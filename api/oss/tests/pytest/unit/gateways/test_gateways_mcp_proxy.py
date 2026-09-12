"""Unit tests for MCP gateway proxy routing.

In-process ASGI against a mock `MCPGatewayService` and a mockd `get_auth_scope()` — no
Postgres, no real service, no network. Asserts which handler each path reaches (the
each builtin provider's own grammar under its segment), the 405s on the
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

from oss.src.apis.fastapi.gateways.mcps.proxy import MCPGatewayProxy
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import (
    GatewayConnectionRequirement,
    GatewayConnectionState,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPEndpointNotFoundError,
    MCPScopeInsufficientError,
    MCPToolNotAllowedError,
    MCPUpstreamError,
)
from oss.src.core.gateways.policy.dtos import SecretMode, SecretOwnerKind
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretInvalidError,
    SecretNotFoundError,
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
        return MCPRelayResult(
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

    proxy = MCPGatewayProxy(mcp_gateway_service=mock_service)
    app = FastAPI()
    app.include_router(proxy.router)
    return TestClient(app)


def test_builtin_agenta_nests_the_slug(client, mock_service):
    response = client.post(
        "/builtin/agenta/tools/search",
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    )

    assert response.status_code == 200
    call = mock_service.calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.BUILTIN
    assert call["provider"] == "agenta"
    assert call["integration"] is None
    assert call["name"] == "tools/search"


def test_builtin_reaches_with_three_segments(client, mock_service):
    response = client.post(
        "/builtin/composio/notion/my-notion",
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
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
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
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
        "/builtin/agenta/tools/search",
        "/builtin/composio/notion/my-notion",
        "/custom/acme-notion",
    ],
)
def test_get_and_delete_return_405(client, path):
    assert client.get(path).status_code == 405
    assert client.delete(path).status_code == 405


def test_relayed_body_and_status_pass_through_untouched(client, mock_service):
    """The upstream's own protocol-level result (success or its own JSON-RPC `error`
    body, D16) never goes through `_map_gateway_exception` — `HttpMCPAdapter` never
    raises for it, so it is not this test's concern to mock beyond the happy path;
    the mapping only ever sees exceptions from `service.relay` itself."""
    request_body = b'{ "jsonrpc" : "2.0", "id" : 1, "method" : "tools/list" }'
    response = client.post("/custom/acme-notion", content=request_body)

    assert response.status_code == 200
    assert response.content == b'{"jsonrpc": "2.0", "id": 1, "result": {}}'
    assert mock_service.calls[0]["body"] == request_body


def test_gateway_credential_is_not_forwarded_but_upstream_authorization_is(
    client, mock_service
):
    client.post(
        "/custom/acme-notion",
        headers={
            "Authorization": "Bearer upstream-token",
            "X-AG-Credentials": "ApiKey gateway-token",
        },
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    )

    forwarded_headers = mock_service.calls[0]["headers"]
    normalized = {key.lower(): value for key, value in forwarded_headers.items()}
    assert normalized["authorization"] == "Bearer upstream-token"
    assert "x-ag-credentials" not in normalized


# ---------------------------------------------------------------------------
# Gateway-authored refusals -> the proxy's own JSON-RPC error mapping
# (proxy.py::_map_gateway_exception), NOT handle_gateway_exceptions(). Every
# case asserts the HTTP status (unchanged from that decorator's table) AND the
# stable `cause` string in the error body — status alone would also pass under
# the old, wrong HTTPException(detail=str) behaviour.
# ---------------------------------------------------------------------------


def _endpoint_not_found():
    return MCPEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.CUSTOM, name="missing"
    )


def _policy_denied():
    return PolicyDeniedError(
        permission=Permission.USE_MCP_ENDPOINTS, target="custom/acme-notion"
    )


def _entitlement_denied():
    return EntitlementDeniedError(key="mcp_calls", target="custom/acme-notion")


def _tool_not_allowed():
    return MCPToolNotAllowedError(
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
    return MCPAuthRequiredError(requirement=requirement)


def _scope_insufficient():
    return MCPScopeInsufficientError(target="custom/acme-notion", scopes=["write"])


def _secret_missing():
    return SecretNotFoundError(
        mode=SecretMode.PROJECT_ONLY,
        missing=SecretOwnerKind.PROJECT,
        target="custom/acme-notion",
    )


def _secret_invalid():
    return SecretInvalidError(target="custom/acme-notion")


def _upstream_error_below_500():
    return MCPUpstreamError(target="http://upstream", status_code=400)


def _upstream_error_5xx():
    return MCPUpstreamError(target="http://upstream", status_code=503)


def _upstream_error_no_status():
    return MCPUpstreamError(target="http://upstream")


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
        (_secret_missing, 409, "secret_missing"),
        (_secret_invalid, 409, "secret_invalid"),
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
        "/custom/acme-notion",
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    )

    assert response.status_code == expected_status
    payload = response.json()
    assert payload["jsonrpc"] == "2.0"
    assert payload["id"] is None
    assert payload["error"]["data"]["cause"] == expected_cause
    # never the gateway error envelope.
    assert "retryable" not in payload["error"]["data"]


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
        (_secret_missing, 409, "secret_missing"),
        (_secret_invalid, 409, "secret_invalid"),
        (_upstream_error_below_500, 424, "upstream_error"),
        (_upstream_error_5xx, 502, "upstream_error"),
        (_upstream_error_no_status, 424, "upstream_error"),
    ],
)
def test_mapped_gateway_exceptions_carry_the_code_marker_except_upstream_error(
    client, mock_service, make_error, expected_status, expected_cause
):
    """WP25/OD18: `cause` must survive in `message` alone on both planes, for the same
    reason as the LLM plane — Codex's own SDK keeps only `error.message`. `upstream_error`
    is excluded — D16 forwards the upstream's own detail untouched."""
    mock_service.raise_error = make_error()

    response = client.post(
        "/custom/acme-notion",
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    )

    message = response.json()["error"]["message"]
    marker = f"⟦agenta_code:{expected_cause}⟧"
    if expected_cause == "upstream_error":
        assert marker not in message
    else:
        assert message.endswith(marker)


