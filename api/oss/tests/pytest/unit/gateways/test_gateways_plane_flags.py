"""`AGENTA_LLM_GATEWAY_ENABLED` and `AGENTA_MCP_GATEWAY_ENABLED` decide whether a plane serves.

Four things have to hold for the release, and each has a section below.

1. The defaults. LLM off, MCP on, for a process that sets neither variable. Asserted in a
   subprocess, because both are read once when `utils/env.py` is imported: setting them in
   this process after the fact would prove nothing about a deployment that never sets them.
2. A plane that is off refuses on every surface it owns — the control plane, the data plane,
   and the credential exchange — with a code the caller can branch on rather than a status
   number or a 404.
3. A plane that is on is untouched: the refusal sits in front of the handler, not inside it,
   so the request reaches the permission check and the service exactly as before.
4. The two planes are independent. Turning the LLM gateway off must leave the MCP gateway
   serving, which is the whole shape of this release.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from oss.src.apis.fastapi.gateways.credentials_router import GatewayCredentialsRouter
from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
from oss.src.apis.fastapi.gateways.llms.router import LLMGatewayRouter
from oss.src.apis.fastapi.gateways.mcps.oauth_router import MCPOAuthClientMetadataRouter
from oss.src.apis.fastapi.gateways.mcps.proxy import MCPGatewayProxy
from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import LLMGatewayConnectionResolution
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env


LLM_FLAG = "AGENTA_LLM_GATEWAY_ENABLED"
MCP_FLAG = "AGENTA_MCP_GATEWAY_ENABLED"

API_ROOT = Path(__file__).resolve().parents[5]

FIXED_SCOPE = AuthScope(
    organization_id=uuid4(),
    workspace_id=uuid4(),
    project_id=uuid4(),
    user_id=uuid4(),
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def llm_gateway(monkeypatch):
    """Set the LLM plane's switch for the duration of one test."""

    def _set(enabled: bool) -> None:
        monkeypatch.setattr(env.llm_gateway, "enabled", enabled)

    return _set


@pytest.fixture
def mcp_gateway(monkeypatch):
    """Set the MCP plane's switch for the duration of one test."""

    def _set(enabled: bool) -> None:
        monkeypatch.setattr(env.mcp_gateway, "enabled", enabled)

    return _set


def _asgi_request(*, body: bytes) -> Request:
    async def receive() -> Dict[str, Any]:
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {"type": "http", "method": "POST", "path": "/", "headers": []}, receive
    )


class _UnreachableService:
    """Any call on this is a bug: a refused plane must not reach its service."""

    def __getattr__(self, name):
        raise AssertionError(f"the service was called ({name}) on a disabled plane")


class _StubLLMGatewayService:
    def __init__(self) -> None:
        self.calls: list = []

    async def resolve_agent_connection(self, **kwargs):
        self.calls.append("resolve_agent_connection")
        return LLMGatewayConnectionResolution(
            namespace="custom",
            name="acme-openai",
            provider_key="openai",
            deployment_kind="custom",
            model="gpt-4o",
        )


def _envelope(response) -> Optional[Dict[str, Any]]:
    """The shared gateway envelope a control-plane refusal sends as its `detail`."""
    detail = response.json().get("detail")
    return detail if isinstance(detail, dict) else None


# ---------------------------------------------------------------------------
# 1. Declared defaults
# ---------------------------------------------------------------------------

_PROBE = (
    "from oss.src.utils.env import env;"
    "print('llm=%s mcp=%s' % (env.llm_gateway.enabled, env.mcp_gateway.enabled))"
)


