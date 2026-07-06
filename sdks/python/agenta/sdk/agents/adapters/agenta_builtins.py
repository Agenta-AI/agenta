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

# Built-in tools the Agenta harness forces, unioned with the agent's resolved tools. These
# grants are load-bearing on the wire: once ANY custom tool ships in ``request.tools``, the
# runner flips Pi's builtin gating from "Pi defaults" to granted-only. So ``read`` and
# ``bash`` must be granted explicitly wherever build-kit tools ship (e.g. the playground
# overlay), or Pi loses them — skills are then announced but unloadable (``read`` loads
# SKILL.md; ``bash`` runs skill helper scripts).
AGENTA_FORCED_TOOLS: List[str] = ["read", "bash"]

# Reserved slug of the platform default skill. The default agent config template embeds the
# skill by this slug; the server-side StaticWorkflowCatalog resolves the slug to the
# SkillTemplate below. Kept here so the catalogue and the forced path share one slug constant.
GETTING_STARTED_WITH_AGENTA_SLUG = "__ag__getting_started_with_agenta"
BUILD_AN_AGENT_SLUG = "__ag__build_an_agent"

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

_BUILD_AN_AGENT_BODY = """\
# Build an Agenta agent

You turn a plain-language request into a working, verified Agenta agent. You are configuring
yourself: the committed template you edit is the agent that will keep running. Optimize for the
fewest calls and the least time. A simple no-tool ask is two actions: write better
`instructions.agents_md`, then call `commit_revision`.

## When to use

Use this when the user asks you to build, set up, configure, or automate an agent.

## The shape of your config

You decide four things under `parameters.agent`:

- `instructions.agents_md`: who you are and what you do.
- `tools`: integration actions and platform ops you can call.
- `skills`: reusable know-how packaged as skill templates.
- A trigger: either a schedule or an event subscription, only when the user asked for one.

Everything else is fixed unless the user explicitly asks to change it. Configure yourself with
`commit_revision` by setting `parameters.agent` fields; do not create a separate app.

## Decision table

| The ask... | Needs | What to add |
|---|---|---|
| transform text the user pastes, such as summarize, rewrite, classify | nothing extra | `instructions.agents_md` only |
| apply reusable know-how, such as a style guide or review rubric | a skill | one `skills` entry |
| read or write in an outside tool, such as GitHub or Slack | gateway tools | `discover_tools`, then `tools` entries |
| run on a clock | a schedule | `create_schedule` after committing |
| react to an outside event | a subscription | `discover_triggers`, then `create_subscription` |

Do not discover tools or triggers for an ask that does not need them.

## The loop

1. Clarify the ask. Get the missing timezone, channel, repo, account, output style, and success
   criteria. Do not guess concrete destinations.
2. Decide from the table. Most agents need only instructions. If the ask needs outside actions,
   call `discover_tools` with one short fragment per capability, such as "list github issues" or
   "post a slack message".
3. Read discovery as a search result, not an oracle. Confirm the matched integration and the
   action are both right. If a "new telegram message" search returns a Slack event, reword the
   fragment or choose the right alternative.
4. If a needed connection is not ready, call `request_connection` for that integration and stop.
   Give the user the connection request and wait for them. Re-run `discover_tools` after they
   connect; do not silently create, fake, or skip connections.
5. Configure yourself. Put the chosen `capability.tool` entries and needed alternatives in
   `tools`, write `instructions.agents_md`, and call `commit_revision`. This is an approval stop.
   If the commit is denied or fails, earlier connections or triggers are not undone.
6. Verify with `test_run`. First warn the user that this is a real run: external write
   tools may perform their action if approved. Then call `test_run` with
   `inputs.messages` as a blunt instruction-framed test message and
   `expectations.terminal_tool` set to the final tool that proves success. Read `verdict`,
   `verdict_reason`, `tools`, and `approvals`; a 200 response is not proof. Pass only
   when `verdict` is `pass`. If `approvals` is non-empty, this is an approval stop:
   report the waiting gate and wait for the user. If `verdict` is `incomplete`, rewrite
   `instructions.agents_md` as a blunter numbered procedure, call `commit_revision`, and
   run `test_run` again. Use `query_spans` after schedules or subscriptions fire to read
   back the SCHEDULED run spans.
7. Add a trigger only if asked. For schedules, cron is UTC, five fields, with a one-minute floor;
   convert the user's timezone yourself, then stop for approval before `create_schedule`: say what
   you are about to create and wait for the gate. After approval, call `create_schedule`, then
   confirm with `list_schedules`. For events, call `discover_triggers`, ensure the integration is
   connected, then stop for approval before `create_subscription`: say what you are about to create
   and wait for the gate. After approval, call `create_subscription`, and confirm with
   `list_deliveries`. `test_subscription` waits for a real event, so warn the user before using it
   in a chat turn. Use `remove_schedule` or `remove_subscription` only when cleaning up a wrong
   trigger.
8. Report short: what you became, what is connected, what is scheduled, what you verified, and
   what still needs the human.

## Writing instructions for multi-tool and scheduled agents

When you write `instructions.agents_md` for a multi-tool or scheduled agent, write an explicit
numbered procedure that names the exact tools in order, pins concrete ids, and ends on the
terminal action.

Example:

> Every run, do exactly these steps and nothing else: (1) call LIST_REPOSITORY_ISSUES for
> owner/repo X; (2) call LIST_COMMITS for X; (3) write a 3-bullet digest; (4) call SEND_MESSAGE to
> channel C0XXXX with that digest. Do not check triggers, do not stop before step 4.

- Pin concrete ids, such as channel id and repo, instead of telling the agent to re-resolve them.
- Make the final numbered step the terminal side effect, such as the post or write.
- Say "finish by doing step N" so the run does not stop after the early read steps.

## Prefer wired tools

Prefer your wired tools (`discover_tools`, `request_connection`, `commit_revision`,
`test_run`, `query_spans`, `create_schedule`, `list_schedules`, `discover_triggers`,
`create_subscription`, `test_subscription`, `list_deliveries`, `remove_schedule`,
`remove_subscription`) over harness builtins. Touch Terminal, RemoteTrigger, File tools, or raw
HTTP only when your wired tools cannot do the job, and say so when you do.

## Footguns

- Empty output is not enough to fail a run; read the `test_run` verdict, tools, approvals,
  and verdict_reason before judging.
- Never surface raw provider slugs such as `provider_action` to the user; speak in Agenta terms.
- Re-run discovery after the user connects an integration so the committed tool gets the concrete
  connection id.
- A subscription without a ready connection never fires.
- Trigger inputs must match what the instructions expect, or the run starts empty.
"""

BUILD_AN_AGENT_SKILL = SkillTemplate(
    name="build-an-agent",
    description=(
        "Build or configure an Agenta agent end to end. Use when the user asks to set up, "
        "automate, connect tools for, schedule, or subscribe an agent."
    ),
    body=_BUILD_AN_AGENT_BODY,
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
