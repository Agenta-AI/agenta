"""The per-harness connection-capability table (the data behind ``/inspect``).

Locks what this project contributes: the REAL provider lists each harness reaches (Pi's eight
vault-mapped providers; Claude anthropic-only), the deployment surfaces it can consume in v1,
the two connection modes, the permissive default for an unknown harness, and the document shape
published on ``/inspect`` ``meta``.
"""

from __future__ import annotations

from agenta.sdk.agents.capabilities import (
    CLAUDE_MODEL_ALIASES,
    HARNESS_CONNECTION_CAPABILITIES,
    PI_SUBSCRIPTION_MODELS,
    PI_SUBSCRIPTION_PROVIDERS,
    PI_VAULT_PROVIDERS,
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_provider,
    harness_capabilities_document,
)
from agenta.sdk.utils.assets import supported_llm_models


def test_claude_is_anthropic_only():
    assert harness_allows_provider("claude", "anthropic") is True
    assert harness_allows_provider("claude", "openai") is False
    assert harness_allows_provider("claude", "OpenAI") is False  # case-insensitive


def test_pi_and_agenta_reach_the_vault_providers_not_arbitrary_ones():
    for harness in ("pi_core", "pi_agenta"):
        # Real list, not "*": the eight vault-mapped providers are reachable...
        for provider in PI_VAULT_PROVIDERS:
            assert harness_allows_provider(harness, provider) is True
        # ...but an arbitrary unmapped provider is NOT (the old "*" wildcard is gone).
        assert harness_allows_provider(harness, "anything-custom") is False


def test_pi_and_agenta_reach_the_openai_codex_subscription_provider():
    """The ChatGPT/Codex subscription provider is reachable (OAuth login, no vault key).

    Without this, an ``openai-codex`` model fails the agent-layer pre-resolve provider check
    even though the runner drives the subscription fine. ``self_managed`` is the subscription
    path; the provider must be allowed for that mode to ever reach the runner.
    """
    for harness in ("pi_core", "pi_agenta"):
        for provider in PI_SUBSCRIPTION_PROVIDERS:
            assert harness_allows_provider(harness, provider) is True
        assert harness_allows_provider(harness, "openai-codex") is True
        # case-insensitive, like the vault providers
        assert harness_allows_provider(harness, "OpenAI-Codex") is True
        # the subscription is a Pi reach only; Claude stays anthropic-only
        assert harness_allows_provider("claude", "openai-codex") is False


def test_unknown_harness_is_closed():
    # An unmapped harness gets no capability: fail closed, not permissive.
    assert harness_allows_provider("some-future-harness", "openai") is False
    assert harness_allows_mode("some-future-harness", "agenta") is False
    assert harness_allows_deployment("some-future-harness", "bedrock") is False


def test_two_modes_supported_on_all_known_harnesses():
    for harness in HARNESS_CONNECTION_CAPABILITIES:
        for mode in ("agenta", "self_managed"):
            assert harness_allows_mode(harness, mode) is True
        # The removed `default` mode is no longer supported.
        assert harness_allows_mode(harness, "default") is False
    assert harness_allows_mode("pi_core", "bogus") is False


def test_pi_only_consumes_direct_deployment_in_v1():
    for harness in ("pi_core", "pi_agenta"):
        assert harness_allows_deployment(harness, "direct") is True
        for deployment in ("custom", "bedrock", "vertex_ai", "azure"):
            assert harness_allows_deployment(harness, deployment) is False


def test_claude_consumes_custom_gateway_bedrock_and_vertex():
    for deployment in ("direct", "custom", "bedrock", "vertex_ai", "vertex"):
        assert harness_allows_deployment("claude", deployment) is True
    assert harness_allows_deployment("claude", "azure") is False


def test_capabilities_document_shape():
    doc = harness_capabilities_document()
    assert set(doc) == {"pi_core", "pi_agenta", "claude"}
    assert doc["claude"]["providers"] == ["anthropic"]
    assert doc["claude"]["model_selection"] == "alias"
    assert doc["pi_core"]["providers"] == list(PI_VAULT_PROVIDERS) + list(
        PI_SUBSCRIPTION_PROVIDERS
    )
    assert doc["pi_core"]["connection_modes"] == ["agenta", "self_managed"]
    assert doc["pi_core"]["deployments"] == ["direct"]
    assert doc["claude"]["deployments"] == [
        "direct",
        "custom",
        "bedrock",
        "vertex_ai",
        "vertex",
    ]
    assert doc["claude"]["mcp"] == {
        "user_servers": {
            "connection_types": ["http"],
            "credentials": ["none", "header_secret_refs"],
        }
    }
    assert "mcp" not in doc["pi_core"]
    assert "mcp" not in doc["pi_agenta"]


def test_every_harness_publishes_a_models_map():
    doc = harness_capabilities_document()
    for harness in ("pi_core", "pi_agenta", "claude"):
        assert isinstance(doc[harness]["models"], dict)
        assert doc[harness]["models"], f"{harness} has an empty models map"


def test_pi_models_are_a_subset_of_the_shared_catalog():
    # Each Pi harness publishes, per vault provider, exactly that provider's catalog ids, plus the
    # subscription/OAuth providers' explicit ids (which the shared catalog does not list).
    for harness in ("pi_core", "pi_agenta"):
        models = HARNESS_CONNECTION_CAPABILITIES[harness].models
        # The published providers are the vault-mapped ones plus the subscription providers.
        assert set(models) == set(PI_VAULT_PROVIDERS) | set(PI_SUBSCRIPTION_PROVIDERS)
        for provider in PI_VAULT_PROVIDERS:
            # The published ids are exactly the shared catalog's ids for that provider
            # (verbatim — most are provider-prefixed like ``anthropic/...``, but some
            # providers, e.g. openai, list bare ids like ``gpt-5.5``).
            assert models[provider] == list(supported_llm_models[provider])
        for provider, ids in PI_SUBSCRIPTION_MODELS.items():
            # The subscription providers carry their explicit ids and are NOT in the shared
            # catalog (they authenticate via OAuth, not a vault provider_key).
            assert models[provider] == list(ids)
            assert provider not in supported_llm_models


def test_pi_publishes_concrete_gpt_5_6_models_for_both_openai_providers():
    expected = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]

    for harness in ("pi_core", "pi_agenta"):
        models = HARNESS_CONNECTION_CAPABILITIES[harness].models
        for provider in ("openai", "openai-codex"):
            assert models[provider][:3] == expected
            assert "gpt-5.6" not in models[provider]


def test_claude_models_are_the_alias_set_under_anthropic():
    models = HARNESS_CONNECTION_CAPABILITIES["claude"].models
    assert set(models) == {"anthropic"}
    assert models["anthropic"] == list(CLAUDE_MODEL_ALIASES)
    # Aliases, not provider-prefixed ids.
    assert "opus" in models["anthropic"]
    assert "opus[1m]" in models["anthropic"]
    assert all("/" not in alias for alias in models["anthropic"])


def test_models_round_trip_as_a_plain_dict():
    doc = harness_capabilities_document()
    # The published document is plain JSON-able dicts/lists, no model objects.
    for harness, entry in doc.items():
        assert isinstance(entry, dict)
        assert isinstance(entry["models"], dict)
        for provider, ids in entry["models"].items():
            assert isinstance(provider, str)
            assert isinstance(ids, list)
            assert all(isinstance(model_id, str) for model_id in ids)
