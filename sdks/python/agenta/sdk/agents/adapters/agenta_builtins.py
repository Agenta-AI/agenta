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
BUILD_YOUR_FIRST_APP_SLUG = "__ag__build_your_first_app"
DISCOVER_AND_WIRE_TOOLS_SLUG = "__ag__discover_and_wire_tools"
SET_UP_TRIGGERS_SLUG = "__ag__set_up_triggers"

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

_BUILD_YOUR_FIRST_APP_BODY = """\
# Build your first app

You are helping the user turn a plain-language goal into a working app. You are building
yourself: the app you configure is you. This skill is the map. It names the order and the
points where you stop for the user. Read the focused skill for a step before you act on it.

## When to use

Use this when the user asks you to build, set up, or automate something, and the app does not
exist yet.

## The flow

1. Clarify the goal. Ask what the app should do, what should start it (a message, a schedule,
   an outside event), and what tools or data it needs. Do not guess.
2. See what exists. Call `query_workflows` to check the project for work you can reuse.
3. Find the tools. Follow the `discover-and-wire-tools` skill. It calls `find_capabilities`
   and reports which integrations need a connection.
4. Connect the integrations. Hand the user the connection link, wait for them to finish, then
   re-check. You never connect on their behalf.
5. Configure yourself. Edit your own instructions and attach the tools, then commit with
   `commit_revision`. This stops for the user's approval.
6. Set the trigger. Follow the `set-up-triggers` skill for a cron job or an event trigger.
   Each one stops for the user's approval.
7. Test. Run once against a sample, then confirm the result with the user.
8. Report. Tell the user what you became, what is connected, and what is now scheduled.

## Stop points

You pause for the user at every connection, every commit, every schedule, and every
subscription. These are approval gates by design. Say what you are about to do, then wait.
"""

BUILD_YOUR_FIRST_APP_SKILL = SkillTemplate(
    name="build-your-first-app",
    description=(
        "Guide the user through building their first Agenta app end to end. Use at the start "
        "of a build conversation to plan the work, find and wire tools, set a trigger, and "
        "commit. This skill is the map. Read the focused skill for each step."
    ),
    body=_BUILD_YOUR_FIRST_APP_BODY,
)

_DISCOVER_AND_WIRE_TOOLS_BODY = """\
# Discover and wire tools with `find_capabilities`

You are configuring yourself as an app. Before you can act in the world, you need tools:
the right integration actions, working connections, and the schemas your model will call.
`find_capabilities` does the discovery in one step so you do not guess slugs or stitch the
catalog by hand.

This skill is the discover -> resolve-connections -> configure -> test loop. It pairs with
the configure step in the `build-your-first-app` skill: once the tools are chosen, commit
the tools and instructions onto this agent.

> **Availability (2026-06-27):** the server side is live, but the SDK does not yet declare
> `find_capabilities` as a tool the model can call directly (that lands in Workstream A). Until
> then, reach the same discovery from setup code: `POST /tools/discover` with
> `{"use_cases": [...]}`, or `POST /tools/call` with call_ref `tools.agenta.find_capabilities`.
> The response below is identical either way.

## When to use it

Use it whenever you are wiring tools for this agent and the task is described in plain
language ("listen in Slack and file GitHub issues") rather than as exact tool slugs. One call
returns the best-match tool per use case, alternatives the one-line request omitted, the input
schemas, the connection state per integration, and operating guidance.

## The loop

### 1. Discover

Call `find_capabilities` with one short fragment per capability the agent needs. Keep each
fragment to a single action ("create a github issue"), not a whole workflow.

```jsonc
find_capabilities({
  "use_cases": [
    "search github issues for a matching report",
    "create a github issue",
    "post a reply in a slack thread with a link"
  ]
})
```

Project scope comes from your run's caller auth, so the connection state you get back is your
project's real state. You do not pass a project id or a Composio user id.

### 2. Read the response (it is already in Agenta terms)

You never see Composio. Each capability is Agenta-shaped:

- `capability.tool` — a `gateway` tool config (`provider` / `integration` / `action`), ready to
  drop into this agent's `tools`. It also carries the `input_schema` and `description` the
  model needs, plus `provider_action` (opaque, debugging only — do not show it).
- `capability.tool.connection` — filled **only** when the integration is `ready`. If it is
  missing, the connection is not set up yet (see step 3).
- `capability.alternatives` — companion or prerequisite actions the one-line request omitted
  (for example `slack.FIND_CHANNELS` before `slack.SEND_MESSAGE`). Add the ones the task needs.
- `capability.connection.state` — `ready`, `needs_auth`, or `needs_input`.
- `connections[]` — one entry per integration, deduped, with what to do when it is not ready.
- `guidance` — `plan_steps` and `pitfalls` you compose into this agent's
  `instructions.agents_md`.
- `ready` — `true` only when every primary connection is ready (you can configure and run now).
- `notes` — scope notes, e.g. a use case that looks like a trigger (see "Triggers" below).

### 3. Resolve connections (a human approves; you never auto-connect)

For each integration in `connections[]`:

- **`ready`** — reuse it. The `slug` is already on `capability.tool.connection`. Nothing to do.
- **`needs_auth`** (OAuth) — run the returned `connect` affordance
  (`POST /tools/connections/` with the given `body`). It returns a `redirect_url`. Surface that
  link to the human and **pause** until they finish authorizing. Then re-run `find_capabilities`
  (or check the connection) to confirm the integration flipped to `ready`.
- **`needs_input`** (API key) — ask the human for the secret the integration needs, then create
  the connection with the `connect` affordance.

Do not create connections silently. A human approves OAuth and supplies secrets.

### 4. Configure this agent

Once the tools are chosen and their connections are `ready`, build this agent's template:

- Put each chosen `capability.tool` (and any needed `alternatives`, shaped as gateway tools
  with a `connection`) into `tools` on the agent template.
- Compose `instructions.agents_md` from `guidance`: turn `plan_steps` into the operating
  procedure and `pitfalls` into "things to avoid". The guidance already uses friendly
  `integration.action` names, so it reads cleanly.

Then return to the `build-your-first-app` configure step: edit this agent's own template and
commit it with `commit_revision`. If a tool call fails on a missing connection, return to
step 3.

## Triggers (listening for events) are a separate step

`find_capabilities` covers **action** tools (do a thing). It does not discover triggers
(listen for an event), because the engine has no semantic trigger search. If a use case reads
like a trigger ("listen for new messages...", "when a new issue is created..."), the response
flags it in `notes` and on that `capability.note`. Treat the listening half as a trigger
subscription with the `set-up-triggers` skill, and wire the action tools as usual.

## Good habits

- One capability per `use_case` fragment; let discovery return the alternatives.
- Always check `connection.state` before assuming a tool will run; `ready` means it will
  resolve at invoke time.
- Never surface `provider_action` or any raw provider slug to the user — speak Agenta.
- Re-run discovery after a human finishes a connection to confirm `ready` before creating.
"""

