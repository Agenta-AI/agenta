"""The curated per-model catalog: one record per model, keyed by the id the harness accepts.

This is the decoration layer over the harness's accepted model set (``capabilities.py`` ``models``
map). Each :class:`ModelCatalogEntry` separates three semantic groups: identity (``id`` /
``provider`` — the join key to the accepted set), sourced facts (``name`` / ``pricing`` /
``context_window`` / ``modalities`` — objective, provenanced), and curated judgments (``label`` /
``description`` / ``ratings`` — subjective, human, sourced from current public info). The catalog
never gates selection; the runtime accepted set does. Its ``modalities`` fact feeds the runtime
delivery gate through the connection resolver, but the catalog still gates nothing itself. See
``docs/design/agent-workflows/projects/model-catalog-schema/design.md``.

The data lives in JSON files under ``data/`` (owned by the ``sync-model-catalog`` skill), not in
code:

- ``data/pi_models.generated.json`` — machine-generated from ``@earendil-works/pi-ai``. Objective
  facts only; curated fields absent.
- ``data/pi_models.curated.json`` — human overlay (id -> ``{label?, description?, ratings?}``),
  merged onto the generated facts at load time so a regeneration never overwrites judgments. Its
  ``additions`` list carries whole entries for models the pinned pi-ai release predates; a
  generated entry of the same id always wins, so an addition retires itself on the next
  regeneration.
- ``data/claude_models.curated.json`` — hand-curated Claude alias entries (facts + judgments).
- ``data/codex_models.curated.json``: hand-curated Codex entries (facts + judgments), with the
  same shape as the Claude catalog.

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
    """The Pi catalog: generated facts with the human overlay merged on by id, plus additions.

    The overlay only ever supplies ``label`` / ``description`` / ``ratings``; every objective fact
    comes from the generated file. ``pydantic`` validates each entry on construction (including the
    1-5 rating range), so a malformed data file fails loud here.

    ``additions`` carries whole hand-written entries (``source: "curated"``) for models released
    after the pinned pi-ai snapshot. Without them such a model has no catalog entry at all, so the
    picker can only show its bare id and ``PROVIDER_DEFAULT_MODELS`` cannot offer it. A generated
    entry of the same id always wins: the addition is a stopgap that retires itself the moment a
    regeneration carries the model, rather than shadowing fresher sourced facts.
    """
    generated = _read_json("pi_models.generated.json")
    curated_file = _read_json("pi_models.curated.json")
    overlay = curated_file.get("overlay", {})
    additions = curated_file.get("additions", [])

    def with_overlay(raw: dict) -> dict:
        merged = dict(raw)
        curated = overlay.get(raw.get("id"))
        if curated:
            for field in _OVERLAY_FIELDS:
                if field in curated:
                    merged[field] = curated[field]
        return merged

    entries: List[ModelCatalogEntry] = []
    generated_ids = set()
    for raw in generated.get("models", []):
        generated_ids.add(raw.get("id"))
        entries.append(ModelCatalogEntry.model_validate(with_overlay(raw)))

    # The overlay decorates an addition too, so its judgments survive the regeneration that
    # retires the addition.
    for raw in additions:
        if raw.get("id") in generated_ids:
            continue
        entries.append(ModelCatalogEntry.model_validate(with_overlay(raw)))

    return ModelCatalog(schema_version="1", models=entries)


def load_claude_model_catalog() -> ModelCatalog:
    """The Claude catalog: hand-curated alias entries, validated on load."""
    curated = _read_json("claude_models.curated.json")
    entries = [
        ModelCatalogEntry.model_validate(raw) for raw in curated.get("models", [])
    ]
    return ModelCatalog(schema_version="1", models=entries)


def load_codex_model_catalog() -> ModelCatalog:
    """The Codex catalog: hand-curated model entries, validated on load."""
    curated = _read_json("codex_models.curated.json")
    entries = [
        ModelCatalogEntry.model_validate(raw) for raw in curated.get("models", [])
    ]
    return ModelCatalog(schema_version="1", models=entries)


# Cached at import so ``capabilities.py`` builds its records once. The data files are static and
# ship with the SDK, so a per-process load is enough.
_PI_CATALOG: Optional[ModelCatalog] = None
_CLAUDE_CATALOG: Optional[ModelCatalog] = None
_CODEX_CATALOG: Optional[ModelCatalog] = None


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


def codex_model_catalog() -> ModelCatalog:
    global _CODEX_CATALOG
    if _CODEX_CATALOG is None:
        _CODEX_CATALOG = load_codex_model_catalog()
    return _CODEX_CATALOG


def _catalog_id(provider: Optional[str], model_id: str) -> str:
    """Build the ``provider/model`` join key.

    Catalog ids carry a lowercase provider, and the rest of the system (environment resolver,
    connection matching) treats provider names case-insensitively, so a caller-supplied
    ``"OpenAI"`` must still join.
    """
    head, separator, tail = model_id.partition("/")
    if provider is None:
        return f"{head.lower()}/{tail}" if separator else model_id
    if separator and head.lower() == provider.lower():
        return f"{provider.lower()}/{tail}"
    return f"{provider.lower()}/{model_id}"


# Provider spellings that name a deployment of a family the catalog spells differently: a
# bridge can serve a model through a deployment while the catalog lists the model under the
# family name (``vertex_ai`` serves Google's Gemini models, catalogued under ``gemini``).
# The alias only widens an otherwise-missed lookup; it can never change a join that succeeds.
_PROVIDER_FAMILY_ALIASES: Dict[str, str] = {
    "vertex": "gemini",
    "vertex_ai": "gemini",
}


def _strip_custom_provider_kind(model_id: str) -> str:
    """Drop a custom-provider kind segment: ``<connection>/custom/<model>`` -> ``<model>``.

    Custom-provider model keys carry the vault storage namespace plus a ``custom`` kind segment
    (``Agenta/custom/gemini/gemini-3.7-flash``, legacy ``openai/<name>/custom/<model>``); the
    tail after ``custom/`` is the catalog-spelled model id. No catalog id contains a ``custom``
    segment, so the strip can never distort a direct spelling.
    """
    parts = model_id.split("/")
    if "custom" in parts[:-1]:
        return "/".join(parts[parts.index("custom") + 1 :])
    return model_id


def _pi_input_modalities(model_id: str, provider: Optional[str]) -> Optional[List[str]]:
    catalog = pi_model_catalog()

    def entry_for(catalog_id: str) -> Optional[ModelCatalogEntry]:
        return next((item for item in catalog.models if item.id == catalog_id), None)

    # The unchanged strict join first: every id that joins today keeps joining, including the
    # multi-segment spellings (``openrouter/google/gemini-3.7-flash``) where ``provider``
    # prefixes a provider-qualified model id.
    entry = entry_for(_catalog_id(provider, model_id))
    # A custom-provider/bridge run passes the CONNECTION's provider (e.g. the starter-credits
    # bridge) while the model id already names its own family, so let the id speak for itself.
    if entry is None:
        entry = entry_for(_catalog_id(None, model_id))
    # A bridge can also serve the model through a deployment spelling the catalog does not use.
    # The alias applies to the deployment spelling itself: a qualified id must carry it as its
    # own head, and an unqualified id takes it from ``provider``. An arbitrary qualified head
    # (``unknown-x/gemini-3.7-flash``) stays unknown rather than resolving through the tail's
    # model.
    if entry is None:
        head, separator, tail = model_id.partition("/")
        if separator:
            spellings = (head,) if head.lower() in _PROVIDER_FAMILY_ALIASES else ()
        else:
            spellings = (provider,)
        for spelling in spellings:
            family = _PROVIDER_FAMILY_ALIASES.get((spelling or "").lower())
            if family is None:
                continue
            entry = entry_for(_catalog_id(family, tail if separator else model_id))
            if entry is not None:
                break
    if entry is None or entry.modalities is None:
        return None
    return list(entry.modalities)


def model_input_modalities(
    harness: Optional[str], model_id: str, *, provider: Optional[str] = None
) -> Optional[List[str]]:
    """Look up input modalities using the model id form accepted by ``harness``."""
    entry: Optional[ModelCatalogEntry]
    if harness == "pi_core":
        # A bridge/custom-provider spelling (`<connection>/custom/<model>`) addresses the
        # catalog-spelled model in its tail, so strip the kind segment before joining.
        return _pi_input_modalities(_strip_custom_provider_kind(model_id), provider)
    if harness == "claude":
        catalog = claude_model_catalog()
        catalog_id = model_id
    elif harness == "codex":
        # Unknown ids deliberately return None, degrading to a workspace copy instead of guessing.
        catalog = codex_model_catalog()
        catalog_id = model_id
    else:
        return None

    entry = next((item for item in catalog.models if item.id == catalog_id), None)
    if harness == "claude" and entry is None:
        # Reuse the same sourced Anthropic fact from Pi's generated catalog; do not guess.
        pi_catalog_id = _catalog_id("anthropic", model_id)
        entry = next(
            (item for item in pi_model_catalog().models if item.id == pi_catalog_id),
            None,
        )
    if entry is None or entry.modalities is None:
        return None
    return list(entry.modalities)


def model_catalog_entries(harness: str) -> List[Dict[str, object]]:
    """The catalog entries for a harness, as plain JSON-able dicts (the published shape).

    Pi harnesses share the pi-ai-derived catalog; Claude uses its curated alias catalog; Codex
    uses its curated model catalog. An unknown harness has an empty catalog (like the ``models``
    map default).
    """
    if harness == "pi_core":
        catalog = pi_model_catalog()
    elif harness == "claude":
        catalog = claude_model_catalog()
    elif harness == "codex":
        catalog = codex_model_catalog()
    else:
        return []
    return [entry.model_dump() for entry in catalog.models]
