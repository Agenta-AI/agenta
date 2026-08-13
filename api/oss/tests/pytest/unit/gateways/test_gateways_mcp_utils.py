"""Unit tests for parse_mcp_call_context (entities.md §9, workstreams/specs-wp8.md).

Pure function: header dicts in, McpCallContext out. Header names pinned against the
2026-07-28 MCP revision: `Mcp-Method` (required), `Mcp-Name` (target, absent for
target-less methods).
"""

import pytest

from oss.src.apis.fastapi.gateways.mcps.utils import parse_mcp_call_context
from oss.src.core.gateways.mcps.dtos import McpCallContext


def test_both_headers_present():
    context = parse_mcp_call_context(
        headers={"Mcp-Method": "tools/call", "Mcp-Name": "echo"}
    )

    assert context == McpCallContext(method="tools/call", target="echo")


def test_target_absent_for_a_target_less_method():
    context = parse_mcp_call_context(headers={"Mcp-Method": "tools/list"})

    assert context == McpCallContext(method="tools/list", target=None)


def test_header_names_are_case_insensitive():
    context = parse_mcp_call_context(
        headers={"mcp-method": "tools/call", "MCP-NAME": "echo"}
    )

    assert context == McpCallContext(method="tools/call", target="echo")


def test_missing_method_header_raises_value_error():
    with pytest.raises(ValueError):
        parse_mcp_call_context(headers={"Mcp-Name": "echo"})


def test_blank_method_header_raises_value_error():
    with pytest.raises(ValueError):
        parse_mcp_call_context(headers={"Mcp-Method": "   "})


def test_blank_target_header_is_treated_as_absent():
    context = parse_mcp_call_context(
        headers={"Mcp-Method": "tools/list", "Mcp-Name": "  "}
    )

    assert context.target is None
