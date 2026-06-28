# Agent builder capabilities: tools and skills the build flow still needs

A new agent on Agenta ships with skills and platform tools. The goal is that a user can chat
with that agent and have it turn itself into a real application: wire the tools it needs,
connect the integrations, edit its own instructions, set up a trigger or a cron job, and
commit the result. This doc asks one question. What tools and skills are still missing for
that to work, and what should each missing piece look like?

Grounded in code on branch `gitbutler/edit` over `big-agents`, 2026-06-28. Paths are absolute.

## Decisions locked in round 2

Mahmoud answered the four open questions. They are settled, and the design below assumes them:

1. **Self-modification only.** The agent becomes the app. It does not create other workflows.
   No `create_workflow`, `create_variant`, or commit-to-another-variant tools now. The agent
   that builds *other* agents is a separate future agent, out of scope here.
2. **Triggers self-target.** A schedule or subscription points at the agent itself, with the
   destination bound server-side from run context the way `commit_revision` binds the variant
   id. The model never supplies a destination.
3. **`find_triggers` with keyword search.** Build a small new backend that keyword-searches the
   trigger event catalog and returns `find_capabilities`-shaped results. Not semantic. If the
   event set turns out tiny, a hardcoded skill that enumerates events is an acceptable simpler
   path; start with `find_triggers`.
4. **The agent cannot create a connection or set a secret.** When a connection is missing, the
   agent asks the frontend through the general client-tool round-trip (owned by the FE
   round-trip design); when the frontend finishes, it tells the agent, which continues. Secrets
   stay frontend-only. This doc references that mechanism and does not design it.

A constraint that shapes every proposal: the team already decided (in
`projects/agent-creation-skills/`, where a bespoke "create_workflow with logic" design was
superseded on 2026-06-27) that platform tools are **thin wrappers over existing endpoints, with
no new logic**, and that a **skill** composes the multi-step flow. Every tool below is one HTTP
call to one endpoint that already ships. The one exception is `find_triggers`, which Mahmoud
asked for as new backend; the doc says so plainly.

## These tools all ship in a new agent's default config

A consequence worth stating up front. The default-agent-config project freezes every platform op
in the catalog into a new agent's default config at build time. So once the tools below land, a
new agent ships with all of them: the three core ops (`find_capabilities`, `query_workflows`,
`commit_revision`) plus the eight trigger and cron ops here. Several are approval-gated
(`create_schedule`, `create_subscription`, `test_subscription`), and they all arrive with their
catalog default permissions, which the user can edit. This is intended. The build flow needs it,
because there is no picker to add a platform tool back: a tool that is not in the default can
never reach the agent. So adding a tool to this catalog also changes what every new agent
carries. See `../default-agent-config/design.md`.

## How to read this

- Section 1: the end-to-end walkthrough, each step mapped to a tool or skill, marked EXISTS or
  MISSING.
- Section 2: the triggers and cron reality (the backend already exists).
- Section 3: each missing tool, with the `design-interfaces` role analysis and motivations.
- Section 4: **the agent-driven trigger and subscription flow, walked end to end.** This is the
  part Mahmoud most wants explored: what the agent asks, what happens when a connection is
  missing, and whether a subscription can be tested before a connection exists.
- Section 5: the missing skills.
- Section 6: the split between us (backend, SDK, runner) and Arda (frontend).
- Section 7: the smaller questions that remain.

## 1. The end-to-end walkthrough

The agent is configuring itself. The columns: the step, the serving tool or skill, and whether
that piece exists today.

