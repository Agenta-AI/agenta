"""The curated model-catalog schema, data files, and loader (design: model-catalog-schema).

Locks: the three JSON data files load and validate (including the 1-5 rating range), the Pi
overlay merges onto the generated facts without overwriting them, the Claude catalog covers exactly
the accepted alias set, and ``capabilities.py`` publishes ``model_catalog`` ADDITIVELY next to the
unchanged ``models`` map.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.capabilities import (
    CLAUDE_MODEL_ALIASES,
    HARNESS_CONNECTION_CAPABILITIES,
    harness_catalog_document,
)
from agenta.sdk.agents.model_catalog import (
    ModelCatalogEntry,
    ModelRatings,
    claude_model_catalog,
    load_claude_model_catalog,
    load_pi_model_catalog,
    model_catalog_entries,
    pi_model_catalog,
)

_ALL_HARNESSES = ("pi_core", "pi_agenta", "claude")


def test_data_files_load_and_validate():
    pi = load_pi_model_catalog()
    claude = load_claude_model_catalog()
    assert pi.schema_version == "1"
    assert claude.schema_version == "1"
    assert pi.models, "pi catalog is empty"
    assert claude.models, "claude catalog is empty"
    # Every entry is a validated ModelCatalogEntry (pydantic enforced on load).
    assert all(isinstance(e, ModelCatalogEntry) for e in pi.models)
    assert all(isinstance(e, ModelCatalogEntry) for e in claude.models)


def test_ratings_are_enforced_1_to_5():
    # Valid boundaries construct.
    ModelRatings(cost=1, intelligence=5, speed=3)
    # Out of range fails loud, in both directions.
    with pytest.raises(ValidationError):
        ModelRatings(cost=0)
    with pytest.raises(ValidationError):
        ModelRatings(intelligence=6)


def test_every_data_file_rating_is_in_range():
    for catalog in (pi_model_catalog(), claude_model_catalog()):
        for entry in catalog.models:
            if entry.ratings is None:
                continue
            for axis in (
                entry.ratings.cost,
                entry.ratings.intelligence,
                entry.ratings.speed,
            ):
                assert axis is None or 1 <= axis <= 5


def test_pi_ids_are_unique_and_provider_prefixed():
    entries = pi_model_catalog().models
    ids = [e.id for e in entries]
    assert len(ids) == len(set(ids)), "duplicate id in the Pi catalog"
    for entry in entries:
        # id is the provider/model join key; its prefix is the entry's provider.
        assert entry.id.startswith(f"{entry.provider}/"), entry.id
        assert entry.source == "pi_generated"


def test_pi_overlay_merges_without_overwriting_facts():
    # A curated Pi entry gets its label/description/ratings from the overlay while keeping the
    # generated pricing facts (the overlay never carries pricing).
    entry = next(
        e for e in pi_model_catalog().models if e.id == "anthropic/claude-fable-5"
    )
    assert entry.label == "Fable"
    assert entry.description
    assert entry.ratings is not None and entry.ratings.intelligence == 5
    # Facts still come from the generated file, not the overlay.
    assert entry.pricing is not None
    assert entry.pricing.input_per_mtok == 10.0
    assert entry.pricing.output_per_mtok == 50.0
    assert entry.context_window == 1000000


def test_uncurated_pi_entry_is_valid_with_absent_curated_fields():
    # Optionality is real: an uncurated Pi model is a valid entry with no label/description/ratings.
    uncurated = [
        e for e in pi_model_catalog().models if e.label is None and e.ratings is None
    ]
    assert uncurated, "expected some uncurated Pi entries"
    sample = uncurated[0]
    assert sample.name is not None  # frontend falls back to name


def test_claude_catalog_covers_exactly_the_accepted_alias_set():
    entries = claude_model_catalog().models
    ids = {e.id for e in entries}
    # The catalog tracks the accepted set: every accepted alias has an entry, and nothing extra.
    assert ids == set(CLAUDE_MODEL_ALIASES)
    for entry in entries:
        assert entry.provider == "anthropic"
        assert entry.source == "curated"
        assert "/" not in entry.id  # bare aliases, not provider-prefixed


def test_claude_catalog_uses_stable_harness_request_values():
    assert CLAUDE_MODEL_ALIASES == [
        "default",
        "sonnet",
        "haiku",
        "opus[1m]",
        "claude-fable-5",
    ]


def test_fable_ships_as_a_current_fact_via_the_pi_anthropic_block():
    # Fable is the current Anthropic frontier and reaches the picker through the Pi catalog even
    # though it is not (yet) a Claude Code alias.
    entry = next(
        e for e in pi_model_catalog().models if e.id == "anthropic/claude-fable-5"
    )
    assert entry.name == "Claude Fable 5"
    assert entry.ratings is not None and entry.ratings.intelligence == 5


def test_capabilities_publishes_model_catalog_additively():
    catalog = harness_catalog_document()
    for harness in _ALL_HARNESSES:
        caps = catalog[harness]["capabilities"]
        # The old field is untouched (backward compatible)...
        assert isinstance(caps["models"], dict) and caps["models"]
        # ...and the new field is published alongside it as a non-empty list of dict entries.
        published = caps["model_catalog"]
        assert isinstance(published, list) and published
        assert all(isinstance(item, dict) for item in published)
        assert all("id" in item and "provider" in item for item in published)


def test_model_catalog_entries_helper_matches_the_published_field():
    catalog = harness_catalog_document()
    for harness in _ALL_HARNESSES:
        assert (
            model_catalog_entries(harness)
            == catalog[harness]["capabilities"]["model_catalog"]
        )
    # An unknown harness has an empty catalog, mirroring the models-map default.
    assert model_catalog_entries("some-future-harness") == []


def test_claude_model_catalog_ids_match_the_models_map():
    # For Claude the catalog id set equals the published models map (the accepted alias set), so a
    # picker reading either stays consistent.
    models = HARNESS_CONNECTION_CAPABILITIES["claude"].models["anthropic"]
    catalog_ids = [e.id for e in claude_model_catalog().models]
    assert set(catalog_ids) == set(models)


def test_pricing_and_ratings_never_collide_in_type():
    # A price is a float dollar amount; a rating is an int 1-5. They live in distinct sub-objects.
    for entry in claude_model_catalog().models:
        if entry.pricing is not None:
            assert isinstance(entry.pricing.input_per_mtok, float)
        if entry.ratings is not None and entry.ratings.cost is not None:
            assert isinstance(entry.ratings.cost, int)
