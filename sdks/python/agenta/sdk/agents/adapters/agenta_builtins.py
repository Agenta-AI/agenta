"""The Agenta harness's forced defaults: the things ``AgentaHarness`` always applies.

``AgentaHarness`` is Pi with an opinion. It is the same engine as :class:`PiHarness`, but
every run carries a fixed set of Agenta-shipped extras the author cannot turn off:

- a base **persona** appended to Pi's system prompt (``AGENTA_FORCED_APPEND_SYSTEM``),
- a base **AGENTS.md preamble** the author's instructions are appended to (``AGENTA_PREAMBLE``),
- a set of **forced tools** (``AGENTA_FORCED_TOOLS``).

Forced skills are *not* a constant here. They become platform default skills the project-creation
step seeds as locked workflow revisions and embeds into the agent config (resolved server-side
into concrete :class:`~agenta.sdk.agents.skills.SkillConfig` packages before the runner). By the
time this harness runs, those defaults already ride ``AgentConfig.skills``, so the adapter needs
no name list. That seeding is a separate workstream (see the skills-config proposal).

Two layers, kept distinct on purpose (matching Pi's own split, see :class:`PiAgentConfig`):
the *persona* is an ``append_system`` (changes Pi's base prompt), while *project conventions*
belong in ``AGENTS.md``. ``AGENTA_PREAMBLE`` is the AGENTS.md layer; ``AGENTA_FORCED_APPEND_SYSTEM``
is the persona layer.
"""

from __future__ import annotations

from typing import List, Optional

# The base AGENTS.md preamble. The author's own ``instructions`` are appended after this, so
# the final AGENTS.md is ``AGENTA_PREAMBLE`` + the author's project conventions.
#
# TODO(product): replace this placeholder with the real Agenta AGENTS.md preamble.
AGENTA_PREAMBLE = """\
# Agenta agent

You are an agent running on the Agenta platform. The instructions below are Agenta's
baseline; the user's own instructions follow and take precedence where they are more
specific.

- Prefer the tools and skills provided to you over guessing.
- When a skill matches the task, read its SKILL.md fully before acting.
- Keep answers grounded in what the tools and skills actually return."""

# The base persona, always appended to Pi's built-in system prompt (never replaces it). This
# is the "who the agent is" layer, distinct from the AGENTS.md project-context layer above.
#
# TODO(product): replace this placeholder with the real Agenta persona framing.
AGENTA_FORCED_APPEND_SYSTEM = """\
You are an Agenta agent. Be precise, cite what your tools and skills return, and do not
fabricate results."""

# Built-in tools every Agenta run forces on, unioned with the agent's resolved tools.
# ``read`` is mandatory: Pi only renders the skills section into the system prompt when the
# ``read`` tool is available. ``bash`` lets skills run their helper scripts.
AGENTA_FORCED_TOOLS: List[str] = ["read", "bash"]


def _join(*parts: Optional[str]) -> Optional[str]:
    """Join the non-empty parts with a blank line, or ``None`` when nothing remains."""
    kept = [part.strip() for part in parts if part and part.strip()]
    if not kept:
        return None
    return "\n\n".join(kept)


def compose_instructions(user: Optional[str]) -> Optional[str]:
    """The AGENTS.md the harness ships: the base preamble with the author's instructions
    appended after it."""
    return _join(AGENTA_PREAMBLE, user)


def compose_append_system(user: Optional[str]) -> Optional[str]:
    """The ``append_system`` the harness ships: the forced base persona with the author's own
    ``append_system`` appended after it."""
    return _join(AGENTA_FORCED_APPEND_SYSTEM, user)


def force_tools(builtin_tools: List[str]) -> List[str]:
    """Union the resolved built-in tools with the forced set, order-stable and de-duplicated
    (resolved tools first, then any forced tools not already present)."""
    seen = set()
    out: List[str] = []
    for name in list(builtin_tools) + AGENTA_FORCED_TOOLS:
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out
