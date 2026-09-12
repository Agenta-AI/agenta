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
    GatewayConnectionRefusedError,
    MissingCredentialError,
    ModelRef,
    RuntimeAuthContext,
)
from agenta.sdk.agents.platform import connection as platform_connection
from agenta.sdk.agents.platform import connections as platform_connections
from agenta.sdk.agents.platform import resolve_connection
from agenta.sdk.models.workflows import WorkflowServiceRequest, failure_code_of

from oss.src.agent import app

_AGENT_SRC = Path(app.__file__).resolve().parent

# Names that would mean a provider secret is being read directly rather than routed through
# the gateway rather than through provider-secret environment variables.
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
    """Service composition uses the core gateway resolver, never a provider secret."""
    monkeypatch.setattr(
        platform_connection, "_derive_base_url", lambda: "https://api.x/api"
    )
    monkeypatch.setattr(
        platform_connection, "_derive_authorization", lambda: "Access tok"
    )

    class _Response:
        status_code = 200

        def json(self):
            return {
                "connection": {
                    "namespace": "standard",
                    "name": "openai",
                    "provider_key": "openai",
                    "deployment_kind": "direct",
                    "model": "gpt-5.5",
                }
            }

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None):
            assert url == "https://api.x/api/gateways/llms/resolve"
            assert headers["Authorization"] == "Access tok"
            assert json == {
                "model": "gpt-5.5",
                "provider_key": "openai",
                "connection_slug": None,
            }
            return _Response()

    monkeypatch.setattr(platform_connections.httpx, "AsyncClient", _Client)

    resolved = await app.resolve_connection(
        model=ModelRef(provider="openai", model="gpt-5.5"),
        context=RuntimeAuthContext(harness="pi_core"),
    )

    assert resolved.credential_mode == "none"
    assert resolved.credentials == []
    assert (
        resolved.endpoint.base_url
        == "https://api.x/api/gateways/llms/standard/openai/v1"
    )
    assert resolved.gateway_credentials is not None
    assert resolved.gateway_credentials.value == "Access tok"


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


async def test_a_control_plane_refusal_reaches_the_caller_with_its_code(
    monkeypatch, fake_backend
):
    """OR27: the gateway's `code` and message survive the service, not just the status.

    The resolver used to read only the HTTP status of a refusal, so an endpoint that did not
    exist reached the person running the agent as an unknown-invoke-error 500 with no code and
    no sentence they could act on. Both normalizers that build an error response from a raised
    exception read `failure_code_of`, so asserting it here pins what the browser receives.
    """

    refusal = GatewayConnectionRefusedError.from_response(
        status_code=404,
        body={
            "detail": {
                "code": "endpoint_not_found",
                "message": "LLM endpoint not found: custom/absent-gw",
                "retryable": False,
                "next_step": "Register the endpoint, or name one that already exists.",
                "details": {"target": "custom/absent-gw"},
            }
        },
    )

    async def _resolve(*, model, context):
        raise refusal

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

    with pytest.raises(GatewayConnectionRefusedError) as excinfo:
        await app._agent(
            request=WorkflowServiceRequest(),
            messages=[{"role": "user", "content": "hi"}],
            parameters={"agent": {"harness": {"kind": "pi_core"}}},
        )

    error = excinfo.value
    # What the normalizer puts on the status: a client error, the gateway's own failure code,
    # and the gateway's sentence as the message, never "connection resolution failed (HTTP 404)".
    assert error.status_code == 422
    assert failure_code_of(error) == "endpoint_not_found"
    assert str(error) == "LLM endpoint not found: custom/absent-gw"
    assert error.error_detail["next_step"]
