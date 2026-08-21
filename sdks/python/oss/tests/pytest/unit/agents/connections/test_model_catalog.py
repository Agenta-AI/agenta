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
    PROVIDER_DEFAULT_MODELS,
    harness_catalog_document,
)
from agenta.sdk.agents import model_catalog as model_catalog_module
from agenta.sdk.agents.model_catalog import (
    ModelCatalogEntry,
    ModelRatings,
    claude_model_catalog,
    codex_model_catalog,
    load_claude_model_catalog,
    load_codex_model_catalog,
    load_pi_model_catalog,
    model_catalog_entries,
    model_input_modalities,
    pi_model_catalog,
)

_ALL_HARNESSES = ("pi_core", "pi_agenta", "claude", "codex")


def test_data_files_load_and_validate():
    pi = load_pi_model_catalog()
    claude = load_claude_model_catalog()
    codex = load_codex_model_catalog()
    assert pi.schema_version == "1"
    assert claude.schema_version == "1"
    assert codex.schema_version == "1"
    assert pi.models, "pi catalog is empty"
    assert claude.models, "claude catalog is empty"
    assert codex.models, "codex catalog is empty"
    # Every entry is a validated ModelCatalogEntry (pydantic enforced on load).
    assert all(isinstance(e, ModelCatalogEntry) for e in pi.models)
    assert all(isinstance(e, ModelCatalogEntry) for e in claude.models)
    assert all(isinstance(e, ModelCatalogEntry) for e in codex.models)


def test_every_codex_model_declares_image_input():
    entries = codex_model_catalog().models
    assert entries, "codex catalog is empty"
    assert all(entry.modalities and "image" in entry.modalities for entry in entries)


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
        # Generated facts, or a hand-written addition for a model the pinned pi-ai predates.
        assert entry.source in ("pi_generated", "curated"), entry.id


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


def test_gemini_3_6_flash_is_published_with_its_display_name():
    # The model postdates the pinned pi-ai snapshot, so it reaches the catalog through the curated
    # `additions` list. Without an entry the picker can only show the bare id, which is the bug
    # this pins: the Model row must read "Gemini 3.6 Flash".
    entries = model_catalog_entries("pi_core")
    entry = next(
        (item for item in entries if item["id"] == "gemini/gemini-3.6-flash"), None
    )
    assert entry is not None, "gemini/gemini-3.6-flash missing from the pi catalog"
    assert entry["name"] == "Gemini 3.6 Flash"
    assert entry["provider"] == "gemini"
    assert entry["source"] == "curated"
    assert entry["context_window"] == 1048576


def test_gemini_3_6_flash_is_offered_as_a_default_model():
    # A curated default is dropped when the harness cannot select it, so the catalog entry and the
    # PROVIDER_DEFAULT_MODELS line only work together.
    assert "gemini/gemini-3.6-flash" in PROVIDER_DEFAULT_MODELS["gemini"]
    defaults = harness_catalog_document()["pi_core"]["capabilities"]["default_models"]
    assert "gemini/gemini-3.6-flash" in defaults["gemini"]


def test_a_curated_addition_never_shadows_a_generated_entry(monkeypatch):
    # The addition is a stopgap until a regeneration carries the model. When both files name the
    # same id the generated facts win, so an addition left behind cannot mask fresher facts.
    generated = {
        "models": [
            {
                "id": "gemini/overlapping",
                "provider": "gemini",
                "source": "pi_generated",
                "name": "From pi-ai",
            }
        ]
    }
    curated = {
        "overlay": {},
        "additions": [
            {
                "id": "gemini/overlapping",
                "provider": "gemini",
                "source": "curated",
                "name": "Hand written",
            },
            {
                "id": "gemini/only-curated",
                "provider": "gemini",
                "source": "curated",
                "name": "Only curated",
            },
        ],
    }
    monkeypatch.setattr(
        model_catalog_module,
        "_read_json",
        lambda name: generated if "generated" in name else curated,
    )

    names = {entry.id: entry.name for entry in load_pi_model_catalog().models}
    assert names["gemini/overlapping"] == "From pi-ai"
    assert names["gemini/only-curated"] == "Only curated"


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


