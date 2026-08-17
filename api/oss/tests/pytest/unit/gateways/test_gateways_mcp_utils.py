"""Unit tests for parse_mcp_call_context (entities.md §9, workstreams/specs-wp8.md).

Pure function: header dicts in, MCPCallContext out. Header names pinned against the
2026-07-28 MCP revision: `MCP-Method` (required), `MCP-Name` (target, absent for
target-less methods).
"""

import pytest

from oss.src.apis.fastapi.gateways.mcps.utils import parse_mcp_call_context
from oss.src.core.gateways.mcps.dtos import MCPCallContext


def test_both_headers_present():
    context = parse_mcp_call_context(
        headers={"MCP-Method": "tools/call", "MCP-Name": "echo"}
    )

    assert context == MCPCallContext(method="tools/call", target="echo")


def test_target_absent_for_a_target_less_method():
    context = parse_mcp_call_context(headers={"MCP-Method": "tools/list"})

    assert context == MCPCallContext(method="tools/list", target=None)


def test_header_names_are_case_insensitive():
    context = parse_mcp_call_context(
        headers={"mcp-method": "tools/call", "MCP-NAME": "echo"}
    )

    assert context == MCPCallContext(method="tools/call", target="echo")


def test_missing_method_header_raises_value_error():
    with pytest.raises(ValueError):
        parse_mcp_call_context(headers={"MCP-Name": "echo"})


def test_blank_method_header_raises_value_error():
    with pytest.raises(ValueError):
        parse_mcp_call_context(headers={"MCP-Method": "   "})


def test_blank_target_header_is_treated_as_absent():
    context = parse_mcp_call_context(
        headers={"MCP-Method": "tools/list", "MCP-Name": "  "}
    )

    assert context.target is None
