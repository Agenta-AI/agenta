"""The provider-family prefixes litellm expects on a model id.

`litellm_model_id` is the one place that turns a family plus a model id into the string
litellm routes on. It has to be idempotent — it runs as a safety net over ids that are usually
already correct — and it has to leave alone the two cases that look like they need work but do
not: OpenAI ids (bare by design) and a provider outside the catalog.
"""

import pytest

from agenta.sdk.utils.assets import (
    litellm_model_id,
    litellm_provider_prefixes,
    supported_llm_models,
)


@pytest.mark.parametrize(
    "model, provider, expected",
    [
        # A bare id gets its family's prefix.
        ("claude-fable-5", "anthropic", "anthropic/claude-fable-5"),
        ("command-r", "cohere", "cohere/command-r"),
        ("gemini-2.5-flash", "gemini", "gemini/gemini-2.5-flash"),
        ("llama-3.3-70b-versatile", "groq", "groq/llama-3.3-70b-versatile"),
        ("mistral-small", "mistral", "mistral/mistral-small"),
        ("MiniMax-M3", "minimax", "minimax/MiniMax-M3"),
        (
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "together_ai",
            "together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo",
        ),
        # The provider kind is "perplexityai"; litellm spells the model prefix "perplexity".
        ("sonar-pro", "perplexityai", "perplexity/sonar-pro"),
        # Already prefixed: unchanged, in every family.
        ("anthropic/claude-fable-5", "anthropic", "anthropic/claude-fable-5"),
        ("perplexity/sonar-pro", "perplexityai", "perplexity/sonar-pro"),
        ("mistral/mistral-small", "mistral", "mistral/mistral-small"),
        (
            "together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "together_ai",
            "together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo",
        ),
        # OpenAI ids are bare in litellm, so there is nothing to add — in either direction.
        ("gpt-4o-mini", "openai", "gpt-4o-mini"),
        ("gpt-5.6-sol", "openai", "gpt-5.6-sol"),
        ("o3-mini", "openai", "o3-mini"),
        # The OpenRouter trap: its ids are themselves `vendor/model`, so a leading path segment
        # does NOT mean the id is already prefixed. Only the family's own prefix counts.
        (
            "deepseek/deepseek-v4-flash",
            "openrouter",
            "openrouter/deepseek/deepseek-v4-flash",
        ),
        (
            "openrouter/deepseek/deepseek-v4-flash",
            "openrouter",
            "openrouter/deepseek/deepseek-v4-flash",
        ),
        ("x-ai/grok-4.3", "openrouter", "openrouter/x-ai/grok-4.3"),
        # Stored kinds litellm has no provider for: identity, because no prefix would route
        # them. An id that already carries the defunct spelling is passed through as-is too.
        ("luminous-base", "alephalpha", "luminous-base"),
        ("aleph_alpha/luminous-base", "alephalpha", "aleph_alpha/luminous-base"),
        ("Llama-2-7b-chat-hf", "anyscale", "Llama-2-7b-chat-hf"),
        # A provider the catalog does not know can never mangle an id.
        ("some-model", "not-a-provider", "some-model"),
        ("some-model", "", "some-model"),
        ("some-model", None, "some-model"),
        ("", "anthropic", ""),
    ],
)
def test_litellm_model_id_maps_both_directions(model, provider, expected):
    assert litellm_model_id(model, provider) == expected


@pytest.mark.parametrize("model, provider", [("claude-fable-5", "anthropic")])
def test_prefixing_is_idempotent_under_repetition(model, provider):
    once = litellm_model_id(model, provider)

    assert litellm_model_id(once, provider) == once
    assert litellm_model_id(litellm_model_id(once, provider), provider) == once


def test_every_supported_family_has_a_prefix_entry():
    """A new family in the catalog is a new decision, not a silent pass-through.

    Missing entries fail here rather than resolving to "no prefix" at request time, where the
    symptom is an opaque provider error from litellm.
    """
    missing = set(supported_llm_models) - set(litellm_provider_prefixes)

    assert not missing, f"families with no litellm prefix decision: {sorted(missing)}"


def test_only_the_modelless_vault_kinds_sit_outside_the_catalog():
    """The table is keyed by stored vault kind, which is a superset of the catalog families.

    `anyscale` and `alephalpha` are `StandardProviderKind` values a project can still hold a
    record for, but they ship no catalog models. They are carried so this table and the
    frontend's match key-for-key; anything else appearing here is a stale entry.

    Paired with `MODELLESS_KINDS` in
    `web/packages/agenta-entities/tests/unit/litellm-model-id.test.ts`, which asserts the same
    two keys from the other side. A new `StandardProviderKind` has to land in both tables in
    the same change or one of the two tests fails — which is the intended signal, not a local
    list to extend past its twin.
    """
    extra = set(litellm_provider_prefixes) - set(supported_llm_models)

    assert extra == {"anyscale", "alephalpha"}, (
        f"unexpected prefix entries outside the catalog: {sorted(extra)}"
    )


def test_openai_is_the_only_catalog_family_without_a_prefix():
    """Among families that ship models, only OpenAI is bare — the rest must carry a prefix.

    Scoped to the catalog because None means two different things in this table: OpenAI is bare
    by litellm's own spelling, while a modelless kind is identity for want of any provider to
    route to. Those are covered separately by `test_the_modelless_kinds_are_identity`.
    """
    unprefixed = {
        family
        for family, prefix in litellm_provider_prefixes.items()
        if not prefix and family in supported_llm_models
    }

    assert unprefixed == {"openai"}


def test_the_modelless_kinds_are_identity():
    """A kind litellm cannot route gets no prefix, however plausible the spelling looks.

    litellm 1.92.0 has no `anyscale` or `aleph_alpha` provider, so `aleph_alpha/luminous-base`
    fails exactly like the bare id. Mapping them would put a routing claim in the table that
    litellm cannot honour, which is the one thing this table exists not to do.
    """
    unroutable = {
        family: litellm_provider_prefixes[family]
        for family in ("anyscale", "alephalpha")
    }

    assert unroutable == {"anyscale": None, "alephalpha": None}


def test_no_catalog_model_carries_a_prefix_litellm_cannot_route():
    """A prefix is only worth adding if litellm routes on it.

    litellm drops providers as services shut down, and a prefix it no longer recognizes fails
    exactly like no prefix at all ("LLM Provider NOT provided"). That is tolerable for a kind
    with no models to offer, but never for a family we ship models for — there it would break
    every one of them. Scoped to families with catalog models so it holds regardless of which
    defunct providers this litellm build still lists.
    """
    import litellm

    known = {str(getattr(p, "value", p)) for p in litellm.provider_list}
    unroutable = {
        family: prefix
        for family, prefix in litellm_provider_prefixes.items()
        if prefix and prefix not in known and supported_llm_models.get(family)
    }

    assert not unroutable, (
        f"catalog families with prefixes litellm cannot route: {unroutable}"
    )


def test_catalog_ids_already_carry_their_familys_prefix():
    """The table has to agree with how the catalog actually spells its ids.

    This is what catches a wrong prefix (e.g. "perplexityai" instead of "perplexity"): every
    shipped id would start being rewritten, and every one of them would break.
    """
    rewritten = {
        model: litellm_model_id(model, family)
        for family, models in supported_llm_models.items()
        for model in models
        if litellm_model_id(model, family) != model
    }

    assert not rewritten, f"catalog ids the prefix table would rewrite: {rewritten}"
