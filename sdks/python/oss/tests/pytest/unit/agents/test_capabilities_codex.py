"""Codex capabilities allow managed and subscription OpenAI direct connections."""

from __future__ import annotations

from agenta.sdk.agents.capabilities import (
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
