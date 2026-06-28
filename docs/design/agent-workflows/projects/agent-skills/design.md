# Design: agent skills for the build-an-app use case

Status: draft for Mahmoud's review. Grounded in code on `gitbutler/edit` over `big-agents`,
2026-06-28. Paths are absolute. See the sibling projects for the parts this one depends on
(`default-agent-config`, `agent-builder-capabilities`, `agent-fe-roundtrip`, `tool-discovery`).

## Problem and goal

A new Agenta agent should arrive able to help. The user chats with it and builds their first
app: the agent finds the tools the app needs, connects the integrations, sets a trigger or a
cron job, edits its own instructions, and commits itself. Tools do the actions. Skills teach the
agent which tools to use and in what order. This project owns the skills: which ones we need,
what each teaches, and how they are named.

We do not have the real skill content yet. We know what each skill should do. So this design
sets the skill set, the naming, and the contracts, and writes placeholder bodies that capture
the build flow. It does not over-build. The placeholders ship as the starting content; the real
prose lands later.

## Scope and ownership

This project owns the skill **content** and the skill **naming**. Three things it does not own,
and only references:

- Which skill is embedded by default, and the embed-by-default mechanism. Owned by
  `default-agent-config`.
- The build-flow tools the skills name (`find_capabilities`, `commit_revision`,
  `create_schedule`, `create_subscription`, and the rest). Owned by
  `agent-builder-capabilities`. Most do not exist yet.
- The connection round-trip (the agent asks the frontend for a connection, the user finishes
  OAuth, the run resumes). Owned by `agent-fe-roundtrip`.

## 1. Audit: what exists today

### `agenta-getting-started` (placeholder, shipped)

This is the one platform skill that exists. It lives in two places, and they have drifted.

- The canonical content is an SDK constant, `GETTING_STARTED_WITH_AGENTA_SKILL`, in
  `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:93`.
  Its body is `_GETTING_STARTED_BODY` in the same file. The static catalog imports this constant
  and serves it under the reserved slug `__ag__getting_started_with_agenta`
  (`/home/mahmoud/code/agenta/api/oss/src/core/workflows/static_catalog.py:82`). The
  `pi_agenta` harness force-injects the same constant. So the SDK constant is the single source
  the running agent actually sees.
- A second copy is a file at
  `/home/mahmoud/code/agenta/services/agent/skills/agenta-getting-started/SKILL.md`. Its text is
  different from the constant. It is not loaded at runtime: the runner composes each SKILL.md
  from the wire skill (name, description, body) and writes it into the sandbox
  (`/home/mahmoud/code/agenta/services/agent/src/engines/skills.ts:148`). It never reads this
  directory from disk.

So the file is an authoring artifact that drifts from the constant the agent reads. Finding:
single-source the body. The `services/agent/skills/<name>/` layout is still the right home for a
human-readable copy, but only if it is generated from, or asserted against, the SDK constant.
Decision needed (open question 5).

The current content of both copies is generic "be concise, prefer your tools, read SKILL.md
before acting." That is fine as a placeholder. It is not the build-flow content.

### `discover-and-wire-tools` (draft, not yet a platform skill)

Lives at
`/home/mahmoud/code/agenta/docs/design/agent-workflows/projects/tool-discovery/skills/discover-and-wire-tools/SKILL.md`.
Written and verified on 2026-06-27. It teaches the discover, resolve-connections, create, test
loop around `find_capabilities`. It is well written and mostly current. It speaks the in-agent
voice (it names `find_capabilities` as a tool the agent calls). Its only naming debt is step 4,
where it composes results into `agent_config.tools` and `agents_md`. Those keys changed (see
section 2).

### `create-agenta-agent` (draft, not yet a platform skill)

Lives at
`/home/mahmoud/code/agenta/docs/design/agent-workflows/projects/agent-creation-skills/skills/create-agenta-agent/SKILL.md`.
It teaches an external caller to build an agent over the HTTP API with curl: create the
workflow, create a variant, commit a revision, invoke. It is verified against a live stack. It
carries heavy naming debt: it uses the old flat config shape throughout (`agents_md`, `model`,
`harness: "pi_core"`, `sandbox: "local"`, `permission_policy`, `mcp_servers`, the type name
`agent_config`). All of it predates JP's rename.

