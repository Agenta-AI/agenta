"""The per-harness connection-capability table (the data behind ``/inspect``).

Locks what this project contributes: the REAL provider lists each harness reaches (Pi's eight
vault-mapped providers; Claude anthropic-only), the deployment surfaces it can consume in v1,
the two connection modes, the permissive default for an unknown harness, and the document shape
published on ``/inspect`` ``meta``.
"""

from __future__ import annotations

from agenta.sdk.agents.capabilities import (
    HARNESS_CONNECTION_CAPABILITIES,
    PI_VAULT_PROVIDERS,
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_provider,
    harness_capabilities_document,
)


def test_claude_is_anthropic_only():
    assert harness_allows_provider("claude", "anthropic") is True
    assert harness_allows_provider("claude", "openai") is False
    assert harness_allows_provider("claude", "OpenAI") is False  # case-insensitive


def test_pi_and_agenta_reach_the_vault_providers_not_arbitrary_ones():
    for harness in ("pi", "agenta"):
        # Real list, not "*": the eight vault-mapped providers are reachable...
        for provider in PI_VAULT_PROVIDERS:
            assert harness_allows_provider(harness, provider) is True
        # ...but an arbitrary unmapped provider is NOT (the old "*" wildcard is gone).
        assert harness_allows_provider(harness, "anything-custom") is False


def test_unknown_harness_is_permissive():
    assert harness_allows_provider("some-future-harness", "openai") is True
    assert harness_allows_mode("some-future-harness", "agenta") is True
    assert harness_allows_deployment("some-future-harness", "bedrock") is True


def test_two_modes_supported_on_all_known_harnesses():
    for harness in HARNESS_CONNECTION_CAPABILITIES:
        for mode in ("agenta", "self_managed"):
            assert harness_allows_mode(harness, mode) is True
        # The removed `default` mode is no longer supported.
        assert harness_allows_mode(harness, "default") is False
    assert harness_allows_mode("pi", "bogus") is False


def test_pi_only_consumes_direct_deployment_in_v1():
    for harness in ("pi", "agenta"):
        assert harness_allows_deployment(harness, "direct") is True
        for deployment in ("custom", "bedrock", "vertex_ai", "azure"):
            assert harness_allows_deployment(harness, deployment) is False


def test_claude_consumes_custom_gateway_bedrock_and_vertex():
    for deployment in ("direct", "custom", "bedrock", "vertex_ai", "vertex"):
        assert harness_allows_deployment("claude", deployment) is True
    assert harness_allows_deployment("claude", "azure") is False


def test_capabilities_document_shape():
    doc = harness_capabilities_document()
    assert set(doc) == {"pi", "agenta", "claude"}
    assert doc["claude"]["providers"] == ["anthropic"]
    assert doc["claude"]["model_selection"] == "alias"
    assert doc["pi"]["providers"] == list(PI_VAULT_PROVIDERS)
    assert doc["pi"]["connection_modes"] == ["agenta", "self_managed"]
    assert doc["pi"]["deployments"] == ["direct"]
    assert doc["claude"]["deployments"] == [
        "direct",
        "custom",
        "bedrock",
        "vertex_ai",
        "vertex",
    ]