@pytest.mark.parametrize("harness", ["pi_core", "pi_agenta"])
def test_pi_input_modalities_lookup_joins_resolved_provider_and_model(harness):
    assert model_input_modalities(harness, "gpt-5.5", provider="openai") == [
        "text",
        "image",
    ]


def test_input_modalities_lookup_is_case_insensitive_on_provider():
    # Provider names are matched case-insensitively everywhere else (environment resolver,
    # connection matching); a mixed-case provider must not silently drop the modality fact.
    assert model_input_modalities(
        "pi_core", "gpt-5.5", provider="OpenAI"
    ) == model_input_modalities("pi_core", "gpt-5.5", provider="openai")
    assert model_input_modalities("pi_core", "OpenAI/gpt-5.5", provider="OpenAI") == [
        "text",
        "image",
    ]
    assert model_input_modalities(
        "claude", "claude-sonnet-4-6", provider="Anthropic"
    ) == ["text", "image"]


def test_claude_input_modalities_lookup_uses_bare_alias():
    assert model_input_modalities("claude", "sonnet", provider="anthropic") == [
        "text",
        "image",
    ]


def test_codex_input_modalities_lookup_uses_bare_model_id():
    assert model_input_modalities("codex", "gpt-5.6-sol", provider="openai") == [
        "text",
        "image",
    ]


def test_unknown_codex_model_input_modalities_returns_none():
    assert model_input_modalities("codex", "codex-not-real", provider="openai") is None


@pytest.mark.parametrize("model_id", ["claude-sonnet-4-6", "claude-opus-4-8"])
def test_claude_dated_model_input_modalities_reuse_pi_catalog_fact(model_id):
    assert model_input_modalities("claude", model_id, provider="anthropic") == [
        "text",
        "image",
    ]


def test_input_modalities_lookup_miss_returns_none():
    assert (
        model_input_modalities("pi_core", "workspace-only-model", provider="openai")
        is None
    )
    assert model_input_modalities("future-harness", "sonnet") is None
    assert (
        model_input_modalities("claude", "claude-not-real", provider="anthropic")
        is None
    )


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


def test_default_models_are_published_per_harness_in_its_own_spelling():
    catalog = harness_catalog_document()

    pi_defaults = catalog["pi_core"]["capabilities"]["default_models"]
    assert set(pi_defaults) == set(PROVIDER_DEFAULT_MODELS)
    # Pi spells the openai family bare and every other family provider-prefixed; the defaults
    # follow the accepted set rather than the curated list's canonical spelling.
    assert pi_defaults["openai"] == ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
    assert pi_defaults["anthropic"] == [
        "anthropic/claude-fable-5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-haiku-4-5",
    ]
    assert pi_defaults["openrouter"] == PROVIDER_DEFAULT_MODELS["openrouter"]

    # Claude selects by alias: `claude-fable-5` is its own alias, and the versioned sonnet and
    # haiku ids arrive under the tier alias Claude actually accepts. Opus is absent because it
    # is not curated yet, not because the alias is missing.
    assert catalog["claude"]["capabilities"]["default_models"] == {
        "anthropic": ["claude-fable-5", "sonnet", "haiku"]
    }
    # Codex reaches openai only, and names its models bare.
    assert catalog["codex"]["capabilities"]["default_models"] == {
        "openai": ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
    }


def test_default_models_are_a_subset_of_what_the_harness_can_select():
    for harness, caps in HARNESS_CONNECTION_CAPABILITIES.items():
        for provider, defaults in caps.default_models.items():
            # Scoped to the provider: an id under another provider's catalog is not something
            # this provider's connection can select.
            catalog_ids = {
                str(entry["id"])
                for entry in caps.model_catalog
                if entry.get("provider") == provider
            }
            assert provider in caps.providers, harness
            selectable = set(caps.models.get(provider) or []) | catalog_ids
            assert set(defaults) <= selectable, (harness, provider)


def test_curated_default_models_exist_in_the_pinned_pi_catalog():
    catalog_ids = {entry.id for entry in pi_model_catalog().models}
    for provider, models in PROVIDER_DEFAULT_MODELS.items():
        for model_id in models:
            assert model_id in catalog_ids, (provider, model_id)
    # Pending a catalog refresh: the founder-approved Anthropic list also names Opus 5, which
    # the pinned pi-ai version does not carry yet (see the note in capabilities.py).
    assert "anthropic/claude-opus-5" not in catalog_ids