This skill has a different audience from the build skills. See section 3.

### `self-host-agenta` (draft, out of scope)

Lives next to `create-agenta-agent`. It teaches a person to self-host Agenta with and without
the Claude subscription sidecar. It is an external operator skill, not part of the build-an-app
flow. Noted so the set is complete. This project does not touch it.

## 2. The naming update (JP's rename)

JP moved the agent config from a flat blob to a nested template. The catalog type-ref changed
from `agent_config` to `agent-template`. The whole template still sits at `parameters.agent`.
Verified in code: `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/dtos.py:1015`
(`_template`) and `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/utils/types.py:1399`
(`build_agent_v0_default`).

The map, old key on the left, current key on the right:

| Old (drafts use this) | Current | Source |
|---|---|---|
| type-ref `agent_config` | type-ref `agent-template` | `dtos.py:1018` |
| `agents_md` (flat) | `instructions.agents_md` | `dtos.py:1172`, `types.py:1417` |
| `model` (flat) | `llm.model` (or the `llm` block) | `dtos.py:1184`, `types.py:1418` |
| `model.params` (the ModelRef knobs bag) | `llm.extras` | `dtos.py:1147`, `connections/models.py:125` |
| `harness` (flat string) | `harness.kind` | `dtos.py:1097` |
| `sandbox` (flat string) | `sandbox.kind` | `dtos.py:1098` |
| `permission_policy` (flat) | `runner.interactions.headless` | `dtos.py:1099`, `types.py:1442` |
| `mcp_servers` | `mcps` | `dtos.py:1046` |
| `tools` | `tools` (unchanged, flat on the template) | `dtos.py:1189` |
| `skills` | `skills` (unchanged, flat on the template) | `dtos.py:1061` |
| env `AGENTA_AGENT_CONFIG_DIR` | env `AGENTA_AGENT_TEMPLATE_DIR` | `services/oss/src/agent/config.py:54` |

The harness kind values are unchanged: `pi_core`, `pi_agenta`, `claude`
(`dtos.py:49`). The runner block is new: `runner.kind = "sidecar"` and
`runner.interactions.headless` is `"auto"` or `"deny"`.

A correct commit body in the current shape:

```jsonc
{
  "workflow_revision": {
    "message": "initial agent config",
    "slug": "rev-001",
    "workflow_variant_id": "<variant_id>",
    "data": {
      "uri": "agenta:builtin:agent:v0",
      "parameters": {
        "agent": {
          "instructions": { "agents_md": "You are a helpful research assistant." },
          "llm": { "model": "openai/gpt-4o-mini" },
          "tools": [],
          "mcps": [],
          "harness": { "kind": "pi_core" },
          "runner": { "kind": "sidecar", "interactions": { "headless": "auto" } },
          "sandbox": { "kind": "local" }
        }
      }
    }
  }
}
```

A model pinned to a named vault connection rides the `llm` block, not a flat `model` object:

```jsonc
"llm": {
  "model": "claude-opus-4-8",
  "provider": "anthropic",
  "connection": { "mode": "agenta", "slug": "anthropic-prod" }
}
```

Which skills carry naming debt:

- `agenta-getting-started`: none. It has no config examples.
- `discover-and-wire-tools`: light. Only the step-4 composition (`agent_config.tools` →
  `tools` on the template; `agents_md` → `instructions.agents_md`).
- `create-agenta-agent`: heavy. Every config example and the schema table. Full overhaul.
- The two new skills (`build-your-first-app`, `set-up-triggers`): written fresh in the current
  shape, so no debt.

## 3. Two audiences, one word "skill"

The word "skill" hides a fork that decides which skills get embedded.

- **In-agent platform skills.** The running agent reads these mid-task. They name the agent's
  **platform tools** (`find_capabilities`, `commit_revision`, `create_schedule`). They never
  contain curl. They assume the tools are present, because the default config ships the tools and
  the skills together.
- **External developer skills.** A person, or a harness building agents from outside, reads
  these. They use the HTTP API with curl. `create-agenta-agent` and `self-host-agenta` are this
  kind.