| # | Build step | Serving tool / skill | State |
|---|---|---|---|
| 0 | Understand the goal, plan the build | skill: **build-your-first-app** (orchestrator) | MISSING (skill) |
| 1 | Find the right action tools | `find_capabilities` tool | EXISTS |
| 2 | See what already exists in the project | `query_workflows` tool | EXISTS |
| 3 | Connect an integration the tools need | FE connection round-trip (agent requests, cannot create) | MISSING (FE-owned) |
| 3b | Check whether a connection is ready | `list_connections` tool | MISSING (tool) |
| 4 | Set a provider key / secret | frontend-only, by design | OUT (FE-only) |
| 5 | Attach tools + edit own AGENTS.md + own skills | `commit_revision` tool (self-target) | EXISTS |
| 6 | Find the right event to trigger on | `find_triggers` tool (keyword) | MISSING (new backend) |
| 7 | Set up a cron job on itself | `create_schedule` tool (self-target) | MISSING (tool); backend EXISTS |
| 8 | Set up an event trigger on itself | `create_subscription` tool (self-target) | MISSING (tool); backend EXISTS |
| 9 | List / inspect its own triggers | `list_schedules` / `list_subscriptions` tools | MISSING (tool); backend EXISTS |
| 10 | Test the trigger end to end | `test_subscription` tool + `list_deliveries` | MISSING (tool); backend EXISTS |
| 11 | Commit the finished agent | `commit_revision` (self-target) | EXISTS |
| - | Teach the trigger + cron flow | skill: **set-up-triggers** | MISSING (skill) |
| - | Teach the discover-and-wire flow | skill: **discover-and-wire-tools** | DRAFT, not yet a platform skill |
| - | Teach the create/commit/invoke flow | skill: **create-agenta-agent** | DRAFT, not yet a platform skill |

The gaps cluster in three places: trigger and cron tools (backend ready, no agent-facing tools),
the connection dependency (the agent requests through the FE, never creates), and the build-flow
skills (drafts exist, none loaded as platform skills yet). Self-modification of instructions,
tools, and skills is already covered by `commit_revision`.

## 2. The triggers and cron reality

Agenta has a complete trigger subsystem already. We are not designing a scheduler. We are
exposing what ships.

What exists, in `api/oss/src/`:

- **Schedules (cron).** `core/triggers/dtos.py` defines `TriggerSchedule`; the router
  (`apis/fastapi/triggers/router.py`) exposes `POST /api/triggers/schedules/` plus list, query,
  fetch, edit, delete, start, stop. A schedule carries a five-field cron expression
  (`data.schedule`, UTC, one-minute floor, validated by `croniter`), an optional
  `[start_time, end_time)` window, an `inputs_fields` mapping template, and a
  `references`/`selector` naming the workflow to run.
- **Subscriptions (event-driven).** Same router exposes `POST /api/triggers/subscriptions/` and
  the full lifecycle. A subscription watches one provider event (Composio today), keyed by a
  `connection_id` and an `event_key`, with the same `inputs_fields` and `references`/`selector`.
  An `is_test` flag puts it in capture-and-skip mode: events are recorded as test deliveries
  with full context, and the workflow is never invoked.
- **Test (one-shot).** `POST /api/triggers/subscriptions/test` creates a temporary test
  subscription, long-polls for the first captured provider event, records it as a delivery, then
  tears the temporary subscription down (`core/triggers/service.py`, `test_subscription`). It
  needs a working connection, because it waits for a real event from the provider.
- **Catalog.** `GET /api/triggers/catalog/providers/.../integrations/.../events/` browses the
  events you can subscribe to. The leaf is an *event*, the trigger analogue of a tools *action*;
  the event detail carries a `trigger_config` JSON Schema and an optional sample `payload`.
- **Deliveries.** `GET /api/triggers/deliveries` and `/query` are the audit log: one row per
  fire, with inputs, result, error, and a test marker. This is how the agent confirms a trigger
  fired and reads a captured sample event.
- **The machinery.** A per-minute cron tick (`crons/triggers.sh`) POSTs an admin
  `schedules/refresh`; due schedules are enqueued onto Taskiq + Redis Streams; a worker
  (`entrypoints/worker_triggers.py`) dispatches each to the bound workflow. The agent never
  touches any of this. It only writes the schedule or subscription row.

What does not exist: any agent-facing tool over these endpoints, and any search over events. The
gap is the tool layer and the discovery story, not the engine.

How a trigger binds to the agent (decision 2): the destination is `data.references` plus
`data.selector`. For self-targeting, the runner binds those to the running agent's own workflow
from run context, stripped from the model-visible schema, exactly as `commit_revision` binds and
strips the variant id. The model never names a destination, so it can only ever schedule or
subscribe *itself*.

## 3. The missing tools

Each tool is a platform-op catalog entry in
`sdks/python/agenta/sdk/agents/platform/op_catalog.py`: a thin wrapper over one existing
endpoint. The catalog owns the model-facing description, the method and path, the curated input
schema, the run-context bindings, and the default permission and approval. Adding one is a data
change to that catalog. `find_triggers` (3.4) is the lone exception that needs new backend.

