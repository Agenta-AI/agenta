"""Codex capabilities allow managed and subscription OpenAI gateway connections."""

from __future__ import annotations

from agenta.sdk.agents.capabilities import (
    CODEX_MODELS,
    HARNESS_CONNECTION_CAPABILITIES,
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_provider,
)
from agenta.sdk.agents.dtos import CodexAgentTemplate, HarnessKind
from agenta.sdk.agents.model_catalog import model_catalog_entries
from agenta.sdk.agents.utils.wire import request_to_wire


def test_codex_connection_capabilities() -> None:
    assert harness_allows_provider("codex", "openai") is True
    assert harness_allows_provider("codex", "anthropic") is False
    assert harness_allows_mode("codex", "agenta") is True
    assert harness_allows_mode("codex", "self_managed") is True
    assert harness_allows_deployment("codex", "direct") is True
    assert harness_allows_deployment("codex", "custom") is True


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


# The models the pinned Codex CLI 0.156.1 (codex-acp 1.13.1) lists: its bundled model list for an
# API key, and the ChatGPT backend's list for a subscription login (the backend hides GPT-6 from
# Codex clients older than 0.155.0). Both lists matched on 2026-09-27. Update on a Codex bump.
CODEX_ACCEPTED_MODELS = {
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
}


def test_codex_publishes_only_models_the_pinned_codex_accepts() -> None:
    caps = HARNESS_CONNECTION_CAPABILITIES["codex"]
    catalog_ids = [entry["id"] for entry in model_catalog_entries("codex")]

    assert catalog_ids == CODEX_MODELS
    assert set(caps.models["openai"]) <= CODEX_ACCEPTED_MODELS
    assert set(caps.default_models["openai"]) <= CODEX_ACCEPTED_MODELS
    assert {"gpt-6-sol", "gpt-6-luna"} <= set(caps.models["openai"])


def test_codex_model_catalog_carries_pricing() -> None:
    catalog_entries = model_catalog_entries("codex")
    luna = next(entry for entry in catalog_entries if entry["id"] == "gpt-5.6-luna")

    assert luna["pricing"]["input_per_mtok"] == 1.0
    assert luna["pricing"]["output_per_mtok"] == 6.0
    assert luna["context_window"] == 1050000
    assert all(entry["pricing"] is not None for entry in catalog_entries)


def test_codex_mode_wire() -> None:
    def serialize(harness_permissions=None):
        return request_to_wire(
            harness=HarnessKind.CODEX,
            sandbox="local",
            config=CodexAgentTemplate(
                harness_permissions=harness_permissions or {},
            ),
            messages=[],
        )

    assert serialize({"mode": "agent"})["harnessMode"] == "agent"
    assert "harnessMode" not in serialize()
    assert "harnessMode" not in serialize({"mode": "invalid"})