def _probe_defaults(**overrides: str) -> str:
    """Import `utils/env.py` in a fresh process and report both switches.

    The current environment is inherited minus the two variables, so the process differs
    from this one in exactly the thing under test.
    """
    child_env = {
        key: value
        for key, value in os.environ.items()
        if key not in {LLM_FLAG, MCP_FLAG}
    }
    child_env.update(overrides)

    result = subprocess.run(
        [sys.executable, "-c", _PROBE],
        env=child_env,
        cwd=str(API_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    lines = [line for line in result.stdout.splitlines() if line.startswith("llm=")]
    assert lines, result.stdout
    return lines[-1]


def test_a_deployment_that_sets_nothing_gets_the_llm_gateway_off_and_mcp_on():
    # The release contract: an upgrade must not reroute anyone's model traffic, and the MCP
    # gateway is the feature being shipped, so its switch is a kill switch rather than an
    # opt-in.
    assert _probe_defaults() == "llm=False mcp=True"


def test_both_switches_are_settable_from_the_environment():
    assert (
        _probe_defaults(
            **{LLM_FLAG: "true", MCP_FLAG: "false"},
        )
        == "llm=True mcp=False"
    )


# ---------------------------------------------------------------------------
# 2. A plane that is off refuses, everywhere it serves
# ---------------------------------------------------------------------------


@pytest.fixture
def llm_router_client(monkeypatch):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )
    service = _StubLLMGatewayService()
    app = FastAPI()
    app.include_router(LLMGatewayRouter(llm_gateway_service=service).router)
    return TestClient(app), service


def test_llm_resolve_refuses_with_a_code_the_sdk_can_branch_on(
    llm_router_client, llm_gateway
):
    client, service = llm_router_client
    llm_gateway(False)

    response = client.post("/resolve", json={"model": "gpt-4o"})

    assert response.status_code == 403
    envelope = _envelope(response)
    assert envelope is not None
    assert envelope["code"] == "llm_gateway_disabled"
    assert envelope["retryable"] is False
    assert envelope["details"] == {"flag": LLM_FLAG}
    # The SDK reads this to decide it may resolve from the vault instead, so the refusal
    # must arrive before anything resolves.
    assert service.calls == []


@pytest.mark.parametrize(
    "method, path",
    [
        ("POST", "/resolve"),
        ("POST", "/endpoints/"),
        ("GET", "/endpoints/"),
        ("POST", "/endpoints/query"),
        ("GET", "/endpoints/00000000-0000-0000-0000-000000000000"),
        ("PUT", "/endpoints/00000000-0000-0000-0000-000000000000"),
        ("DELETE", "/endpoints/00000000-0000-0000-0000-000000000000"),
    ],
)
def test_every_llm_management_route_refuses_while_the_plane_is_off(
    method, path, llm_gateway, monkeypatch
):
    # The gate is declared on the router, so this is the assertion that a route added later
    # cannot be born ungated.
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )
    llm_gateway(False)
    app = FastAPI()
    app.include_router(
        LLMGatewayRouter(llm_gateway_service=_UnreachableService()).router
    )

    response = TestClient(app).request(method, path, json={})

    assert response.status_code == 403
    assert (_envelope(response) or {}).get("code") == "llm_gateway_disabled"


@pytest.mark.asyncio
async def test_the_llm_relay_refuses_in_the_shape_an_openai_client_reads(llm_gateway):
    llm_gateway(False)
    proxy = LLMGatewayProxy(llm_gateway_service=_UnreachableService())

    response = await proxy.chat_completions_custom(
        _asgi_request(body=json.dumps({"model": "gpt-4o", "messages": []}).encode()),
        "acme-openai",
    )

    assert response.status_code == 403
    error = json.loads(bytes(response.body))["error"]
    assert error["code"] == "llm_gateway_disabled"
    assert error["type"] == "invalid_request_error"
    # A harness that keeps only the message still recovers the code from the marker.
    assert "llm_gateway_disabled" in error["message"]


@pytest.mark.asyncio
async def test_the_llm_model_listing_refuses_too(llm_gateway):
    llm_gateway(False)
    proxy = LLMGatewayProxy(llm_gateway_service=_UnreachableService())

    response = await proxy.list_models_standard("openai")

    assert response.status_code == 403
    assert json.loads(bytes(response.body))["error"]["code"] == "llm_gateway_disabled"


@pytest.fixture
def mcp_router_client(monkeypatch):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )
    router = MCPGatewayRouter(
        mcp_gateway_service=_UnreachableService(),
        oauth_connect_service=_UnreachableService(),
    )
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app), router


@pytest.mark.parametrize(
    "method, path",
    [
        ("POST", "/credentials/agenta"),
        ("POST", "/endpoints/"),
        ("GET", "/endpoints/"),
        ("POST", "/endpoints/query"),
        ("GET", "/endpoints/00000000-0000-0000-0000-000000000000"),
        ("PUT", "/endpoints/00000000-0000-0000-0000-000000000000"),
        ("DELETE", "/endpoints/00000000-0000-0000-0000-000000000000"),
        ("POST", "/endpoints/00000000-0000-0000-0000-000000000000/connect"),
        ("GET", "/connect/callback"),
    ],
)
def test_every_mcp_route_refuses_while_the_plane_is_off(
    method, path, mcp_router_client, mcp_gateway
):
    client, _ = mcp_router_client
    mcp_gateway(False)

    response = client.request(method, path, json={})

    assert response.status_code == 403
    assert (_envelope(response) or {}).get("code") == "mcp_gateway_disabled"


def test_the_oauth_client_identity_document_is_withheld_while_the_plane_is_off(
    mcp_gateway,
):
    mcp_gateway(False)
    app = FastAPI()
    app.include_router(MCPOAuthClientMetadataRouter().router)

    response = TestClient(app).get("/oauth/client-metadata.json")

    assert response.status_code == 403
    assert (_envelope(response) or {}).get("code") == "mcp_gateway_disabled"


def test_the_oauth_attempt_sweep_keeps_running_while_the_plane_is_off(
    mcp_router_client, mcp_gateway
):
    # Table maintenance, not a product surface: a deployment that turned the plane off still
    # wants its abandoned attempts expired rather than kept forever.
    _, router = mcp_router_client
    mcp_gateway(False)
    admin_paths = {route.path for route in router.admin_router.routes}

    assert "/mcps/oauth/attempts/sweep" in admin_paths
    assert router.admin_router.dependencies == []


