"""Acceptance: an author-declared MCP server resolves to a gateway route (specs-wp15.md).

Mirrors `api/oss/tests/pytest/acceptance/gateways/test_mcp_gateway_proxy_acceptance.py`,
one layer up: this proves the SDK's `resolve_mcp` (the runner's caller) produces a
`connection.url`/`connection.credentials` pair that actually reaches the mock upstream
through the gateway, with no upstream server token anywhere in the resolved output.

Needs a real deployment_kind (api/AGENTS.md's test-layer rule) with WP5's mock MCP
upstream reachable at `mock-mcp-gateway:9092`. Run it with the stack up:

    load-env hosting/docker-compose/ee/.env.ee.dev
    bash hosting/docker-compose/run.sh --ee --dev --build
    cd sdks/python && pytest oss/tests/pytest/acceptance/agents -m acceptance

Audit-event assertion (WP4) is intentionally not made here: this branch is cut from
WP13's wire commit, before WP4's emission lands, so there is nothing to assert yet.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
import requests

from agenta.sdk.agents.platform import PlatformConnection, resolve_mcp

pytestmark = [pytest.mark.acceptance]

# Compose service name and port WP5 owns; the mock speaks Streamable HTTP in JSON mode
# at the root path (see the sibling api-layer acceptance test).
_MOCK_BASE_URL = "http://mock-mcp-gateway:9092/"


class _EmptySecrets:
    async def get_many(self, names):
        raise AssertionError(
            "gateway-routed resolution must never fetch a named secret"
        )


@pytest.fixture
def custom_mcp_endpoint(e2e_account):
    """Register a `custom` MCP endpoint pointing at the mock, matching this server's name."""
    slug = f"wp15-acceptance-{uuid4().hex[:8]}"
    response = requests.post(
        f"{e2e_account['api_url']}/gateways/mcps/endpoints/",
        headers={"Authorization": e2e_account["credentials"]},
        json={
            "endpoint": {
                "slug": slug,
                "auth_mode": "none",  # the mock needs no secret (D23)
                "secret_id": None,
                "data": {"route": {"base_url": _MOCK_BASE_URL}},
            }
        },
        timeout=30,
    )
    response.raise_for_status()
    endpoint = response.json()["endpoint"]
    yield endpoint
    requests.delete(
        f"{e2e_account['api_url']}/gateways/mcps/endpoints/{endpoint['id']}",
        headers={"Authorization": e2e_account["credentials"]},
        timeout=30,
    )


async def test_resolved_mcp_server_carries_the_gateway_route_and_our_credentials(
    e2e_account, custom_mcp_endpoint
):
    connection = PlatformConnection(
        base_url=e2e_account["api_url"], authorization=e2e_account["credentials"]
    )
    slug = custom_mcp_endpoint["slug"]

    resolved = await resolve_mcp(
        [
            {
                "name": slug,
                # The author's own URL and secret ref are deliberately wrong/unreachable:
                # a gateway-routed resolution must never use them (`_EmptySecrets` proves
                # no named-secret lookup happens either).
                "connection": {
                    "type": "http",
                    "url": "https://placeholder.invalid/mcp",
                    "credentials": {
                        "type": "header_secret_refs",
                        "headers": {"Authorization": "unused-secret-ref"},
                    },
                },
            }
        ],
        secret_provider=_EmptySecrets(),
        connection=connection,
    )

    assert len(resolved) == 1
    server = resolved[0]
    assert server.url == f"{e2e_account['api_url']}/gateways/mcps/custom/{slug}"
    assert [c.binding.name for c in server.credentials] == ["X-AG-Credentials"]
    # No upstream server token, ours or theirs, appears anywhere in the resolved output.
    assert "unused-secret-ref" not in server.model_dump_json()
    assert "placeholder.invalid" not in server.model_dump_json()


async def test_a_tool_call_through_the_resolved_route_reaches_the_mock_upstream(
    e2e_account, custom_mcp_endpoint
):
    connection = PlatformConnection(
        base_url=e2e_account["api_url"], authorization=e2e_account["credentials"]
    )
    slug = custom_mcp_endpoint["slug"]

    resolved = await resolve_mcp(
        [{"name": slug, "connection": {"type": "http", "url": "https://unused/mcp"}}],
        secret_provider=_EmptySecrets(),
        connection=connection,
    )
    server = resolved[0]

    # The exact request the runner sends (`toAcpMcpServers`): the gateway URL, our
    # credential in its bound header, no upstream secret anywhere in the request.
    headers = {c.binding.name: c.value for c in server.credentials}
    response = requests.post(
        server.url,
        headers={**headers, "MCP-Method": "tools/list"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        timeout=30,
    )
    response.raise_for_status()
    tool_names = {tool["name"] for tool in response.json()["result"]["tools"]}
    assert {"echo", "fail", "slow"} <= tool_names