DISCOVER_AND_WIRE_TOOLS_SKILL = SkillTemplate(
    name="discover-and-wire-tools",
    description=(
        "Use find_capabilities to discover the right Agenta tools for an agent you are "
        "configuring, report what each integration needs to connect, and wire the tools into "
        "this agent's template. Use when a setup/builder agent must turn a plain-language task "
        "into attached, connected, ready-to-run tools."
    ),
    body=_DISCOVER_AND_WIRE_TOOLS_BODY,
)

_SET_UP_TRIGGERS_BODY = """\
# Set up triggers

A trigger makes the app run on its own. There are two kinds. A schedule runs on a clock. A
subscription runs when an outside event arrives. Either way, the trigger targets you: it is
set on this agent automatically, and you never name a destination.

## When to use

Use this when the user says the app should run on a timer, on a cron, or whenever something
happens in a connected tool.

## Schedules (cron)

1. Get the cron expression right. Five fields, UTC, one-minute floor. Confirm the user's
   timezone and convert to UTC.
2. Set the optional window if the job should only run between two dates.
3. Map the inputs the job passes to the app on each run.
4. Create it with `create_schedule`. This stops for the user's approval.

## Subscriptions (events)

1. Find the event. Call `find_triggers` with a short keyword for the event you want.
2. Make sure the connection exists. A subscription needs a connected integration. If it is
   missing, run the connection round-trip first and wait.
3. Map the event into the run inputs.
4. Create it with `create_subscription`. This stops for the user's approval.

## Confirm it works

Test before you go live. If the catalog has a sample event, map the sample and run yourself
on it, with no connection. To prove the live wiring, call `test_subscription`, then read the
delivery with `list_deliveries`. Tell the user what fired and what it produced.

## Footguns

- Cron is UTC. Always convert from the user's timezone.
- A subscription with no connection never fires. Connect first.
- The inputs must match what the app expects, or the run starts empty.
"""

SET_UP_TRIGGERS_SKILL = SkillTemplate(
    name="set-up-triggers",
    description=(
        "Set up a cron job (a schedule) or an event trigger (a subscription) for the app. Use "
        "when the user wants the app to run on a timer or react to an outside event."
    ),
    body=_SET_UP_TRIGGERS_BODY,
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
