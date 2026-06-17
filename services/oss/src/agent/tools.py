"""Resolve the agent's configured tools through the Agenta backend.

The playground tool picker emits provider-agnostic references; the backend resolver
(``POST /tools/resolve``) validates Composio connections up front and enriches each action
from the catalog. We turn the result into the customTool specs the wire carries and the
``/tools/call`` callback. The provider key and connection auth stay server-side.
"""

from typing import Any, Dict, List, Optional, Tuple

import httpx

from oss.src.agent.client import (
    TOOLS_TIMEOUT,
    agenta_api_base,
    request_authorization,
)
from oss.src.harness.ports import ToolCallback


def _parse_gateway_slug(slug: Any) -> Optional[Dict[str, Any]]:
    """Parse a gateway tool slug into a Composio reference, or ``None``.

    The playground tool picker encodes a Composio action as a function name like
    ``tools__composio__github__GET_THE_AUTHENTICATED_USER__github-tvn`` (the same 5-segment
    slug ``/tools/call`` parses; ``__`` or ``.`` separated). Anything that is not a
    5-segment ``tools.composio.*`` slug returns ``None`` so the caller can skip it.
    """
    if not isinstance(slug, str):
        return None
    parts = slug.replace("__", ".").split(".")
    if len(parts) == 5 and parts[0] == "tools" and parts[1] == "composio":
        return {
            "type": "composio",
            "integration": parts[2],
            "action": parts[3],
            "connection": parts[4],
        }
    return None


def _normalize_tool_ref(ref: Any) -> Optional[Dict[str, Any]]:
    """Coerce a config entry into a discriminated tool reference the resolver parses.

    Handles three shapes: a bare string (or single-key ``{"name": ...}``) is a built-in
    tool name; a dict already carrying ``type`` passes through; and the playground picker's
    gateway entry (``{"function": {"name": "tools__composio__..."}}``) becomes a
    ``composio`` ref. Unsupported picker entries (provider built-ins, inline custom
    functions) return ``None`` and are skipped rather than failing the run.
    """
    if isinstance(ref, str):
        return {"type": "builtin", "name": ref}
    if isinstance(ref, dict):
        if ref.get("type") in ("builtin", "composio"):
            return ref
        function = ref.get("function") if isinstance(ref.get("function"), dict) else {}
        gateway = _parse_gateway_slug(function.get("name") or ref.get("name"))
        if gateway:
            return gateway
        if "type" not in ref and isinstance(ref.get("name"), str):
            return {"type": "builtin", "name": ref["name"]}
        return None
    return None


async def resolve_tools(
    tools: List[Any],
) -> Tuple[List[str], List[Dict[str, Any]], Optional[ToolCallback]]:
    """Resolve config tool references into built-in names + customTool specs + callback.

    Calls the backend resolver (``POST /tools/resolve``), which validates Composio
    connections up front and enriches each action from the catalog. Returns the built-in
    tool names, the camelCase customTool specs for the wire, and the ``/tools/call``
    callback. Raises on resolution failure so the invoke fails early with a clear message
    rather than the model hitting a runtime tool error.
    """
    refs = [ref for ref in (_normalize_tool_ref(t) for t in tools if t) if ref]
    if not refs:
        return [], [], None

    api_base = agenta_api_base()
    if not api_base:
        raise RuntimeError(
            "Agent has tools configured but the Agenta API base URL is unknown. "
            "Set AGENTA_AGENT_TOOLS_API_URL or AGENTA_API_URL."
        )

    authorization = request_authorization()
    headers = {"Content-Type": "application/json"}
    if authorization:
        headers["Authorization"] = authorization

    async with httpx.AsyncClient(timeout=TOOLS_TIMEOUT) as client:
        response = await client.post(
            f"{api_base}/tools/resolve",
            json={"tools": refs},
            headers=headers,
        )

    if response.status_code >= 400:
        raise RuntimeError(
            f"Tool resolution failed (HTTP {response.status_code}): {response.text[:500]}"
        )

    data = response.json()
    builtins = data.get("builtins") or []
    custom = data.get("custom") or []

    custom_tools = [
        {
            "name": spec["name"],
            "description": spec.get("description"),
            "inputSchema": spec.get("input_schema"),
            "callRef": spec["call_ref"],
        }
        for spec in custom
    ]

    callback = ToolCallback(
        endpoint=f"{api_base}/tools/call",
        authorization=authorization,
    )

    return builtins, custom_tools, callback
