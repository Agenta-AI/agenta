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
2. It is no longer wanted. Codex's own per-turn gate is the tool-permission authority in every
   mode, and the runner classifies each gate against the author's permissions; per-server
   approval config in this file would only duplicate that decision.

Texture caveat, now applying to EVERY mode (D-008 amendment, 2026-07-31: the runner image patches
codex-acp's ``agent-full-access`` preset from ``approvalPolicy: "never"`` to ``on-request``, so
tool approvals park warm): because no per-tool ``approval_mode`` is rendered, every tool call
pauses at codex's OWN on-request gate (an ``allow``-permission tool is not pre-approved via
config). The runner then applies the tool's effective permission when it classifies that ACP gate,
so an ``allow`` tool is answered in-process with no human round trip. This is the safe default; a
Codex-native ``[mcp_servers.<name>] default_tools_approval_mode`` pre-allow would require the
runner to emit a transport-bearing entry (a contract change, deferred). Layers 1/2 scalars are
unaffected. The runner-side gate at the ``agenta-tools`` pause seam (``executable-tools.ts``)
remains as second-line enforcement: it consumes the execution grant the ACP gate records, so one
approval prompts once, and an ungranted call still fails closed.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..tools.models import PermissionMode

# Where the rendered configuration lands, relative to the session cwd. ``CODEX_HOME`` points at
# ``<cwd>/.codex``.
SETTINGS_PATH = ".codex/config.toml"

APPROVAL_POLICIES = frozenset({"untrusted", "on-request", "on-failure", "never"})
SANDBOX_MODES = frozenset({"read-only", "workspace-write", "danger-full-access"})

# File-free managed authentication (D-002 final ruling). A managed Codex run authenticates through
# a CUSTOM model provider whose `env_key` names the environment variable holding the key. Codex reads
# that variable from its process environment AT REQUEST TIME and never writes a credential file:
# `config.toml` carries only the variable NAME, never the secret. The provider id must be NEW (codex
# does not let user config override the built-in `openai` provider), and it must live in the FILE,
# not a `CODEX_CONFIG` env override, because codex-acp's `authRequired()` reads the ACTIVE provider
# from the app-server's own `config.toml` (a custom provider defaults `requires_openai_auth=false`,
# so no login gate). Proven end to end on the daemon path (research q1a/q1a2). Subscription runs do
# NOT get this block: ChatGPT OAuth needs the built-in provider and its mounted login file.
MANAGED_PROVIDER_ID = "agenta-openai"
MANAGED_PROVIDER_NAME = "Agenta OpenAI"
# INVARIANT: the value of this variable is treated as OPAQUE. Under the Daytona-Secrets placeholder
# design (#5277) the runner delivers a placeholder here, not the real key, and Daytona's egress proxy
# substitutes it in flight; codex copies whatever the variable holds byte-exact into the request's
# Authorization header (probe P3 / q1a). Nothing here inspects, parses, or reformats it. The runner
# already delivers OPENAI_API_KEY into the daemon env for managed runs (plan.secrets), and it stays
# absent on subscription runs.
MANAGED_PROVIDER_ENV_KEY = "OPENAI_API_KEY"

# OUR gateway credential (D31/W1), not a provider secret: codex's `env_http_headers` maps a header
# NAME to an env var name and reads the value from its process environment at request time (the
# same indirection `env_key` already uses for the bearer token), so this file never carries the raw
# value. Must match the runner's `GATEWAY_CREDENTIALS_VALUE_ENV` (services/runner/src/engines/
# sandbox_agent/run-plan.ts) — both sides read/write the same env var name.
GATEWAY_CREDENTIALS_VALUE_ENV = "AGENTA_GATEWAY_CREDENTIALS_VALUE"


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


