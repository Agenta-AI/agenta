"""Parse MCP routing headers without reading the request body."""

from typing import Dict, Optional, Tuple

from oss.src.core.gateways.mcps.dtos import COMPOSIO_PROVIDER, MCPCallContext

MCP_METHOD_HEADER = "MCP-Method"
MCP_NAME_HEADER = "MCP-Name"


def parse_mcp_call_context(*, headers: Dict[str, str]) -> MCPCallContext:
    """Read the required method and optional target headers."""
    lowered = {key.lower(): value for key, value in headers.items()}

    method = (lowered.get(MCP_METHOD_HEADER.lower()) or "").strip()
    if not method:
        raise ValueError(f"Missing or empty required header: {MCP_METHOD_HEADER}")

    target = (lowered.get(MCP_NAME_HEADER.lower()) or "").strip() or None

    return MCPCallContext(method=method, target=target)


def split_builtin_path(*, provider: str, rest: str) -> Tuple[Optional[str], str]:
    """Split a provider-specific builtin path into integration and name."""
    remainder = rest.strip("/")
    if provider == COMPOSIO_PROVIDER:
        integration, _, name = remainder.partition("/")
        return integration or None, name
    return None, remainder
