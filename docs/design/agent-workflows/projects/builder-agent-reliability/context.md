# Context

## Why this work exists

`big-agents` already ships the mechanics for an agent to build itself. A fresh agent gets a
**playground build kit**: a read-only agent-template overlay (`additional_context.playground_build_kit
.agent_template_overlay` on the simple-applications response) that, for the duration of a playground
run, hands the agent platform tools and an authoring skill set. The user opens a new agent, chats
with it, and the agent is supposed to turn the conversation into a working app: find the right
tools, connect the right integrations, edit its own instructions, set a trigger, commit, and test.
That whole initiative ("Agent builds an app") shipped: PRs #4917-4935 are merged into `big-agents`.
See [Background](#background) for exactly what landed and where its design docs live.

Mahmoud tried it end to end on a concrete, deliberately ordinary use case (below) and the agent was
**confused**: it did not reliably reach for the tools it had, and it did not take the easy,
intended path through them. This project exists to find out why, with a real conversation as the
test case, before deciding what to fix.

This is a draft scoping note, not a plan. Goals and approach are intentionally open; the next step
is to agree on how to diagnose and fix this with Mahmoud, not to start building.

## The worked example

The use case Mahmoud described, as a prompt a user might actually type into a fresh agent's chat:

> I want an agent that, twice a day — say 9:00 and 15:00, every day of the week — checks what
> changed in this repo: new issues, new commits, and new discussions. It writes a report about
> the changes in a particular style and sends it to me in Slack, in a specific channel.

Nothing about this prompt is exotic. It is one schedule, three read-style GitHub checks, one
Slack write, and a report with a style instruction. Worked through the shipped build kit, the
intended path looks roughly like:

1. **Orient.** The agent recognizes this is a self-build request (it is being asked to become
   this app), not a one-off task to execute right now.
2. **Clarify.** `build-your-first-app` step 1 says ask, don't guess — and this prompt has real
   gaps: is 9:00/15:00 in the user's local time or UTC (`set-up-triggers` is explicit that cron is
   UTC and the agent must convert), does "every day of the week" mean all 7 days or weekdays, what
   GitHub repo, what Slack channel, what "style" means for the report.
