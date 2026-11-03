"""A run posted to the service's real ``/invoke`` route gets the Agenta tools its saved
``agenta_tools`` entry turns on, through the real tool resolver. Only the backend and the
HTTP reads around the run are stubbed."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from agenta.sdk.agents import AgentResult, AgentTemplate, ResolvedConnection
from agenta.sdk.agents.platform import session_context as session_context_module
from agenta.sdk.middlewares.routing import auth as auth_middleware

from oss.src.agent import agent_v0_app, app

from .test_session_context_resolution import sdk_singleton  # noqa: F401

_SERVICE_DEFAULT_TEMPLATE = app._default_agent_template

DEFAULT_ENTRY = {
    "type": "agenta_tools",
    "tools": {"get_current_session": "allow", "rename_session": "allow"},
}


class _NotFound:
    status_code = 404
    text = "{}"

    def json(self) -> Any:
        return {}


class _Client:
    """Every read around the run (session context, channel tools) finds nothing."""

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, *args, **kwargs):
        return _NotFound()

    async def post(self, *args, **kwargs):
        return _NotFound()


@pytest.fixture
def backend(monkeypatch, fake_backend, sdk_singleton):  # noqa: F811
    backend = fake_backend(result=AgentResult(output="ok"))

    async def _no_mcp(mcp_servers, **_kw):
        return []

    async def _no_connection(*, model, context):
        return ResolvedConnection(
            provider="openai", model=model.model, credential_mode="runtime_provided"
        )

    monkeypatch.setattr(session_context_module.httpx, "AsyncClient", _Client)
    monkeypatch.setenv("AGENTA_API_URL", "https://api.test/api")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    monkeypatch.setattr(auth_middleware, "_AUTH_ENABLED", False)
    monkeypatch.setattr(app, "resolve_mcp_servers", _no_mcp)
    monkeypatch.setattr(app, "resolve_connection", _no_connection)
    monkeypatch.setattr(app, "trace_context", lambda: None)
    monkeypatch.setattr(app, "record_usage", lambda usage: None)
    monkeypatch.setattr(app, "select_backend", lambda selection: backend)
    monkeypatch.setattr(
        app, "_default_agent_template", lambda: AgentTemplate(instructions="x")
    )
    return backend


def _run(backend, tools: list | None) -> set:
    agent = {"harness": {"kind": "pi_core"}}
    if tools is not None:
        agent["tools"] = tools
    response = TestClient(agent_v0_app).post(
        "/invoke",
        json={
            "session_id": "s-1",
            "data": {
                "inputs": {"messages": [{"role": "user", "content": "hi"}]},
                "parameters": {"agent": agent},
            },
        },
    )
    assert response.status_code == 200, response.text
    return {spec.name for spec in backend.created_configs[-1].tool_specs}


def test_an_agent_with_the_entry_gets_both_session_tools(backend):
    assert _run(backend, [DEFAULT_ENTRY]) == {"get_current_session", "rename_session"}


def test_an_agent_without_the_entry_gets_neither(backend):
    assert _run(backend, []) == set()


def test_a_saved_agent_without_tools_gets_no_fallback(backend, monkeypatch):
    # The service's own defaults fill a missing `tools`; they must not add Agenta tools.
    monkeypatch.setattr(app, "_default_agent_template", _SERVICE_DEFAULT_TEMPLATE)
    assert _run(backend, None) == set()
