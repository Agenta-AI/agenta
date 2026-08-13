"""Parses the MCP proxy's routing headers (entities.md §9).

Header names pinned against the 2026-07-28 MCP revision
(`docs/design/gateways-research/v1/raw/mcp-2026-07-28.md`, "Header-based routing"):
`Mcp-Method` is required on every Streamable HTTP POST; `Mcp-Name` carries the target for
`tools/call`, `resources/read` and `prompts/get`, and is absent for target-less methods
(`tools/list`, `server/discover`, ...). The body is never parsed for routing.
"""

from typing import Dict

from oss.src.core.gateways.mcps.dtos import McpCallContext

MCP_METHOD_HEADER = "Mcp-Method"
MCP_NAME_HEADER = "Mcp-Name"


def parse_mcp_call_context(*, headers: Dict[str, str]) -> McpCallContext:
    """Read `Mcp-Method`/`Mcp-Name` from the caller's request headers.

    Raises ValueError when `Mcp-Method` is missing or blank; the proxy translates that
    into the surface's own invalid-request response.
    """
    lowered = {key.lower(): value for key, value in headers.items()}

    method = (lowered.get(MCP_METHOD_HEADER.lower()) or "").strip()
    if not method:
        raise ValueError(f"Missing or empty required header: {MCP_METHOD_HEADER}")

    target = (lowered.get(MCP_NAME_HEADER.lower()) or "").strip() or None

    return McpCallContext(method=method, target=target)
