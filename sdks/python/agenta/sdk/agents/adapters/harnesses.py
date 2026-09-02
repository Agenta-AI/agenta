"""Adapters of the :class:`~agenta.sdk.agents.interfaces.Harness` port: one per harness type.

This is where the per-harness adaptation lives (the logic that used to sit in the TS runner):
turning the neutral :class:`SessionConfig` into the harness's own config, especially the
*tools*. The harnesses genuinely differ, so the two adapters do different work:

- **pi_core** takes resolved tool specs, delivered natively (Pi has no MCP). Built-in tools are
  not configured: the runner activates all of them on every run. The runner relay enforces the
  shared permission plan.
- **claude** has no built-in tools (they are a Pi concept), delivers tools over MCP, and
  receives the same runner permission plan.
- Skills ride the neutral config as resolved inline packages. Pi installs them through Pi
  skill dirs; Claude carries them so the runner can write project-local `.claude/skills`
  packages. Seeding platform default skills is a separate workstream.

The backend below stays pure plumbing; this layer owns the harness knowledge.
"""

from __future__ import annotations

from typing import Any, Dict, List, Type

from ..dtos import (
    ClaudeAgentTemplate,
    CodexAgentTemplate,
    HarnessKind,
    PiAgentTemplate,
    SessionConfig,
)
from ..interfaces import Environment, Harness
from ..tools.models import ToolSpec, coerce_tool_spec
from .agenta_builtins import gateway_guidance_field


def _opt_str(value: Any) -> Any:
    """Keep a harness option only if it is a non-empty string; otherwise drop it to ``None``
    so an empty or malformed value never reaches the wire as a real override."""
    if isinstance(value, str) and value.strip():
        return value
    return None


def _normalize_tool_specs(specs: List[Dict[str, Any]]) -> List[ToolSpec]:
    """Compatibility helper for old tests/callers still supplying runner dictionaries."""
    return [coerce_tool_spec(spec) for spec in specs or []]


class PiHarness(Harness):
    harness_type = HarnessKind.PI

    def _to_harness_config(self, config: SessionConfig) -> PiAgentTemplate:
        # Pi delivers resolved tool specs natively, registered through the Pi extension.
        # The runner relay enforces the shared permission plan.
        # Pi reads the selected harness's escape-hatch `extras`: `system` replaces Pi's base
        # prompt, `append_system` extends it (both leave AGENTS.md untouched).
        extras = config.agent.harness_extras
        return PiAgentTemplate(
            # Purely authored: Pi's carrier for the gateway guidance is `append_system`, not
            # AGENTS.md. AGENTS.md is the author's project-conventions layer, and a bare Pi
            # run has no platform half of it to add to; `append_system` is the layer the
            # platform already extends without replacing what the author wrote.
            agents_md=config.agent.instructions,
            model=config.agent.model,
            # Thread the structured ref so the author's connection {mode, slug} reaches the
            # connection resolver. Without it a named custom (OpenAI-compatible) connection
            # loses its slug and cannot be selected; only the resolved connection rides the wire.
            model_ref=config.agent.model_ref,
            resolved_connection=config.resolved_connection,
            tool_specs=list(config.tool_specs),
            tool_callback=config.tool_callback,
            mcp_servers=list(config.mcp_servers),
            skills=list(config.agent.skills),
            sandbox_permission=config.agent.sandbox_permission,
            permission_default=config.permission_default,
            harness_permissions=config.agent.harness_permissions,
            system=_opt_str(extras.get("system")),
            append_system=_opt_str(extras.get("append_system")),
            gateway_guidance=gateway_guidance_field(
                config.gateway_integration_names, "appendSystemPrompt"
            ),
        )


class ClaudeHarness(Harness):
    harness_type = HarnessKind.CLAUDE

    def _to_harness_config(self, config: SessionConfig) -> ClaudeAgentTemplate:
        # Claude has no Pi built-in tools. Tools go over MCP, and the shared permission plan
        # is carried through.
        # Skills stay on the harness config; the runner materializes them under `.claude/skills`
        # in the session cwd so Claude ACP can load the same resolved inline packages.
        # The harness's first-class `permissions` slice (plus sandbox_permission + mcp_servers) is
        # threaded onto the ClaudeAgentTemplate; the config's `wire_harness_files` (the Python claude
        # adapter) renders `.claude/settings.json` as a generic `harnessFiles` entry. No
        # claude-specific parsing happens here; the runner just writes the files into the cwd.
        return ClaudeAgentTemplate(
            agents_md=config.agent.instructions,
            gateway_guidance=gateway_guidance_field(
                config.gateway_integration_names, "agentsMd"
            ),
            model=config.agent.model,
            resolved_connection=config.resolved_connection,
            tool_specs=list(config.tool_specs),
            tool_callback=config.tool_callback,
            mcp_servers=list(config.mcp_servers),
            skills=list(config.agent.skills),
            sandbox_permission=config.agent.sandbox_permission,
            permission_default=config.permission_default,
            harness_permissions=config.agent.harness_permissions,
        )


class CodexHarness(Harness):
    harness_type = HarnessKind.CODEX

    def _to_harness_config(self, config: SessionConfig) -> CodexAgentTemplate:
        # Codex has no Pi built-in tools. Tools go over MCP, and the shared permission plan
        # is carried through.
        # Skills stay on the harness config (carried for parity with Claude); wiring them into
        # Codex is a later milestone, so a Milestone 1 text-only run carries none.
        # The harness's first-class `permissions` slice (plus sandbox_permission + mcp_servers) is
        # threaded onto the CodexAgentTemplate; the config's `wire_harness_files` (the Python codex
        # adapter) renders `.codex/config.toml` as a generic `harnessFiles` entry. No
        # codex-specific parsing happens here; the runner just writes the files into the cwd.
        return CodexAgentTemplate(
            agents_md=config.agent.instructions,
            gateway_guidance=gateway_guidance_field(
                config.gateway_integration_names, "agentsMd"
            ),
            model=config.agent.model,
            resolved_connection=config.resolved_connection,
            tool_specs=list(config.tool_specs),
            tool_callback=config.tool_callback,
            mcp_servers=list(config.mcp_servers),
            skills=list(config.agent.skills),
            sandbox_permission=config.agent.sandbox_permission,
            permission_default=config.permission_default,
            harness_permissions=config.agent.harness_permissions,
        )


_HARNESSES: Dict[HarnessKind, Type[Harness]] = {
    HarnessKind.PI: PiHarness,
    HarnessKind.CLAUDE: ClaudeHarness,
    HarnessKind.CODEX: CodexHarness,
}


def make_harness(
    harness_type: "HarnessKind | str", environment: Environment
) -> Harness:
    """Construct the Harness for a harness type over an environment.

    Maps the playground/config string to the right class. Raises
    :class:`~agenta.sdk.agents.errors.UnsupportedHarnessError` if the environment's backend
    cannot drive it.
    """
    resolved = HarnessKind.coerce(harness_type)
    try:
        cls = _HARNESSES[resolved]
    except KeyError as exc:
        known = ", ".join(sorted(h.value for h in _HARNESSES))
        raise ValueError(
            f"unknown harness '{resolved.value}'; known harnesses: {known}"
        ) from exc
    return cls(environment)
