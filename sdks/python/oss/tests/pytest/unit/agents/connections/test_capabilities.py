"""The minimal per-harness connection-capability table.

Locks the subset this project contributes: which providers each harness reaches and which
connection modes it supports, plus the permissive default for an unknown harness.
"""

from __future__ import annotations

from agenta.sdk.agents.capabilities import (
    HARNESS_CONNECTION_CAPABILITIES,
    harness_allows_mode,
    harness_allows_provider,
)


def test_claude_is_anthropic_only():
    assert harness_allows_provider("claude", "anthropic") is True
    assert harness_allows_provider("claude", "openai") is False
    assert harness_allows_provider("claude", "OpenAI") is False  # case-insensitive


def test_pi_and_agenta_reach_any_provider():
    for harness in ("pi", "agenta"):
        assert harness_allows_provider(harness, "openai") is True
        assert harness_allows_provider(harness, "anything-custom") is True


def test_unknown_harness_is_permissive():
    assert harness_allows_provider("some-future-harness", "openai") is True
    assert harness_allows_mode("some-future-harness", "agenta") is True


def test_modes_supported_on_all_known_harnesses():
    for harness in HARNESS_CONNECTION_CAPABILITIES:
        for mode in ("default", "self_managed", "agenta"):
            assert harness_allows_mode(harness, mode) is True
    assert harness_allows_mode("pi", "bogus") is False
