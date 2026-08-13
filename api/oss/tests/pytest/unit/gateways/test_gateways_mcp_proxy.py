"""Unit tests for McpGatewayProxy routing (entities.md §9, workstreams/specs-wp8.md).

In-process ASGI against a mock `McpGatewayService` and a mockd `get_auth_scope()` — no
Postgres, no real service, no network. Asserts which handler each path reaches (the
catch-all nesting on `agenta`, the three fixed segments on `builtin`), the 405s on the
stream verbs, and the exception -> protocol-error mapping this proxy owns
(`proxy.py::_map_gateway_exception`) — deliberately NOT the seed's
`handle_gateway_exceptions()`, which raises a plain `HTTPException(status, detail=str)`
and would collapse every cause below into an indistinguishable message. Each mapped-cause
test asserts both the HTTP status AND the stable `cause` string in the JSON-RPC error's
`data` — asserting the status alone would also pass under the old, wrong behaviour.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.mcps.proxy import McpGatewayProxy
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import (
    GatewayConnectionRequirement,
    GatewayConnectionState,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.mcps.interfaces import McpRelayResult
from oss.src.core.gateways.mcps.types import (
    McpAuthRequiredError,
    McpEndpointNotFoundError,
    McpScopeInsufficientError,
    McpToolNotAllowedError,
    McpUpstreamError,
)
from oss.src.core.gateways.policy.dtos import CredentialMode, CredentialOwnerKind
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    CredentialInvalidError,
    CredentialNotFoundError,
    EntitlementDeniedError,
    PolicyDeniedError,
)
from oss.src.utils.context import AuthScope


class _MockMcpGatewayService:
    def __init__(self):
        self.calls = []
        self.raise_error = None

    async def relay(self, **kwargs):
        self.calls.append(kwargs)
        if self.raise_error is not None:
            raise self.raise_error
        return McpRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=b'{"jsonrpc": "2.0", "id": 1, "result": {}}',
        )


@pytest.fixture
def mock_service():
    return _MockMcpGatewayService()


@pytest.fixture
def client(mock_service, monkeypatch):
    scope = AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.proxy.get_auth_scope",
        lambda: scope,
    )

    proxy = McpGatewayProxy(mcp_gateway_service=mock_service)
    app = FastAPI()
    app.include_router(proxy.router)
    return TestClient(app)


def test_agenta_catchall_nests_the_slug(client, mock_service):
    response = client.post(
        "/agenta/tools/search",
        headers={"Mcp-Method": "tools/list"},
        content=b"{}",
    )

    assert response.status_code == 200
    call = mock_service.calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.AGENTA
    assert call["name"] == "tools/search"


def test_builtin_reaches_with_three_segments(client, mock_service):
    response = client.post(
        "/builtin/composio/notion/my-notion",
        headers={"Mcp-Method": "tools/list"},
        content=b"{}",
    )

    assert response.status_code == 200
    call = mock_service.calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.BUILTIN
    assert call["provider"] == "composio"
    assert call["integration"] == "notion"
    assert call["name"] == "my-notion"


def test_custom_reaches_with_the_slug(client, mock_service):
    response = client.post(
        "/custom/acme-notion",
        headers={"Mcp-Method": "tools/list"},
        content=b"{}",
    )

    assert response.status_code == 200
    call = mock_service.calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.CUSTOM
    assert call["name"] == "acme-notion"
    assert call["provider"] is None
    assert call["integration"] is None


@pytest.mark.parametrize(
    "path",
    [
        "/agenta/tools/search",
        "/builtin/composio/notion/my-notion",
        "/custom/acme-notion",
    ],
)
def test_get_and_delete_return_405(client, path):
    assert client.get(path).status_code == 405
    assert client.delete(path).status_code == 405


def test_relayed_body_and_status_pass_through_untouched(client, mock_service):
    """The upstream's own protocol-level result (success or its own JSON-RPC `error`
    body, D16) never goes through `_map_gateway_exception` — `HttpMcpAdapter` never
    raises for it, so it is not this test's concern to mock beyond the happy path;
    the mapping only ever sees exceptions from `service.relay` itself."""
    response = client.post(
        "/custom/acme-notion", headers={"Mcp-Method": "tools/list"}, content=b"{}"
    )

    assert response.status_code == 200
    assert response.content == b'{"jsonrpc": "2.0", "id": 1, "result": {}}'


def test_authorization_header_is_not_forwarded_to_the_service(client, mock_service):
    client.post(
        "/custom/acme-notion",
        headers={"Mcp-Method": "tools/list", "Authorization": "Secret platform-token"},
        content=b"{}",
    )

    forwarded_headers = mock_service.calls[0]["headers"]
    assert "authorization" not in {k.lower() for k in forwarded_headers}


# ---------------------------------------------------------------------------
# Gateway-authored refusals -> the proxy's own JSON-RPC error mapping
# (proxy.py::_map_gateway_exception), NOT handle_gateway_exceptions(). Every
# case asserts the HTTP status (unchanged from that decorator's table) AND the
# stable `cause` string in the error body — status alone would also pass under
# the old, wrong HTTPException(detail=str) behaviour.
# ---------------------------------------------------------------------------


def _endpoint_not_found():
    return McpEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.CUSTOM, name="missing"
    )


def _policy_denied():
    return PolicyDeniedError(
        permission=Permission.USE_MCP_ENDPOINTS, target="custom/acme-notion"
    )


def _entitlement_denied():
    return EntitlementDeniedError(key="mcp_calls", target="custom/acme-notion")


def _tool_not_allowed():
    return McpToolNotAllowedError(
        tool="danger", namespace=GatewayEndpointNamespace.CUSTOM, name="acme-notion"
    )


def _ceiling_exceeded():
    return CeilingExceededError(
        ceiling="max_calls", requested=10, allowed=5, target="custom/acme-notion"
    )


def _auth_required():
    requirement = GatewayConnectionRequirement(
        target="custom/acme-notion", state=GatewayConnectionState.NEEDS_AUTH
    )
    return McpAuthRequiredError(requirement=requirement)


def _scope_insufficient():
    return McpScopeInsufficientError(target="custom/acme-notion", scopes=["write"])


def _credential_missing():
    return CredentialNotFoundError(
        mode=CredentialMode.PROJECT_ONLY,
        missing=CredentialOwnerKind.PROJECT,
        target="custom/acme-notion",
    )


def _credential_invalid():
    return CredentialInvalidError(target="custom/acme-notion")


def _upstream_error_below_500():
    return McpUpstreamError(target="http://upstream", status_code=400)


def _upstream_error_5xx():
    return McpUpstreamError(target="http://upstream", status_code=503)


def _upstream_error_no_status():
    return McpUpstreamError(target="http://upstream")


@pytest.mark.parametrize(
    "make_error, expected_status, expected_cause",
    [
        (_endpoint_not_found, 404, "endpoint_not_found"),
        (_policy_denied, 403, "policy_denied"),
        (_entitlement_denied, 403, "entitlement_denied"),
        (_tool_not_allowed, 403, "tool_not_allowed"),
        (_ceiling_exceeded, 400, "ceiling_exceeded"),
        (_auth_required, 409, "auth_required"),
        (_scope_insufficient, 409, "scope_insufficient"),
        (_credential_missing, 409, "credential_missing"),
        (_credential_invalid, 409, "credential_invalid"),
        (_upstream_error_below_500, 424, "upstream_error"),
        (_upstream_error_5xx, 502, "upstream_error"),
        (_upstream_error_no_status, 424, "upstream_error"),
    ],
)
def test_mapped_gateway_exceptions_carry_status_and_cause(
    client, mock_service, make_error, expected_status, expected_cause
):
    mock_service.raise_error = make_error()

    response = client.post(
        "/custom/acme-notion", headers={"Mcp-Method": "tools/list"}, content=b"{}"
    )

    assert response.status_code == expected_status
    payload = response.json()
    assert payload["jsonrpc"] == "2.0"
    assert payload["id"] is None
    assert payload["error"]["data"]["cause"] == expected_cause
    # never the house `{code,message,retryable,...}` envelope (entities.md §9)
    assert "retryable" not in payload["error"]["data"]


def test_auth_required_carries_the_connect_requirement(client, mock_service):
    mock_service.raise_error = _auth_required()

    response = client.post(
        "/custom/acme-notion", headers={"Mcp-Method": "tools/list"}, content=b"{}"
    )

    requirement = response.json()["error"]["data"]["requirement"]
    assert requirement["target"] == "custom/acme-notion"
    assert requirement["state"] == "needs_auth"


def test_missing_mcp_method_header_is_a_protocol_invalid_request(client, mock_service):
    response = client.post("/custom/acme-notion", content=b"{}")

    assert response.status_code == 400
    assert mock_service.calls == []
    payload = response.json()
    assert payload["jsonrpc"] == "2.0"
    assert payload["id"] is None
    assert payload["error"]["data"]["cause"] == "invalid_request"
