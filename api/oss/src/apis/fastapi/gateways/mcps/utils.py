"""Parses the MCP proxy's routing headers (entities.md §9).

Header names pinned against the 2026-07-28 MCP revision
(`docs/design/gateways-research/v1/raw/mcp-2026-07-28.md`, "Header-based routing"):
`MCP-Method` is required on every Streamable HTTP POST; `MCP-Name` carries the target for
`tools/call`, `resources/read` and `prompts/get`, and is absent for target-less methods
(`tools/list`, `server/discover`, ...). The body is never parsed for routing.
"""

from typing import Dict, Optional, Tuple

from oss.src.core.gateways.mcps.dtos import COMPOSIO_PROVIDER, MCPCallContext

MCP_METHOD_HEADER = "MCP-Method"
MCP_NAME_HEADER = "MCP-Name"


def parse_mcp_call_context(*, headers: Dict[str, str]) -> MCPCallContext:
    """Read `MCP-Method`/`MCP-Name` from the caller's request headers.

    Raises ValueError when `MCP-Method` is missing or blank; the proxy translates that
    into the surface's own invalid-request response.
    """
    lowered = {key.lower(): value for key, value in headers.items()}

    method = (lowered.get(MCP_METHOD_HEADER.lower()) or "").strip()
    if not method:
        raise ValueError(f"Missing or empty required header: {MCP_METHOD_HEADER}")

    target = (lowered.get(MCP_NAME_HEADER.lower()) or "").strip() or None

    return MCPCallContext(method=method, target=target)


def split_builtin_path(*, provider: str, rest: str) -> Tuple[Optional[str], str]:
    """Split a builtin path's remainder into (integration, name) for its provider.

    Composio addresses a connection as `{integration}/{connection}`; `agenta` serves its
    own endpoints under a bare slug (D30). An unknown provider is read the same way as
    agenta — resolution is what refuses it, not this parse.
    """
    remainder = rest.strip("/")
    if provider == COMPOSIO_PROVIDER:
        integration, _, name = remainder.partition("/")
        return integration or None, name
    return None, remainder
