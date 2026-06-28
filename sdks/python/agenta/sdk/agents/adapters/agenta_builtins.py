"""The Agenta harness's forced defaults: the things ``AgentaHarness`` always applies.

``AgentaHarness`` is Pi with an opinion. It is the same engine as :class:`PiHarness`, but
every run carries a fixed set of Agenta-shipped extras the author cannot turn off:

- a base **persona** appended to Pi's system prompt (``AGENTA_FORCED_APPEND_SYSTEM``),
- a base **AGENTS.md preamble** the author's instructions are appended to (``AGENTA_PREAMBLE``),
- a set of **forced tools** (``AGENTA_FORCED_TOOLS``),
- a set of **forced platform skills** (``AGENTA_FORCED_SKILLS``).

The forced platform skills are the actually-forced part of "forced skills". The default agent
config template embeds the platform default skill by reserved ``__ag__*`` slug, but that embed
only rides the *default* template: a custom ``pi_agenta`` config that drops the embed would
otherwise lose the platform skill entirely. To make "forced" mean forced, ``AgentaHarness``
unions ``AGENTA_FORCED_SKILLS`` into every run's skills via :func:`force_skills`, regardless of
what the author's config carries. The canonical skill content lives here (in the SDK, the lowest
layer); the server-side ``StaticWorkflowCatalog`` imports the same constant so the embed path
and the forced path stay one source of truth.

Two layers, kept distinct on purpose (matching Pi's own split, see :class:`PiAgentTemplate`):
the *persona* is an ``append_system`` (changes Pi's base prompt), while *project conventions*
belong in ``AGENTS.md``. ``AGENTA_PREAMBLE`` is the AGENTS.md layer; ``AGENTA_FORCED_APPEND_SYSTEM``
is the persona layer.
"""

from __future__ import annotations

from typing import List, Optional

from ..skills import SkillTemplate

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

# Built-in tools the Agenta harness records as forced, unioned with the agent's resolved
# tools. NOTE: this list is config-level metadata only today. The runner never reads
# ``request.tools`` / ``builtin_names`` to grant builtins, and Pi already gets ``read`` (and
# ``bash``) from its own DEFAULTS, so skills render regardless of this list. The intent is that
# ``read`` is needed for Pi to render the skills section and ``bash`` lets skills run helper
# scripts; wiring the forced set to actually deliver builtins over the wire is deferred (it
# works via Pi defaults today).
AGENTA_FORCED_TOOLS: List[str] = ["read", "bash"]

# Reserved slug of the platform default skill. The default agent config template embeds the
# skill by this slug; the server-side StaticWorkflowCatalog resolves the slug to the
# SkillTemplate below. Kept here so the catalogue and the forced path share one slug constant.
GETTING_STARTED_WITH_AGENTA_SLUG = "__ag__getting_started_with_agenta"

# Canonical SKILL.md body for the platform "getting started" skill. Single source of the body
# text: the server-side StaticWorkflowCatalog imports this constant rather than redeclaring it.
_GETTING_STARTED_BODY = (
    "# Getting started with Agenta agents\n"
    "\n"
    "This skill orients an agent running on the Agenta platform.\n"
    "\n"
    "## When to use it\n"
    "\n"
    "Use it at the start of a task to recall how Agenta agents are expected to behave: be "
    "concise, ask for missing inputs, and prefer the tools and skills the agent was given over "
    "guessing.\n"
    "\n"
    "## Conventions\n"
    "\n"
    "- Greet the user once, then get to work.\n"
    "- State assumptions briefly when a request is ambiguous.\n"
    "- When a skill or tool references a relative path, resolve it against the skill directory "
    "(the parent of SKILL.md) before running it.\n"
    "- Keep answers short unless the user asks for depth.\n"
)

# The platform default skill as a concrete inline package. This is the canonical content; the
# server-side catalogue serves the same SkillTemplate for the reserved slug above.
GETTING_STARTED_WITH_AGENTA_SKILL = SkillTemplate(
    name="agenta-getting-started",
    description=(
        "Getting started on the Agenta platform: how an Agenta agent should behave, ask for "
        "missing inputs, and use its tools and skills. Use at the start of a task."
    ),
    body=_GETTING_STARTED_BODY,
)

# Platform skills every pi_agenta run carries, regardless of the author's config. These are the
# actually-forced skills (see module docstring); unioned in by `force_skills`.
AGENTA_FORCED_SKILLS: List[SkillTemplate] = [GETTING_STARTED_WITH_AGENTA_SKILL]


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


def force_skills(skills: List[SkillTemplate]) -> List[SkillTemplate]:
    """Union the author's skills with the forced platform skills, de-duplicated by name.

    The author's skills come first and win on a name clash (a config that already carries the
    resolved platform skill — e.g. via the default template's embed — is not doubled), then any
    forced platform skill not already present is appended. This is what makes the ``_agenta``
    platform skill actually forced on a custom ``pi_agenta`` config that drops the embed."""
    seen = {skill.name for skill in skills}
    out: List[SkillTemplate] = list(skills)
    for forced in AGENTA_FORCED_SKILLS:
        if forced.name not in seen:
            seen.add(forced.name)
            out.append(forced)
    return out
