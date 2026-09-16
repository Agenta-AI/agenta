"""Extract the policy-relevant fields from an MCP JSON-RPC request."""

import json
from typing import Any, Dict, Optional, Tuple

from oss.src.core.gateways.mcps.dtos import COMPOSIO_PROVIDER, MCPCallContext


def parse_mcp_call_context(*, headers: Dict[str, str], body: bytes) -> MCPCallContext:
    """Read policy-relevant fields from JSON-RPC without changing forwarded bytes.

    Read, never canonicalised. These two values decide which permission is checked and
    which tool the audit record names, and the body travels to the upstream byte for
    byte, so a value trimmed here is a value the upstream never sees: policy could
    evaluate `echo` while the server received `" echo "` (M15). A padded identifier is
    therefore refused rather than repaired, because repairing it is precisely what makes
    the two disagree.

    Nothing legitimate is refused by that. A JSON-RPC method is a fixed protocol token,
    and a tool name has to match what the server advertised, so neither carries
    surrounding whitespace in a request that could have worked.
    """
    try:
        payload: Any = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError) as exc:
        raise ValueError("MCP request body must be a JSON-RPC object") from exc

    if not isinstance(payload, dict):
        raise ValueError("MCP request body must be a JSON-RPC object")

    method = payload.get("method")
    if not isinstance(method, str) or not method:
        raise ValueError("MCP JSON-RPC request requires a non-empty method")
    if method != method.strip():
        raise ValueError(
            "MCP JSON-RPC method must not begin or end with whitespace: the upstream "
            "receives the body unchanged, so a trimmed value would not be the one sent"
        )

    params = payload.get("params")
    target: Optional[str] = None
    if isinstance(params, dict) and "name" in params:
        target = params["name"]
        if not isinstance(target, str) or not target:
            raise ValueError("MCP JSON-RPC params.name must be a non-empty string")
        if target != target.strip():
            raise ValueError(
                "MCP JSON-RPC params.name must not begin or end with whitespace: the "
                "upstream receives the body unchanged, so a trimmed value would not be "
                "the one sent"
            )

    return MCPCallContext(method=method, target=target)


def split_builtin_path(*, provider: str, rest: str) -> Tuple[Optional[str], str]:
    """Split a provider-specific builtin path into integration and name."""
    remainder = rest.strip("/")
    if provider == COMPOSIO_PROVIDER:
        integration, _, name = remainder.partition("/")
        return integration or None, name
    return None, remainder