The `design-interfaces` rule applied throughout: classify each field by the role it plays (data,
config, policy, credentials, routing, context, metadata), bind context server-side rather than
trusting the model, and gate dangerous behavior behind approval rather than a blanket allow.

### 3.1 `create_schedule` — set up a cron job on itself (backend exists)

One call to `POST /api/triggers/schedules/`; the model's arguments land at `args_into:
"schedule"`. The destination is bound, not supplied.

| Field | Role | Owner | Notes |
|---|---|---|---|
| `name` | metadata | model | A human label for the schedule. |
| `data.schedule` | config (period) | model | Five-field cron, UTC. The skill teaches the syntax. |
| `data.start_time` / `data.end_time` | config (window) | model | Optional `[start, end)` bounds. |
| `data.inputs_fields` | data (mapping) | model | Template that fills the run's inputs. |
| `data.event_key` | metadata | model | A label for the fire; reused on deliveries. |
| `data.references` + `data.selector` | routing (destination) | **context-bound** | The running agent's own workflow, from `$ctx`. Stripped from the model schema. |

Default permission and approval: **`ask`, approval required.** This is the load-bearing safety
call. A schedule makes the agent run on its own, unattended, possibly costing money or taking
real-world actions. That is exactly the dangerous behavior `design-interfaces` says to gate
behind an explicit allow, never a default-on. It mirrors `commit_revision`.

The destination binding needs one implementation check: confirm the runner can express
`data.references` as a `$ctx` binding to the running workflow (the key name and the dotted path
the trigger's `/retrieve` resolver expects). `commit_revision` already binds
`workflow_revision.workflow_variant_id` to `$ctx.workflow.variant.id`, so the mechanism exists;
the exact reference key for triggers is the thing to verify.

### 3.2 `create_subscription` — trigger itself on an external event (backend exists)

One call to `POST /api/triggers/subscriptions/`, `args_into: "subscription"`. Same shape as a
schedule, plus the connection.

| Field | Role | Owner | Notes |
|---|---|---|---|
| `name` | metadata | model | Label. |
| `connection_id` | routing / credentials | model, **value from the FE round-trip** | Identifies and authenticates the event source. The agent never creates it (decision 4); it passes the id it learned from the connection round-trip or from `list_connections`. |
| `data.event_key` | config | model | The provider event to watch, from `find_triggers`. |
| `data.trigger_config` | config | model | The event's parameters, shaped by the event's `trigger_config` schema. |
| `data.inputs_fields` | data (mapping) | model | Fills the run's inputs from event context. |
| `data.references` + `data.selector` | routing (destination) | **context-bound** | Self, same as 3.1. |

Default permission and approval: **`ask`, approval required.** Same motivation as 3.1, stronger
if anything, because the trigger fires on the provider's schedule, not the user's.

The connection dependency is the crux of section 4. The agent holds only a *reference* to a
connection (an id or slug); it never holds the secret and never creates the connection.

### 3.3 The read and test tools

Thin reads, default permission **`allow`, no approval**, matching `find_capabilities` and
`query_workflows`. The agent needs to see its own triggers before adding more, and to read the
delivery log to confirm a fire.

- `list_schedules` — `GET /api/triggers/schedules/`.
- `list_subscriptions` — `GET /api/triggers/subscriptions/`.
- `list_deliveries` — `GET /api/triggers/deliveries` (and `/query` for filters). The agent reads
  a captured sample event here.
- `list_connections` — `POST /api/tools/connections/query`. The agent checks whether a
  connection is `ready` before it tries to subscribe.

`test_subscription` — `POST /api/triggers/subscriptions/test`. This one *does* something
(creates a temporary test subscription and long-polls for a real event), but it invokes no
workflow and leaves nothing behind. Default **`ask`** is the conservative choice, since it
opens a real watch on the provider and blocks for up to a minute; `allow` is defensible because
it is non-destructive. Lean `ask`. It requires a `connection_id`, so it cannot run before a
connection exists (see section 4).

### 3.4 `find_triggers` — keyword event discovery (new backend, decision 3)

`find_capabilities` searches *actions* and returns ready-to-attach tool configs with connection
state. There is no equivalent for *events*. Mahmoud chose to build a small one.

- Endpoint: a new `POST /api/triggers/discover`, mirroring `POST /api/tools/discover`.
- Search: **keyword**, not semantic, over the trigger event catalog.
- Input roles: `use_cases` (data, the keyword fragments, e.g. "new github issue"), `provider`
  (config, default `composio`), `limit_alternatives` (config). Identical in shape to
  `find_capabilities`.
- Output, `find_capabilities`-shaped per use case: the best-match event (its `event_key`,
  integration, `trigger_config` schema, and sample `payload` if the catalog has one), the
  connection state for that integration (`ready` / `needs_auth` / `needs_input`), alternatives,
  and guidance. The connection state is what lets the agent decide whether to route to the FE
  connection round-trip.
- Platform tool: a thin wrapper over the new endpoint, default **`allow`** (read).

Motivation for keyword over semantic: the event set is small, so keyword matching is enough and
far cheaper to build than the semantic engine `find_capabilities` leans on. The simpler fallback
Mahmoud named (a hardcoded skill that just lists the common events) stays in reserve if even the
keyword endpoint proves to be more than the small set warrants. Start with `find_triggers`.

## 4. The agent-driven trigger flow, end to end

This is the section Mahmoud most wants. Take a concrete ask: *"Run yourself every time a new
GitHub issue is opened in `acme/app`, and triage it."* The agent is configuring itself. Walk it.

### 4.1 The flow, step by step

1. **Clarify intent.** The agent asks what it needs to pin the event: which provider and event
   ("a new issue is opened"), the scope ("which repo"), and what to do on each fire ("triage:
   label it and post a summary"). Plain conversation, no tools yet.

2. **Discover the event.** The agent calls `find_triggers(["new github issue opened"])`. It gets
   back the `event_key`, the `trigger_config` schema (so it knows it must supply the repo), a
   sample `payload` if available, and the **connection state** for GitHub.

3. **Branch on connection state.** This is the fork that decides everything after.
   - **Connection ready.** Continue to step 4.
   - **Connection missing (`needs_auth` or `needs_input`).** The agent cannot create it
     (decision 4). It emits a connection-request through the general client-tool round-trip: "I
     need access to your GitHub to watch for new issues. I'll ask the app to connect it." The run
     **pauses**. The user connects GitHub in the frontend (OAuth, or a key for `needs_input`).
     The frontend signals the agent that the connection is ready and hands back its id or slug.
     The agent resumes at step 4. This pause/resume is the FE round-trip design's mechanism; we
     only consume it.

4. **Build and confirm the input mapping.** The agent must translate a GitHub-issue event into
   its own input message. It needs a *sample event* to show the user what that looks like. Two
   sources, and they differ in whether a connection is required (see 4.2):
   - the sample `payload` from the catalog (no connection needed), or
   - a real captured event via the test path (needs the connection).
   The agent shows the user the mapping in plain terms: "When an issue opens, I receive its
   title, body, and labels. I'll treat the issue as my task, like this." The user adjusts; the
   agent settles `inputs_fields`.

5. **Test before going live.** Two modes, depending on what the user wants to prove (4.3):
   - **Dry test** runs the agent once against a sample event, in the chat, so the user sees the
     response. No live event, and if the sample comes from the catalog payload, no connection.
   - **Live test** calls `test_subscription`, which watches the provider for a real event. The
     user opens a throwaway issue; the agent reads the captured delivery and shows how it mapped
     and would respond. This proves the real wiring, and it needs the connection.

6. **Go live.** The agent calls `create_subscription`: self-targeted (bound to its own workflow),
   `is_test` off, watching `event_key` on the connection, with the confirmed `inputs_fields`.
   This is **approval-gated**: "From now on I'll run automatically on every new issue in
   `acme/app`. Approve?" On approval the subscription is created and active.

7. **Confirm and hand off.** The agent reports what is now live (`list_subscriptions`) and tells
   the user where to manage it. The frontend shows the standing subscriptions and their delivery
   history (a product surface Arda owns).

A cron job (`create_schedule`) is the same flow without steps 2 and 3: no event, no connection.
The only test available is a dry run of the agent itself, which runs into the test gap (4.4).

### 4.2 Can a subscription be tested before a connection exists?

Short answer: **a live test cannot; a dry test can.**

- **Live test needs a connection.** `test_subscription` long-polls the provider for a real
  captured event. With no connection there is no event source and nothing to capture. So the
  connection round-trip (step 3) is a hard gate before any live test or any go-live.
- **Dry test can skip the connection** *if* there is a sample event to run against. The catalog
  event detail can carry a sample `payload`; when it does, the agent can map that sample and run
  itself on it with no connection at all. When the catalog has no sample, the agent can fabricate
  a representative payload from the `trigger_config` schema and say so.

This split is worth making explicit in the skill, because it changes the order of operations.
The agent can validate "do I handle this event shape sensibly?" early and offline (dry test),
and defer "is the live wiring correct?" until after the connection exists (live test). It keeps
the human round-trip off the critical path until the user has already seen the agent behave.

### 4.3 The manual UI idea, translated to the agent

The current manual idea is: "test connection" creates a (test) subscription; the user then picks
a captured sample event, builds a message from it, and adds it to the chat to test, in a new or
the same session. Two ways the agent can express that:

- **Option A, capture-then-promote (closest to the manual flow).** The agent creates an
  `is_test` subscription (or runs `test_subscription`), waits for a real event, captures it as a
  delivery, builds the message from the captured event, dry-runs itself, then on approval
  promotes to a live subscription. Motivation: it mirrors what users already do, and it tests
  against a real provider payload. Cost: it needs the connection up front, so the round-trip
  lands before the user has seen anything work, and it leans on real events arriving.
- **Option B, sample-first (offline first).** The agent uses the catalog sample payload to build
  and dry-test the mapping with no connection, shows the user the behavior, and only then asks
  for the connection and goes live (optionally with one live test at the end). Motivation: the
  user sees the agent work before being asked to authorize anything, which is a gentler first-run
  experience, and the connection round-trip moves off the critical path. Cost: the early test
  uses a sample, not a real event, so a final live test is still worth doing.

Recommendation: **Option B as the default path in the skill, Option A as the "prove it live"
follow-up.** It fits the locked decisions (the agent asks for the connection only when it must)
and gives the smoothest first build.

A second UX choice inside the test step: **same session or new session.** Running the dry test
as the next turn of the current chat needs no new machinery (the agent just continues the
conversation with the synthesized message) but mixes test output into the build conversation. A
clean new session isolates the test but needs a way to invoke the agent fresh, which is the test
gap below. Lean: same-session dry test for v1, new-session as a later nicety.

### 4.4 The test gap

Steps 5 and the cron case both want to "run the agent once to show the user." There is no clean
public endpoint for that: invocation goes through the agent sidecar
(`/services/agent/v0/invoke`) or the internal workflows service, and a platform-op path is
confined to the `/api` mount. So a *new-session* dry test and a cron dry run have no thin-wrapper
home today. Same-session dry tests dodge this (the agent simply continues the chat). Options, to
decide later: expose a public `/api` invoke wrapper (new surface), keep dry tests same-session
only, or accept that the user runs the final check in the playground. Flagging, not solving.

## 5. The missing skills

Skills are code-defined platform skills under the reserved `__ag__*` namespace, served read-only
through `StaticWorkflowCatalog` (`api/oss/src/core/workflows/static_catalog.py`), authored as
`SkillTemplate` constants next to
`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`, with the SKILL.md files under
`services/agent/skills/<name>/`. Only one exists today (`agenta-getting-started`, a placeholder).
A skill teaches the model which tools to use and in what order; it adds no behavior.

### 5.1 `build-your-first-app` — the orchestrator skill (new)

The top-level skill that drives the whole self-build. What it teaches:

1. Clarify the goal (what should the agent do, on what trigger, with what tools).
2. Discover action tools with `find_capabilities`; discover events with `find_triggers`; check
   what exists with `query_workflows` and `list_connections`.
3. When a connection is missing, request it through the FE round-trip and wait. Never try to
   create it.
4. Configure itself with `commit_revision`: instructions, tools, skills.
5. Set up the trigger or cron via the **set-up-triggers** skill, self-targeted.
6. Test (sample-first dry test, then a live test once connected) and confirm.
7. Commit and tell the user what it became and what is now scheduled or subscribed.

It names the stop points: connection requests, schedules, subscriptions, and commits all pause
for the human. Motivation: the model needs the sequence and the approval gates, and a single
orchestration skill is where that lives. It turns "build me an app" into a guided flow instead
of the model guessing the order of a dozen calls.

### 5.2 `set-up-triggers` — the trigger and cron skill (new)

The focused skill for steps 6 to 10. What it teaches:

- Schedule (cron, our own tick, no connection) versus subscription (external event, needs a
  connection).
- Cron syntax, UTC, the one-minute floor, the optional window.
- Finding an event with `find_triggers`, and reading its `trigger_config` schema.
- Mapping event or time context into the run's inputs via `inputs_fields`.
- That the destination is the agent itself and is set automatically; the model supplies no
  destination.
- The test split from section 4: dry test against a sample payload (no connection), live test
  via `test_subscription` (needs the connection), and the capture-then-promote versus
  sample-first orders.
- Confirming a fire with `list_deliveries`.

Motivation: triggers carry real footguns (timezone, cron syntax, the connection prerequisite,
the inputs mapping, the test ordering). A skill turns those into a checklist the model follows.

### 5.3 Promote the two draft skills to platform skills

Two skills already exist as drafts and should become `__ag__*` platform skills so the builder
agent carries them:

- `discover-and-wire-tools` (in `projects/tool-discovery/skills/`) — the discover,
  resolve-connections, create, test loop around `find_capabilities`. It already flags trigger use
  cases as out of its scope; with `find_triggers` and `set-up-triggers` landing, update that note
  to hand off to the trigger skill instead of dead-ending.
- `create-agenta-agent` (in `projects/agent-creation-skills/skills/`) — the create, commit,
  invoke loop and the config schema. For self-modification, the load-bearing half is the commit
  and the config schema; trim the create-a-new-workflow half to match decision 1.

Both drafts predate JP's config rename. Before they ship, update the field names: config nests
under `parameters.agent`, the type-ref is `agent-template` (not `agent_config`),
`ModelRef.params` is now `extras`, and `permission_policy` rides `runner.interactions.headless`.

## 6. The split: us versus Arda (frontend)

**Us (backend, SDK, runner):**

- Add the trigger tools to the platform-op catalog: `create_schedule`, `create_subscription`
  (both self-targeted, approval-gated), `list_schedules`, `list_subscriptions`,
  `list_deliveries`, `list_connections`, `test_subscription` (sections 3.1 to 3.3).
- Build `find_triggers`: the new `POST /api/triggers/discover` keyword endpoint plus its thin
  platform tool (3.4).
- Verify the self-target binding for triggers: that `data.references` can be bound from `$ctx`
  to the running workflow, and find the reference key the trigger `/retrieve` resolver expects.
- Author the two new skills (`build-your-first-app`, `set-up-triggers`) and promote the two draft
  skills, all as `__ag__*` platform skills, updated to the current config field names.
- Decide the test gap (4.4): same-session dry test only, or a public invoke wrapper.

**Arda (frontend):**

- The connection round-trip: the general client-tool mechanism by which the agent asks for a
  connection, the run pauses, the user connects in the UI, and the frontend resumes the agent
  with the connection reference. This is the other research subagent's design; we consume it.
- Secret entry: collect provider keys directly into the vault, never through the model.
- The config-change and action approval UI (the `projects/hitl-fix/` work): the approval prompts
  for `commit_revision`, `create_schedule`, `create_subscription`, and `test_subscription` land
  here.
- The triggers surface: where standing schedules and subscriptions, and their delivery history,
  show up in the playground so the user can see and manage what the agent set up. A product
  decision for Arda.
- The new-session test experience, if we want one (tied to the test gap, 4.4).

## 7. The smaller questions that remain

The four big questions are settled (top of this doc). What is left is finer:

1. **Test order in the skill (4.3).** Confirm sample-first (Option B) as the default, with a live
   test as the "prove it" follow-up. This is a skill-authoring choice, low risk to change later.
2. **Same-session versus new-session dry test (4.3 / 4.4).** Lean same-session for v1 to avoid a
   new invoke surface. Worth a yes from Mahmoud before we write the skill that way.
3. **`test_subscription` permission (3.3).** `ask` (it opens a real provider watch and blocks) or
   `allow` (it is non-destructive)? Lean `ask`.
4. **`find_triggers` scope (3.4).** Build the keyword endpoint now, or start with the hardcoded
   enumeration skill and add the endpoint only if the event set grows? Mahmoud said start with
   `find_triggers`; confirm we want the endpoint in this round rather than the skill-only stand-in.
5. **The test gap (4.4).** Do we want a public `/api` invoke wrapper in this round, or is
   same-session dry testing plus the playground enough for v1?
