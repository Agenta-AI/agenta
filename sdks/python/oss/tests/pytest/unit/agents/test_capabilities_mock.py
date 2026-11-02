"""Mock capabilities: a placeholder provider family so gating never rejects a mock run."""

from __future__ import annotations

from agenta.sdk.agents.capabilities import (
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_pair,
    harness_allows_provider,
)


def test_mock_connection_capabilities() -> None:
    assert harness_allows_provider("mock", "mock") is True
    assert harness_allows_provider("mock", "openai") is False
    assert harness_allows_mode("mock", "agenta") is True
    assert harness_allows_mode("mock", "self_managed") is True
    assert harness_allows_deployment("mock", "direct") is True
    assert harness_allows_deployment("mock", "custom") is False


def test_mock_pair_allowed_only_for_its_placeholder_provider() -> None:
    assert harness_allows_pair("mock", "mock", "direct") is True
    assert harness_allows_pair("mock", "openai", "direct") is False
