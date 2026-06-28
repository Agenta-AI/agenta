# Design: the build skills

The skills a new Agenta agent carries so a user can chat with it and build their first app.

Status: rewrite for Mahmoud's review. Grounded in code on `gitbutler/edit` over `big-agents`,
2026-06-28. Paths are absolute. This replaces the first draft, which mixed the product question
(which skills do we need) with the implementation question (how a skill reaches the agent) and
read as unreviewable. This version separates the two and leads with the answer.

## Summary

The build flow needs four skills. One teaches baseline behavior. One is the map of the whole
build. Two are deep dives on the hardest sub-flows.

| Skill | Role | Source |
|---|---|---|
| `agenta-getting-started` | Baseline behavior. How an Agenta agent works. | Exists as a placeholder. Keep and single-source it. |
| `build-your-first-app` | The orchestrator. Names the steps, the order, and the stop points. | New. |
| `discover-and-wire-tools` | Find action tools and get their integrations connected. | A tested draft. Promote and adapt. |
| `set-up-triggers` | Set up a cron job or an event trigger, and test it. | New. |

The skills reach the agent through the playground build kit, injected at run time and never
committed. They are not an `@ag.embed` in the committed config. The `default-agent-config`
project owns that mechanism; this project owns the skill content, the names, and the slugs.

We do not have the final skill prose yet. We know what each skill must teach. So this design
fixes the set, the naming, and the contracts, and ships placeholder bodies that capture the
build flow. The real prose lands later.

## How to read this

The doc answers two separate questions, in two separate parts, so each is reviewable on its own.

- Part A, the product question: which skills does the build flow need, and why. Read this to
  judge the set. It depends on no implementation detail.
- Part B, the implementation question: how a skill reaches the agent, how it is named, and what
  contract it rides. Read this to judge the build.

Part A is sections 1 to 3. Part B is sections 4 to 6. Open questions are section 7.

---

# Part A. Which skills does the build flow need?

## 1. The problem

A new Agenta agent should start useful. The user creates one, then chats with it, and the agent
turns itself into a real application. It finds the tools it needs, connects the integrations,
edits its own instructions, sets a trigger or a cron job, and commits the result. The agent
becomes the app. The user never writes config by hand. They have a conversation.

This is the initiative framed in
[`../agent-builds-an-app/README.md`](../agent-builds-an-app/README.md). It splits into four
projects. This one owns the skills.

A tool does an action. A skill teaches the agent which tools to use, in what order, where to
stop for the human, and which mistakes to avoid. The model can call a dozen tools, but on its
own it guesses the sequence. The skills turn "build me an app" into a guided flow.

So this project owns the skill content and the skill naming. It does not own three things it
leans on, and only references them:

- Which skills reach a new agent, and the inject mechanism.
  Owned by [`../default-agent-config/`](../default-agent-config/design.md).
- The build-flow tools the skills name (`find_capabilities`, `commit_revision`,
  `create_schedule`, `create_subscription`, and the rest). Most do not exist yet.
  Owned by [`../agent-builder-capabilities/README.md`](../agent-builder-capabilities/README.md).
- The connection round-trip. The agent asks the frontend for a connection, the user finishes the
  sign-in, and the run resumes. Owned by
  [`../agent-fe-roundtrip/`](../agent-fe-roundtrip/design.md).

These decisions are settled across the four projects. This design assumes them, and does not
reopen them:

- The agent becomes the app. Self-modification only. The agent edits and commits itself. It does
  not build other workflows in this round.
- Defaults are injected, not committed. The platform tools and the build skills are a build aid
  the playground injects for the run. The commit writes only the user's own config.
- Skills arrive by inject, not by force. `AGENTA_FORCED_SKILLS` goes empty. The force mechanism
  stays in the code for a future skill that carries real functionality.

## 2. From the build flow to the skill set

The skill set is not a restatement of the drafts that exist on disk. Those drafts were
exploration, written in merged branches and not all carried into `big-agents`. We treat them as
raw material, not as the spec. The set comes from the build flow's actual needs.

### 2.1 What the agent must be able to do