def test_scope_insufficient_with_no_endpoint_id_carries_no_connect_affordance(
    client, mock_service
):
    """The pre-WP19 shape (WP17's own seed test constructs it this way) stays valid:
    `connect` is additive, not required."""
    mock_service.raise_error = _scope_insufficient()

    response = client.post(
        "/custom/acme-notion",
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    )

    data = response.json()["error"]["data"]
    assert data["scopes"] == ["write"]
    assert "connect" not in data


def test_scope_insufficient_with_endpoint_id_carries_the_connect_affordance(
    client, mock_service
):
    """WP19: the step-up interaction reuses the missing-connection path (D17) — the
    same `POST /endpoints/{id}/connect` route WP18 built, re-run with a wider scope
    choice. `body: {}` points at step 1 (discover), not a guessed scope list — a
    marker-only recovery never carries `e.scopes` this far (WP25)."""
    endpoint_id = uuid4()
    mock_service.raise_error = MCPScopeInsufficientError(
        target="custom/acme-notion", scopes=["write"], endpoint_id=endpoint_id
    )

    response = client.post(
        "/custom/acme-notion",
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    )

    data = response.json()["error"]["data"]
    assert data["connect"] == {
        "endpoint": f"/gateways/mcps/endpoints/{endpoint_id}/connect",
        "body": {},
    }


def test_auth_required_carries_the_connect_requirement(client, mock_service):
    mock_service.raise_error = _auth_required()

    response = client.post(
        "/custom/acme-notion",
        content=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    )

    requirement = response.json()["error"]["data"]["requirement"]
    assert requirement["target"] == "custom/acme-notion"
    assert requirement["state"] == "needs_auth"


def test_invalid_json_rpc_request_is_a_protocol_invalid_request(client, mock_service):
    response = client.post("/custom/acme-notion", content=b"{}")

    assert response.status_code == 400
    assert mock_service.calls == []
    payload = response.json()
    assert payload["jsonrpc"] == "2.0"
    assert payload["id"] is None
    assert payload["error"]["data"]["cause"] == "invalid_request"
