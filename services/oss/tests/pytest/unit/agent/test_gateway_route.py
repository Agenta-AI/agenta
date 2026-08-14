"""WP14: the agent holds no provider secret and its model calls route through the gateway.

specs-wp14.md's contracts, exercised at the service boundary. The resolver's own gateway-route
logic (namespace/name selection, credential shape) is already covered exhaustively by WP12's
suite (`sdks/python/oss/tests/pytest/unit/agents/platform/test_connections_http.py`); this
file only asserts the service's WIRING onto that resolver, and that its refusals are not
flattened before they reach the caller.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from agenta.sdk.agents import AgentResult, AgentTemplate, ResolvedToolSet
from agenta.sdk.agents.connections import (
    MissingCredentialError,
    ModelRef,
    RuntimeAuthContext,
)
from agenta.sdk.agents.platform import connection as platform_connection
from agenta.sdk.agents.platform import connections as platform_connections
from agenta.sdk.agents.platform import resolve_connection
from agenta.sdk.models.workflows import WorkflowServiceRequest

from oss.src.agent import app

_AGENT_SRC = Path(app.__file__).resolve().parent

# Names that would mean a provider secret is being read directly rather than routed through
# the gateway (D30/D36) — the deleted whole-vault dump and its aliases.
_FORBIDDEN_NAMES = {"resolve_provider_keys", "resolve_secrets", "_PROVIDER_ENV_VARS"}


def test_no_provider_secret_path_in_the_agent_service():
    """Grep-style guard: nothing under services/oss/src/agent can read a provider secret.
    A name here is one deployment mistake from being wired back in."""
    hits = []
    for path in _AGENT_SRC.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            name = getattr(node, "id", None) or getattr(node, "attr", None)
            if name in _FORBIDDEN_NAMES:
                hits.append(f"{path}:{node.lineno}:{name}")
    assert not hits, f"provider-secret-reading code path found: {hits}"


def test_composition_resolve_connection_is_the_gateway_resolver():
    """`app._composition()` wires the real gateway-routing resolver, not a stub or the
    deleted whole-vault dump."""
    assert app.resolve_connection is resolve_connection


async def test_service_resolves_a_gateway_route_with_no_provider_secret(monkeypatch):
    """End-to-end through the service's own composition against a mocked `/secrets/`: proves
    the WIRING routes through the gateway with no provider secret, not the resolver's own
    selection logic (WP12's suite)."""
    monkeypatch.setattr(
        platform_connection, "_derive_base_url", lambda: "https://api.x/api"
    )
    monkeypatch.setattr(
        platform_connection, "_derive_authorization", lambda: "Access tok"
    )

    class _Response:
        status_code = 200

        def json(self):
            return [
                {
                    "kind": "provider_key",
                    "data": {
                        "kind": "openai",
                        "provider": {"key": "sk-should-never-surface"},
                    },
                }
            ]

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, headers=None):
            return _Response()

    monkeypatch.setattr(platform_connections.httpx, "AsyncClient", _Client)

    resolved = await app.resolve_connection(
        model=ModelRef(provider="openai", model="gpt-5.5"),
        context=RuntimeAuthContext(harness="pi_core"),
    )

    assert resolved.credential_mode == "none"
    assert resolved.credentials == []
    assert (
        resolved.endpoint.base_url == "https://api.x/api/gateways/llms/standard/openai"
    )
    assert "sk-should-never-surface" not in repr(resolved)
    assert "sk-should-never-surface" not in repr(resolved.gateway_credentials)


async def test_connection_refusal_keeps_its_status_code(monkeypatch, fake_backend):
    """Errors contract: a resolve_connection refusal is not flattened into a generic
    failure — its status_code (what `handle_invoke_failure` reads to pick the HTTP status)
    survives to the caller of `_agent`."""

    async def _resolve(*, model, context):
        raise MissingCredentialError(provider="openai", slug=None)

    async def _tools(tools, **_kw):
        return ResolvedToolSet(tool_callback=None)

    async def _no_mcp(mcp_servers, **_kw):
        return []

    backend = fake_backend(result=AgentResult(output="unused"))
    monkeypatch.setattr(app, "resolve_tools", _tools)
    monkeypatch.setattr(app, "resolve_mcp_servers", _no_mcp)
    monkeypatch.setattr(app, "resolve_connection", _resolve)
    monkeypatch.setattr(app, "trace_context", lambda: None)
    monkeypatch.setattr(app, "record_usage", lambda usage: None)
    monkeypatch.setattr(app, "select_backend", lambda selection: backend)
    monkeypatch.setattr(
        app,
        "_default_agent_template",
        lambda: AgentTemplate(instructions="x", model="m"),
    )

    with pytest.raises(MissingCredentialError) as excinfo:
        await app._agent(
            request=WorkflowServiceRequest(),
            messages=[{"role": "user", "content": "hi"}],
            parameters={"agent": {"harness": {"kind": "pi_core"}}},
        )

    assert excinfo.value.status_code == 422