The end-to-end flow has these jobs. The tool layer is owned by `agent-builder-capabilities`;
the table is here so the whole "what self-build needs" picture is reviewable in one place.

| # | Build step | Serving tool | Tool state |
|---|---|---|---|
| 0 | Understand the goal, plan the build | (no tool; the orchestrator skill) | n/a |
| 1 | Find the right action tools | `find_capabilities` | exists |
| 2 | See what already exists in the project | `query_workflows` | exists |
| 3 | Connect an integration the tools need | frontend round-trip (agent requests, cannot create) | frontend-owned |
| 3b | Check whether a connection is ready | `list_connections` | missing |
| 4 | Attach tools, edit own instructions, edit own skills | `commit_revision` (self-target) | exists |
| 5 | Find the right event to trigger on | `find_triggers` (keyword) | missing (new backend) |
| 6 | Set up a cron job on itself | `create_schedule` (self-target) | missing (backend exists) |
| 7 | Set up an event trigger on itself | `create_subscription` (self-target) | missing (backend exists) |
| 8 | Inspect its own triggers | `list_schedules` / `list_subscriptions` | missing (backend exists) |
| 9 | Test the trigger | `test_subscription` + `list_deliveries` | missing (backend exists) |
| 10 | Commit the finished agent | `commit_revision` (self-target) | exists |

Through all of it the agent must behave well. Be concise. Ask for missing inputs. Prefer the
tools and skills it was given over guessing. Read a matching skill fully before it acts. Stop for
the human at every connection, every commit, every schedule, and every subscription.

### 2.2 Which of those jobs need a skill

A job needs a skill when the agent has to learn a sequence, a stop point, or a footgun that a
single tool call cannot carry. Map the jobs to that test.

- Behavior (concise, ask, prefer tools, read before acting). This is always-on guidance, not a
  sequence. It needs a baseline skill: `agenta-getting-started`.
- Step 0, the whole sequence and the stop points. The agent has to run a dozen calls in the
  right order and pause at the right gates. This is the core teaching job. It needs the
  orchestrator skill: `build-your-first-app`.
- Steps 1 to 3b, find tools and get them connected. This is a loop with a hard footgun: the
  agent must never create a connection itself; it requests one and waits. It needs a focused
  skill: `discover-and-wire-tools`.
- Steps 5 to 9, triggers and cron. This carries the worst footguns in the flow: cron is in UTC,
  a subscription needs a connection first, the test order matters, and the input mapping is easy
  to get wrong. It needs a focused skill: `set-up-triggers`.
- Step 4 and step 10, self-modify and commit. These are a single tool, `commit_revision`. The
  orchestrator names when to call it. No dedicated skill.

So four skills fall out of the flow: one baseline, one orchestrator, two focused. This is the
recommended set. Section 7 asks whether to fold the trigger skill into the orchestrator to start
smaller; the default is to keep four, because the orchestrator stays a short map and each focused
skill owns one hard sub-flow.

### 2.3 What we reuse from the drafts

Two drafts exist and were tested. We keep what they proved and drop the rest.

- `discover-and-wire-tools` lives at
  [`../tool-discovery/skills/discover-and-wire-tools/SKILL.md`](../tool-discovery/skills/discover-and-wire-tools/SKILL.md).
  It was written and verified on 2026-06-27. Its discover, resolve-connections, create, test
  loop is good and current. We promote it. Two edits in section 3.3.
- `create-agenta-agent` lives under
  [`../agent-creation-skills/`](../agent-creation-skills/). It teaches an outside developer to
  build an agent over the HTTP API with curl. That is a different audience from a running agent
  that builds itself. Under the self-modify decision, it is not in the build set. It stays an
  external developer skill, gets a naming fix so it stays accurate, and is out of scope here
  beyond this note.

`agenta-getting-started` is the one skill that already ships. Section 3.1 covers its drift.

## 3. The skills (placeholder bodies)

Each skill below is a placeholder. The body is a design artifact: the outline of what the skill
teaches and which tools it drives, in order. It is the starting content, not the final prose.