@pytest.mark.asyncio
async def test_the_mcp_relay_refuses_in_the_shape_a_json_rpc_client_reads(mcp_gateway):
    mcp_gateway(False)
    proxy = MCPGatewayProxy(mcp_gateway_service=_UnreachableService())

    response = await proxy._relay(
        request=_asgi_request(
            body=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
        ),
        namespace=GatewayEndpointNamespace.CUSTOM,
        name="acme",
    )

    assert response.status_code == 403
    payload = json.loads(bytes(response.body))
    assert payload["error"]["data"]["cause"] == "mcp_gateway_disabled"
    assert "mcp_gateway_disabled" in payload["error"]["message"]


# --- the credential exchange, which is where the SDK asks before it dials --- #


@pytest.fixture
def credentials_client(monkeypatch):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.credentials_router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.credentials_router.sign_secret_token",
        AsyncMock(return_value="signed-token"),
    )
    app = FastAPI()
    app.include_router(GatewayCredentialsRouter().router)
    return TestClient(app)


def test_a_credential_for_the_mcp_plane_is_refused_while_that_plane_is_off(
    credentials_client, mcp_gateway, llm_gateway
):
    mcp_gateway(False)
    llm_gateway(True)

    response = credentials_client.post("/credentials", json={"plane": "mcp"})

    assert response.status_code == 403
    assert (_envelope(response) or {}).get("code") == "mcp_gateway_disabled"


def test_a_credential_for_the_llm_plane_is_refused_while_that_plane_is_off(
    credentials_client, llm_gateway, mcp_gateway
):
    llm_gateway(False)
    mcp_gateway(True)

    response = credentials_client.post("/credentials", json={"plane": "llm"})

    assert response.status_code == 403
    assert (_envelope(response) or {}).get("code") == "llm_gateway_disabled"


def test_an_older_caller_that_names_no_plane_still_gets_a_credential(
    credentials_client, llm_gateway, mcp_gateway
):
    # `plane` is optional so an SDK built before these switches existed keeps working. It
    # meets the refusal on the data plane instead, which is a later error but not a wrong one.
    llm_gateway(False)
    mcp_gateway(False)

    response = credentials_client.post("/credentials", json={})

    assert response.status_code == 200
    assert response.json() == {"credentials": "Secret signed-token"}


# ---------------------------------------------------------------------------
# 3 and 4. A plane that is on is untouched, and the two are independent
# ---------------------------------------------------------------------------


def test_the_llm_plane_serves_normally_while_its_switch_is_on(
    llm_router_client, llm_gateway, monkeypatch
):
    client, service = llm_router_client
    llm_gateway(True)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.check_action_access",
        AsyncMock(return_value=True),
    )

    response = client.post("/resolve", json={"model": "gpt-4o"})

    assert response.status_code == 200
    assert response.json()["connection"]["name"] == "acme-openai"
    assert service.calls == ["resolve_agent_connection"]


def test_the_switch_sits_in_front_of_the_permission_check_not_instead_of_it(
    llm_router_client, llm_gateway, monkeypatch
):
    # Both refuse with 403. They must stay distinguishable, or an operator debugging a
    # refused run cannot tell a switched-off plane from a missing role.
    client, _ = llm_router_client
    llm_gateway(True)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.check_action_access",
        AsyncMock(return_value=False),
    )

    response = client.post("/resolve", json={"model": "gpt-4o"})

    assert response.status_code == 403
    assert (_envelope(response) or {}).get("code") != "llm_gateway_disabled"


def test_the_mcp_plane_serves_while_the_llm_plane_is_off(
    mcp_router_client, llm_gateway, mcp_gateway, monkeypatch
):
    # The shape of this release: MCP ships, the new LLM routing does not.
    client, _ = mcp_router_client
    llm_gateway(False)
    mcp_gateway(True)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access",
        AsyncMock(return_value=False),
    )

    response = client.get("/endpoints/")

    # It got past the switch and was stopped by the permission check instead.
    assert response.status_code == 403
    assert (_envelope(response) or {}).get("code") != "mcp_gateway_disabled"


@pytest.mark.asyncio
async def test_the_mcp_relay_is_unaffected_by_the_llm_switch(
    llm_gateway, mcp_gateway, monkeypatch
):
    llm_gateway(False)
    mcp_gateway(True)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.proxy.get_auth_scope",
        lambda: FIXED_SCOPE,
    )
    proxy = MCPGatewayProxy(mcp_gateway_service=_UnreachableService())

    with pytest.raises(AssertionError, match="the service was called"):
        await proxy._relay(
            request=_asgi_request(
                body=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
            ),
            namespace=GatewayEndpointNamespace.CUSTOM,
            name="acme",
        )