The build-an-app use case is the first audience. The user chats with a running agent that builds
its first app by calling its own tools. So the embedded set is the in-agent skills. This is now
**decided (Reading A): the agent becomes the app.** The consequence for `create-agenta-agent`:
it is an external developer skill, so it is not embedded. It still gets a naming fix so it stays
accurate, and it stays where external skills live (the repo's `.agents/skills/`, per the
agent-creation-skills README). The builder doc locks the same call (self-modification only). If
we ever want the agent to build a **separate** app (Reading B in `agent-builder-capabilities`
section 1), the right home is a section in `build-your-first-app` that drives the
`create_workflow` / `create_variant` / `commit_workflow_revision` tools, not a curl skill. That
is a later question, out of scope for this round.

## 4. The skill set (placeholders)

The embedded build set is four in-agent platform skills. Each is a `SkillTemplate` constant
served read-only under a reserved `__ag__*` slug. The placeholder bodies below are design
artifacts: the outline of what each skill teaches and which tools it drives, in order. They are
the starting content, not the final prose.

A standing caveat for 4.1 and 4.2: the tools these skills name are MISSING until
`agent-builder-capabilities` ships them. The skill content is ready; it goes live when the tools
do.

### 4.0 `agenta-getting-started` — the baseline (embedded default, exists)

Slug `__ag__getting_started_with_agenta`. Already embedded by the default config and served by
the static catalog. Keep it. It sets behavior, not the build flow: be concise, ask for missing
inputs, prefer the provided tools and skills, read a matching skill fully before acting. The
placeholder content it has today is acceptable. The only work here is single-sourcing the body
(section 1) and confirming it stays the embedded default (it does; `default-agent-config` owns
that).

### 4.1 `build-your-first-app` — the orchestrator (new)

Slug `__ag__build_your_first_app`. The top-level skill. It names the order of steps and the stop
points, and it points at the focused skills rather than restating them.

```markdown
---
name: build-your-first-app
description: Guide the user through building their first Agenta app end to end. Use at the
  start of a build conversation to plan the work, find and wire tools, set a trigger, and
  commit. This skill is the map; read the focused skill for each step.
---

# Build your first app

You are helping the user turn a plain-language goal into a working app. This skill is the map.
It names the order and the points where you stop for the user. Read the focused skill for a step
before you act on it.

## When to use

Use this when the user asks you to build, set up, or automate something, and the app does not
exist yet.

## The flow

1. Clarify the goal. Ask what the app should do, what should start it (a message, a schedule, an
   outside event), and what tools or data it needs. Do not guess.
2. See what exists. Call `query_workflows` to check the project for an app you can reuse.
3. Find the tools. Follow the `discover-and-wire-tools` skill. It calls `find_capabilities` and
   reports which integrations need a connection.
4. Connect the integrations. Hand the user the connection link, wait for them to finish, then
   re-check. You never connect on their behalf.
5. Configure the app. Edit your own instructions and attach the tools, then commit with
   `commit_revision`. This stops for the user's approval.
6. Set the trigger. Follow the `set-up-triggers` skill for a cron job or an event trigger. Each
   one stops for the user's approval.
7. Test. Fire a test or run once, then confirm the result with the user.
8. Report. Tell the user what you built, what is connected, and what is now scheduled.

## Stop points

You pause for the user at every connection, every commit, every schedule, and every
subscription. These are approval gates by design. Say what you are about to do, then wait.
```

### 4.2 `set-up-triggers` — cron and event triggers (new)

Slug `__ag__set_up_triggers`. The focused skill for steps 6 to 7 above. It turns the trigger
footguns (timezone, cron syntax, the connection prerequisite, the inputs mapping) into a
checklist.

```markdown
---
name: set-up-triggers
description: Set up a cron job (a schedule) or an event trigger (a subscription) for an app.
  Use when the user wants the app to run on a timer or react to an outside event.
---

# Set up triggers

A trigger makes an app run on its own. There are two kinds. A schedule runs on a clock. A
subscription runs when an outside event arrives.

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

1. Find the event. Browse the trigger catalog by integration, then by event. There may be no
   semantic event search yet, so browse by keyword.
2. Make sure the connection exists. A subscription needs a connected integration. If it is
   missing, run the connection flow first.
3. Map the event into the run inputs.
4. Create it with `create_subscription`. This stops for the user's approval.

## Confirm it works

Fire a test delivery with `test_subscription`, then read the delivery log. Tell the user whether
it fired and what it produced.

## Footguns

- Cron is UTC. Always convert from the user's timezone.
- A subscription with no connection never fires. Connect first.
- The inputs must match what the app expects, or the run starts empty.
```