A standing note for `build-your-first-app` and `set-up-triggers`: the tools they name are
missing until `agent-builder-capabilities` ships them. The skill content is ready. It goes live
when the tools do.

### 3.1 `agenta-getting-started` — baseline behavior (exists, single-source it)

This is the only platform skill that ships today. It sets behavior, not the build flow: be
concise, ask for missing inputs, prefer the provided tools and skills, read a matching skill
fully before acting. The placeholder content it carries now is acceptable. The work here is to
fix a drift, not to rewrite it.

The skill lives in two places, and they have diverged.

- The canonical content is an SDK constant, `GETTING_STARTED_WITH_AGENTA_SKILL`, at
  `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:93`. The
  static catalog imports it and serves it under the reserved slug
  `__ag__getting_started_with_agenta`
  (`/home/mahmoud/code/agenta/api/oss/src/core/workflows/static_catalog.py:82`). This constant is
  the only copy the running agent ever sees.
- A second copy is a file at
  `/home/mahmoud/code/agenta/services/agent/skills/agenta-getting-started/SKILL.md`. Its text
  differs from the constant, and the runner never reads it. The runner composes each SKILL.md
  from the wire skill it receives, keyed by name, and writes that into the sandbox
  (`/home/mahmoud/code/agenta/services/agent/src/engines/skills.ts:148`). The on-disk directory
  is an authoring artifact that has gone stale.

So the file misleads any human who reads it, because it is not what the agent runs. Single-source
the body. The constant stays canonical. Section 7 asks how: generate the file from the constant,
assert the file against the constant in a test, or drop the file.

One refinement worth Mahmoud's call (section 7): this skill's content overlaps the always-on
AGENTS.md preamble (`AGENTA_PREAMBLE` in the same file), which already says "prefer the tools and
skills provided" and "read a matching skill fully before acting." Baseline behavior may belong in
the preamble, which applies to every run, rather than in a build-only skill.

### 3.2 `build-your-first-app` — the orchestrator (new)

The top-level skill. It names the order of steps and the stop points, and it points at the
focused skills rather than restating them.

```markdown
---
name: build-your-first-app
description: Guide the user through building their first Agenta app end to end. Use at the
  start of a build conversation to plan the work, find and wire tools, set a trigger, and
  commit. This skill is the map. Read the focused skill for each step.
---

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
```

### 3.3 `discover-and-wire-tools` — promote and adapt (draft exists)

Promote the tested draft to a platform skill. The body carries over. Two edits.

- Step 4 composes the chosen tools into `agent_config.tools` and the guidance into `agents_md`.
  Those keys are stale. Put each chosen tool into `tools` on the agent template, and compose the
  guidance into `instructions.agents_md` (the rename, section 5).
- The draft pairs step 4 with the `create-agenta-agent` curl skill to create a separate agent.
  Under self-modify, the create step is `commit_revision` on this agent itself. Re-point that
  line at the `build-your-first-app` configure step, so the skill stays in the in-agent voice.

Everything else carries over: the discover loop, reading the response in Agenta terms, the
resolve-connections branch (the agent never auto-connects), and the good-habits list. Its
"triggers are out of scope" note now hands off to `set-up-triggers` instead of dead-ending.

### 3.4 `set-up-triggers` — cron and event triggers (new)

The focused skill for the trigger steps. It turns the trigger footguns into a checklist.

```markdown
---
name: set-up-triggers
description: Set up a cron job (a schedule) or an event trigger (a subscription) for the app.
  Use when the user wants the app to run on a timer or react to an outside event.
---

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
```

---

# Part B. How does a skill reach the agent?

## 4. The delivery model: inject, do not commit

This is the part that changed most since the first draft, and the part to coordinate with
`default-agent-config`. The first draft said the build skills reach the agent as an `@ag.embed`
in the committed default config. That is no longer how it works.

The current model is inject, not commit. The platform tools and the build skills are a build aid,
not part of the user's shipped agent. So the playground injects them for the run, and the commit
writes only the user's own config.

- The build skills ride the playground build kit, alongside the platform tools and the build
  permissions. The kit is a backend-defined set with one source of truth.
  See [`../default-agent-config/design.md`](../default-agent-config/design.md).
