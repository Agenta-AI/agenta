# Agent builds an app

Read this first. It is the map for four design docs that ship together, each in its own folder
under `docs/design/agent-workflows/projects/`. This page says what the whole thing is, what is
locked, what order it builds in, and what is still open.

## The initiative

A new Agenta agent should start useful. The moment a user creates one, the playground hands it a
**build kit**: the platform tools and the authoring skill it needs to build and improve itself.
The user then chats with the agent, and the agent turns itself into a real application. It finds
the tools it needs, connects the integrations, edits its own instructions, sets a trigger or a
cron job, and commits the result. The agent becomes the app. The user never writes config by
hand. They have a conversation.

The kit is a build aid, not part of the shipped agent. It is an **agent-template overlay** the
backend serves read-only on the simple-applications response (`GET /api/simple/applications/{id}`).
The frontend reads the overlay from that response, applies it for a playground run, excludes it on
commit, and shows it in a read-only drawer. So the platform tools and the authoring skill are
present while the user builds, and absent the moment the agent ships. This is the pivot the rest of
this page reflects: **a read-only overlay the frontend applies, never committed.** An earlier
version of this initiative baked the defaults into the committed config. Mahmoud rejected that. The
defaults are now a read-only overlay that is never persisted, and the agent service never sees it.

This initiative has shipped. The four sub-projects landed (PRs #4917, #4918, #4919, #4925/#4934),
the authoring skill and builder tools landed (#4930, #4931), and the collapsible advanced drawer
landed (#4935). The status notes below mark each piece done.

## The four sub-projects

### 1. Default agent config — [#4917](https://github.com/Agenta-AI/agenta/pull/4917)

Folder: [`../default-agent-config/`](../default-agent-config/design.md)

This project owns the build-kit overlay and now the drawer UI that renders it. The kit is an
agent-template overlay, a partial `parameters.agent` with three kinds of entry: the platform tools
(from `PLATFORM_OPS`) and the client tools as `@ag.embed` references, the authoring skill as an
`@ag.embed` reference, and the build permissions (write files, execute code). The backend serves it
read-only at `additional_context.playground_build_kit.agent_template_overlay` on the
simple-applications response (`GET /api/simple/applications/{id}` -> `SimpleApplicationResponse`).
The frontend reads it from there and applies it on a kit-on playground run (deep-merge object
fields, identity-merge list fields), then excludes it on commit. The agent service stays dumb: no run flag
and no service-side merge. The published default goes back to bare, so a production run never gets
self-commit or execute-code by accident.

### 2. The frontend round-trip — backend [#4925](https://github.com/Agenta-AI/agenta/pull/4925), frontend [#4934](https://github.com/Agenta-AI/agenta/pull/4934) (designed as #4920, Part 2, Arda)

Folder: [`../agent-fe-roundtrip/`](../agent-fe-roundtrip/design.md)

Sometimes the agent needs the human mid-run: to approve a commit of its own config, or to get a
connection it does not have. Both cases are one shape. The run pauses, the playground shows the
user something, the user acts, and the run resumes with the result. This doc designs that shape
once, as a generic client-tool round-trip, then points it at two jobs. It reuses the
human-in-the-loop approval transport that already ships, widened so any client tool can
round-trip. The first client tool is `request_connection`, a non-runnable reference tool the
overlay embeds via `@ag.embed`; the embed resolves to a `ClientToolConfig` with
`render.kind:"connect"`. On a commit, the platform `commit_revision` tool emits a one-way
`data-committed-revision` event, which the playground listens for to refresh the config panel and
the build-kit view. This project owns the client-tool primitive and the connection flow, so it is
upstream of the rest.

Known gap: the `data-committed-revision` event fires only on the create/initial commit path
(`create_workflow_revision`) and the platform-tool `/tools/call` path. The regular
`commit_workflow_revision` endpoint (`api/oss/src/apis/fastapi/workflows/router.py`) does not emit
it yet, so a normal frontend-driven commit of an existing variant does not auto-refresh. Follow-up.

### 3. Builder capabilities — [#4919](https://github.com/Agenta-AI/agenta/pull/4919)

Folder: [`../agent-builder-capabilities/`](../agent-builder-capabilities/README.md)

The trigger and cron half of the build flow needs tools. The backend subsystem for event
subscriptions, cron schedules, and delivery logs already ships. What is missing is the
agent-facing tool layer over it, plus one search endpoint. This project adds platform ops over it:
`create_schedule`, `create_subscription`, `test_subscription`, the `remove_schedule` and
`remove_subscription` undo tools with a pause and resume pair for each, four `list_*` reads, and
`find_triggers`, a keyword search over the event catalog and the one new backend piece, at
`POST /api/triggers/discover`. A schedule or subscription targets the agent itself, bound
server-side from run context the way `commit_revision` binds the variant id, so the agent never
names a destination. The mutating tools default to approval. Trigger hardening (#4931) locked the
create-trigger schemas with `additionalProperties:false` to protect the self-target guarantee.

### 4. Agent skills — [#4918](https://github.com/Agenta-AI/agenta/pull/4918)

Folder: [`../agent-skills/`](../agent-skills/design.md)

Tools do the actions. Skills teach the agent which tools to call, in what order, and where to
stop for the human. This project owns the build skill set, the naming, and the contracts. Four
skills fall out of the flow: `agenta-getting-started` (baseline behavior), `build-your-first-app`
(the orchestrator that names the steps and the stop points), `discover-and-wire-tools` (find
action tools and get them connected), and `set-up-triggers` (cron and event triggers). The
skills ride the build-kit overlay as `@ag.embed` references the frontend applies for a run, never
an `@ag.embed` in the committed config. The authoring skill lives in the code-defined static
catalog (#4930). The frontend shows each embedded skill and tool by its resolved workflow `name`,
not the raw `__ag__*` slug.

## The drawer folded into the default config

The advanced build-kit drawer is no longer a separate sub-project. Its design is folded into #4917,
which now owns both the overlay and the drawer that renders it read-only. One related cleanup, making
the advanced drawer sections collapsible, is independent of the build kit and shipped on its own as a
small drawer change (#4935): the three advanced config groups (Authentication, Execution environment,
Permissions) are collapsible accordions, collapsed by default.

## Cross-cutting locked decisions

These hold across the docs. They are settled.

- **The agent becomes the app.** Self-modification only. The agent edits and commits itself. It
  does not build other workflows in this round.
- **A read-only overlay the frontend applies, never committed.** The build kit is an agent-template
  overlay the backend serves read-only on the simple-applications response
  (`GET /api/simple/applications/{id}`) at
  `additional_context.playground_build_kit.agent_template_overlay`. The frontend applies it for a
  run (deep-merge object fields, identity-merge list fields) and excludes it on commit. The agent
  service stays dumb: no run flag, no service-side merge. It is whole-kit on or off, never edited
  per item. The stored revision holds only the user's config.
- **Ship all the platform tools in the overlay.** Every op in `PLATFORM_OPS`, including the builder
  tools, joins the overlay's `tools` list as `{ "type": "platform", "op": ... }` entries. The build
  flow has no picker, so the agent cannot add a platform tool to itself mid-run; the tools must be
  present from the start. A new agent's overlay will carry around a dozen tools, several
  approval-gated. That is intended.
- **One generic client-tool round-trip.** A single primitive carries config approval and
  connection requests. It reuses the HITL transport and retires the dead `client` executor. It is
  not two narrow flows.
- **Connections are frontend-owned and reference-only.** The agent asks; the frontend creates the
  connection and finishes any OAuth flow. The result carries a reference (integration plus slug),
  never the secret. The runner re-resolves the credential from the project vault on resume.
- **Client tools and skills are reference-tool embeds.** The authoring skill and the client tool
  `request_connection` are non-runnable reference tools the overlay embeds via
  `{ "@ag.embed": { "@ag.references": { "workflow": { "slug": "__ag__..." } }, "@ag.selector": { "path": "parameters.tool" } }, "name": "..." }`,
  the same shape for both. The slug and the selector path differ: `parameters.skill` for a skill,
  `parameters.tool` for a tool. The `@ag.selector` is required; without it the resolver inlines the
  whole revision and the SDK rejects it. `request_connection` is not a platform op; the embed
  resolves to a `ClientToolConfig` (`render.kind:"connect"`) the frontend handles.
- **No forced skills.** The published default is bare. A skill reaches a run only because the
  overlay carries its `@ag.embed`, not by force-injection. There is no forced-skill coupling.

## Build order and dependencies

The docs are not independent. Build in this order.

1. **The frontend round-trip is the foundation.** It owns the client-tool primitive and the
   connection flow, so everything that needs a human mid-run sits on top of it. It also defines the
   `request_connection` reference tool the overlay embeds.
2. **Default agent config is independent.** The overlay, the applier, and the drawer touch no other
   project, so it can build in parallel with the round-trip.
3. **Builder capabilities and agent skills build on the round-trip.** The connection branch of the
   builder (a live subscription needs a connection first) and the skills that teach the connection
   step both consume the round-trip. The two land together, since the skills name the tools and
   assume they are present.

## Decided

These finer points are settled, so they are recorded here, not relitigated.

- **The drawer folds into #4917,** which owns both the overlay and the drawer. The
  collapsible-sections change shipped separately as a small drawer cleanup (#4935).
- **The toggle is ephemeral** per playground session, resetting to on. Not a stored preference in v1.
- **The kit's permissions render read-only,** a reflection of what the overlay grants.
- **Builder testing:** dry test is same-session for v1, `test_subscription` permission is `ask`, and
  the public invoke wrapper is deferred.

## Open items (settled during implementation)

These were the design-review open items. The initiative shipped, so each settled during
implementation. They are kept here as a record, not as live questions.

**Cross-project**

- **Does the overlay carry the full build set?** Settled: the overlay's `skills` list is an array
  and carries the build skills the orchestrator references.
- **Confirm the published default goes fully bare,** dropping the skill embed and the sandbox
  boundary from the config-schema default and moving both into the overlay. Settled: the published
  default ships bare.

**Builder capabilities**

- **Test order in the build skill:** sample-first as the default, with a live test as the prove-it
  follow-up. Lean sample-first.

**Agent skills**

- **The skill set count:** keep four, or fold `set-up-triggers` into `build-your-first-app` to
  start smaller. Lean four.
- **Baseline behavior as a skill or the AGENTS.md preamble.** `agenta-getting-started` overlaps the
  always-on preamble. Lean fold into the preamble.
- **Single-sourcing the getting-started body,** which lives twice today. Lean drop the on-disk copy
  and keep the SDK constant as the only source.

**Frontend round-trip**

- **The `render.kind` vocabulary** (for example `connect`, `config-diff`). The dispatch precedence
  is settled (`render.kind`, then `name`, then a generic fallback); only the string values remain.
- **The exact `request_connection` argument and output schema,** and its render hint.
- **Whether the resume predicate stays one function or composes two.** Same behavior either way.
- **The `data-committed-revision` payload** beyond `{ variantId, revisionId, version }`, once the
  refresh code names what it needs.

**Default agent config**

- **An in-chat signal for a kit-off run,** so the user knows they are testing the published agent,
  beyond the drawer note.
