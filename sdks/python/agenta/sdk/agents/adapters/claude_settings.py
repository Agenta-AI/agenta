"""Layer 1 for Claude: render the harness's permission settings into a ``.claude/settings.json``.

This is the claude adapter. It builds the full file CONTENT in Python (the translation used to
live in the TS runner's ``claude-settings.ts``); the runner is now a dumb file-writer that drops
whatever ``harnessFiles`` the adapter produced into the session cwd. The Claude ACP adapter reads
``<cwd>/.claude/settings.json`` because it builds its SDK query with
``settingSources: ["user", "project", "local"]`` (and applies ``permissions.defaultMode``); that
file is the only clean Claude-config path because the sandbox-agent daemon strips ACP ``_meta``.

Four rule sources merge here:
 - the AUTHOR's options (Layer 1), read from the harness's first-class ``permissions`` slice
   (``harness.permissions`` in the template): ``default_mode`` + per-tool ``allow``/``deny``/``ask``
   strings. This is the only place the claude-specific shape of that slice is known.
 - rules DERIVED from ``sandbox_permission`` (Layer 2): baseline reinforcement of the sandbox
   boundary as Claude-tool rules (block web tools when egress is off, block edits when the
   filesystem is read-only/off). A safety floor, not the primary enforcement.
 - rules DERIVED from per-MCP-server ``permission`` (Layer 3, S3b): each user MCP server with a
   set permission becomes a whole-server ``mcp__<server>`` allow/ask/deny rule.
 - rules DERIVED from each resolved EXECUTABLE tool's ``permission`` (Layer 3, tool path; F-046):
   each callback/code tool becomes a per-tool ``mcp__agenta-tools__<tool>`` allow/ask/deny rule.

Why the tool path needs a rule here (F-046): backend-resolved executable tools (callback/code) are
delivered to Claude as tools of the runner's internal ``agenta-tools`` MCP server. Claude Code
raises its OWN permission gate BEFORE running any tool, and the runner parks every undecided gate
when a human surface exists — so the tool's per-tool ``permission`` never reaches the runner relay
that honors ``allow``. Emitting an ``allow`` rule here is the only way an ``allow`` tool actually
runs on Claude instead of always parking. ``ask``/unset emits no allow rule (the gate stays raised
-> HITL park preserved); ``deny`` emits a deny rule (which also closes a local-Claude execution
gap). ``client`` tools are browser-fulfilled, never delivered over this channel, so they are
excluded. The runner policy supplies the default permission when a tool has no explicit value.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Sequence

from ..permission_rules import CLAUDE_PERMISSION_MODES, parse_author_permissions
from ..tools.models import PermissionMode, effective_permission

# Claude Code's four permission modes (its ``permissions.defaultMode``); any other authored value
# is dropped.
PERMISSION_MODES = CLAUDE_PERMISSION_MODES
_parse_author_permissions = parse_author_permissions

# Where the rendered settings land, relative to the session cwd.
SETTINGS_PATH = ".claude/settings.json"

# The fixed name of the runner's INTERNAL MCP server that delivers backend-resolved EXECUTABLE
# tools (callback/code) to the harness. Claude addresses one of a server's tools as
# ``mcp__<server>__<tool>``, so a per-tool permission rule for a resolved tool is
# ``mcp__agenta-tools__<tool>``. This name COUPLES to the runner constant and MUST stay in sync
# with the TypeScript runner, which advertises the same server name in:
#   - ``services/agent/src/tools/mcp-bridge.ts`` (``name: "agenta-tools"``)
#   - ``services/agent/src/tools/relay-mcp-stdio.ts`` and ``tool-mcp-http.ts`` (``serverInfo.name``)
#   - ``services/agent/src/engines/sandbox_agent/mcp.ts``
# If the runner renames this server, this constant must change with it.
INTERNAL_TOOL_MCP_SERVER = "agenta-tools"


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


def _rules_from_tool_specs(
    tool_specs: Any, permission_default: PermissionMode
) -> Dict[str, List[str]]:
    """Derive per-tool Claude rules from each resolved EXECUTABLE tool's Layer-3 ``permission`` (F-046).

    Mirrors :func:`_rules_from_mcp_permissions`, but per-tool against the fixed internal server name
    ``agenta-tools``: a callback/code tool is delivered to Claude as a tool of that MCP server, so
    its rule is ``mcp__agenta-tools__<name>``. The tool's :meth:`ToolSpec.effective_permission`
    (the single source of the allow/ask/deny ladder) routes it to the matching list. Unset tools
    only render a rule when the runner mode needs an explicit Claude allow/deny rule. ``client``
    tools are browser-fulfilled and never delivered over this channel, so they are excluded (this
    mirrors the runner's ``mcp-bridge`` filter). Accepts a list
    of :class:`~agenta.sdk.agents.tools.models.ToolSpec` or plain dicts (coerced to a spec so the
    same permission ladder applies).
    """
    # Lazy import: ``tools.models`` does not import this adapter, but keeping the import local
    # avoids loading the tool models when the claude adapter is used without resolved tools.
    from ..tools.models import coerce_tool_spec

    allow: List[str] = []
    ask: List[str] = []
    deny: List[str] = []
    for raw in tool_specs or []:
        try:
            spec = coerce_tool_spec(raw)
        except Exception:
            # A malformed/nameless spec contributes nothing (mirrors the MCP helper's name guard).
            continue
        if spec.kind == "client":
            continue
        permission = effective_permission(
            spec.permission, spec.read_only, permission_default
        )
        if spec.permission is None and permission == "ask":
            continue
        rule = f"mcp__{INTERNAL_TOOL_MCP_SERVER}__{spec.name}"
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
    harness_permissions: Any,
    sandbox_permission: Any = None,
    mcp_servers: Any = None,
    tool_specs: Any = None,
    permission_default: PermissionMode = "allow_reads",
) -> List[Dict[str, str]]:
    """Build the Claude ``settings.json`` as a generic ``harnessFiles`` entry, or ``[]`` if none.

    Reads the author's Layer-1 options from the harness's ``permissions`` slice
    (``harness.permissions`` in the template), merges them with the Layer-2-derived rules (from
    ``sandbox_permission``), the Layer-3-derived MCP rules (from ``mcp_servers``), and the
    Layer-3-derived per-resolved-tool rules (from ``tool_specs``, F-046), dedupes each list, and
    emits the smallest valid file: ``permissions.defaultMode`` is set only when authored (and
    valid), and each allow/deny/ask list appears only when non-empty. When there is nothing to
    write at all (no author options AND no derived rules) it returns ``[]`` so the runner writes
    no file.

    Returns ``[{"path": ".claude/settings.json", "content": <json str>}]`` or ``[]``.
    """
    author = _parse_author_permissions(harness_permissions)

    # Merge order: author rules first, then derived rules (Layer 2, then Layer 3). ``_dedupe``
    # keeps first-seen order, so an author rule wins its position and derived rules append.
    sandbox_rules = _rules_from_sandbox_permission(sandbox_permission)
    mcp_rules = _rules_from_mcp_permissions(mcp_servers)
    tool_rules = _rules_from_tool_specs(tool_specs, permission_default)

    allow = _dedupe(
        [*author["allow"], *mcp_rules.get("allow", []), *tool_rules.get("allow", [])]
    )
    deny = _dedupe(
        [
            *author["deny"],
            *sandbox_rules.get("deny", []),
            *mcp_rules.get("deny", []),
            *tool_rules.get("deny", []),
        ]
    )
    ask = _dedupe(
        [*author["ask"], *mcp_rules.get("ask", []), *tool_rules.get("ask", [])]
    )

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