- At run time, when the build kit is on, the backend merges the kit's skills into the effective
  config before skill resolution. The agent runs with the build skills present.
- The commit writes only the user's config. The build skills are never in the stored revision,
  so there is nothing to strip. They are absent by construction.
- The playground shows the injected skills read-only in the Advanced drawer, marked removed on
  commit. That drawer is owned by [`../advanced-build-kit/design.md`](../advanced-build-kit/design.md).

The kit references each build skill by its stable slug. The kit's `skills` group carries one row
per build skill: the slug, the display name, and the description. This project supplies those
slugs, names, and descriptions; the kit reads them.

A user-added skill is different. A user can still add their own skill the normal way: an inline
`SkillTemplate`, or an `@ag.embed` reference, in the committed `skills` list. Those are committed
and shipped. The build skills are not. The two paths stay separate, and that separation is the
whole point: Agenta's build aid never leaks into the user's published agent.

One open coordination point (section 7): `default-agent-config` currently describes the kit as
carrying a single "authoring skill," while this design needs the kit to carry the full build set,
because the orchestrator references the focused skills and they must be co-present. The kit's
`skills` group is an array, so it can carry all four. Confirm the kit injects the set.

## 5. Naming

### 5.1 The slug, and why it matters

A skill is addressed by a slug. Lead with why that matters, because the first draft dropped it
with no context.

- The **slug** is the routing key. The static catalog derives every id for a skill from it: the
  artifact id, the variant id, and the revision id all come from a UUIDv5 over the slug
  (`/home/mahmoud/code/agenta/api/oss/src/core/workflows/static_catalog.py`). So the slug is
  immutable once shipped. Change it and every reference to the skill breaks.
- The **name** is the human label the playground shows, and the SKILL.md frontmatter field. It is
  metadata, not a routing key.

They play different roles, so they are different fields, and they do not have to match. Today they
do not: name `agenta-getting-started`, slug `__ag__getting_started_with_agenta`. That mismatch is
pre-existing. Do not change the live slug to fix it. The ids derive from it.

For the new skills, adopt one rule: `__ag__` plus the name with hyphens turned to underscores.
So `build-your-first-app` gives `__ag__build_your_first_app`, and `set-up-triggers` gives
`__ag__set_up_triggers`. A reader who knows the name can predict the slug. The `__ag__` prefix is
the reserved namespace a user cannot author or shadow
(`/home/mahmoud/code/agenta/api/oss/src/core/workflows/types.py:41`). That reservation is what
makes a platform skill trusted.

### 5.2 The config rename (JP's rename)

The drafts predate JP's config rename. The agent config moved from a flat blob to a nested
template at `parameters.agent`, with the catalog type-ref `agent-template`. Verified in
`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/dtos.py` and
`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/utils/types.py` (`build_agent_v0_default`).

The keys a skill example must use, old on the left, current on the right:

| Old (drafts use this) | Current | Source |
|---|---|---|
| type-ref `agent_config` | type-ref `agent-template` | `dtos.py` |
| `agents_md` (flat) | `instructions.agents_md` | `dtos.py`, `types.py` |
| `model` (flat) | `llm.model` (or the `llm` block) | `dtos.py`, `types.py` |
| `model.params` (the model knobs bag) | `llm.extras` | `dtos.py` |
| `harness` (flat string) | `harness.kind` | `dtos.py` |
| `sandbox` (flat string) | `sandbox.kind` | `dtos.py` |
| `permission_policy` (flat) | `runner.interactions.headless` | `dtos.py`, `types.py` |
| `mcp_servers` | `mcps` | `dtos.py` |
| `tools` | `tools` (unchanged, flat on the template) | `dtos.py` |
| `skills` | `skills` (unchanged, flat on the template) | `dtos.py` |

The harness kind values are unchanged: `pi_core`, `pi_agenta`, `claude`. The runner block is new:
`runner.kind = "sidecar"` and `runner.interactions.headless` is `"auto"` or `"deny"`.

Which skill carries naming debt:

