"""Extract the policy-relevant fields from an MCP JSON-RPC request."""

import json
from typing import Any, Dict, Optional, Tuple

from oss.src.core.gateways.mcps.dtos import COMPOSIO_PROVIDER, MCPCallContext

MCP_METHOD_HEADER = "MCP-Method"
MCP_NAME_HEADER = "MCP-Name"


def _optional_header(headers: Dict[str, str], name: str) -> Optional[str]:
    lowered = {key.lower(): value for key, value in headers.items()}
    return (lowered.get(name.lower()) or "").strip() or None


def parse_mcp_call_context(*, headers: Dict[str, str], body: bytes) -> MCPCallContext:
    """Read method and tool name from JSON-RPC without changing the forwarded bytes.

    ``MCP-Method`` and ``MCP-Name`` were used by an early gateway client.  They
    remain accepted as optional metadata, but must agree with the JSON-RPC
    request when present so they cannot weaken policy enforcement.
    """
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

    header_method = _optional_header(headers, MCP_METHOD_HEADER)
    if header_method is not None and header_method != method:
        raise ValueError(f"{MCP_METHOD_HEADER} does not match the JSON-RPC method")

    header_target = _optional_header(headers, MCP_NAME_HEADER)
    if header_target is not None and header_target != target:
        raise ValueError(f"{MCP_NAME_HEADER} does not match JSON-RPC params.name")

    return MCPCallContext(method=method, target=target)


def split_builtin_path(*, provider: str, rest: str) -> Tuple[Optional[str], str]:
    """Split a provider-specific builtin path into integration and name."""
    remainder = rest.strip("/")
    if provider == COMPOSIO_PROVIDER:
        integration, _, name = remainder.partition("/")
        return integration or None, name
    return None, remainder
