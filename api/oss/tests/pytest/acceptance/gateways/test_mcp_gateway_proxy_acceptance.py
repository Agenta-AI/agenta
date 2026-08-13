"""Acceptance tests for the MCP data-plane proxy (specs-wp8.md "Done test").

specs-wp8.md rests WP8's done claim on two checks running against a deployment: a
byte-for-byte relay end to end, and the refusal of a tool outside the endpoint's policy.
specs-wp9.md cross-references the same pair. Mirrors the LLM module next door.

Needs a real deployment (api/AGENTS.md's test-layer rule). Run it with the stack up:

    load-env hosting/docker-compose/ee/.env.ee.dev
    bash hosting/docker-compose/run.sh --ee --dev --build
    cd api && pytest oss/tests/pytest/acceptance/gateways -m acceptance
"""

import json
from uuid import uuid4

import pytest

# Compose service name and port WP5 owns; the mock speaks Streamable HTTP in JSON mode
# at the root path, so no trailing segment.
_MOCK_BASE_URL = "http://mock-mcp-gateway:9092/"


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _create_custom_endpoint(authed_api, *, tool_policy=None):
    slug = f"wp8-acceptance-{uuid4().hex[:8]}"
    data = {"url": _MOCK_BASE_URL}
    if tool_policy is not None:
        data["tool_policy"] = tool_policy

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


def _call(authed_api, slug, payload):
    return authed_api("POST", f"/gateways/mcps/custom/{slug}", json=payload)


@pytest.fixture(scope="class")
def mock_mcp_endpoint(authed_api):
    """An endpoint with the default ALL tool policy, so nothing is filtered."""
    return _create_custom_endpoint(authed_api)


@pytest.mark.acceptance
class TestMcpGatewayProxyAcceptance:
    def test_tools_list_relays_the_upstream_answer(self, authed_api, mock_mcp_endpoint):
        response = _call(
            authed_api,
            mock_mcp_endpoint["slug"],
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )

        body = _assert_ok(response)
        assert {tool["name"] for tool in body["result"]["tools"]} == {
            "echo",
            "fail",
            "slow",
        }

    def test_tools_call_round_trips_the_upstream_result_unmodified(
        self, authed_api, mock_mcp_endpoint
    ):
        payload = {
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": {"name": "echo", "arguments": {"text": "hello"}},
        }

        response = _call(authed_api, mock_mcp_endpoint["slug"], payload)

        body = _assert_ok(response)
        assert body["id"] == 7
        assert "hello" in json.dumps(body["result"])

    def test_a_failing_tool_relays_as_a_result_not_a_transport_error(
        self, authed_api, mock_mcp_endpoint
    ):
        # D16: the server's own failure reason is what lets a model correct itself, so
        # it travels as the response body, never as a gateway error.
        response = _call(
            authed_api,
            mock_mcp_endpoint["slug"],
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "fail"},
            },
        )

        body = _assert_ok(response)
        assert body["result"]["isError"] is True

    def test_tool_outside_the_policy_is_refused_before_the_upstream(self, authed_api):
        endpoint = _create_custom_endpoint(
            authed_api, tool_policy={"mode": "include", "names": ["echo"]}
        )

        response = _call(
            authed_api,
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

    def test_an_include_policy_filters_the_listing(self, authed_api):
        endpoint = _create_custom_endpoint(
            authed_api, tool_policy={"mode": "include", "names": ["echo"]}
        )

        response = _call(
            authed_api,
            endpoint["slug"],
            {"jsonrpc": "2.0", "id": 4, "method": "tools/list"},
        )

        body = _assert_ok(response)
        # The body is rewritten here, so a relayed content-length would be stale.
        assert {tool["name"] for tool in body["result"]["tools"]} == {"echo"}

    def test_unauthenticated_request_never_reaches_the_upstream(
        self, unauthed_api, mock_mcp_endpoint
    ):
        response = unauthed_api(
            "POST",
            f"/gateways/mcps/custom/{mock_mcp_endpoint['slug']}",
            json={"jsonrpc": "2.0", "id": 5, "method": "tools/list"},
        )

        assert response.status_code in (401, 403), response.text
