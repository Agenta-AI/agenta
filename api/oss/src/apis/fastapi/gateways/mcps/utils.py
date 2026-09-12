"""Extract the policy-relevant fields from an MCP JSON-RPC request."""

import json
from typing import Any, Dict, Optional, Tuple

from oss.src.core.gateways.mcps.dtos import COMPOSIO_PROVIDER, MCPCallContext


def parse_mcp_call_context(*, headers: Dict[str, str], body: bytes) -> MCPCallContext:
    """Read policy-relevant fields from JSON-RPC without changing forwarded bytes."""
    try:
        payload: Any = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError) as exc:
        raise ValueError("MCP request body must be a JSON-RPC object") from exc

    if not isinstance(payload, dict):
        raise ValueError("MCP request body must be a JSON-RPC object")

    method = payload.get("method")
    if not isinstance(method, str) or not (method := method.strip()):
        raise ValueError("MCP JSON-RPC request requires a non-empty method")

    params = payload.get("params")
    target: Optional[str] = None
    if isinstance(params, dict) and "name" in params:
        raw_target = params["name"]
        if not isinstance(raw_target, str) or not (target := raw_target.strip()):
            raise ValueError("MCP JSON-RPC params.name must be a non-empty string")

    return MCPCallContext(method=method, target=target)


def split_builtin_path(*, provider: str, rest: str) -> Tuple[Optional[str], str]:
    """Split a provider-specific builtin path into integration and name."""
    remainder = rest.strip("/")
    if provider == COMPOSIO_PROVIDER:
        integration, _, name = remainder.partition("/")
        return integration or None, name
    return None, remainder
