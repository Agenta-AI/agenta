"""Layer 1 for Claude: render the harness's permission settings into a ``.claude/settings.json``.

This is the claude adapter. It builds the full file CONTENT in Python (the translation used to
live in the TS runner's ``claude-settings.ts``); the runner is now a dumb file-writer that drops
whatever ``harnessFiles`` the adapter produced into the session cwd. The Claude ACP adapter reads
``<cwd>/.claude/settings.json`` because it builds its SDK query with
``settingSources: ["user", "project", "local"]`` (and applies ``permissions.defaultMode``); that
file is the only clean Claude-config path because the sandbox-agent daemon strips ACP ``_meta``.

Three rule sources merge here:
 - the AUTHOR's options (Layer 1), read from the generic ``harness_kwargs["claude"]["permissions"]``
   slice: ``default_mode`` + per-tool ``allow``/``deny``/``ask`` strings. This is the only place the
   claude-specific shape of that slice is known.
 - rules DERIVED from ``sandbox_permission`` (Layer 2): baseline reinforcement of the sandbox
   boundary as Claude-tool rules (block web tools when egress is off, block edits when the
   filesystem is read-only/off). A safety floor, not the primary enforcement.
 - rules DERIVED from per-MCP-server ``permission`` (Layer 3, S3b): each user MCP server with a
   set permission becomes a whole-server ``mcp__<server>`` allow/ask/deny rule.

Layer 3 enforcement is split by tool source: resolved tools (code / gateway-callback) run
runner-side and are enforced at the relay, NOT here. Only the per-MCP-server permission lands in
this file.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence

# Claude Code's four permission modes (its ``permissions.defaultMode``); any other authored value
# is dropped.
PERMISSION_MODES = frozenset({"default", "acceptEdits", "plan", "bypassPermissions"})

# Where the rendered settings land, relative to the session cwd.
SETTINGS_PATH = ".claude/settings.json"


def _string_list(value: Any) -> List[str]:
    """Keep only the string entries of an authored allow/deny/ask value; default to ``[]``."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _parse_author_permissions(slice_: Any) -> Dict[str, Any]:
    """Parse the untyped author block from ``harness_kwargs["claude"]["permissions"]``.

    ``default_mode`` (also accepted as ``defaultMode``) survives only when it is one of the four
    valid modes; ``allow``/``deny``/``ask`` become string lists. This is where the claude-specific
    knowledge of that slice lives. Returns ``{mode?, allow, deny, ask}`` (mode omitted when unset
    or invalid).
    """
    if not isinstance(slice_, dict):
        return {"allow": [], "deny": [], "ask": []}
    out: Dict[str, Any] = {}
    mode = slice_.get("default_mode", slice_.get("defaultMode"))
    if isinstance(mode, str) and mode in PERMISSION_MODES:
        out["mode"] = mode
    out["allow"] = _string_list(slice_.get("allow"))
    out["deny"] = _string_list(slice_.get("deny"))
    out["ask"] = _string_list(slice_.get("ask"))
    return out


