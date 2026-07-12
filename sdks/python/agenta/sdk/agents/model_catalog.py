"""The curated per-model catalog: one record per model, keyed by the id the harness accepts.

This is the decoration layer over the harness's accepted model set (``capabilities.py`` ``models``
map). Each :class:`ModelCatalogEntry` separates three semantic groups: identity (``id`` /
``provider`` — the join key to the accepted set), sourced facts (``name`` / ``pricing`` /
``context_window`` / ``modalities`` — objective, provenanced), and curated judgments (``label`` /
``description`` / ``ratings`` — subjective, human, sourced from current public info). The catalog
never gates selection; the runtime accepted set does. See
``docs/design/agent-workflows/projects/model-catalog-schema/design.md``.

The data lives in JSON files under ``data/`` (owned by the ``sync-model-catalog`` skill), not in
code:

- ``data/pi_models.generated.json`` — machine-generated from ``@earendil-works/pi-ai``. Objective
  facts only; curated fields absent.
- ``data/pi_models.curated.json`` — human overlay (id -> ``{label?, description?, ratings?}``),
  merged onto the generated facts at load time so a regeneration never overwrites judgments.
- ``data/claude_models.curated.json`` — hand-curated Claude alias entries (facts + judgments).

The catalog is published ADDITIVELY on each harness capability record alongside the existing
``models`` map (``capabilities.py``); readers migrate to it at their own pace.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

_DATA_DIR = Path(__file__).parent / "data"

# Only these curated fields may come from an overlay; the objective facts always win from the
# generated file.
_OVERLAY_FIELDS = ("label", "description", "ratings")


class ModelPricing(BaseModel):
    """A real, sourced price. Never a rating. Units are USD per million tokens."""

    input_per_mtok: float
    output_per_mtok: float
    cache_read_per_mtok: Optional[float] = None
    cache_write_per_mtok: Optional[float] = None
    currency: str = "USD"


class ModelRatings(BaseModel):
    """Curated, relative 1-5 scores. Higher is better on every axis. Never a price.

    The range is enforced. ``cost`` is cost-efficiency (5 = cheapest). Values are sourced from
    current public information, not from a model's own training data.
    """

    cost: Optional[int] = Field(default=None, ge=1, le=5)
    intelligence: Optional[int] = Field(default=None, ge=1, le=5)
    speed: Optional[int] = Field(default=None, ge=1, le=5)


class ModelCatalogEntry(BaseModel):
    """One record per model. Fields split by semantic role; only identity + ``source`` required."""

    # identity: the join key to the accepted set
    id: str
    provider: str

    # provenance of the facts below
    source: Literal["pi_generated", "curated"]

    # concrete, sourced facts (objective)
    name: Optional[str] = None
    pricing: Optional[ModelPricing] = None
    context_window: Optional[int] = None
    modalities: Optional[List[str]] = None

    # curated judgments (subjective)
    label: Optional[str] = None
    description: Optional[str] = None
    ratings: Optional[ModelRatings] = None


class ModelCatalog(BaseModel):
    """The versioned envelope. Additive optional fields need no version bump; a shape change does."""

    schema_version: Literal["1"] = "1"
    models: List[ModelCatalogEntry] = Field(default_factory=list)


def _read_json(name: str) -> dict:
    with open(_DATA_DIR / name, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_pi_model_catalog() -> ModelCatalog:
    """The Pi catalog: generated facts with the human overlay merged on by id.

    The overlay only ever supplies ``label`` / ``description`` / ``ratings``; every objective fact
    comes from the generated file. ``pydantic`` validates each entry on construction (including the
    1-5 rating range), so a malformed data file fails loud here.
    """
    generated = _read_json("pi_models.generated.json")
    overlay = _read_json("pi_models.curated.json").get("overlay", {})

    entries: List[ModelCatalogEntry] = []
    for raw in generated.get("models", []):
        merged = dict(raw)
        curated = overlay.get(raw.get("id"))
        if curated:
            for field in _OVERLAY_FIELDS:
                if field in curated:
                    merged[field] = curated[field]
        entries.append(ModelCatalogEntry.model_validate(merged))

    return ModelCatalog(schema_version="1", models=entries)


def load_claude_model_catalog() -> ModelCatalog:
    """The Claude catalog: hand-curated alias entries, validated on load."""
    curated = _read_json("claude_models.curated.json")
    entries = [
        ModelCatalogEntry.model_validate(raw) for raw in curated.get("models", [])
    ]
    return ModelCatalog(schema_version="1", models=entries)


# Cached at import so ``capabilities.py`` builds its records once. The data files are static and
# ship with the SDK, so a per-process load is enough.
_PI_CATALOG: Optional[ModelCatalog] = None
_CLAUDE_CATALOG: Optional[ModelCatalog] = None


def pi_model_catalog() -> ModelCatalog:
    global _PI_CATALOG
    if _PI_CATALOG is None:
        _PI_CATALOG = load_pi_model_catalog()
    return _PI_CATALOG


def claude_model_catalog() -> ModelCatalog:
    global _CLAUDE_CATALOG
    if _CLAUDE_CATALOG is None:
        _CLAUDE_CATALOG = load_claude_model_catalog()
    return _CLAUDE_CATALOG


def model_catalog_entries(harness: str) -> List[Dict[str, object]]:
    """The catalog entries for a harness, as plain JSON-able dicts (the published shape).

    Pi harnesses share the pi-ai-derived catalog; Claude uses its curated alias catalog. An
    unknown harness has an empty catalog (like the ``models`` map default).
    """
    if harness in ("pi_core", "pi_agenta"):
        catalog = pi_model_catalog()
    elif harness == "claude":
        catalog = claude_model_catalog()
    else:
        return []
    return [entry.model_dump() for entry in catalog.models]