### 4.3 `discover-and-wire-tools` — promote and adapt (draft exists)

Slug `__ag__discover_and_wire_tools`. Promote the existing draft to a platform skill. The body
is mostly current. Two edits:

- Step 4 ("Create the agent") composes results into `agent_config.tools` and `agents_md`. Change
  to the current template: put each chosen tool into `tools` on the agent template, and compose
  the guidance into `instructions.agents_md`.
- It pairs with `create-agenta-agent` for the create-and-run step. In the embedded set the create
  step is `commit_revision` on the agent itself, not the curl skill. Re-point the "then create
  and test" line at the `build-your-first-app` configure step (`commit_revision`), so the
  embedded skill stays in the in-agent voice.

Everything else (the discover, read-the-response, resolve-connections loop, the triggers-are-out-
of-scope note, the good-habits list) carries over unchanged.

### 4.4 `create-agenta-agent` — external developer skill (draft exists; not embedded)

Not in the embedded set (section 3). Keep it as an external developer skill. Two pieces of work,
both independent of embedding:

- Naming overhaul. Rewrite every config example to the current template shape (section 2): the
  `instructions` / `llm` / `tools` / `mcps` / `skills` template with nested `harness` / `runner`
  / `sandbox`, the `agent-template` type name, and `runner.interactions.headless`. The
  reference.md schema table needs the same pass.
- Audience label. State at the top that it is for building an agent from outside over HTTP, and
  that an agent building itself uses its platform tools (`commit_revision`, `find_capabilities`),
  not these calls.

Reading A is decided, so do not embed this curl skill. If we ever build the separate-app case
(Reading B) later, add a "build a separate app" section to `build-your-first-app` that drives the
`create_workflow` / `create_variant` / `commit_workflow_revision` tools.

## 5. The contracts (design-interfaces)

Three things here are contracts: the slug, the embed shape, and how a skill declares its tools.
Run the role analysis on each.

### Slug versus name

- The **slug** is a routing key: a stable identifier into the static catalog, platform-owned and
  immutable. Ids derive from it (`static_catalog.py:92`), so it must never change once shipped.
- The **name** (the frontmatter `name`) is metadata: a human label the playground shows.

They play different roles, so they are different fields. They do not have to match, and today
they do not: name `agenta-getting-started`, slug `__ag__getting_started_with_agenta`. That is a
pre-existing mismatch. Do not change the live slug to fix it; the ids derive from it.

For the new slugs, adopt one predictable rule: `__ag__` plus the name with hyphens turned into
underscores. So name `build-your-first-app` gives slug `__ag__build_your_first_app`, and
`set-up-triggers` gives `__ag__set_up_triggers`. A reader who knows the name can predict the slug.
The `__ag__` prefix is the reserved namespace a user cannot author or shadow
(`api/oss/src/core/workflows/types.py:41`); it is what makes the skill trusted.

### The embed shape

A default config carries a skill by reference, not by value. The reference is the existing
`@ag.embed`, which the backend inlines before the runner sees it. The shape, from
`build_agent_v0_default` (`types.py:1424`):

```jsonc
{
  "@ag.embed": {
    "@ag.references": { "workflow": { "slug": "__ag__build_your_first_app" } },
    "@ag.selector": { "path": "parameters.skill" }
  }
}
```