def _dedupe(values: Sequence[str]) -> List[str]:
    """Dedupe in first-seen order, dropping falsy entries."""
    seen: set[str] = set()
    out: List[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _rules_from_sandbox_permission(sandbox_permission: Any) -> Dict[str, List[str]]:
    """Derive baseline Claude-tool rules from the Layer-2 sandbox boundary.

    These reinforce the declared boundary at the harness level (the sandbox provider is the real
    enforcement):
     - network not fully ``on`` (off / allowlist) -> deny the web tools (``WebFetch``, ``WebSearch``);
     - filesystem ``readonly`` or ``off`` -> deny the mutating file tools (``Write``, ``Edit``).

    Accepts either a :class:`~agenta.sdk.agents.dtos.SandboxPermission` or a plain dict (network is
    a nested object with a ``mode``; filesystem is a plain string).
    """
    deny: List[str] = []
    if sandbox_permission is None:
        return {"deny": deny}

    network = _get(sandbox_permission, "network")
    network_mode = _get(network, "mode") if network is not None else None
    if network is not None and (network_mode or "on") != "on":
        deny.extend(["WebFetch", "WebSearch"])

    filesystem = _get(sandbox_permission, "filesystem")
    if filesystem in ("readonly", "off"):
        deny.extend(["Write", "Edit"])

    return {"deny": deny}


def _rules_from_mcp_permissions(mcp_servers: Any) -> Dict[str, List[str]]:
    """Derive whole-server Claude rules from each MCP server's Layer-3 ``permission`` (S3b).

    Claude addresses a whole MCP server as ``mcp__<serverName>`` (a per-tool rule is
    ``mcp__<server>__<tool>``); the server name is the ``name`` carried to the runtime verbatim.
    ``allow``/``ask``/``deny`` route to the matching list; a server with no permission contributes
    nothing (falls back to the global policy). Accepts a list of
    :class:`~agenta.sdk.agents.mcp.models.ResolvedMCPServer` or plain dicts.
    """
    allow: List[str] = []
    ask: List[str] = []
    deny: List[str] = []
    for server in mcp_servers or []:
        name = _get(server, "name")
        permission = _get(server, "permission")
        if not permission or not name:
            continue
        rule = f"mcp__{name}"
        if permission == "allow":
            allow.append(rule)
        elif permission == "ask":
            ask.append(rule)
        elif permission == "deny":
            deny.append(rule)
    return {"allow": allow, "ask": ask, "deny": deny}


def _get(obj: Any, key: str) -> Any:
    """Read ``key`` off a pydantic model (attribute) or a plain dict (item)."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def build_claude_settings_files(
    harness_kwargs: Optional[Dict[str, Any]],
    sandbox_permission: Any = None,
    mcp_servers: Any = None,
) -> List[Dict[str, str]]:
    """Build the Claude ``settings.json`` as a generic ``harnessFiles`` entry, or ``[]`` if none.

    Reads the author's Layer-1 options from ``harness_kwargs["claude"]["permissions"]``, merges
    them with the Layer-2-derived rules (from ``sandbox_permission``) and the Layer-3-derived MCP
    rules (from ``mcp_servers``), dedupes each list, and emits the smallest valid file:
    ``permissions.defaultMode`` is set only when authored (and valid), and each allow/deny/ask list
    appears only when non-empty. When there is nothing to write at all (no author options AND no
    derived rules) it returns ``[]`` so the runner writes no file.

    Returns ``[{"path": ".claude/settings.json", "content": <json str>}]`` or ``[]``.
    """
    author = _parse_author_permissions(_claude_permissions_slice(harness_kwargs))

    # Merge order: author rules first, then derived rules (Layer 2, then Layer 3). ``_dedupe``
    # keeps first-seen order, so an author rule wins its position and derived rules append.
    sandbox_rules = _rules_from_sandbox_permission(sandbox_permission)
    mcp_rules = _rules_from_mcp_permissions(mcp_servers)

    allow = _dedupe([*author["allow"], *mcp_rules.get("allow", [])])
    deny = _dedupe(
        [*author["deny"], *sandbox_rules.get("deny", []), *mcp_rules.get("deny", [])]
    )
    ask = _dedupe([*author["ask"], *mcp_rules.get("ask", [])])

    permissions: Dict[str, Any] = {}
    if "mode" in author:
        permissions["defaultMode"] = author["mode"]
    if allow:
        permissions["allow"] = allow
    if deny:
        permissions["deny"] = deny
    if ask:
        permissions["ask"] = ask

    # Nothing authored and nothing derived -> no file (the boundary-free Claude run is unchanged).
    if not permissions:
        return []

    content = json.dumps({"permissions": permissions}, indent=2)
    return [{"path": SETTINGS_PATH, "content": content}]


def _claude_permissions_slice(harness_kwargs: Optional[Dict[str, Any]]) -> Any:
    """Pull the ``claude.permissions`` slice from the generic per-harness options map."""
    if not isinstance(harness_kwargs, dict):
        return None
    claude = harness_kwargs.get("claude")
    if not isinstance(claude, dict):
        return None
    return claude.get("permissions")
