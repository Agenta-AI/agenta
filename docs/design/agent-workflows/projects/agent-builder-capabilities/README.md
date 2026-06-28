# Design: agent builder tools (triggers, cron, and event discovery)

A new agent on Agenta should turn itself into a real application by chatting with the user. It
finds the tools it needs, connects the integrations, edits its own instructions, sets a trigger
or a cron job, and commits the result. The agent becomes the app. The user never writes config by
hand. They have a conversation.

This project owns the agent builder tools that make the trigger and cron half of that flow work,
plus the one event-discovery endpoint the flow is missing. It does not own the skills that teach
the flow (see `agent-skills`), the connection round-trip the flow depends on (see
`agent-fe-roundtrip`), or how defaults reach a new agent (see `default-agent-config`). The map for
all four is `agent-builds-an-app`.

Grounded in code on `gitbutler/edit` over `big-agents`, 2026-06-28. Paths are absolute.

## 1. The goal and the gap

The user wants the agent to run on a schedule or react to an outside event. "Triage every new
GitHub issue." "Send me a digest each morning." Today the agent cannot set that up. It can edit
its own instructions and wire action tools, but it has no way to schedule itself or subscribe
itself to an event.

The engine for triggers and cron already ships. Agenta has a full backend subsystem for event
subscriptions, cron schedules, delivery logs, a provider event catalog, and a worker that fires
the bound workflow. We do not build a scheduler. The gap is narrow and specific: there is no
agent-facing tool layer over that engine, and there is no way to search the event catalog. This
design fills both.

## 2. What already exists: the trigger and cron engine

Everything below ships today under `api/oss/src/`. The agent only ever writes one row, a schedule
or a subscription. The engine does the rest.

- **Schedules (cron).** `core/triggers/dtos.py` defines `TriggerSchedule`. The router
  (`apis/fastapi/triggers/router.py`) exposes `POST /api/triggers/schedules/` plus list, query,
  fetch, edit, delete, start, and stop. A schedule carries a five-field cron expression in
  `data.schedule` (UTC, one-minute floor, validated by `croniter`), an optional
  `[start_time, end_time)` window, an `inputs_fields` mapping template, and a
  `references`/`selector` pair naming the workflow to run.
- **Subscriptions (events).** The same router exposes `POST /api/triggers/subscriptions/` and the
  full lifecycle. A subscription watches one provider event, keyed by a top-level `connection_id`
  and a `data.event_key`, with the same `inputs_fields` and `references`/`selector`. An `is_test`
  flag puts it in capture-and-skip mode: matching events are recorded as test deliveries with full
  context, and the workflow is never invoked. Capture-and-skip needs no bound workflow.
- **One-shot test.** `POST /api/triggers/subscriptions/test` creates a temporary test
  subscription, long-polls the provider for the first real event (60-second deadline), records it
  as a delivery, then always tears the temporary subscription down
  (`core/triggers/service.py:624`). It requires a connection, because it waits for a real event
  from the provider (`_require_connection`, `service.py:380`).
- **Event catalog.** `GET /api/triggers/catalog/providers/.../integrations/.../events/` browses
  the events you can subscribe to. The leaf is an *event*, the trigger analogue of a tool *action*.
  Each event detail carries a `trigger_config` JSON Schema (the event's parameters) and an
  optional sample `payload` (`core/triggers/dtos.py:73`).
- **Deliveries.** `GET /api/triggers/deliveries` and `/query` are the audit log: one row per
  fire, recording the resolved `inputs`, the `result`, any `error`, and an `is_test` marker. This
  is how the agent confirms a fire and reads a captured sample event.
- **Connections.** A subscription's connection is a shared `gateway_connections` row. Triggers
  exposes `/api/triggers/connections/*` over the same connection service that the tools subsystem
  uses, so a connection made from either side is visible from both (`triggers/models.py:69`). The
  agent never creates one; it only reads connection state.
- **The machinery.** A per-minute external tick calls the admin endpoint
  `POST /api/admin/triggers/schedules/refresh`. Due schedules and arriving events are enqueued onto
  Taskiq and Redis Streams; a worker (`tasks/taskiq/triggers/worker.py`) dispatches each to the
  bound workflow and records the delivery. The agent touches none of this.

What is missing: any agent-facing tool over these endpoints, and any search over events. There is
no `POST /api/triggers/discover` today. The gap is the tool layer and the discovery story, not the
engine.

## 3. Decisions this design honors

These are settled across the initiative (`agent-builds-an-app`). The design assumes them.

- **The agent becomes the app.** Self-modification only. A schedule or subscription targets the
  running agent itself. No tool creates another workflow in this round.
- **Triggers self-target by context binding.** The destination is bound server-side from run
  context and stripped from the model-visible schema, the same way `commit_revision` binds the
  variant id. The model never names a destination, so it can only schedule or subscribe itself.
- **The agent cannot create connections or set secrets.** When a connection is missing, the agent
  requests one through the frontend round-trip and waits. It holds only a connection reference, never
  the secret. The round-trip is owned by `agent-fe-roundtrip`; this design consumes it.
- **Builder tools are injected, not committed.** They are platform operations, a build-time aid.
  They reach a playground run through the injected build kit and never enter the user's stored
  config (section 6). The default-config model is owned by `default-agent-config`.
- **Mutating tools default to approval.** `create_schedule`, `create_subscription`, and
  `test_subscription` each pause for the user before they act.

## 4. The tool set

Every builder tool is a `PlatformOp`: one entry in
`sdks/python/agenta/sdk/agents/platform/op_catalog.py`, one HTTP call to one endpoint that already
ships. The catalog entry owns the model-facing description, the method and path, a curated input
schema, the run-context bindings, and the default permission and approval. Adding a tool is a data
change to that catalog. `find_triggers` (4.6) is the one exception that needs new backend.

Each tool's contract is laid out by the role each field plays: **input** (the data the model
provides), **config** (how the trigger behaves), **routing** (where it points), **credentials**
(how the source authenticates), **metadata** (labels), and **policy** (what is allowed). Two role
rules run through the whole set. The destination is routing, and it is bound from context, never
trusted from the model. The connection is a credential reference, an id only, never a secret.

