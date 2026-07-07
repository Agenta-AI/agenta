"""Shared parsing for authored harness permission rule lists."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, TypedDict

ToolPermission = Literal["allow", "ask", "deny"]
CLAUDE_PERMISSION_MODES = frozenset(
    {"default", "acceptEdits", "plan", "bypassPermissions"}
)


class PermissionRule(TypedDict):
    pattern: str
    permission: ToolPermission


def _string_list(value: Any) -> List[str]:
    """Keep only string entries from an authored allow/deny/ask value."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def parse_author_permissions(slice_: Any) -> Dict[str, Any]:
    """Parse the untyped ``harness.permissions`` block used by Claude settings and wire rules."""
    if not isinstance(slice_, dict):
        return {"allow": [], "deny": [], "ask": []}
    out: Dict[str, Any] = {}
    mode = slice_.get("default_mode", slice_.get("defaultMode"))
    if isinstance(mode, str) and mode in CLAUDE_PERMISSION_MODES:
        out["mode"] = mode
    out["allow"] = _string_list(slice_.get("allow"))
    out["deny"] = _string_list(slice_.get("deny"))
    out["ask"] = _string_list(slice_.get("ask"))
    return out


def wire_author_permission_rules(slice_: Any) -> List[PermissionRule]:
    """Build runner permission rules from authored builtin lists, excluding MCP rules.

    ``mcp__`` patterns are still rendered into Claude settings; on the runner wire they would
    double-count tools reached through MCP server/spec permissions.
    """
    author = parse_author_permissions(slice_)
    rules: List[PermissionRule] = []
    for permission in ("deny", "ask", "allow"):
        for pattern in author[permission]:
            if pattern.startswith("mcp__"):
                continue
            rules.append({"pattern": pattern, "permission": permission})
    return rules
