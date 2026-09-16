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


@pytest.mark.asyncio
async def test_a_workflow_with_its_own_agent_parameter_still_gets_the_vault(
    monkeypatch,
):
    """A workflow's parameter names are its author's to choose. "There is a parameter
    called `agent` and it is an object" also describes an ordinary workflow that happens
    to have one, and such a workflow ran with an empty vault and no explanation (M10)."""
    fetched = False

    async def get_secrets(*_args, **_kwargs):
        nonlocal fetched
        fetched = True
        return [], [], []

    monkeypatch.setattr(vault, "get_secrets", get_secrets)
    request = WorkflowServiceRequest(
        data={
            "parameters": {
                # A support workflow that routes a ticket to a person, say.
                "agent": {"name": "Dana", "team": "billing"},
            }
        }
    )

    async def call_next(received):
        return received

    await vault.VaultMiddleware()(request, call_next)

    assert fetched


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "agent",
    [
        {"instructions": {"text": "be helpful"}},
        {"llm": {"model": "mock/echo"}},
        {"tools": []},
        {"mcps": []},
        {"skills": []},
        {"harness": {"kind": "pi_core"}},
        {"runner": {}},
        {"sandbox": {}},
    ],
)
async def test_any_agent_template_key_is_enough_to_recognise_an_agent(
    monkeypatch, agent
):
    """The template's keys all default, so an agent may carry any one of them and no
    particular one. Recognising only some would send a real agent to the vault."""
    fetched = False

    async def get_secrets(*_args, **_kwargs):
        nonlocal fetched
        fetched = True
        return [], [], []

    monkeypatch.setattr(vault, "get_secrets", get_secrets)
    request = WorkflowServiceRequest(data={"parameters": {"agent": agent}})

    async def call_next(received):
        return received

    await vault.VaultMiddleware()(request, call_next)

    assert not fetched


@pytest.mark.asyncio
async def test_a_workflow_with_no_agent_parameter_gets_the_vault(monkeypatch):
    fetched = False

    async def get_secrets(*_args, **_kwargs):
        nonlocal fetched
        fetched = True
        return [], [], []

    monkeypatch.setattr(vault, "get_secrets", get_secrets)
    request = WorkflowServiceRequest(data={"parameters": {"prompt": {"text": "hi"}}})

    async def call_next(received):
        return received

    await vault.VaultMiddleware()(request, call_next)

    assert fetched