Role analysis: `@ag.references.workflow.slug` is routing (which static workflow), `@ag.selector.path`
is routing (where the value sits inside that workflow's parameters). No new field. Reuse this
shape for every embedded skill. Reference the skill at the artifact level (the bare slug, latest
version), not a revision slug; a revision slug is a hash and 500s (`types.py:1427`).

### How a skill declares which tools it teaches

Today a `SkillTemplate` is `name`, `description`, `body`, `files`
(`sdks/python/agenta/sdk/agents/skills/models.py`). It does not declare the tools it teaches. The
body names them in prose, and the default config ships the matching tools alongside.

Two options:

- **Prose only (recommended).** The skill body names its tools. No contract change. This works
  because the default config guarantees the tools and the skills arrive together
  (`default-agent-config`). The skill assumes co-presence.
- **Structured declaration (deferred).** Add a field to `SkillTemplate`, say
  `requires_tools: [platform-op names]`, so the system can verify or auto-include the tools a
  skill needs. This is a new contract surface and a new coupling between the skill catalog and the
  platform-op catalog.

Recommend prose only now. The structured field earns its place when a user can add or remove
tools and skills independently and we need to enforce "this skill needs that tool." That second
case does not exist yet. Adding the field before it does is the over-abstraction the
design-interfaces rule warns against. Note it as a deferred option.

One more contract note: a skill is content and metadata addressed by a slug. It carries no
executable behavior and grants no tools. That separation is deliberate. Tools are policy and
capability; skills are guidance. Keep them apart.

## 6. Embed and force decision (confirm)

This restates the decision `default-agent-config` owns, because the skill content depends on it.

- Skills reach the agent through `@ag.embed` in the default config. Present by default. Removable.
- Stop force-injecting `agenta-getting-started` through the `pi_agenta` harness. Set
  `AGENTA_FORCED_SKILLS = []` in
  `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:104`.
- Keep the machinery: `force_skills`, the slug constant `GETTING_STARTED_WITH_AGENTA_SLUG`, the
  skill constant `GETTING_STARTED_WITH_AGENTA_SKILL`, and the static catalog. We will force a
  skill again when one carries real functionality the author must not be able to drop. Forcing is
  for capability, not for the getting-started placeholder.

So the getting-started skill becomes a normal embedded default the user can remove, and forcing
stays a tool we keep in reserve.

## 7. The split: us versus Arda (frontend)

**Us (backend, SDK, runner):**

- Author the two new skills (`build-your-first-app`, `set-up-triggers`) as `SkillTemplate`
  constants near `agenta_builtins.py`, register them in the static catalog under their reserved
  slugs, and lay a single-sourced SKILL.md copy under `services/agent/skills/<name>/`.
- Promote `discover-and-wire-tools` to a platform skill with the section-4.3 edits.
- Fix the naming on `create-agenta-agent` (external skill, not embedded).
- Single-source the getting-started body (open question 5).
- Set `AGENTA_FORCED_SKILLS = []` (section 6).

**Arda (frontend):**

- The skill control renders embedded skills: content read-only (it is Agenta's skill), the embed
  removable. This is `default-agent-config`'s frontend item; the skills only depend on it.
- The connection round-trip the build skills reference (surface the OAuth link, pause, resume) is
  `agent-fe-roundtrip`. The skills consume it; they do not design it.

## 8. Open questions for Mahmoud

1. **Self-modify or separate app? DECIDED (Reading A).** The agent becomes the app: it edits
   itself. The embedded set is the four in-agent skills, and `create-agenta-agent` stays an
   external developer skill that is not embedded. The builder doc locks the same call
   (self-modification only). A future separate-app case (Reading B) would be a section in
   `build-your-first-app` over the `create_workflow` tools, not the embedded curl skill; that is
   out of scope for this round. (Mirrors `agent-builder-capabilities` decision 1.)

2. **The skill set.** I propose four embedded skills: `agenta-getting-started`,
   `build-your-first-app`, `set-up-triggers`, `discover-and-wire-tools`. Is that the set, or do
   you want `set-up-triggers` folded into `build-your-first-app` to keep the count down at the
   start?

3. **Slug rule.** Adopt `__ag__` plus name-with-underscores for new slugs
   (`__ag__build_your_first_app`), leaving the live getting-started slug as-is. Agreed?

4. **Tool declaration.** Prose-only now (the skill body names its tools, the default config ships
   them together), structured `requires_tools` deferred until tools and skills can be added
   independently. Agreed?

5. **Single-sourcing the body.** The getting-started body lives twice (SDK constant, served at
   runtime; SKILL.md file, not loaded). Make the file generated from or asserted against the
   constant, or drop the file. Which way?
