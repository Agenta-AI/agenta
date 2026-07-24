"""Layers 1 through 3 for Codex: render harness settings into ``.codex/config.toml``.

This is the Codex adapter. Codex reads its configuration from
``$CODEX_HOME/config.toml``. The runner sets ``CODEX_HOME`` to ``<cwd>/.codex`` and writes this
file there through the generic ``harnessFiles`` seam. The runner is a blind file writer.

Four sources merge here, mirroring ``claude_settings.py``:

- Layer 1 passes through the author's Codex-native ``approval_policy`` and ``sandbox_mode``.
- Layer 2 reinforces a read-only/off filesystem boundary with Codex's ``read-only`` sandbox mode.
- Layer 3a maps user MCP server permissions to Codex server approval settings.
- Layer 3b maps resolved tools to per-tool settings on the internal ``agenta-tools`` MCP server.

Decision D-008 is the controlling proviso: these config-file rules affect Codex tool gating only
when the author chooses ACP ``agent`` mode. The default ``agent-full-access`` mode forces approvals
off, so nothing in this file restores a Codex-side gate there. The rules are still rendered
regardless of mode; the author's mode choice decides whether Codex honors them. The Layer-3 key
names and enum values come from ``docs/design/codex-harness/spike/findings.md`` Q3.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Tuple, Union

from ..tools.models import PermissionMode, effective_permission

# Where the rendered configuration lands, relative to the session cwd. ``CODEX_HOME`` points at
# ``<cwd>/.codex``.
SETTINGS_PATH = ".codex/config.toml"

APPROVAL_POLICIES = frozenset({"untrusted", "on-request", "on-failure", "never"})
SANDBOX_MODES = frozenset({"read-only", "workspace-write", "danger-full-access"})
APPROVAL_MODE_BY_PERMISSION = {
    "allow": "approve",
    "ask": "prompt",
}

# The fixed name of the runner's INTERNAL MCP server that delivers backend-resolved EXECUTABLE
# tools (callback/code) to the harness. Codex addresses their settings under
# ``mcp_servers.agenta-tools.tools.<tool>``. This name COUPLES to the runner constant and MUST stay
# in sync with the TypeScript runner, which advertises the same server name in:
#   - ``services/runner/src/tools/mcp-bridge.ts`` (``name: "agenta-tools"``)
#   - ``services/runner/src/tools/relay.ts`` and ``tool-mcp-http.ts`` (``serverInfo.name``)
#   - ``services/runner/src/engines/sandbox_agent/mcp.ts``
# If the runner renames this server, this constant must change with it.
INTERNAL_TOOL_MCP_SERVER = "agenta-tools"

TomlValue = Union[str, List[str]]
TomlTable = Dict[str, TomlValue]
ServerTables = Dict[str, TomlTable]
ToolTables = Dict[Tuple[str, str], Dict[str, str]]

_BARE_TOML_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def _toml_escape(value: str) -> str:
    """Escape characters with special meaning in a TOML basic string."""
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\b", "\\b")
        .replace("\t", "\\t")
        .replace("\n", "\\n")
        .replace("\f", "\\f")
        .replace("\r", "\\r")
    )


def _toml_key_segment(value: str) -> str:
    """Render one safe TOML key segment, quoting names that are not bare keys."""
    if _BARE_TOML_KEY.fullmatch(value):
        return value
    return f'"{_toml_escape(value)}"'


def _toml_value(value: TomlValue) -> str:
    """Render the string and string-list values used by Codex permission settings."""
    if isinstance(value, list):
        items = ", ".join(f'"{_toml_escape(item)}"' for item in value)
        return f"[{items}]"
    return f'"{_toml_escape(value)}"'


def _render_config_toml(
    scalars: Dict[str, str],
    server_tables: ServerTables | None = None,
    tool_tables: ToolTables | None = None,
) -> str:
    """Render top-level values and nested MCP permission tables as dependency-free TOML.

    The table shapes and key names are the forms verified in
    ``docs/design/codex-harness/spike/findings.md`` Q3:
    ``[mcp_servers.<name>]`` with ``default_tools_approval_mode`` or
    ``disabled_tools``, and ``[mcp_servers.<name>.tools.<tool>]`` with
    ``approval_mode``.
    """
    sections: List[str] = []
    if scalars:
        sections.append(
            "\n".join(f"{key} = {_toml_value(value)}" for key, value in scalars.items())
        )

    for server_name, values in (server_tables or {}).items():
        server = _toml_key_segment(server_name)
        lines = [f"[mcp_servers.{server}]"]
        lines.extend(f"{key} = {_toml_value(value)}" for key, value in values.items())
        sections.append("\n".join(lines))

    for (server_name, tool_name), values in (tool_tables or {}).items():
        server = _toml_key_segment(server_name)
        tool = _toml_key_segment(tool_name)
        lines = [f"[mcp_servers.{server}.tools.{tool}]"]
        lines.extend(f"{key} = {_toml_value(value)}" for key, value in values.items())
        sections.append("\n".join(lines))

    if not sections:
        return ""
    return "\n\n".join(sections) + "\n"


def _dedupe(values: Iterable[str]) -> List[str]:
    """Dedupe in first-seen order, dropping empty values."""
    seen: set[str] = set()
    output: List[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output


def _get(source: Any, key: str) -> Any:
    """Read ``key`` off a pydantic model (attribute) or a plain dict (item)."""
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _rules_from_sandbox_permission(sandbox_permission: Any) -> Dict[str, str]:
    """Derive Codex's minimal Layer-2 reinforcement from the sandbox boundary.

    Filesystem ``readonly`` and ``off`` both map to ``sandbox_mode = "read-only"``. This is only
    reinforcement; the runner's ACP mode and outer container or VM remain the real boundary.
    Network off/allowlist is not expressible in Codex config: Q3 only observed
    ``enabled_tools``/``disabled_tools`` on MCP server tables, not on Codex's built-in web tools.

    Per D-008, this config-file rule only takes effect when the author chooses ACP ``agent`` mode.
    It is rendered regardless so the author's mode choice decides whether Codex honors it.
    """
    filesystem = _get(sandbox_permission, "filesystem")
    if filesystem in ("readonly", "off"):
        return {"sandbox_mode": "read-only"}

    # Network restrictions are not expressible in codex config.
    return {}


def _rules_from_mcp_permissions(mcp_servers: Any) -> ServerTables:
    """Derive per-server Codex settings from Layer-3 MCP permissions.

    Per ``findings.md`` Q3, ``allow`` maps to
    ``default_tools_approval_mode = "approve"`` and ``ask`` maps to ``"prompt"``. Codex has no
    observed whole-server disable key. A deny is therefore rendered as ``disabled_tools`` only
    when an ``include`` policy supplies every known tool name; an all-tools deny contributes
    nothing rather than guessing a key. The reserved internal ``agenta-tools`` server is skipped.

    Per D-008, these config-file rules only take effect when the author chooses ACP ``agent`` mode.
    They are rendered regardless so the author's mode choice decides whether Codex honors them.
    """
    tables: ServerTables = {}
    for server in mcp_servers or []:
        name = _get(server, "name")
        policy = _get(server, "policy")
        permission = _get(policy, "permission")
        if not isinstance(name, str) or not name or name == INTERNAL_TOOL_MCP_SERVER:
            continue

        approval_mode = (
            APPROVAL_MODE_BY_PERMISSION.get(permission)
            if isinstance(permission, str)
            else None
        )
        if approval_mode is not None:
            tables[name] = {"default_tools_approval_mode": approval_mode}
            continue

        if permission != "deny":
            continue

        tools = _get(policy, "tools")
        names = _get(tools, "names")
        if _get(tools, "mode") == "include" and isinstance(names, list):
            known_names = _dedupe(
                name for name in names if isinstance(name, str) and name
            )
            if known_names:
                tables[name] = {"disabled_tools": known_names}
        # A whole-server deny without known tool names is not expressible in codex config.

    return tables


def _rules_from_tool_specs(
    tool_specs: Any, permission_default: PermissionMode
) -> Tuple[Dict[str, str], List[str]]:
    """Derive per-tool Codex settings for the internal MCP server (Layer 3b, F-046).

    The sibling Claude adapter's ``effective_permission`` ladder applies: explicit permission,
    otherwise read-only tools are allowed under ``allow_reads``, otherwise the runner default.
    ``allow`` maps to per-tool ``approval_mode = "approve"``, ``ask`` maps to ``"prompt"``, and
    ``deny`` adds the tool to the internal server's ``disabled_tools``. Unlike Claude's helper,
    Codex applies the effective result directly: an effective ``ask`` always renders ``prompt``.

    F-046 is inverted for Codex: unlike Claude, an ``allow`` rule does not bypass a harness gate.
    Under authored ACP ``agent`` mode Codex honors ``approval_mode`` directly. Under D-008's
    default ``agent-full-access`` mode none of these config-file gates take effect, but the rules
    are still rendered so the author's mode choice controls whether Codex honors them.
    """
    from ..tools.models import coerce_tool_spec

    approval_modes: Dict[str, str] = {}
    disabled_tools: List[str] = []
    for raw in tool_specs or []:
        try:
            spec = coerce_tool_spec(raw)
        except Exception:
            continue

        permission = effective_permission(
            spec.permission, spec.read_only, permission_default
        )
        approval_mode = APPROVAL_MODE_BY_PERMISSION.get(permission)
        if approval_mode is not None:
            approval_modes[spec.name] = approval_mode
        elif permission == "deny":
            disabled_tools.append(spec.name)

    return approval_modes, _dedupe(disabled_tools)


def build_codex_settings_files(
    harness_permissions: Any,
    sandbox_permission: Any = None,
    mcp_servers: Any = None,
    tool_specs: Any = None,
    permission_default: PermissionMode = "allow_reads",
) -> List[Dict[str, str]]:
    """Build the Codex ``config.toml`` as one generic ``harnessFiles`` entry, or ``[]`` if none.

    Reads the author's Codex-native Layer-1 options and merges the Layer-2 sandbox reinforcement,
    Layer-3 MCP server settings, and Layer-3 resolved-tool settings. The nested table key names are
    the shapes verified in ``docs/design/codex-harness/spike/findings.md`` Q3. When nothing is
    authored or derived, returns ``[]`` so the runner writes no file.

    Per D-008, the derived config-file rules only take effect when the author chooses ACP
    ``agent`` mode. The default ``agent-full-access`` mode gates nothing in Codex. This function
    still renders the rules regardless; the author's mode choice decides whether Codex honors
    them. No runner-side or platform defaults are baked into this file.

    Returns ``[{"path": ".codex/config.toml", "content": <toml str>}]`` or ``[]``.
    """
    scalars: Dict[str, str] = {}

    approval_policy = _get(harness_permissions, "approval_policy")
    if isinstance(approval_policy, str) and approval_policy in APPROVAL_POLICIES:
        scalars["approval_policy"] = approval_policy

    sandbox_mode = _get(harness_permissions, "sandbox_mode")
    if isinstance(sandbox_mode, str) and sandbox_mode in SANDBOX_MODES:
        scalars["sandbox_mode"] = sandbox_mode

    sandbox_rules = _rules_from_sandbox_permission(sandbox_permission)
    if "sandbox_mode" not in scalars and "sandbox_mode" in sandbox_rules:
        scalars["sandbox_mode"] = sandbox_rules["sandbox_mode"]

    server_tables = _rules_from_mcp_permissions(mcp_servers)
    tool_approval_modes, disabled_tools = _rules_from_tool_specs(
        tool_specs, permission_default
    )
    if disabled_tools:
        server_tables[INTERNAL_TOOL_MCP_SERVER] = {"disabled_tools": disabled_tools}
    tool_tables: ToolTables = {
        (INTERNAL_TOOL_MCP_SERVER, name): {"approval_mode": approval_mode}
        for name, approval_mode in tool_approval_modes.items()
    }

    # The model is not written here; it rides the wire ``model`` field for the runner to apply.

    # Nothing authored or derived keeps a text-only Codex run byte-identical and fileless.
    if not scalars and not server_tables and not tool_tables:
        return []

    content = _render_config_toml(scalars, server_tables, tool_tables)
    return [{"path": SETTINGS_PATH, "content": content}]
