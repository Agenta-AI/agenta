"""OAuth-grant MCP relay acceptance on a real OSS or EE development stack.

The authorization exchange is exercised at the service boundary by the local mock OAuth
provider tests. This module proves the post-exchange invariant that matters to the live
gateway: the endpoint carries only the vault handle and relays with that vault grant.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

from oss.tests.pytest.acceptance.gateways.mock_matrix import unique_slug


_MOCKS_ENABLED = os.getenv("AGENTA_GATEWAYS_MOCKS_ENABLED", "").lower() == "true"
_UPSTREAM_TOKEN = os.getenv("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN")
_MCP_MOCK_URL = os.getenv(
    "AGENTA_MOCK_MCP_GATEWAY_URL", "http://mock-mcp-gateway:9092/"
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.skipif(
        not _MOCKS_ENABLED,
        reason="gateway mock matrix is disabled (set AGENTA_GATEWAYS_MOCKS_ENABLED=true)",
    ),
]


def _assert_ok(response) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.acceptance
def test_oauth_grant_handle_relays_through_the_real_mcp_gateway(
    authed_api, gateway_api
):
    """The API response/endpoint contains only an id; the bearer stays in the vault."""
    if not _UPSTREAM_TOKEN:
        pytest.skip("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN is not configured")

    secret = _assert_ok(
        authed_api(
            "POST",
            "/secrets/",
            json={
                "header": {"name": unique_slug("oauth-grant")},
                "secret": {
                    "kind": "oauth_grant",
                    "data": {
                        "grant": {
                            "server": _MCP_MOCK_URL,
                            "access_token": _UPSTREAM_TOKEN,
                            "scopes": ["tools:call"],
                        }
                    },
                },
            },
        )
    )
    secret_id = secret["id"]
    endpoint_id = None
    try:
        endpoint = _assert_ok(
            authed_api(
                "POST",
                "/gateways/mcps/endpoints/",
                json={
                    "endpoint": {
                        "slug": unique_slug("oauth-mcp"),
                        "auth_mode": "oauth",
                        "secret_id": secret_id,
                        "data": {
                            "route": {
                                "base_url": _MCP_MOCK_URL,
                                "headers": {"X-Agenta-Mock-Profile": "mcp-custom-mock"},
                            }
                        },
                    }
                },
            )
        )["endpoint"]
        endpoint_id = endpoint["id"]
        assert "access_token" not in endpoint
        assert "refresh_token" not in endpoint
        assert endpoint["secret_id"] == secret_id

        response = gateway_api(
            "POST",
            f"/gateways/mcps/custom/{endpoint['slug']}",
            headers={"MCP-Method": "tools/call"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "echo", "arguments": {"text": "oauth"}},
            },
        )
        body = _assert_ok(response)
        assert "oauth" in str(body["result"])
    finally:
        if endpoint_id:
            authed_api("DELETE", f"/gateways/mcps/endpoints/{endpoint_id}")
        authed_api("DELETE", f"/secrets/{secret_id}")
