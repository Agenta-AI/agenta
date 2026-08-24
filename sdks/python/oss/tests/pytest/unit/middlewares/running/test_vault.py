from __future__ import annotations

import pytest

from agenta.sdk.middlewares.running import vault
from agenta.sdk.models.workflows import WorkflowServiceRequest


@pytest.mark.asyncio
async def test_agent_request_does_not_prefetch_project_vault(monkeypatch):
    """Provider credentials stay in API core while an agent uses a gateway route."""
    fetched = False

    async def get_secrets(*_args, **_kwargs):
        nonlocal fetched
        fetched = True
        return [], [], []

    monkeypatch.setattr(vault, "get_secrets", get_secrets)
    request = WorkflowServiceRequest(
        data={
            "parameters": {
                "agent": {
                    "harness": {"kind": "pi_core"},
                    "llm": {"model": "mock/echo"},
                }
            }
        }
    )

    async def call_next(received):
        return received

    result = await vault.VaultMiddleware()(request, call_next)

    assert result is request
    assert not fetched
