"""Adapters of the :class:`~agenta.sdk.agents.interfaces.Harness` port: one per harness type.

This is where the per-harness adaptation lives (the logic that used to sit in the TS runner):
turning the neutral :class:`SessionConfig` into the harness's own config, especially the
*tools*. The harnesses genuinely differ, so the two adapters do different work:

- **Pi** takes built-in tools by name *and* resolved tool specs, delivered natively (Pi has
  no MCP). Pi does not gate tool use, so the permission policy does not apply.
- **Claude** has no built-in tools (they are a Pi concept), delivers tools over MCP, and
  gates tool use, so the permission policy applies.
- **Agenta** is Pi with an opinion: the same engine and config shape, plus a fixed set of
  forced tools, a base AGENTS.md preamble, and a persona (see :mod:`.agenta_builtins`).
  Skills ride the neutral config (resolved inline packages); seeding platform default skills
  is a separate project-creation workstream.

The backend below stays pure plumbing; this layer owns the harness knowledge.
"""

from __future__ import annotations

from typing import Any, Dict, List, Type

from agenta.sdk.utils.logging import get_module_logger

from ..dtos import (
    AgentaAgentConfig,
    ClaudeAgentConfig,
    HarnessType,
    PiAgentConfig,
    SessionConfig,
)
from ..interfaces import Environment, Harness
from ..tools.models import ToolSpec, coerce_tool_spec
from .agenta_builtins import (
    compose_append_system,
    compose_instructions,
    force_tools,
)

log = get_module_logger(__name__)


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
    harness_type = HarnessType.PI

    def _to_harness_config(self, config: SessionConfig) -> PiAgentConfig:
        # Pi delivers tools natively: built-in names plus resolved specs registered through
        # the Pi extension. Pi does not gate tool use, so the permission policy is dropped.
        # Pi reads its own slice of the neutral harness_options bag: `system` replaces Pi's
        # base prompt, `append_system` extends it (both leave AGENTS.md untouched).
        pi_options = config.agent.harness_options.get(HarnessType.PI.value, {})
        return PiAgentConfig(
            agents_md=config.agent.instructions,
            model=config.agent.model,
            resolved_connection=config.resolved_connection,
            builtin_names=list(config.builtin_names),
            tool_specs=list(config.tool_specs),
            tool_callback=config.tool_callback,
            mcp_servers=list(config.mcp_servers),
            skills=list(config.agent.skills),
            sandbox_permission=config.agent.sandbox_permission,
            system=_opt_str(pi_options.get("system")),
            append_system=_opt_str(pi_options.get("append_system")),
        )


class ClaudeHarness(Harness):
    harness_type = HarnessType.CLAUDE

    def _to_harness_config(self, config: SessionConfig) -> ClaudeAgentConfig:
        # Claude has no Pi built-in tools; drop them rather than ship a name Claude cannot
        # honor. Tools go over MCP, and Claude gates tool use, so the permission policy is
        # carried through.
        if config.builtin_names:
            log.warning(
                "ClaudeHarness ignores %d built-in tool(s); built-ins are a Pi concept",
                len(config.builtin_names),
            )
        # The Claude Agent SDK path we drive does not load SKILL.md, so emitting skills to the
        # runner would ship content it never materializes for Claude. Log-and-drop here (the
        # same graceful degrade used for unsupported Pi built-ins) instead of carrying them.
        if config.agent.skills:
            log.warning(
                "ClaudeHarness drops %d skill(s); the Claude SDK path does not load SKILL.md",
                len(config.agent.skills),
            )
        # Claude reads its own slice of the neutral harness_options bag: `permissions` holds the
        # author's `default_mode` + allow/deny/ask rules (Layer 1). The runner renders them into
        # `<cwd>/.claude/settings.json`. A missing/malformed value is coerced to None.
        claude_options = config.agent.harness_options.get(HarnessType.CLAUDE.value, {})
        return ClaudeAgentConfig(
            agents_md=config.agent.instructions,
            model=config.agent.model,
            resolved_connection=config.resolved_connection,
            tool_specs=list(config.tool_specs),
            tool_callback=config.tool_callback,
            mcp_servers=list(config.mcp_servers),
            skills=[],
            sandbox_permission=config.agent.sandbox_permission,
            permission_policy=config.permission_policy,
            permissions=claude_options.get("permissions"),
        )


class AgentaHarness(Harness):
    """Pi with an Agenta opinion. Same engine as :class:`PiHarness`, but every run carries the
    forced Agenta extras (see :mod:`.agenta_builtins`): a base AGENTS.md preamble the author's
    instructions are appended to, a forced persona ``append_system``, and forced tools. The
    author's own Pi ``harness_options`` (``system`` / ``append_system``) still apply, layered
    after the forced bits. Skills come from the neutral config as resolved inline packages;
    seeding platform default skills is a separate project-creation workstream."""

    harness_type = HarnessType.AGENTA

    def _to_harness_config(self, config: SessionConfig) -> AgentaAgentConfig:
        # The author's Pi options still apply; the Agenta harness reads the same `pi` slice as
        # PiHarness (it drives Pi) and layers its forced extras on top.
        pi_options = config.agent.harness_options.get(HarnessType.PI.value, {})
        return AgentaAgentConfig(
            agents_md=compose_instructions(config.agent.instructions),
            model=config.agent.model,
            resolved_connection=config.resolved_connection,
            builtin_names=force_tools(list(config.builtin_names)),
            tool_specs=list(config.tool_specs),
            tool_callback=config.tool_callback,
            mcp_servers=list(config.mcp_servers),
            skills=list(config.agent.skills),
            sandbox_permission=config.agent.sandbox_permission,
            system=_opt_str(pi_options.get("system")),
            append_system=compose_append_system(
                _opt_str(pi_options.get("append_system"))
            ),
        )


_HARNESSES: Dict[HarnessType, Type[Harness]] = {
    HarnessType.PI: PiHarness,
    HarnessType.CLAUDE: ClaudeHarness,
    HarnessType.AGENTA: AgentaHarness,
}


def make_harness(
    harness_type: "HarnessType | str", environment: Environment
) -> Harness:
    """Construct the Harness for a harness type over an environment.

    Maps the playground/config string to the right class. Raises
    :class:`~agenta.sdk.agents.errors.UnsupportedHarnessError` if the environment's backend
    cannot drive it.
    """
    resolved = HarnessType.coerce(harness_type)
    try:
        cls = _HARNESSES[resolved]
    except KeyError as exc:
        known = ", ".join(sorted(h.value for h in _HARNESSES))
        raise ValueError(
            f"unknown harness '{resolved.value}'; known harnesses: {known}"
        ) from exc
    return cls(environment)