def _render_managed_provider_table(
    base_url: Optional[str] = None, gateway_header: Optional[str] = None
) -> str:
    """Render the file-free managed auth provider table (see the ``MANAGED_PROVIDER_*`` docstring).

    A TOML table must follow every top-level scalar, so this is appended AFTER the scalars (which
    include the ``model_provider`` pointer). The secret never appears here; only the env var name.

    ``base_url`` and ``gateway_header`` carry a gateway route (D31/W1): ``base_url`` points codex
    at the gateway instead of OpenAI's default endpoint, and ``env_http_headers`` (a codex 0.145+
    field, verified OD14) maps the header NAME to ``GATEWAY_CREDENTIALS_VALUE_ENV`` so codex reads
    the credential from its process env at request time, exactly like ``env_key`` above. Both
    absent on a non-gateway connection (byte-identical to before).
    """
    lines = [
        f"\n[model_providers.{MANAGED_PROVIDER_ID}]\n",
        f'name = "{_toml_escape(MANAGED_PROVIDER_NAME)}"\n',
        f'env_key = "{_toml_escape(MANAGED_PROVIDER_ENV_KEY)}"\n',
    ]
    if base_url:
        lines.append(f'base_url = "{_toml_escape(base_url)}"\n')
    if gateway_header:
        lines.append(
            f'env_http_headers = {{ "{_toml_escape(gateway_header)}" = '
            f'"{_toml_escape(GATEWAY_CREDENTIALS_VALUE_ENV)}" }}\n'
        )
    return "".join(lines)


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
    credential_mode: Optional[str] = None,
    gateway_base_url: Optional[str] = None,
    gateway_header: Optional[str] = None,
) -> List[Dict[str, str]]:
    """Build the Codex ``config.toml`` as one generic ``harnessFiles`` entry, or ``[]`` if none.

    Renders the file-free managed auth provider block (see the ``MANAGED_PROVIDER_*`` docstring)
    plus flat top-level scalars: the author's Codex-native Layer-1 options (``approval_policy``,
    ``sandbox_mode``) and the Layer-2 filesystem reinforcement. Per the D-008 amendment, NO
    ``[mcp_servers.*]`` approval tables are rendered (codex rejects a transport-less server entry at
    ``session/new``, and the runner-side gate is the tool-permission authority — see the module
    docstring). ``mcp_servers``, ``tool_specs``, and ``permission_default`` are accepted for
    signature parity with ``build_claude_settings_files`` and are intentionally unused here.

    ``credential_mode`` decides the managed auth block. A run is MANAGED unless it is explicitly
    subscription (``"runtime_provided"``), matching the runner's ``isManagedCodexRun`` (which keys
    on ``credentialMode !== "runtime_provided"``): ``"env"``, ``"none"``, and an unresolved
    (``None``) connection all render the provider block so the managed key authenticates
    file-free. A subscription run renders no block (it uses the built-in provider + its mounted
    login).

    When a subscription run has nothing authored or derived either, returns ``[]`` so the runner
    writes no file and that run stays byte-identical to a fileless run.

    ``gateway_base_url``/``gateway_header`` (D31/W1) carry a gateway route onto the managed
    provider table (see ``_render_managed_provider_table``); both are ignored on a subscription
    run, which never renders the table at all.

    Returns ``[{"path": ".codex/config.toml", "content": <toml str>}]`` or ``[]``.
    """
    managed = credential_mode != "runtime_provided"

    scalars: Dict[str, str] = {}

    # File-free managed auth: point codex at the custom provider (top-level scalar, rendered before
    # the provider table appended below). Subscription keeps the built-in provider.
    if managed:
        scalars["model_provider"] = MANAGED_PROVIDER_ID

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

    # A subscription run with nothing authored or derived stays fileless (byte-identical to before).
    # A managed run always has at least the `model_provider` scalar, so it always writes the file.
    if not scalars:
        return []

    content = _render_config_toml(scalars)
    if managed:
        content += _render_managed_provider_table(gateway_base_url, gateway_header)
    return [{"path": SETTINGS_PATH, "content": content}]