- `agenta-getting-started`: none. It has no config examples.
- `discover-and-wire-tools`: light. Only the step-4 composition (section 3.3).
- `build-your-first-app`, `set-up-triggers`: none. Written fresh in the current shape.
- `create-agenta-agent` (external, not embedded): heavy. Every config example. Owned by the
  external-skill cleanup, not by this round.

## 6. The skill contract (design-interfaces)

A contract change is the kind of decision the design-interfaces skill governs: classify each
field by the role it plays, and resist adding a field before a real need exists. One question
came up, and the answer is to change nothing.

How does a skill declare which tools it teaches? It does not, and it should not.

- A `SkillTemplate` is `name`, `description`, `body`, `files`, and two harness flags
  (`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/skills/models.py`). That shape is the
  general harness skill standard. Pi, Claude, OpenCode, and Antigravity all read the same
  frontmatter. A skill is content and metadata. It grants no tools and carries no behavior. We
  keep it a general standard.
- A skill names its tools in prose, in its body. The build kit injects the build skills and the
  platform tools together, so they arrive co-present at run time. If a tool a skill names is
  absent, the agent simply cannot call it. Nothing in the skill breaks. The harness exposes
  whatever tools it has, and the skill is plain Markdown either way.
- We do not add a `requires_tools` field to `SkillTemplate`. That would couple the skill catalog
  to the platform-op catalog, and it would put platform-specific knowledge into a general
  standard. By the design-interfaces rule, a field earns its place only when a real need exists.
  Co-presence is guaranteed by the kit, so there is no need. We reject the field.

## 7. The split: us versus the frontend

**Us (backend, SDK, runner):**

- Author the two new skills (`build-your-first-app`, `set-up-triggers`) as `SkillTemplate`
  constants near `agenta_builtins.py`, register them in the static catalog under their reserved
  slugs, and lay a single-sourced SKILL.md copy under `services/agent/skills/<name>/` if we keep
  the human-readable copies at all (section 8).
- Promote `discover-and-wire-tools` to a platform skill with the section-3.3 edits.
- Single-source the `agenta-getting-started` body (section 3.1).
- Supply the kit's skill rows (slug, name, description) for the build set, for the inject path and
  the drawer to read.
- Set `AGENTA_FORCED_SKILLS = []`
  (`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:104`), and
  keep the `force_skills` machinery for a future skill that carries real functionality.

**Frontend (Arda):**

- The Advanced drawer renders the injected build skills read-only, in the build-kit section,
  marked removed on commit. Owned by [`../advanced-build-kit/design.md`](../advanced-build-kit/design.md).
  The skills only depend on it.
- The connection round-trip the build skills reference (surface the sign-in link, pause, resume).
  Owned by [`../agent-fe-roundtrip/design.md`](../agent-fe-roundtrip/design.md). The skills
  consume it; they do not design it.

## 8. Open questions

1. **The skill set count.** The recommendation is four: `agenta-getting-started`,
   `build-your-first-app`, `discover-and-wire-tools`, `set-up-triggers`. The alternative is to
   fold `set-up-triggers` into `build-your-first-app` to ship a smaller surface first. Default:
   keep four. The orchestrator stays a short map, and each focused skill owns one hard sub-flow.

2. **Baseline behavior: skill or preamble.** `agenta-getting-started` overlaps the always-on
   AGENTS.md preamble (section 3.1). Keep it as a separate build skill, or fold its content into
   the preamble so baseline behavior applies to every run, not only build-time runs? Lean: fold
   into the preamble, and drop the separate behavior skill, once we confirm nothing else depends
   on the slug.

3. **Does the kit inject the full build set.** `default-agent-config` describes the kit as
   carrying one authoring skill; this design needs all of the build skills present so the
   orchestrator can reference the focused ones (section 4). Confirm the kit's `skills` group
   carries the set.

4. **Single-sourcing the getting-started body.** The body lives twice today: the SDK constant
   (canonical, served at run time) and a SKILL.md file (stale, never loaded). Generate the file
   from the constant, assert the file against the constant in a test, or drop the file. Lean: drop
   the on-disk copies and keep the constant as the only source.
