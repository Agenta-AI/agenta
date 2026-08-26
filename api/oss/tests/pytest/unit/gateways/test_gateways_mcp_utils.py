"""Unit tests for MCP JSON-RPC policy context extraction."""

import json
import pytest

from oss.src.apis.fastapi.gateways.mcps.utils import parse_mcp_call_context
from oss.src.core.gateways.mcps.dtos import MCPCallContext


def _request(*, method="tools/list", params=None):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        payload["params"] = params
    return json.dumps(payload).encode()


def test_json_rpc_body_is_sufficient_without_private_headers():
    context = parse_mcp_call_context(headers={}, body=_request())

    assert context == MCPCallContext(method="tools/list", target=None)


def test_tool_name_comes_from_tools_call_params():
    context = parse_mcp_call_context(
        headers={}, body=_request(method="tools/call", params={"name": "echo"})
    )

    assert context == MCPCallContext(method="tools/call", target="echo")


def test_matching_legacy_headers_are_accepted():
    context = parse_mcp_call_context(
        headers={"mcp-method": "tools/call", "MCP-NAME": "echo"},
        body=_request(method="tools/call", params={"name": "echo"}),
    )

    assert context == MCPCallContext(method="tools/call", target="echo")


@pytest.mark.parametrize(
    ("headers", "message"),
    [
        ({"MCP-Method": "tools/list"}, "MCP-Method does not match"),
        ({"MCP-Name": "other"}, "MCP-Name does not match"),
    ],
)
def test_conflicting_legacy_headers_are_rejected(headers, message):
    with pytest.raises(ValueError, match=message):
        parse_mcp_call_context(
            headers=headers,
            body=_request(method="tools/call", params={"name": "echo"}),
        )


@pytest.mark.parametrize(
    "body",
    [
        b"not-json",
        b"[]",
        b"{}",
        b'{"method": ""}',
        b'{"method": "tools/call", "params": {"name": 3}}',
    ],
)
def test_invalid_json_rpc_context_is_rejected(body):
    with pytest.raises(ValueError):
        parse_mcp_call_context(headers={}, body=body)