3. **Discover tools.** `discover-and-wire-tools` calls `find_capabilities` with short fragments
   ("list new GitHub issues since a date", "list new commits since a date", "list new GitHub
   discussions since a date", "post a message to a Slack channel") rather than guessing
   Composio slugs.
4. **Connect.** For any integration not already connected, hand the user the connection link and
   wait — never connect on the user's behalf.
5. **Configure itself.** Attach the resolved tools, write `instructions.agents_md` from the
   discovery guidance plus the report style, and `commit_revision` (a stop-for-approval step).
6. **Schedule.** `set-up-triggers`: build the UTC cron expression for twice-daily, map run
   inputs, `create_schedule` (another stop-for-approval step).
7. **Test.** Run once against a sample before declaring it done, per the skill.
8. **Report.** Tell the user what it became, what is connected, and what is now scheduled.

That is the "easy path" referenced below: the skills already name these exact steps in this exact
order. The live test did not follow it cleanly.

## What was observed

Talking to the agent about exactly this kind of change, informally:

- It did not reliably know how to use its own tools — it did not consistently reach for
  `find_capabilities` / `find_triggers` the way `discover-and-wire-tools` / `set-up-triggers`
  describe, even though those tools and skills were present in its build kit.
- It did not take the easy path. Where a skill names a direct sequence (discover -> connect ->
  configure -> schedule -> test), the agent's actual behavior wandered rather than following it.

This is a first impression from one informal session, not a reproduced, logged finding yet.
Turning it into something diagnosable — a real transcript, a replayable test, a named failure
mode — is the first piece of work, before any fix is designed.

## Open questions this project should answer

These are genuinely open; do not treat any of them as already decided.

- Does the agent reliably recognize "build me an app that does X" as a self-build request and
  pull in the `build-your-first-app` skill, versus trying to just chat or execute X directly?
- Given the skill content is fairly long and procedural (see
  `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`), is the failure a context/attention
  problem (the model doesn't load or follow the skill), a discoverability problem (the model
  doesn't know when to open it), or a tool-calling problem (it opens the skill but still
  mis-calls `find_capabilities` / `create_schedule` / etc.)?
- Is `find_capabilities` itself actually wired as a callable tool yet, or only reachable via the
  `/tools/discover` / `/tools/call` workaround the skill text calls out as a 2026-06-27
  limitation (see `discover-and-wire-tools` body, "Availability" note)? If the gap is still
  there, that alone could explain the agent not reaching for it.
- Does the four-skill split (`agenta-getting-started`, `build-your-first-app`,
  `discover-and-wire-tools`, `set-up-triggers`) help or hurt — does the orchestrator skill
  actually cause the agent to read the focused skills at the right step, or does splitting the
  procedure across files lose the agent along the way?
- Is the build kit overlay actually reaching the running agent in this kind of session (the
  tools and skills are present, attached, and not silently dropped by harness/runner plumbing),
  or is part of the confusion really a delivery bug dressed up as a prompting problem?

## Non-goals (for now)

- Redesigning the build-kit architecture (the overlay mechanism, the platform-op catalog, the
  client-tool round-trip). That shipped and is out of scope unless diagnosis points there.
- Adding new platform tools or triggers. The worked example above should be servable by what
  already exists (`find_capabilities`, `find_triggers`, `create_schedule`, `commit_revision`,
  GitHub + Slack via Composio gateway tools).
- Solving this generally for every possible use case. The worked example is the one fixed test
  case for this round.

## Background

### What "Agent builds an app" shipped

Four sub-projects landed together (PRs #4917, #4918, #4919, #4925/#4934, plus #4930/#4931 for the
skills/builder-tools content and #4935 for a drawer cleanup):

- **The build-kit overlay** (`api/oss/src/apis/fastapi/applications/overlay.py`,
  `build_agent_template_overlay()`): assembles platform tools (`PLATFORM_OPS`), the authoring
  skills, and elevated sandbox permissions (write files, execute code) into a read-only overlay
  served on `GET /api/simple/applications/{id}`. The frontend deep-merges it onto the run config
  for a playground run only; it is excluded on commit, so a published agent never carries it.
- **The platform-op catalog** (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`,
  `PLATFORM_OPS`): thin wrappers over existing Agenta endpoints, exposed to the agent as
  `type:"platform"` tools. Relevant to the worked example: `find_capabilities`, `query_workflows`,
  `commit_revision`, `find_triggers`, `create_schedule`, `create_subscription`, `list_schedules`,
  `list_subscriptions`, `list_deliveries`, `list_connections`, `test_subscription`,
  `remove_schedule`, `remove_subscription`, `pause_schedule`/`resume_schedule`,
  `pause_subscription`/`resume_subscription`. Mutating ops default to requiring approval.
- **The skill catalog** (`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`): four
  code-defined skills, single-sourced between the SDK and the server-side static workflow
  catalog — `agenta-getting-started` (always forced, baseline behavior),
  `build-your-first-app` (the orchestrator named above), `discover-and-wire-tools` (the
  `find_capabilities` loop), `set-up-triggers` (cron/event setup). Full skill bodies are quoted
  in [the worked example](#the-worked-example) above; read them in the source for the exact
  wording the model sees.
- **The client-tool round-trip**: a generic pause-for-the-human primitive (config-commit
  approval, connection requests) the rest of the flow's stop points reuse.
- **`find_capabilities`** (`docs/design/agent-workflows/projects/tool-discovery/`): wraps
  Composio's `COMPOSIO_SEARCH_TOOLS` so the agent gives short natural-language fragments instead
  of guessing integration/action slugs. See that project's `use-case-walkthrough.md` for a worked
  Slack -> GitHub example in the same spirit as this one.

### A documentation gap worth knowing about

The richest design documentation for this initiative — `agent-builds-an-app/README.md` (the
umbrella doc this context file draws the shipped-PR list from) and its four sibling project
folders (`default-agent-config`, `agent-builder-capabilities`, `agent-skills`,
`agent-fe-roundtrip`) — lives on an **unmerged branch**, `agent-design-docs`. The code shipped to
`big-agents`; the docs describing it did not. Anyone picking up this project should either pull
those docs in or read them straight off that branch (`git show agent-design-docs:docs/design/
agent-workflows/projects/agent-builds-an-app/README.md`), since they are the authoritative record
of what was decided and why, and `documentation/` in this workspace does not yet reflect them.

### Related project work already in this workspace

- `tool-discovery/` — the `find_capabilities` design and the Composio wrapper it sits on.
- `skills-config/` — the general skill-configuration mechanism (`SkillConfig`, the
  `_agenta.*` reserved-slug platform-skill resolver) that the forced/embedded skills above are
  built on.
- `capability-config/` — the permission/approval layers; relevant because every mutating
  platform op in the worked example (`commit_revision`, `create_schedule`) is approval-gated by
  default, so part of "did it take the easy path" includes "did it pause correctly and explain
  why."
