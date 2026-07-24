"""Codex Milestone 1 capabilities allow managed OpenAI direct connections only."""

from __future__ import annotations

from agenta.sdk.agents.capabilities import (
    HARNESS_CONNECTION_CAPABILITIES,
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_provider,
)
from agenta.sdk.agents.model_catalog import model_catalog_entries


def test_codex_milestone_one_connection_capabilities() -> None:
    assert harness_allows_provider("codex", "openai") is True
    assert harness_allows_provider("codex", "anthropic") is False
    assert harness_allows_mode("codex", "agenta") is True
    assert harness_allows_mode("codex", "self_managed") is False
    assert harness_allows_deployment("codex", "direct") is True
    assert harness_allows_deployment("codex", "custom") is False


def test_codex_milestone_one_model_sets() -> None:
    capability_models = HARNESS_CONNECTION_CAPABILITIES["codex"].models["openai"]
    catalog_models = [entry["id"] for entry in model_catalog_entries("codex")]

    for model_id in ("gpt-5.6-sol", "gpt-5.6-luna"):
        assert model_id in capability_models
        assert model_id in catalog_models

    assert not any(
        model_id.startswith("gpt-5.1-codex") for model_id in capability_models
    )
    assert not any(model_id.startswith("gpt-5.1-codex") for model_id in catalog_models)
