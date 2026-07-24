"""Layers 1 and 2 for Codex: render harness settings into ``.codex/config.toml``.

This is the Codex adapter. Codex reads its configuration from
``$CODEX_HOME/config.toml``. The runner sets ``CODEX_HOME`` to ``<cwd>/.codex`` and writes this
file there through the generic ``harnessFiles`` seam. The runner is a blind file writer.

Two sources merge here, both flat top-level scalars:

- Layer 1 passes through the author's Codex-native ``approval_policy`` and ``sandbox_mode``.
- Layer 2 reinforces a read-only/off filesystem boundary with Codex's ``read-only`` sandbox mode.

Per-server / per-tool approval config (a former Layer 3, the ``[mcp_servers.<name>]`` and
``[mcp_servers.<name>.tools.<tool>]`` tables) is deliberately NOT rendered, per the D-008
amendment (2026-07-24). Two reasons:

1. It is unrepresentable for our ACP-delivered servers. Codex 0.145 validates EVERY entry under
   ``[mcp_servers]`` for a transport at ``session/new``; an approval-only table with no
   ``command`` (stdio) or ``url`` (http/sse) is rejected with ``invalid transport in
   'mcp_servers.agenta-tools'``, which codex-acp surfaces as a generic ``Internal agent error:
   Internal error`` and fails the whole session before any prompt. Our internal ``agenta-tools``
   channel and user HTTP MCP servers are delivered over ACP ``session/new`` ``mcpServers`` (the
   runner knows their transport at session-build time), never through this file, so a
   transport-bearing table cannot be written here anyway. The spike's Q3 probe missed this because
   it always tested these tables ALONGSIDE a transport.
2. It is no longer wanted. Under D-008 the runner-side gate (``executable-tools.ts``, the
   ``agenta-tools`` pause seam) is the tool-permission authority for the default
   ``agent-full-access`` mode; per-server approval config in this file would only matter under
   authored ``agent`` mode and is superseded there by codex's own per-turn gate.

Texture caveat for authored ``agent`` mode (extended): because no per-tool ``approval_mode`` is
rendered, every tool call under ``agent`` mode pauses at codex's OWN on-request gate (an
``allow``-permission tool is not pre-approved via config). The runner then applies the tool's
effective permission when it classifies that ACP gate. This is the safe default; a Codex-native
``[mcp_servers.<name>] default_tools_approval_mode`` pre-allow would require the runner to emit a
transport-bearing entry (a contract change, deferred). Layers 1/2 scalars are unaffected.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ..tools.models import PermissionMode

# Where the rendered configuration lands, relative to the session cwd. ``CODEX_HOME`` points at
# ``<cwd>/.codex``.
SETTINGS_PATH = ".codex/config.toml"

APPROVAL_POLICIES = frozenset({"untrusted", "on-request", "on-failure", "never"})
SANDBOX_MODES = frozenset({"read-only", "workspace-write", "danger-full-access"})


def _toml_escape(value: str) -> str:
    """Escape backslashes and double quotes for a TOML basic string."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _render_config_toml(scalars: Dict[str, str]) -> str:
    """Render flat top-level string scalars as TOML.

    Only flat top-level scalars are rendered: ``approval_policy`` and ``sandbox_mode``. No
    ``[mcp_servers.*]`` tables are ever written (see the module docstring: codex rejects a
    transport-less server entry at ``session/new`` and the runner-side gate is the permission
    authority). No third-party TOML library is used (there is no stdlib TOML writer and this
    module must stay dependency-free).
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


def _rules_from_sandbox_permission(sandbox_permission: Any) -> Dict[str, str]:
    """Derive Codex's minimal Layer-2 reinforcement from the sandbox boundary.

    Filesystem ``readonly`` and ``off`` both map to ``sandbox_mode = "read-only"``. This is only
    reinforcement; the runner's ACP mode and outer container or VM remain the real boundary.
    Network off/allowlist is not expressible in Codex config (no observed key for codex's built-in
    web tools). This does not override an author-set ``sandbox_mode``.

    Per D-008, a config-file ``sandbox_mode`` only takes effect when the author chooses ACP
    ``agent`` mode; the codex-acp bridge overrides it with its per-turn preset under the default
    ``agent-full-access`` mode. It is rendered regardless so the author's mode choice decides.
    """
    filesystem = _get(sandbox_permission, "filesystem")
    if filesystem in ("readonly", "off"):
        return {"sandbox_mode": "read-only"}

    # Network restrictions are not expressible in codex config.
    return {}


def build_codex_settings_files(
    harness_permissions: Any,
    sandbox_permission: Any = None,
    mcp_servers: Any = None,
    tool_specs: Any = None,
    permission_default: PermissionMode = "allow_reads",
) -> List[Dict[str, str]]:
    """Build the Codex ``config.toml`` as one generic ``harnessFiles`` entry, or ``[]`` if none.

    Renders only flat top-level scalars: the author's Codex-native Layer-1 options
    (``approval_policy``, ``sandbox_mode``) plus the Layer-2 filesystem reinforcement. Per the
    D-008 amendment, NO ``[mcp_servers.*]`` approval tables are rendered (codex rejects a
    transport-less server entry at ``session/new``, and the runner-side gate is the tool-permission
    authority — see the module docstring). ``mcp_servers``, ``tool_specs``, and
    ``permission_default`` are accepted for signature parity with ``build_claude_settings_files``
    and are intentionally unused here.

    When nothing is authored or derived, returns ``[]`` so the runner writes no file and a
    text-only Codex run is byte-identical to a fileless run.

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

    # The model is not written here; it rides the wire ``model`` field for the runner to apply.

    # Nothing authored or derived keeps a text-only (or permission-only) Codex run fileless: a run
    # whose only permission content would have been per-server/per-tool tables now writes NO file
    # at all, since those tables are no longer rendered.
    if not scalars:
        return []

    content = _render_config_toml(scalars)
    return [{"path": SETTINGS_PATH, "content": content}]
