"""Layer 1 for Codex: render the harness's authored options into ``.codex/config.toml``.

This is the Codex adapter (Layer 1). Codex reads its configuration from
``$CODEX_HOME/config.toml``. The runner sets ``CODEX_HOME`` to ``<cwd>/.codex`` and writes this
file there through the generic ``harnessFiles`` seam. The runner is a blind file writer.

The author's Codex-native permission options are ``approval_policy`` (``untrusted``,
``on-request``, ``on-failure``, or ``never``) and ``sandbox_mode`` (``read-only``,
``workspace-write``, or ``danger-full-access``). The harness carries these values verbatim in its
first-class ``permissions`` slice. This is a Layer-1 pass-through with no Agenta-invented
vocabulary.

This module renders ONLY what the author set, exactly like ``claude_settings.py``: when the author
sets nothing, no file is written (return ``[]``) and Codex runs under the ACP adapter's own default
mode. A Milestone 1 text-only run authors nothing, so it renders no file at all.

Two hard facts from the Milestone 0 derisk probes (``spike/derisk-findings.md`` P2) shape what this
file may and may not do, and why the platform sandbox/approval defaults are NOT baked in here:

- The ``codex-acp`` bridge sends ``approvalPolicy`` and ``sandboxPolicy`` PER TURN from its ACP
  ``mode`` preset, overriding whatever ``sandbox_mode`` the ``config.toml`` (or ``CODEX_CONFIG``)
  carries. So a config-file ``sandbox_mode = "danger-full-access"`` default is a no-op on the
  daemon path, and an ``approval_policy`` default may be silently overridden by the mode preset.
  Baking those defaults here would therefore be either dead or misleading.
- The platform default posture for an unconfigured Codex agent is decision D-008 (pending). It
  lands with the permissions and human-in-the-loop milestone (Milestone 3), which will also add
  Layer 2 (sandbox-boundary reinforcement) and Layer 3 (per-MCP-server and per-tool approval
  rules). The signature and module structure below leave room for all three.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ..tools.models import PermissionMode

# Where the rendered configuration lands, relative to the session cwd. ``CODEX_HOME`` points at
# ``<cwd>/.codex``.
SETTINGS_PATH = ".codex/config.toml"

APPROVAL_POLICIES = frozenset({"untrusted", "on-request", "on-failure", "never"})
SANDBOX_MODES = frozenset({"read-only", "workspace-write", "danger-full-access"})

# Reserved for Layer 3, which will render per-tool approval rules in a later milestone.
# The fixed name of the runner's INTERNAL MCP server that delivers backend-resolved EXECUTABLE
# tools (callback/code) to the harness. Claude addresses one of a server's tools as
# ``mcp__<server>__<tool>``, so a per-tool permission rule for a resolved tool is
# ``mcp__agenta-tools__<tool>``. This name COUPLES to the runner constant and MUST stay in sync
# with the TypeScript runner, which advertises the same server name in:
#   - ``services/runner/src/tools/mcp-bridge.ts`` (``name: "agenta-tools"``)
#   - ``services/runner/src/tools/relay.ts`` and ``tool-mcp-http.ts`` (``serverInfo.name``)
#   - ``services/runner/src/engines/sandbox_agent/mcp.ts``
# If the runner renames this server, this constant must change with it.
INTERNAL_TOOL_MCP_SERVER = "agenta-tools"


def _toml_escape(value: str) -> str:
    """Escape backslashes and double quotes for a TOML basic string."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _render_config_toml(scalars: Dict[str, str]) -> str:
    """Render flat top-level string scalars as TOML.

    This renders only flat top-level string scalars today. Layer 3 will add
    ``[mcp_servers.<name>]`` tables here later. No third-party TOML library is used (there is no
    stdlib TOML writer and this module must stay dependency-free).
    """
    return "".join(
        f'{key} = "{_toml_escape(value)}"\n' for key, value in scalars.items()
    )


def _get(source: Any, key: str) -> Any:
    """Read ``key`` off a pydantic model (attribute) or a plain dict (item)."""
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def build_codex_settings_files(
    harness_permissions: Any,
    sandbox_permission: Any = None,
    mcp_servers: Any = None,
    tool_specs: Any = None,
    permission_default: PermissionMode = "allow_reads",
) -> List[Dict[str, str]]:
    """Build the Codex ``config.toml`` as one generic ``harnessFiles`` entry, or ``[]`` if none.

    Reads the author's Codex-native options (``approval_policy``, ``sandbox_mode``) from the
    ``harness_permissions`` slice and renders only the valid ones. When the author set nothing,
    returns ``[]`` so the runner writes no file and Codex runs under the ACP adapter's default
    mode (same rule as ``build_claude_settings_files``). The platform default posture is decision
    D-008 (pending) and lands in the permissions milestone, so no defaults are baked here.

    Returns ``[{"path": ".codex/config.toml", "content": <toml str>}]`` or ``[]``.
    """
    # Milestone 1 reads only ``harness_permissions``. ``sandbox_permission``, ``mcp_servers``,
    # ``tool_specs``, and ``permission_default`` are accepted for signature parity (mirroring
    # ``build_claude_settings_files``) and deliberately reserved for the Layer 2 and Layer 3
    # milestone.
    scalars: Dict[str, str] = {}

    approval_policy = _get(harness_permissions, "approval_policy")
    if isinstance(approval_policy, str) and approval_policy in APPROVAL_POLICIES:
        scalars["approval_policy"] = approval_policy

    sandbox_mode = _get(harness_permissions, "sandbox_mode")
    if isinstance(sandbox_mode, str) and sandbox_mode in SANDBOX_MODES:
        scalars["sandbox_mode"] = sandbox_mode

    # The model is not written here; it rides the wire ``model`` field for the runner to apply.

    # Nothing authored -> no file, so a text-only Codex run is byte-identical to a fileless run
    # (the Milestone 1 authoring schema does not yet carry these keys, so this is the live path).
    if not scalars:
        return []

    content = _render_config_toml(scalars)
    return [{"path": SETTINGS_PATH, "content": content}]
