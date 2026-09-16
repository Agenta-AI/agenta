"""Acceptance tests for the MCP data-plane proxy.

Covers byte-preserving relays and endpoint tool-policy refusals.

Needs a real deployment_kind (api/AGENTS.md's test-layer rule). Run it with the stack up:

    bash hosting/docker-compose/test.sh --ee --dev --api --acceptance
"""

import json
import os
from uuid import uuid4

import pytest


_MOCKS_ENABLED = os.getenv("AGENTA_GATEWAYS_MOCKS_ENABLED", "").lower() == "true"

# The mock upstream this suite dials is a compose service, so it exists only in a dev
# stack that opts into the mock topology. Deployments without it (the PR preview) would
# otherwise fail here on DNS rather than on anything the gateway does.
pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.skipif(
        not _MOCKS_ENABLED,
        reason=(
            "gateway mocks are disabled "
            "(set AGENTA_GATEWAYS_MOCKS_ENABLED=true in an OSS/EE dev compose stack)"
        ),
    ),
]

# Mock MCP upstream base URL; it uses Streamable HTTP JSON at the root path.
_MOCK_BASE_URL = "http://mock-mcp-gateway:9092/"


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return _jsonrpc(response)


def _jsonrpc(response) -> dict:
    """The JSON-RPC envelope, whichever framing came back.

    A Streamable HTTP server may answer one request as an event stream and may send
    notifications before the response, and the mock now does both, as a conforming server
    is entitled to. Reading `response.json()` saw a body that was not JSON and this suite
    could not run at all.
    """
    body = response.text
    if "data:" not in body:
        return response.json()
    payloads = [
        json.loads(line[len("data:") :].strip())
        for line in body.splitlines()
        if line.startswith("data:")
    ]
    answers = [p for p in payloads if "result" in p or "error" in p]
    assert answers, body
    return answers[-1]


def _session_headers(gateway_api, slug) -> dict:
    """Initialize through the gateway and return the headers a session must then send.

    A conforming server requires `MCP-Protocol-Version` on every request after the
    handshake, and it must be the version the server negotiated. This suite sent none, so
    it was only ever exercising an obliging upstream. The header is in the relay's
    forwardable allowlist, so what a real client sends is what the upstream receives.
    """
    handshake = _call(
        gateway_api,
        slug,
        {
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "agenta-acceptance", "version": "0"},
            },
        },
    )
    negotiated = _assert_ok(handshake)["result"]["protocolVersion"]
    return {"MCP-Protocol-Version": negotiated}


def _listed_tools(gateway_api, slug) -> set:
    """Every tool the connection offers, following the upstream's pagination.

    The mock pages one tool at a time. A caller that reads only the first page sees one
    tool and calls it the catalogue.
    """
    headers = _session_headers(gateway_api, slug)
    names: set = set()
    cursor = None
    for request_id in range(1, 20):
        params = {"cursor": cursor} if cursor else {}
        response = _call(
            gateway_api,
            slug,
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/list",
                "params": params,
            },
            headers=headers,
        )
        result = _assert_ok(response)["result"]
        names.update(tool["name"] for tool in result.get("tools", []))
        cursor = result.get("nextCursor")
        if not cursor:
            return names
    raise AssertionError("the upstream paginated further than any real catalogue would")


def _create_custom_endpoint(authed_api, *, tools=None):
    slug = f"wp8-acceptance-{uuid4().hex[:8]}"
    data = {"route": {"base_url": _MOCK_BASE_URL}}
    if tools is not None:
        data["tools"] = tools

    body = _assert_ok(
        authed_api(
            "POST",
            "/gateways/mcps/endpoints/",
            json={
                "endpoint": {
                    "slug": slug,
                    "auth_mode": "none",  # the mock needs no secret (D23)
                    "secret_id": None,
                    "data": data,
                }
            },
        )
    )
    return body["endpoint"]


def _call(gateway_api, slug, payload, *, headers=None):
    """Use only the standard JSON-RPC request shape; no Agenta headers are needed."""
    return gateway_api(
        "POST", f"/gateways/mcps/custom/{slug}", json=payload, headers=headers or {}
    )


@pytest.fixture(scope="class")
def mock_mcp_endpoint(authed_api):
    """An endpoint with the default ALL tool policy, so nothing is filtered."""
    return _create_custom_endpoint(authed_api)


@pytest.mark.acceptance
class TestMCPGatewayProxyAcceptance:
    def test_tools_list_relays_the_upstream_answer(
        self, gateway_api, mock_mcp_endpoint
    ):
        listed = _listed_tools(gateway_api, mock_mcp_endpoint["slug"])

        assert listed == {"echo", "fail", "slow"}

    def test_tools_call_round_trips_the_upstream_result_unmodified(
        self, gateway_api, mock_mcp_endpoint
    ):
        payload = {
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": {"name": "echo", "arguments": {"text": "hello"}},
        }

        response = _call(
            gateway_api,
            mock_mcp_endpoint["slug"],
            payload,
            headers=_session_headers(gateway_api, mock_mcp_endpoint["slug"]),
        )

        body = _assert_ok(response)
        assert body["id"] == 7
        assert "hello" in json.dumps(body["result"])

    def test_a_failing_tool_relays_as_a_result_not_a_transport_error(
        self, gateway_api, mock_mcp_endpoint
    ):
        # Preserve the server's failure reason so a model can correct itself.
        # it travels as the response body, never as a gateway error.
        response = _call(
            gateway_api,
            mock_mcp_endpoint["slug"],
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "fail"},
            },
            headers=_session_headers(gateway_api, mock_mcp_endpoint["slug"]),
        )

        body = _assert_ok(response)
        assert body["result"]["isError"] is True

    def test_tool_outside_the_policy_is_refused_before_the_upstream(
        self, authed_api, gateway_api
    ):
        endpoint = _create_custom_endpoint(authed_api, tools={"allowlist": ["echo"]})

        response = _call(
            gateway_api,
            endpoint["slug"],
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "fail"},
            },
        )

        assert response.status_code == 403, response.text
        assert response.json()["error"]["data"]["cause"] == "tool_not_allowed"

    def test_an_include_policy_filters_the_listing(self, authed_api, gateway_api):
        endpoint = _create_custom_endpoint(authed_api, tools={"allowlist": ["echo"]})

        # The body is rewritten by the filter here, so a relayed content-length would be
        # stale and the framing has to survive the rewrite.
        assert _listed_tools(gateway_api, endpoint["slug"]) == {"echo"}

    def test_unauthenticated_request_never_reaches_the_upstream(
        self, unauthed_api, mock_mcp_endpoint
    ):
        response = unauthed_api(
            "POST",
            f"/gateways/mcps/custom/{mock_mcp_endpoint['slug']}",
            json={"jsonrpc": "2.0", "id": 5, "method": "tools/list"},
        )

        assert response.status_code in (401, 403), response.text
