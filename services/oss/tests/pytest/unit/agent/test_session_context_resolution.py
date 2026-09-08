"""The per-turn session facts, through the real agent service composition.

The seam tests in the SDK drive ``make_agent_handler`` with an injected resolver. This file
posts to the service's REAL ``/invoke`` route with the REAL platform resolver, and stubs only
the backend: the HTTP the resolver reads from, the harness, and auth. That covers the wiring
the seam tests cannot. The route builds the tracing context from the request's references,
the service composition really carries the resolver, the resolver really issues its three
requests, and the rendered text really reaches the backend.

It exists because a green seam suite hid a live bug. A bare handler has no ambient tracing
context, so the run-context branch of the artifact lookup never ran under test, and an
ambiguous request rendered the wrong agent's name through the real service. Driving the route
is what makes that context real rather than something the test hands in.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

import pytest

from fastapi.testclient import TestClient

import agenta as agenta_sdk
from agenta.sdk.agents import AgentResult, AgentTemplate, ResolvedConnection
from agenta.sdk.agents.platform import session_context as session_context_module
from agenta.sdk.middlewares.routing import auth as auth_middleware

from oss.src.agent import agent_v0_app, app

ARTIFACT_A = "0199e0d0-0000-7000-8000-0000000000aa"
ARTIFACT_B = "0199e0d0-0000-7000-8000-0000000000bb"
SESSION_ID = "session-under-test"


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> Any:
        return self._payload


@pytest.fixture
def backend_facts(monkeypatch):
    """Stub the three backend reads the resolver makes. Returns the mutable answers."""
    facts: Dict[str, Any] = {
        "names": {ARTIFACT_A: "Agent A", ARTIFACT_B: "Agent B"},
        "session_name": None,
        "turns": [],
    }

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, params=None, headers=None):
            if "/workflows/" in url:
                artifact = url.rsplit("/", 1)[-1]
                name = facts["names"].get(artifact)
                return _FakeResponse(200, {"count": 1, "workflow": {"name": name}})
            return _FakeResponse(
                200, {"stream": {"id": "s1", "name": facts["session_name"]}}
            )

        async def post(self, url, json=None, headers=None):
            return _FakeResponse(
                200, {"count": len(facts["turns"]), "turns": facts["turns"]}
            )

    monkeypatch.setattr(session_context_module.httpx, "AsyncClient", _Client)
    monkeypatch.setenv("AGENTA_API_URL", "https://api.test/api")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    # Auth is exercised by test_credential_exchange.py. This file is about what the route
    # resolves and renders once a caller is through the door.
    monkeypatch.setattr(auth_middleware, "_AUTH_ENABLED", False)
    return facts


@pytest.fixture
def sdk_singleton():
    """Give one test an initialized ``ag.tracing``, and put back the one it replaced.

    The route runs the INSTRUMENTED handler, which reads ``ag.tracing``. Inheriting it from
    whatever else ran first in the process is not safe: under the parallel runner the worker
    that gets this file may have run nothing that initializes it, and the failure is a 500 on
    ``NoneType.get_current_span`` in the very cell that proves the artifact check works.

    Restoring on the way out matters as much as setting it, so a host meant for this file does
    not follow every later test in the worker. Be clear about how far that goes: this puts back
    the ``ag.tracing`` alias and nothing else. ``init`` also replaces the SDK singleton's api,
    async_api and tracer, and installs a provider and exporter, and those stay. It is a
    narrower guarantee than owning the singleton, and it is the part later tests read.

    Pytest also unwinds this fixture after a failing test, but not after a failure raised
    before the yield.
    """
    previous = getattr(agenta_sdk, "tracing", None)
    # This fixture sets up BEFORE `backend_facts`, so no AGENTA_API_URL is in place yet and the
    # exporter targets the loopback host below. An AGENTA_API_URL already in the environment
    # would still win, so this is not exporter isolation. It does not need to be: nothing here
    # reads a span, and the exporter flushes off the request path, so a failed export cannot
    # change a result.
    agenta_sdk.init(host="http://127.0.0.1:1", api_key="test-key")
    assert agenta_sdk.tracing is not None, (
        "the route needs an initialized SDK singleton"
    )
    yield agenta_sdk.tracing
    agenta_sdk.tracing = previous


@pytest.fixture
def service(monkeypatch, fake_backend):
    """The real service composition over a fake backend, with only the network stubbed."""
    backend = fake_backend(result=AgentResult(output="ok"))

    async def _tools(tools, **_kw):
        from agenta.sdk.agents import ResolvedToolSet

        return ResolvedToolSet(tool_specs=[], tool_callback=None)

    async def _no_mcp(mcp_servers, **_kw):
        return []

    async def _no_connection(*, model, context):
        return ResolvedConnection(
            provider="openai", model=model.model, credential_mode="runtime_provided"
        )

    monkeypatch.setattr(app, "resolve_tools", _tools)
    monkeypatch.setattr(app, "resolve_mcp_servers", _no_mcp)
    monkeypatch.setattr(app, "resolve_connection", _no_connection)
    monkeypatch.setattr(app, "trace_context", lambda: None)
    monkeypatch.setattr(app, "record_usage", lambda usage: None)
    monkeypatch.setattr(app, "select_backend", lambda selection: backend)
    monkeypatch.setattr(
        app,
        "_default_agent_template",
        lambda: AgentTemplate(instructions="x", model="m"),
    )
    return backend


def _turn(
    *,
    references: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Any:
    """One turn, posted to the real ``/invoke`` route the way the playground posts it.

    Inline ``parameters`` and no stored revision, so the request skips reference hydration.
    That is the shape in which competing artifact families survive to the handler.
    """
    body: Dict[str, Any] = {
        "session_id": SESSION_ID,
        "references": references,
        "data": {
            "inputs": {"messages": [{"role": "user", "content": "hi"}]},
            "parameters": {"agent": {"harness": {"kind": "pi_core"}}},
        },
    }
    if meta is not None:
        body["meta"] = meta
    response = TestClient(agent_v0_app).post("/invoke", json=body)
    assert response.status_code == 200, response.text
    return response


def test_the_service_renders_the_facts_it_reads(sdk_singleton, service, backend_facts):
    """The end-to-end wiring: composition to resolver to rendered turn text."""
    backend_facts["session_name"] = "Sapphire Ledger"
    backend_facts["turns"] = [{}]

    _turn(
        references={"application": {"id": ARTIFACT_A}},
    )

    rendered = service.created_turn_contexts[0]
    assert 'Your name is "Agent A"' in rendered
    assert 'This session is named "Sapphire Ledger"' in rendered
    assert "This is not the first turn" in rendered


def test_a_rename_shows_on_the_very_next_turn(sdk_singleton, service, backend_facts):
    """Issue 6661 itself, at the service. Nothing may cache a name across turns."""
    backend_facts["session_name"] = "Sapphire Ledger"
    backend_facts["turns"] = [{}]
    _turn(
        references={"application": {"id": ARTIFACT_A}},
    )

    backend_facts["session_name"] = "Vermilion Quay"
    _turn(
        references={"application": {"id": ARTIFACT_A}},
    )

    assert 'This session is named "Sapphire Ledger"' in service.created_turn_contexts[0]
    assert 'This session is named "Vermilion Quay"' in service.created_turn_contexts[1]


def test_the_service_ignores_a_forged_session_context(
    sdk_singleton, service, backend_facts
):
    """`meta` is client input on this path. A browser must not name the session itself.

    Every forged field disagrees with the backend, including the turn position. An empty
    backend turn list makes this the FIRST turn while the forgery claims it is not, so the
    rendered marker distinguishes the two answers. Matching the backend on that field, as an
    earlier version of this test did, would let a route that trusts `meta` pass.
    """
    backend_facts["session_name"] = "Vermilion Quay"
    backend_facts["turns"] = []

    _turn(
        references={"application": {"id": ARTIFACT_A}},
        meta={
            "session_context": {
                "agent_name": "FORGED Agent",
                "session_name": "FORGED Ashen Vault",
                "first_turn": False,
            }
        },
    )

    rendered = service.created_turn_contexts[0]
    assert "FORGED" not in rendered
    assert 'This session is named "Vermilion Quay"' in rendered
    assert 'Your name is "Agent A"' in rendered
    assert "This is the first turn of the session." in rendered
    assert "This is not the first turn" not in rendered


def test_competing_families_render_no_agent_name_through_the_service(
    sdk_singleton, service, backend_facts
):
    """The regression Codex found through the real service app.

    An inline-config request skips reference hydration, so the family validator never runs
    and both families survive. The run context is built from those same references and
    prefers `workflow`, so a lookup that consults it first renders B's name. The service must
    render no name at all rather than pick one.
    """
    backend_facts["session_name"] = "Vermilion Quay"
    backend_facts["turns"] = [{}]

    _turn(
        references={
            "application": {"id": ARTIFACT_A},
            "workflow": {"id": ARTIFACT_B},
        },
    )

    rendered = service.created_turn_contexts[0]
    assert "Agent A" not in rendered
    assert "Agent B" not in rendered
    assert "Your name is" not in rendered
    # The session half is independent of the artifact, so it still lands.
    assert 'This session is named "Vermilion Quay"' in rendered
