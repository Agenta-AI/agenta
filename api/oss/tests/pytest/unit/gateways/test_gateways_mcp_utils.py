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


def test_unrelated_headers_do_not_affect_json_rpc_context():
    context = parse_mcp_call_context(
        headers={"x-request-id": "request-1"},
        body=_request(method="tools/call", params={"name": "echo"}),
    )

    assert context == MCPCallContext(method="tools/call", target="echo")


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


# ---------------------------------------------------------------------------
# M15: what policy evaluates is what the upstream receives
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        b'{"method": "  tools/call  ", "params": {"name": "echo"}}',
        b'{"method": "tools/call\\n"}',
        b'{"method": "tools/call", "params": {"name": " echo "}}',
        b'{"method": "tools/call", "params": {"name": "echo\\t"}}',
    ],
)
def test_a_padded_identifier_is_refused_rather_than_trimmed(body):
    """These two values decide which permission is checked and which tool the audit
    record names, and the body reaches the upstream byte for byte. Trimming them made
    policy evaluate `echo` while the server received `" echo "`."""
    with pytest.raises(ValueError):
        parse_mcp_call_context(headers={}, body=body)


def test_an_identifier_with_interior_spacing_is_left_exactly_as_sent():
    """Only the ends are refused. Whatever is inside is the caller's string, and it is
    the string the upstream will be given."""
    context = parse_mcp_call_context(
        headers={},
        body=_request(method="tools/call", params={"name": "search web"}),
    )

    assert context.target == "search web"
