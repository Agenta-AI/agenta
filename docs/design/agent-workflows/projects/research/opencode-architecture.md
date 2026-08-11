# OpenCode Architecture

This is a research note. It studies OpenCode's architecture and compares it to the agent
workflow we are building. The goal is to learn from a mature, independent design that solves
the same problem we are solving: run a coding agent behind an API, let many clients drive it,
and stream the run back.

OpenCode is an open-source AI coding agent built by SST. It has a client-server shape. One
server exposes an HTTP API. Many clients connect over that API: a terminal UI, a desktop app,
a VS Code extension, and a web app. The server runs the agent loop, talks to model providers,
runs tools, and owns conversation state. The clients render. This is close to what we are
designing, so it is worth studying carefully.

The source moved during this research. The repo is now
[`anomalyco/opencode`](https://github.com/anomalyco/opencode) on the `dev` branch, not
`sst/opencode`. The codebase is also mid-migration from a v1 model to a v2 model. The v1 model
matches the public docs and the DeepWiki summaries. The v2 model lives in a new `packages/core`
and a new `packages/server`, and it is a different and more interesting design. This note
covers the v2 model as the current direction, and flags where v1 still applies. Where the docs
were thin, the note reads the source directly and says so.

## What the docs cover and what the code shows

The published docs at [opencode.ai/docs](https://opencode.ai/docs) describe the v1 system: an
HTTP server with an SSE event stream, sessions, messages, a "parts" union, providers, tools,
agents, and modes. Most third-party summaries describe the same v1 shape.

The `dev` branch tells a newer story. The team has rewritten the core onto
[Effect](https://effect.website) and an event-sourced session model. Sessions are now durable
event aggregates. Messages are projections built from those events. The new server lives in its
own package and is defined with a typed HTTP API DSL. This note treats that v2 code as the real
current design and notes the confidence level on each claim.

## Services and packages

OpenCode is a monorepo. The server is TypeScript on the Bun runtime. The terminal UI is Go.
Most other surfaces are TypeScript and SolidJS. The packages that matter for this comparison
are below. File counts come from the `dev` tree and just signal weight.

| Package | Role |
| --- | --- |
| `packages/core` | The domain. Sessions, messages, events, tools, providers, agents, the agent loop, and the SQLite store. Built on Effect and Drizzle ORM. |
| `packages/server` | The HTTP API. Route groups, handlers, auth, CORS, middleware. Defined with Effect's `HttpApi` DSL, which also emits the OpenAPI spec. |
| `packages/sdk` | The generated TypeScript client. `js/src/gen` is generated from the OpenAPI JSON. There is a v1 client and a v2 client. |
| `packages/tui` | The terminal client, written in Go. It is a normal API client, not privileged. |
| `packages/app` | Shared SolidJS UI logic for the desktop and web surfaces, including the event reducer and session cache. |
| `packages/desktop` | The Electron desktop app. |
| `packages/llm` | Provider-facing types: tool content, provider metadata, message normalization for model APIs. |
| `packages/plugin` | The plugin interface and hook surface. |
| `packages/console`, `packages/enterprise` | Cloud control plane, sharing, billing, and hosted services (OpenCode Zen and Go). Out of scope here. |

The shape to take away: one server process owns the agent and the state, and every client,
including OpenCode's own TUI, is just an API consumer. The server is the only thing that talks
to model providers and runs tools. This is stated in the architecture overview on
[DeepWiki](https://deepwiki.com/sst/opencode) and confirmed by the package layout in the repo.

### What each part cares about

- The **server** cares about the API contract and request handling. It is thin. Handlers call
  into `core` services. Source: [`packages/server/src/groups`](https://github.com/anomalyco/opencode/tree/dev/packages/server/src/groups)
  and [`handlers`](https://github.com/anomalyco/opencode/tree/dev/packages/server/src/handlers).
- The **core** cares about the agent loop, the session aggregate, the event log, and the
  projections. This is where the real model lives. Source:
  [`packages/core/src/session`](https://github.com/anomalyco/opencode/tree/dev/packages/core/src/session).
- The **clients** care about rendering the event stream and sending prompts. They hold no
  authoritative state. They keep a local cache that the event stream keeps in sync. Source:
  [`packages/app/src/context/global-sync`](https://github.com/anomalyco/opencode/tree/dev/packages/app/src/context/global-sync).
- The **SDK** cares about turning the OpenAPI spec into typed methods and an SSE subscription.
  It is generated, not hand-written.

### External dependencies

- **Model providers.** The server integrates 75+ providers through the Vercel AI SDK and
  `@ai-sdk/*` adapters, plus an OpenAI-compatible adapter for local models. Each provider has a
  small plugin under [`packages/core/src/plugin/provider`](https://github.com/anomalyco/opencode/tree/dev/packages/core/src/plugin/provider).
  Source: [providers doc](https://opencode.ai/docs/providers/).
- **Storage.** SQLite through Drizzle ORM, with write-ahead logging and a busy timeout. The
  event log, the session rows, the message projections, and the part rows all live here. Source:
  [session lifecycle on DeepWiki](https://deepwiki.com/sst/opencode/2.1-session-lifecycle-and-state)
  and the migrations under
  [`packages/core/src/database/migration`](https://github.com/anomalyco/opencode/tree/dev/packages/core/src/database/migration).
- **Auth.** OAuth, API keys, and well-known tokens per provider, set through
  `PUT /auth/{providerID}`. The server can also gate itself with `OPENCODE_SERVER_PASSWORD`.
  Source: [server doc](https://opencode.ai/docs/server/).
- **LSP.** An optional `lsp` tool and LSP client integration for code intelligence. Source:
  [tools doc](https://opencode.ai/docs/tools/).
- **MCP servers.** External tool servers wired in through config. Source:
  [tools doc](https://opencode.ai/docs/tools/).

## Layers

The system layers cleanly from the model up to the screen.

1. **Provider layer.** Adapters that speak each model API and normalize messages before they go
   out. Source: [`packages/llm`](https://github.com/anomalyco/opencode/tree/dev/packages/llm)
   and the `ProviderTransform.normalizeMessages` step described on
   [DeepWiki](https://deepwiki.com/sst/opencode).
2. **Core domain layer.** The session aggregate, the event log, the agent loop, the tool
   registry, and the projections. This layer is provider-agnostic and transport-agnostic.
3. **Server layer.** The HTTP API and the SSE event stream. It exposes the domain over the
   wire and emits the OpenAPI spec.
4. **SDK layer.** Generated typed clients over the API.
5. **Client layer.** The TUI, desktop, web, and editor extensions. They render the stream and
   send prompts.
6. **Plugin layer.** A cross-cutting extension surface with hooks at well-defined points
   (tool execution, permissions, file edits, session lifecycle). Source:
   [plugins doc](https://opencode.ai/docs/plugins/).

The key boundary is between core and everything else. Core does not know about HTTP. The server
does not know how the agent loop works. The clients do not know how the model is called.

## The protocol

The transport is HTTP plus Server-Sent Events. There is no websocket and no custom binary
protocol. The full API is published as an OpenAPI 3.1 spec at `/doc`, and the TypeScript SDK is
generated from it. Source: [server doc](https://opencode.ai/docs/server/)
and [OpenAPI spec on DeepWiki](https://deepwiki.com/sst/opencode/7.2-openapi-specification).

The generator itself is in motion. The v1 SDK used `@hey-api/openapi-ts` over the published
OpenAPI JSON. The team is now replacing that with a private `@opencode-ai/httpapi-codegen`
compiler that "reflects Effect `HttpApi` contracts directly, without OpenAPI or Hey API" and can
"compile once into shared contract IR, then emit either a rich Effect client or a zero-Effect
Promise/fetch client." Source:
[PR #33445, `feat(sdk): add HttpApi client codegen`](https://github.com/anomalyco/opencode/pull/33445).
The destination is the same in both designs. The API contract is written once in code, and the
client is derived from it, so client types cannot drift from the server. The detail to note is
that they decided OpenAPI itself was an intermediate artifact they could drop, and went straight
from the typed API definition to the client.

The v2 routes live under `/api`. The ones that matter for a session turn:

| Method and path | Purpose |
| --- | --- |
| `POST /api/session` | Create a session. Returns `SessionV2.Info`. |
| `GET /api/session` | List sessions with cursor pagination. |
| `GET /api/session/:id` | Get one session. |
| `POST /api/session/:id/prompt` | Admit one prompt and schedule the agent loop. Returns an acknowledgment, not the answer. |
| `POST /api/session/:id/agent` | Switch the agent for later turns. |
| `POST /api/session/:id/model` | Switch the model for later turns. |
| `POST /api/session/:id/compact` | Compact the conversation. |
| `POST /api/session/:id/wait` | Block until the agent loop goes idle. |
| `GET /api/session/:id/message` | Page through the projected messages. |
| `GET /api/session/:id/context` | Get the active context messages (everything after the last compaction). |
| `GET /api/event` | Subscribe to the server event stream over SSE. |

Source for the route shapes:
[`groups/session.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/groups/session.ts),
[`groups/message.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/groups/message.ts),
and [`groups/event.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/groups/event.ts).

### How a client drives a turn

This is the part worth internalizing. The prompt call does not return the assistant's answer.

1. The client creates a session, or reuses an id, then opens one long-lived SSE connection to
   `GET /api/event`. The stream opens with a `server.connected` event and then carries every
   server event.
2. The client posts a prompt to `POST /api/session/:id/prompt`. The server **admits** the
   prompt as a durable event and **schedules** the agent loop. It then returns a small
   `SessionInput.Admitted` acknowledgment with a sequence number. The OpenAPI summary for this
   route says it plainly: "Durably admit one session input and schedule agent-loop execution
   unless resume is false." Source:
   [`groups/session.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/groups/session.ts).
3. The agent loop runs on the server. As it runs, it publishes session events: step started,
   text started, text deltas, text ended, tool input started, tool called, tool success, step
   ended, and so on. These events flow out over the one SSE stream the client already holds.
4. The client renders by folding those events into its local message cache. When it needs the
   settled transcript, it pages `GET /api/session/:id/message`, which returns projected
   messages rebuilt from the same events.

So the request that starts the turn and the stream that carries the turn are decoupled. The
prompt is a command. The output is an event stream. The transcript is a projection. The
[handler](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/handlers/session.ts)
just calls `session.prompt(...)`, and the core
[`Session.prompt`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session.ts)
admits the input and calls `execution.wake(sessionID)`.

Why split admission from execution. OpenCode made this explicit in
[PR #30785, `refactor(core): make v2 session inputs event sourced`](https://github.com/anomalyco/opencode/pull/30785).
Before it, "an accepted prompt lived only in `session_input`" until it became model-visible, so
pending work "could not be reconstructed from synchronized Session history." The fix splits a
prompt into two durable facts: `PromptAdmitted` records "accepted intent" with its delivery mode,
and `PromptPromoted` (now folded into the existing `prompted` event, per
[PR #33443](https://github.com/anomalyco/opencode/pull/33443)) records when the prompt becomes
"model-visible history" at a safe runner boundary. That is the stated reason the POST returns an
acknowledgment rather than the answer. The accepted work is already a durable event the moment
the call returns, and the loop is scheduled separately. A client that drops can re-read the log
and see that its prompt was accepted, even before the agent has produced a token.

### Steering and queueing

The prompt payload carries a `delivery` field with two values, `steer` and `queue`, defaulting
to `steer`. Source:
[`session/input.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/input.ts).
A run coordinator serializes execution per session and lets a new prompt either interrupt the
in-flight turn (`steer`) or wait for it to finish (`queue`). The coordinator exposes `run`,
`wake`, and `interrupt`. Its own doc comment states the contract: it "serializes execution for
each key while allowing different keys to run concurrently." `run` "starts execution while idle or
joins the active execution," `wake` "registers one coalesced follow-up after newly recorded
work," and `interrupt` "stops active execution and waits for its cleanup." Source:
[`session/run-coordinator.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/run-coordinator.ts).
This is how a user types a follow-up mid-turn and the agent reacts to it without a second
connection.

This feature has a long, telling history. The original problem was blunt: a prompt sent while the
session was busy "would be rejected with a `BusyError`," so "users couldn't send messages while
the agent was mid-task."
[PR #19156, `feat: queue pending prompts when session is busy`](https://github.com/anomalyco/opencode/pull/19156)
replaced the rejection with a queue and "injects [queued prompts] as user messages at the start
of each loop iteration, before loading message history." Steering then arrived as the second lane.
[PR #26199, `feat: Add server-owned Steer/Queue pending messages`](https://github.com/anomalyco/opencode/pull/26199)
made the pending state server-owned, "inspired by Codex," so that "the server owns pending state,
ordering, pause/resume, deletes, lane changes, and delivery." The stated reason for server
ownership is to prevent "inconsistent snapshots between clients and runtime status." Later work
([PR #33247](https://github.com/anomalyco/opencode/pull/33247),
[PR #33104](https://github.com/anomalyco/opencode/pull/33104)) added "mid-stream interrupts for
steer, allowing the AI to smoothly pause without wiping the turn," plus a "wrap" mode that lets
the agent "gracefully finish its current step/tool execution before halting for the queued
message." The lesson in this arc: steering is not a feature you bolt onto the transport at the
end. It started as an error and became a first-class, server-owned, event-sourced lane only after
the team had a durable session log to anchor it to.

## Session, message, and parts model

This is the section we care about most. OpenCode's v2 model is event-sourced. Read it as three
layers stacked on each other: events at the bottom, projected messages in the middle, the
session aggregate on top.

### The session aggregate

A session is identified by a branded id with a `ses_` prefix and a descending ULID, so newer
sessions sort first. A session belongs to one project and has an optional `parentID` for
sub-agent and forked conversations. The `Info` record carries title, optional active `agent`,
optional `model` reference, rolled-up `cost` and `tokens`, a `location` (directory and optional
workspace), and lifecycle timestamps. Source:
[`session/schema.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/schema.ts).

The session is not a row that the loop mutates directly. It is the head of an event log keyed by
`sessionID`. Every meaningful thing that happens publishes a durable event against that
aggregate.

### The event log

Events are the source of truth. Each event has an `evt_` id with an ascending ULID, a `type`, a
`data` payload, an optional `location`, and, when durable, a `{ aggregateID, seq, version }`
block. Durable events get a monotonic `seq` per aggregate, which is what gives the log ordering
and replay. Source:
[`event.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/event.ts).

Session events are namespaced `session.next.*`. The set includes prompt admission, agent and
model switches, step lifecycle, text lifecycle, reasoning lifecycle, tool lifecycle, shell,
synthetic and system context, retries, and compaction. Source:
[`session/event.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/event.ts).

The streaming pattern inside the events is the clever part. Each content kind has a
`started` / `delta` / `ended` triad. The `delta` events are deliberately **not** durable. A
comment in the source says it directly: "Stream fragments are live-only; Text.Ended is the
replayable full-value boundary." So the deltas carry the live typing experience and never hit
the log, while the `ended` event carries the full settled value that replay and projection use.
The same split applies to reasoning and to tool input. Tool execution adds a `progress` event
for bounded mid-run checkpoints, with a comment warning tools not to persist every stdout chunk.
Source:
[`session/event.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/event.ts).

### The projected messages

Messages are not stored as the model writes them. They are projections rebuilt from the event
log by a projector, then written to a `MessageTable` and `PartTable` in SQLite. Source:
[`session/projector.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/projector.ts).

The v2 message is a tagged union, discriminated by `type`. The variants are `user`,
`assistant`, `synthetic`, `system`, `shell`, `compaction`, `agent-switched`, and
`model-switched`. Source:
[`session/message.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/message.ts).

The notable shift from v1: in v2 the assistant message does **not** hold a flat array of
sibling "parts." It holds a `content` array of `AssistantContent`, itself a tagged union of
`text`, `reasoning`, and `tool`. The assistant message also carries `agent`, `model`, optional
`snapshot` start and end markers, `finish`, `cost`, and a `tokens` breakdown that includes
cache read and write. Source:
[`session/message.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/message.ts).

The tool content is a state machine, not a flat record. `ToolState` is a tagged union over
`status`:

- `pending`: the call exists, only the raw input string is known.
- `running`: input is parsed, `structured` output and `content` are accumulating.
- `completed`: final `content`, `structured` output, `result`, and `outputPaths`.
- `error`: an error plus whatever `content` and `result` were produced.

Source:
[`session/message.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/message.ts).

So the lifecycle is consistent end to end. The event log emits `tool.input.started`,
`tool.input.delta`, `tool.input.ended`, `tool.called`, `tool.progress`, then `tool.success` or
`tool.failed`. The projector folds those into a single tool entry whose `state` walks
`pending → running → completed | error`. The client renders the same transition live from the
event stream and can reconcile against the projection.

The user message carries a structured `Prompt`: `text`, optional `files`, and optional `agents`.
A `FileAttachment` has a uri, mime, optional name and description, and an optional source range.
An `AgentAttachment` is an `@`-mentioned subagent. Source:
[`session/prompt.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/prompt.ts).

For completeness: the v1 model, which the public docs still describe, used a separate `Part`
union (`TextPart`, `ToolPart`, `FilePart`, `ReasoningPart`, `StepStartPart`, `StepFinishPart`,
`SnapshotPart`, `PatchPart`, `AgentPart`, `SubtaskPart`, `CompactionPart`, and more) hung off a
message `info` record. Source:
[message and part types on DeepWiki](https://deepwiki.com/sst/opencode). The v2 design absorbs
those concerns into events plus a smaller projected message. Confidence: the v1 part list is
from DeepWiki and the docs, not re-read from current source; the v2 model is read directly from
`packages/core`.

### Agents and modes

An agent in OpenCode is a named configuration: a model, a system prompt, a permission ruleset, a
mode, optional step cap, and provider request overrides. Source:
[`agent.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/agent.ts) and the
[agents doc](https://opencode.ai/docs/agents/). The default agent id is `build`.

The `mode` field is `primary`, `subagent`, or `all`. Primary agents are the ones a user drives
directly, like `build` and `plan`. Subagents are spawned by a primary agent or `@`-mentioned by
the user, like `general`, `explore`, and `scout`. The session records its active agent, and the
client can switch it mid-conversation with `POST /api/session/:id/agent`, which the server
records as a `session.next.agent.switched` event. So "mode" is not a separate concept layered on
top of agents. It is a property of the agent, and the active agent is session state. Source:
[agents doc](https://opencode.ai/docs/agents/).

Permissions live on the agent as a ruleset over tool categories (`read`, `edit`, `bash`,
`glob`, `grep`, `task`, and others) with values `allow`, `ask`, or `deny`, and glob patterns for
finer control. The `plan` agent ships with edits and bash set to `ask`. When a tool needs
approval, the server emits a permission event and waits. Source:
[agents doc](https://opencode.ai/docs/agents/) and
[tools doc](https://opencode.ai/docs/tools/).

## Why v2: the rationale and the lessons

This section is the point of the note. For each major v2 choice, it pins down the problem the
choice removed, separates OpenCode's stated reason from inference, and names the lesson for our
own design. A note on provenance first. The event-sourced core was built by jlongster (James
Long), the author of Actual Budget, who is known for putting event sourcing and CRDTs into a
shipping product and wrote the widely-read piece
[Using CRDTs in the Wild](https://archive.jlongster.com/using-crdts-in-the-wild). That pedigree
shows in the design. The first sync PR frames the model in exactly the terms an event-sourcing
practitioner would. This is context for the why, not a substitute for it.

### The event-sourced session log

**Stated reason.** The founding PR,
[#17814, `feat(core): initial implementation of syncing`](https://github.com/anomalyco/opencode/pull/17814),
says it directly: "This is a system inspired by event sourcing that tracks mutations of
session-related data through events." The design constraints are spelled out and are the key to
why it stays simple: "We don't need distributed clocks. We only support a single writer and many
readers. Events can be total ordered via a sequential integer, guaranteed to update atomically via
sqlite." The payoff is also stated: "After this PR I will add more routes for replaying these
events which will let you recreate sessions." A second PR,
[#30785](https://github.com/anomalyco/opencode/pull/30785), gives the sharper reason for pushing
even pending input into the log. Before it, accepted-but-not-yet-run prompts "could not be
reconstructed from synchronized Session history."

**The v1 problem it removed.** In v1 the session was rows the loop mutated in place. State lived
in whatever happened to be written, so there was no single ordered record to replay, and a client
could not rebuild a session it had not watched live. Reconnection and multi-client sync had no
foundation to stand on.

**Lesson for us.** The single-writer, many-reader shape is the whole reason event sourcing here is
cheap, not academic. One server process owns each session, so a per-session monotonic integer is
enough ordering. No vector clocks, no consensus. This matches our setup. Our service is the single
writer for a session. If we adopt server-owned history, an append-only event log with a per-session
`seq`, stored in our normal database, gives us replay and reconnection without distributed-systems
machinery. The constraint that makes it work is one we already satisfy.

### Projecting messages from events, not storing a wire format

**Stated reason.** The replay route promised in #17814 became the projector. The projector reads
the durable events and upserts message and part rows with `onConflictDoUpdate`, which the analysis
of the source confirms is "idempotent message/part insertion, enabling safe event replay." Token
and cost usage is applied with reversible signed arithmetic so a removed or edited part can be
backed out. The one load-bearing comment in the projector states a real invariant: "A newer turn
supersedes stale incomplete rows; never resume an older assistant projection." Source:
[`session/projector.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/projector.ts).

**The v1 problem it removed.** v1 stored messages and a large `Part` union close to a client wire
format. That couples the stored shape to one renderer and to one moment in the schema's life. The
v2 split makes the events the truth and the message table a cache you can rebuild. When the message
shape changes, you re-project. You do not migrate stored transcripts.

**Lesson for us.** This is the cleanest argument against our current convert-on-the-edge approach.
We take Vercel `UIMessage` in, run, and convert `AgentEvent` back to Vercel parts out. That bakes
one client's wire format into the round trip. If history becomes server-owned, store neutral events
as truth and project to Vercel, ACP, or AG-UI on read. The projection is a pure function of the
log, so it is safe to replay, safe to change, and the same log serves every egress format. The
idempotent-upsert and reversible-usage details are worth copying verbatim. They are what make
re-projection and edits safe.

### The live-delta versus durable-`ended` boundary

**Stated reason.** The split is documented in a source comment, not just inferred: "Stream
fragments are live-only; Text.Ended is the replayable full-value boundary." The tool-progress
comment is just as explicit about the cost it avoids: "Replayable bounded running-tool state.
Tools should checkpoint semantic transitions or at a bounded cadence, not persist every
stdout/stderr chunk." Source:
[`session/event.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/event.ts).

**The problem it removes.** If every token delta were durable, the log would bloat in proportion to
output length, replay would get slow, and the disk would carry data no reader ever needs after the
turn settles. Persisting only the settled `ended` value keeps the log proportional to the number of
content segments, not the number of tokens.

**Lesson for us.** We already emit start, delta, and end events. The missing discipline is on the
write path. Persist only the boundary, and treat deltas as live-only transport. We get smooth
streaming and a small replayable log at once. This is the lesson to take first, because it is a
rule about what to write, not a new subsystem.

### The tool state machine

**Stated reason.** None found. The `ToolState` tagged union over `status`
(`pending → running → completed | error`) carries no explaining comment, and no PR was found that
argues for it. Source:
[`session/message.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/message.ts).

**Inference (marked as inference, not their stated reason).** The shape itself is the argument. Each
status carries exactly the fields valid in that state: `pending` has only the raw `input` string;
`running` adds parsed input, `structured` output, and accumulating `content`; `completed` adds
`result` and `outputPaths`; `error` swaps in an `error`. A flat record with all fields optional
would let illegal combinations typecheck, such as a `completed` call with no result, or a `pending`
call that somehow has output. Encoding the state in a discriminant makes those states
unrepresentable. The same union appears in the events, in the projected message, and on the client,
so all three agree on "what state is this call in" by construction. This is the standard reason to
prefer a tagged union over optional fields, and it is consistent with the rest of this codebase,
which leans on tagged unions everywhere. We are confident in the benefit; we just did not find
OpenCode stating it.

**Lesson for us.** Model tool lifecycle as a tagged union in the data, mirrored in the event, the
stored row, and the client. It removes a class of "which fields are set" bugs and gives every
surface one definition of the call's state.

### Steering and the per-session run coordinator

**Stated reason.** Covered in the steering section above. The short version: prompts during a busy
turn used to fail with `BusyError` ([#19156](https://github.com/anomalyco/opencode/pull/19156)), so
queueing replaced rejection, then server-owned steer/queue lanes
([#26199](https://github.com/anomalyco/opencode/pull/26199), "inspired by Codex") replaced ad-hoc
client handling to stop "inconsistent snapshots between clients and runtime status." The coordinator
"serializes execution for each key while allowing different keys to run concurrently."

**The v1 problem it removed.** No way to talk to a working agent. The choice was reject or race. The
coordinator gives a single serialized execution per session with two well-defined entry points for
a follow-up.

**Lesson for us.** Design the coordinator and the `steer | queue` flag in from the start, not after.
The OpenCode history shows the cost of retrofitting. They shipped rejection, then queueing, then
steering, then mid-stream interrupt, then graceful wrap, across a dozen PRs. We can read the
endpoint and design straight to it: one per-session serialized runner, a delivery flag on the
prompt, and the injection happening at a safe loop boundary, "before loading message history."

### Defining the API in code so the client is generated

**Stated reason.** Partly stated, partly inferred. The docs state the mechanism ("All types are
generated from the server's OpenAPI specification") but not the why. The newer
[PR #33445](https://github.com/anomalyco/opencode/pull/33445) states the direction more plainly:
reflect the Effect `HttpApi` contract directly and emit the client from it, "without OpenAPI or Hey
API," compiling "once into shared contract IR" that can emit a rich or a zero-dependency client.

**Inference on the benefit.** The reason this matters is drift. When the API is written once in code
and the client is derived from it, the client types cannot diverge from the server. Hand-written
clients drift the moment a route changes and nobody updates the client. OpenCode did not have to
state this; it is why anyone generates a client from a contract. Their extra move is the lesson:
they treated even OpenAPI as a replaceable middle artifact and went straight from the typed API
definition to the client.

**Lesson for us.** Keep one source of truth for the wire contract and generate the typed client from
it. We do not need Effect to get this. A typed API definition that emits both the spec and the
client is enough. The point is that the contract is authored once and the client is derived, never
written twice.

### The migration strategy, as its own lesson

This is not a single design choice, but it is the most reusable thing in the history. OpenCode did
not big-bang the rewrite. The first sync PR put event writing "behind a feature flag so that we can
easily change the schema if we need to," ran a temporary dual-write of v1 and v2 paths, kept "the db
mutations exactly the same for each of the write paths," and shipped it "through beta first."
Source: [PR #17814](https://github.com/anomalyco/opencode/pull/17814). The transitional
`session.next.*` event namespace and the parallel v1/v2 SDK clients are the visible residue of that
approach. The lesson for us, if we move to server-owned history, is to dual-write and flag-gate the
new event log beside the current path, project from it, and cut over only once the projection
matches the live behavior. We do not have to choose between cold replay and event sourcing on day
one.

## Learnings and interesting things

**The prompt is a command, not a request-response.** The HTTP call that starts a turn returns an
acknowledgment with a sequence number, and all output arrives on a separate, already-open event
stream. This is the cleanest answer I have seen to a problem we keep hitting: how do you start a
long agent turn over HTTP without holding a request open, and how do you reconnect mid-turn. You
do not stream the answer back on the POST. You admit the work and let the client read the event
stream. A reconnecting client just re-reads from a sequence number.

**Event sourcing with a live/durable split.** The deltas are live-only and the `ended` events
are the durable, replayable boundary. This gets you smooth token streaming and a clean,
compact, replayable log at the same time, without writing every token to disk. The durable
events project into messages, so the transcript is always reconstructable and the streaming UI
is always cheap. This is a strong pattern and the one I would borrow first.

**Tool state as a state machine in the data model.** `pending → running → completed | error` is
encoded in the schema as a tagged union, not implied by which fields happen to be set. The same
state shows up in events, in the projection, and on the client. There is one source of truth for
"what state is this tool call in," and the type system enforces the transitions.

**The server is the single owner of state, and even the first-party TUI is just a client.**
There is no privileged in-process path for OpenCode's own UI. This forces the API to be complete
and keeps every surface honest. It is the discipline that makes a desktop app, a web app, and an
editor extension all viable against the same server.

**Generate the SDK from the API, and define the API in code.** The server is written with
Effect's typed `HttpApi` DSL. That same definition emits the OpenAPI spec, and the spec
generates the SDK. The contract is written once and the client types cannot drift from it.

**Steering is first-class.** `delivery: steer | queue` plus a per-session run coordinator means
a follow-up prompt can interrupt or queue behind the current turn. Mid-turn interruption is a
data-model decision, not a hack bolted onto the transport.

**What I would be cautious about.** The whole core is built on Effect, which is a large bet on a
functional effect system and a steep on-ramp for contributors. The codebase is also visibly
mid-migration, with v1 and v2 session models, two SDK clients, and `session.next.*` event names
that read like a transitional namespace. The SDK generator is moving too, from `@hey-api/openapi-ts`
over OpenAPI toward a custom Effect-contract codegen
([PR #33445](https://github.com/anomalyco/opencode/pull/33445)), so the exact toolchain is not
settled. The public docs lag the code by a full architecture generation, which made this research
slower and means anyone reading their docs is reading the old model. Cloning the event-sourced core
without the Effect machinery would take real work. The good news from the migration history is that
they did this incrementally behind a feature flag with a dual-write, not as a big-bang rewrite, so
the path is reproducible without betting the whole product on it at once.

## Comparison to ours

Our design is documented under
[`docs/design/agent-workflows`](../README.md). The relevant pages are
[architecture](../architecture.md), [protocol](../protocol.md),
[ports-and-adapters](../ports-and-adapters.md), and [sessions](../sessions.md).

### Where we already agree

- **Client-server with a thin transport and a real core.** Our SDK owns neutral ports and DTOs
  in `sdks/python/agenta/sdk/agents/`, and the service is a thin consumer. OpenCode splits
  `core` from `server` the same way. Both keep the agent loop out of the HTTP layer.
- **A neutral intermediate event model.** We emit `AgentEvent` objects and project them into
  one or more egress formats (Vercel UI Message Stream today, ACP and AG-UI planned). OpenCode
  emits `session.next.*` events and projects them into messages and into the SSE stream. Both of
  us treat the live run as a stream of typed events, not as one blob.
- **Lifecycle events with start, delta, and end.** Our protocol maps `message`, `thought`, and
  reasoning to start/delta/end parts. OpenCode does the same with its `started`/`delta`/`ended`
  triads. We arrived at the same shape independently.
- **Tool calls and results as discrete events with an approval path.** Our `tool_call`,
  `tool_result`, and `interaction_request` events line up with OpenCode's tool lifecycle plus
  permission events. Both of us model human approval in the event stream.
- **Tool delivery is harness-specific, but the event is neutral.** We resolve tools server-side
  and let the runner execute them. OpenCode has a tool registry and a permission ruleset. The
  external event shape stays uniform in both.

### Where they differ, and what it suggests

**Sessions: durable and server-owned versus cold replay.** This is the biggest gap. Our runtime
is cold. Each turn creates a fresh session, runs one `/run`, and tears it down. The model only
sees prior context because the client re-sends the full history every turn. We have no durable
session store and no history-load endpoint.
Source: [sessions](../sessions.md). OpenCode is the opposite. The server owns the conversation
as a durable event log, the client sends only the new prompt, and history is a query. Their
model is what our [sessions](../sessions.md) page calls future work. Their event log is also a
concrete answer to our open "session snapshot" question: you do not snapshot opaque harness
state, you keep an event log you can replay and project.

**Prompt response: acknowledge-and-stream versus stream-on-the-POST.** Today our `/messages`
streams the Vercel UI Message Stream as the SSE body of the POST that carried the prompt. That
ties the turn to one open request. OpenCode admits the prompt, returns a sequence-numbered
acknowledgment, and streams everything on a separate long-lived `GET /api/event` connection. If
we want reconnect-mid-turn, multiple watchers on one session, or a turn that outlives a flaky
client connection, their split is the design to copy. It would mean adding a durable per-session
event stream endpoint alongside `/messages`, and treating the prompt POST as a command that
returns an id.

**Message model: projection-from-events versus convert-on-the-edge.** We convert Vercel
`UIMessage` input into neutral `Message` objects on the way in, run, and convert `AgentEvent`
back into Vercel parts on the way out. OpenCode never converts a transcript on the edge. The
transcript is always a projection of the durable event log, so any client can page it and any
client can rebuild it. If we move to server-owned history, we should store events or neutral
messages as the source of truth and project to Vercel, ACP, or AG-UI on read, rather than
storing one client's wire format.

**Steering: built-in versus absent.** We have no mid-turn steering or queueing concept. Our turn
is one cold `/run`. OpenCode's `delivery: steer | queue` plus the run coordinator gives
interrupt and queue semantics for free. When we add warm or server-owned sessions, we will want
the same two verbs, and it is cheaper to design the event and the coordinator in from the start
than to retrofit them.

**Agent and model as session state versus per-run config.** OpenCode records the active agent
and model on the session and switches them with their own events. Our harness, model, and
sandbox selection ride on each `/run` as `RunSelection` and `AgentConfig`. Source:
[ports-and-adapters](../ports-and-adapters.md). For a chat that spans many turns, treating agent
and model as switchable session state, with an event when they change, is the better fit. Our
[agent-template](../agent-template.md) split already points this way; OpenCode shows it working.

**One harness versus many.** Here we differ on purpose, and it is our advantage. OpenCode owns
its agent loop. There is one harness, written in TypeScript on the AI SDK. We run external
harnesses (Pi, Claude) over a backend and harness port, with local and Daytona sandboxes.
Source: [architecture](../architecture.md). That makes our event model harder, because we have
to normalize several harness wire formats into one `AgentEvent`, but it also lets us run agents
we did not write. OpenCode does not have that constraint, so it can make the event log and the
loop one tightly-coupled thing. We should not copy that coupling. Our neutral `AgentEvent`
boundary is the right call for a multi-harness platform.

### Concrete takeaways for our session, message, and protocol design

1. **Make the server own session history as an event log, and make the transcript a
   projection.** Store neutral events or neutral messages as the source of truth. Project to
   Vercel, ACP, or AG-UI on read. This directly fills the gap our
   [sessions](../sessions.md) page documents and avoids storing one client's wire format. The why:
   we are a single writer per session, so a per-session monotonic `seq` in our normal database
   buys replay and reconnection with no distributed-systems machinery, exactly as OpenCode's
   [#17814](https://github.com/anomalyco/opencode/pull/17814) lays out.
2. **Split the prompt from the stream.** Add a durable per-session event stream the client
   subscribes to, and turn the prompt POST into an admit-and-schedule command that returns an
   id and a sequence number. Keep `/messages` as a convenience streaming path, but make the
   event stream the reconnectable source of truth. The why: OpenCode made accepted input a durable
   `PromptAdmitted` event so pending work survives a dropped client and is reconstructable from
   history ([#30785](https://github.com/anomalyco/opencode/pull/30785)).
3. **Adopt the live-delta, durable-boundary split.** Keep token deltas live-only and persist a
   settled `ended` value per text, reasoning, and tool-input segment. We already emit the start,
   delta, and end events; the missing half is persisting only the boundary, not every delta, so
   the log stays small and replayable. The why is stated in their source: deltas are "live-only,"
   the `ended` event is "the replayable full-value boundary," and tools must not "persist every
   stdout/stderr chunk."
4. **Model tool state as an explicit state machine in the data, not as optional fields.** A
   `pending → running → completed | error` tagged union, mirrored in the event, the stored
   message, and the client, removes a class of "which fields are set" bugs. The why is inference,
   not their stated reason: only the fields valid in a state exist in that state, so illegal
   combinations cannot typecheck.
5. **Plan for steering and queueing now.** When we move off cold replay, design a per-session
   coordinator and a `steer | queue` delivery flag into the prompt contract from the start. The
   why: OpenCode shipped this across a dozen PRs starting from a plain `BusyError` rejection
   ([#19156](https://github.com/anomalyco/opencode/pull/19156)). We can design straight to the
   endpoint they reached, and make pending state server-owned to avoid client/runtime drift
   ([#26199](https://github.com/anomalyco/opencode/pull/26199)).
6. **Keep agent and model as session state once chat spans turns.** Record the active agent and
   model on the session and emit an event on change, instead of re-sending them on every run.
7. **Migrate incrementally, behind a flag, with a dual-write.** If we move to server-owned
   history, do not rewrite in one cut. Flag-gate the event log beside the current path, project
   from it, verify the projection matches live behavior, then cut over. This is how OpenCode
   shipped the rewrite without freezing the product ([#17814](https://github.com/anomalyco/opencode/pull/17814)).

The honest summary: OpenCode has already built the durable, server-owned, event-sourced session
model that our docs describe as future work, and it pairs that with an acknowledge-and-stream
protocol that solves reconnection cleanly. Their constraint is simpler than ours, since they own
their one agent loop, so we should borrow their session and protocol mechanics while keeping our
neutral multi-harness `AgentEvent` boundary, which is the thing their design does not need and
we do.

## Sources

- OpenCode docs: [overview](https://opencode.ai/docs/), [server](https://opencode.ai/docs/server/),
  [sdk](https://opencode.ai/docs/sdk/), [agents](https://opencode.ai/docs/agents/),
  [tools](https://opencode.ai/docs/tools/), [plugins](https://opencode.ai/docs/plugins/),
  [providers](https://opencode.ai/docs/providers/).
- Repository: [`anomalyco/opencode`](https://github.com/anomalyco/opencode) (`dev` branch). Key
  source files cited inline: `packages/core/src/session/message.ts`, `schema.ts`, `info.ts`,
  `event.ts`, `prompt.ts`, `input.ts`, `run-coordinator.ts`, `projector.ts`, `session.ts`,
  `agent.ts`; `packages/core/src/event.ts`; `packages/server/src/groups/session.ts`,
  `message.ts`, `event.ts`; `packages/server/src/handlers/session.ts`.
- Pull requests used for the stated rationale and the migration history:
  [#17814 initial syncing](https://github.com/anomalyco/opencode/pull/17814),
  [#30785 event-source session inputs](https://github.com/anomalyco/opencode/pull/30785),
  [#33443 simplify input promotion](https://github.com/anomalyco/opencode/pull/33443),
  [#19156 queue when busy](https://github.com/anomalyco/opencode/pull/19156),
  [#26199 server-owned steer/queue](https://github.com/anomalyco/opencode/pull/26199),
  [#33247](https://github.com/anomalyco/opencode/pull/33247) and
  [#33104 steer interrupts and wrap](https://github.com/anomalyco/opencode/pull/33104),
  [#33445 HttpApi client codegen](https://github.com/anomalyco/opencode/pull/33445),
  [#33238 simplify event model](https://github.com/anomalyco/opencode/pull/33238).
- Context on the author of the event-sourced core: jlongster (James Long), Actual Budget,
  [Using CRDTs in the Wild](https://archive.jlongster.com/using-crdts-in-the-wild).
- DeepWiki overviews (secondary, used for the v1 model and the architecture summary):
  [repo overview](https://deepwiki.com/sst/opencode),
  [session lifecycle](https://deepwiki.com/sst/opencode/2.1-session-lifecycle-and-state),
  [OpenAPI spec](https://deepwiki.com/sst/opencode/7.2-openapi-specification).

## Confidence notes

- The v2 event-sourced model, the event triads, the tool state machine, the message tagged
  union, the prompt admit-and-schedule flow, and the `steer | queue` delivery are all read
  directly from `packages/core` and `packages/server` on the `dev` branch. High confidence.
- The v1 "parts" list and some lifecycle event names are from the public docs and DeepWiki, not
  re-read from current source, because v2 has largely replaced them. Treat the v1 part inventory
  as descriptive of the documented system, not the current head.
- Provider counts, the LSP integration, and the plugin hook list come from the docs and were not
  cross-checked against every source file. Medium confidence on exact counts, high confidence on
  the shapes.
- The codebase is mid-migration. Names like `session.next.*` and the parallel v1/v2 SDK clients
  are transitional and may change. The architectural direction is clear; the exact identifiers
  may not be stable.
- On the rationale: the event-sourcing motivation (single writer, many readers, replay), the
  event-sourced inputs motivation (pending work must be reconstructable from history), the
  queue/steer motivation (prompts used to fail with `BusyError`; server-owned to avoid client/runtime
  drift), and the live/durable split are OpenCode's **stated** reasons, quoted from PRs and source
  comments. High confidence. The tool-state-machine benefit and the generate-the-client benefit are
  **inference** from the shape and from standard practice, clearly marked as such, because no PR or
  comment was found stating them. No reason, stated or inferable, was found for the exact choice of
  the `session.next.*` namespace; it reads as transitional.
</content>
</invoke>