| Tool | Endpoint | Kind | Default permission |
|---|---|---|---|
| `find_triggers` | `POST /api/triggers/discover` (new) | read | allow |
| `create_schedule` | `POST /api/triggers/schedules/` | mutate | ask, approval |
| `create_subscription` | `POST /api/triggers/subscriptions/` | mutate | ask, approval |
| `test_subscription` | `POST /api/triggers/subscriptions/test` | probe | ask, approval |
| `list_schedules` | `GET /api/triggers/schedules/` | read | allow |
| `list_subscriptions` | `GET /api/triggers/subscriptions/` | read | allow |
| `list_deliveries` | `GET /api/triggers/deliveries` | read | allow |
| `list_connections` | `POST /api/triggers/connections/query` | read | allow |

### 4.1 `create_schedule`: run myself on a clock

One call to `POST /api/triggers/schedules/`. The model's arguments land under `args_into:
"schedule"`, matching the `{ "schedule": { ... } }` request body.

| Field | Role | Owner | Notes |
|---|---|---|---|
| `name` | metadata | model | A human label for the schedule. |
| `data.schedule` | config (cadence) | model | Five-field cron, UTC, one-minute floor. The skill teaches the syntax. |
| `data.start_time` / `data.end_time` | config (active window) | model | Optional `[start, end)` bounds. |
| `data.inputs_fields` | input (mapping) | model | Template that fills the run's inputs each fire. |
| `data.event_key` | metadata | model | A label recorded on each delivery. |
| `data.references` + `data.selector` | routing (destination) | context-bound | The running workflow, from `$ctx`. Stripped from the model schema. |

Default permission: **ask, approval required.** This is the load-bearing safety choice. A schedule
makes the agent run unattended, on its own clock, possibly costing money or taking real actions.
Approval gates exactly that. It mirrors `commit_revision`.

### 4.2 `create_subscription`: react to an outside event

One call to `POST /api/triggers/subscriptions/`, `args_into: "subscription"`. Same shape as a
schedule, plus the connection that authenticates the event source.

| Field | Role | Owner | Notes |
|---|---|---|---|
| `name` | metadata | model | A human label. |
| `connection_id` | credentials (reference) | model, value from the round-trip | Identifies and authenticates the event source. A top-level id, never a secret. The agent learns it from the connection round-trip or `list_connections`; it never creates the connection. |
| `data.event_key` | config (which event) | model | The provider event to watch, from `find_triggers`. |
| `data.trigger_config` | config (event parameters) | model | The event's parameters, shaped by the event's `trigger_config` schema (for example, the repository). |
| `data.inputs_fields` | input (mapping) | model | Fills the run's inputs from event context. |
| `data.references` + `data.selector` | routing (destination) | context-bound | Self, the same as 4.1. |

Default permission: **ask, approval required.** Stronger than a schedule if anything, because the
trigger fires on the provider's timing, not the user's. The connection branch is the crux of the
build flow (section 5).

### 4.3 The read tools

Four thin reads, default permission **allow**, matching `find_capabilities` and `query_workflows`.
The agent reads its own state before changing it and reads the log to confirm a fire.

- `list_schedules` and `list_subscriptions` show the agent what it has already set up.
- `list_deliveries` is the audit log. The agent reads a captured sample event here and confirms a
  fire produced a result.
- `list_connections` reads connection state, so the agent can check whether an integration is ready
  before it subscribes. Because triggers and tools share the same connection rows, one read covers
  both sides of the build.

### 4.4 `test_subscription`: prove the live wiring

`POST /api/triggers/subscriptions/test`. This one does something: it opens a temporary watch on the
provider and blocks for up to a minute waiting for a real event. It invokes no workflow and leaves
no row behind. It requires a `connection_id`, so it cannot run before a connection exists.

Default permission: **ask, approval required.** The tool opens a real provider watch and blocks, so
it warrants a confirm even though it is non-destructive. Treating it as a mutating tool keeps the
gate consistent with the two create tools. (Section 8 keeps `allow` as the alternative.)

### 4.5 `find_triggers`: keyword event discovery (new backend)

`find_capabilities` searches *actions* and returns ready-to-attach tool configs with connection
state. There is no equivalent for *events*. This is the one new backend piece.

- **Endpoint.** A new `POST /api/triggers/discover`, mirroring `POST /api/tools/discover`. It
  joins a keyword match over the event catalog with the shared connection state, so the agent
  learns the event and whether it can subscribe to it in one call. The catalog browse endpoints
  return neither a search nor connection state, which is why this is new code, not a thin wrapper.
- **Search.** Keyword, not semantic. The event set is small, so keyword matching is enough and far
  cheaper than the semantic engine `find_capabilities` leans on.

Input, the same shape as `find_capabilities`:

| Field | Role | Owner | Notes |
|---|---|---|---|
| `use_cases` | input (data) | model | One short fragment per event, for example "new github issue opened". |
| `provider` | config | model | Provider to search. Default `composio`. |
| `limit_alternatives` | config | model | Max alternatives per use case. Default 3. |

Output, `find_capabilities`-shaped, per use case: the best-match event (its `event_key`,
integration, `trigger_config` schema, and sample `payload` if the catalog has one), the connection
state for that integration (`ready` / `needs_auth` / `needs_input`) and how to connect it,
alternatives, and short guidance. The connection state is what lets the agent decide whether to
route the user to the connection round-trip.

Default permission: **allow.** It only reads.

## 5. The build flow, end to end

This is the heart of the design. Take a concrete request: *"Run yourself every time a new GitHub
issue is opened in `acme/app`, and triage it."* The agent is configuring itself. Here is the walk.

1. **Clarify the intent.** The agent asks what it needs to pin the event: the provider and event
   (a new issue opens), the scope (which repository), and what to do on each fire (triage: label
   it, post a summary). Plain conversation, no tools yet.
2. **Discover the event.** The agent calls `find_triggers(["new github issue opened"])`. Back come
   the `event_key`, the `trigger_config` schema (so it knows it must supply the repository), a
   sample `payload` if the catalog has one, and the connection state for GitHub.
3. **Branch on the connection.** This fork decides everything after it.
   - *Connection ready.* Continue to step 4.
   - *Connection missing* (`needs_auth` or `needs_input`). The agent cannot create it. It requests
     a connection through the frontend round-trip: "I need access to your GitHub to watch for new
     issues. I will ask the app to connect it." The run pauses. The user connects GitHub in the
     playground. The frontend resumes the agent with the connection reference. The agent continues
     at step 4. This pause and resume belongs to `agent-fe-roundtrip`; the agent only consumes it.
4. **Build the input mapping.** The agent must turn a GitHub-issue event into its own input. It
   needs a sample event to show the user the shape. The sample can come from the catalog `payload`
   (no connection needed) or from a real captured event (needs the connection). The agent explains
   the mapping in plain terms: "When an issue opens, I receive its title, body, and labels. I will
   treat the issue as my task, like this." The user adjusts, and the agent settles `inputs_fields`.
5. **Test before going live.** Two modes, covered in 5.1.
6. **Go live.** The agent calls `create_subscription`: self-targeted, `is_test` off, watching
   `event_key` on the connection, with the confirmed `inputs_fields`. This is approval-gated: "From
   now on I will run on every new issue in `acme/app`. Approve?" On approval the subscription is
   created and active.
7. **Confirm.** The agent reports what is now live with `list_subscriptions` and tells the user
   where to manage it. The playground surface that shows standing subscriptions and their delivery
   history is a product decision owned by the frontend.

### 5.1 The key finding: a dry test needs no connection, a live test does

The order of operations turns on one fact. A test can run against a real provider event or against
a sample event, and only the first needs a connection.

- **A live test needs the connection.** `test_subscription` long-polls the provider for a real
  captured event. With no connection there is no event source and nothing to capture. So a live
  test, and going live, both sit behind the connection round-trip.
- **A dry test can skip the connection.** When the catalog event carries a sample `payload`, the
  agent maps that sample and runs itself on it with no connection at all. When the catalog has no
  sample, the agent fabricates a representative payload from the `trigger_config` schema and says
  so.

This split changes the build order, so the skill should make it explicit. The agent can answer "do
I handle this event shape sensibly?" early and offline with a dry test, and defer "is the live
wiring correct?" to a live test after the connection exists.

**Recommendation: sample-first.** Build and dry-test the mapping against the catalog sample with no
connection. Show the user the agent working. Then ask for the connection and go live, with one live
test as the prove-it follow-up. The user sees the agent behave before authorizing anything, and the
human round-trip stays off the critical path until the agent has already earned it.

### 5.2 The cron variant

A cron job is the same flow without steps 2 and 3: no event to discover, no connection to branch
on. The agent clarifies the cadence, maps the inputs, and calls `create_schedule`, approval-gated.
The only test available is a dry run of the agent against synthesized inputs, which runs into the
gap below.

### 5.3 The test gap

Steps 5 and the cron case both want to "run the agent once to show the user." There is no clean
public endpoint for that today. Invocation goes through the agent sidecar or the internal workflows
service, and a platform operation is confined to the `/api` mount. So a dry run in a fresh session
has no thin-wrapper home. A same-session dry test dodges this, because the agent simply continues
the chat with the synthesized message. The options, to settle in implementation: keep dry tests
same-session only, expose a public `/api` invoke wrapper, or let the user run the final check in
the playground. Section 8 carries the recommendation.

## 6. How these tools reach the agent

The builder tools are platform operations, a build-time aid, not part of the user's shipped agent.
So they follow the inject-not-commit model that `default-agent-config` owns. The agent uses them
to build itself, but they never enter the stored config.

The mechanics are already in place. The build kit reads `PLATFORM_OPS` at call time and injects the
platform tools into the playground run, before tool resolution. Adding the builder tools to
`PLATFORM_OPS` is therefore the whole integration: the new tools join the kit with no extra wiring.
The Advanced drawer shows them as a read-only group; the user toggles the whole kit on or off but
does not edit a tool. A normal production run of the published agent never injects the kit, so it
never carries these tools. When the agent commits, the commit writes only the user's config; the
builder tools are absent by construction.

One consequence is worth stating plainly. After this project lands, a new agent's build kit will
carry around a dozen platform tools, several of them approval-gated. That is intended. The build
flow has no picker, so the agent cannot add a platform tool to itself mid-run; the tools must be
present from the start. `default-agent-config` confirms the same seam.

The per-tool approval lives on the catalog entry, not in the drawer. `create_schedule`,
`create_subscription`, and `test_subscription` each carry `default_needs_approval=True`, so they
pause for the user wherever the kit is injected.

## 7. Dependencies, ownership, and the work split

This project owns the tools. It depends on two sibling projects and shares one seam with a third.

- **The connection round-trip** (`agent-fe-roundtrip`) is the pause-connect-resume mechanism in
  step 3. Hard dependency. The connection branch of the build flow does not work without it.
- **The skills** (`agent-skills`) teach the order of these tool calls and the stop points. The
  `set-up-triggers` and `build-your-first-app` skills name the tools below and assume they are
  present. This project ships the tools; that project ships the prose.
- **The build kit** (`default-agent-config`) is the seam in section 6. This project adds ops to
  `PLATFORM_OPS`; that project injects them.

**What we build (backend, SDK):**

- Add the eight builder tools to `PLATFORM_OPS`: `create_schedule`, `create_subscription` (both
  self-targeted, approval-gated), `test_subscription`, the four reads, and `find_triggers`.
- Build the `find_triggers` backend: the new `POST /api/triggers/discover` endpoint that joins a
  keyword catalog match with shared connection state.
- Verify the self-target binding. Confirm the trigger resolver accepts a `references`/`selector`
  bound from `$ctx` to the running workflow, and find the exact reference key it expects.
  `commit_revision` already binds `workflow_revision.workflow_variant_id` to
  `$ctx.workflow.variant.id`, so the mechanism exists; the trigger reference key is the one thing to
  confirm.

**What the frontend owns (Arda):**

- The connection round-trip and connection entry (the secret never reaches the model).
- The approval prompts for the three mutating tools.
- The playground surface that shows standing schedules and subscriptions with their delivery
  history.

## 8. Open questions

The big decisions are settled (section 3). These are finer and non-blocking; each settles during
implementation. Recommendations included.

1. **Test order in the skill.** Sample-first as the default, with a live test as the prove-it
   follow-up (5.1). A skill-authoring choice, low risk to change later. Recommend sample-first.
2. **Same-session or new-session dry test.** Same-session for v1 avoids a new invoke surface
   (5.3). Recommend same-session.
3. **`test_subscription` permission.** `ask` (it opens a real provider watch and blocks) or `allow`
   (it is non-destructive)? Recommend `ask`.
4. **The test gap.** A public `/api` invoke wrapper now, or same-session dry testing plus the
   playground for v1 (5.3)? Recommend deferring the wrapper.
