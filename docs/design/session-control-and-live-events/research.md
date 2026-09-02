# Research notes

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

## Verified current behavior

### Normal message delivery

The desktop sends messages through the workflow invoke transport. The response carries the live
event stream for that sender. The desktop Send path does not yet use the session command endpoint.

### Normal Stop

The desktop aborts its local response, then posts to `/sessions/streams/` with `session_id`, no
inputs, and `force=false`. The API classifies this as Cancel. It marks the current Redis turn owner
as superseded and clears the `alive` and `running` keys. The runner learns that it lost ownership
when a heartbeat returns `is_current_turn=false`, then aborts locally.

### Hard kill

`DELETE /sessions/streams/?session_id=...` is separate from normal Cancel. It contacts the runner
and tears down the sandbox. The session remains resumable after Cancel but not after Kill.

The direct kill client uses one configured `runner.internal_url`. Redis separately stores the
logical owner `replica_id`. The current kill client does not resolve that identifier to a
replica-specific address. Immediate Cancel cannot assume that logical owner identity already
provides direct network routing.

### Heartbeat

The runner posts `session_id`, `replica_id`, `turn_id`, and `is_running` to
`/sessions/streams/heartbeat`. The heartbeat renews temporary ownership, mirrors liveness to the
session row, and currently carries the delayed cancellation result back to the runner.

### Records

The runner forwards raw events to the sender and performs message and tool coalescing before
durable ingest. Durable records travel through a Redis Stream and worker into Postgres. Record
writes use upsert behavior.

### Watch relay

The current SSE watch endpoint relays change notifications through Redis Pub/Sub. A reader then
refetches durable records. It does not relay raw tokens and cannot replay missed Pub/Sub messages.

## Existing design decision that must be revisited

`docs/designs/sessions/records/specs.md` states:

> Ordering = uuid7 `id`, no stored `seq`.

The same document describes records as append-only, but current implementation uses stable record
IDs and upserts. A retry can therefore update an existing row. The RFC must define whether replay
uses a new append-only event log or changes the record model.

## Dependency to verify early

Another design review reports that the vendored sandbox-agent cannot cancel an execution while
preserving the harness session, and that a patch would require a Daytona snapshot rebuild. This
has not yet been verified in this workspace. It is the first research task for the Stop track.

## Current command endpoint is not a durable command system

`POST /sessions/streams/` derives four modes from the presence of inputs and the `force` flag:

| Inputs | `force` | Derived mode |
|---|---:|---|
| Present | `false` | Send |
| Present | `true` | Steer |
| Absent | `false` | Cancel |
| Absent | `true` | Attach |

The endpoint edits Redis coordination state and the session stream row. Its own DTO states that it
runs nothing. Normal desktop Send still uses the workflow invoke path. Desktop Stop uses the Cancel
mode. Attach acquires watcher bookkeeping but does not deliver live frames. Interaction responses
use their own endpoint and worker path. Kill uses `DELETE /sessions/streams/`.

This means the current endpoint does not provide a durable inbox, command status, retry handling,
or a single route for all execution-affecting actions.

## Current interaction response path

The frontend calls `POST /sessions/interactions/{interaction_id}/respond`. The API checks that the
interaction is pending and atomically changes it to `responded`. The winning responder enqueues a
TaskIQ job. The interaction dispatcher reconstructs the resume conversation from durable records
and calls the workflow invoke service in detached mode. Approval response therefore already uses a
resource-specific public endpoint followed by an internal invoke.

## Current runner routing information

Redis stores a logical `replica_id` for the runner that owns a session. The API hard-kill client
does not resolve this identifier to an address. It calls one configured runner service URL with
`project_id` and `session_id`. A normal load-balanced request is not sufficient when only one
replica holds the live sandbox, unless the runner service provides its own owner routing.

## Existing design references

- `docs/design/agent-workflows/projects/sessions-takeover/architecture.md`
- `docs/design/agent-workflows/projects/sessions-takeover/opencode-comparison.md`
- `docs/design/agenta-mobile/plans/2026-07-27-m3-live-relay.md`
- `docs/design/agenta-mobile/plans/2026-07-27-mobile-approvals-steering.md`
- `docs/designs/sessions/records/specs.md`
- `docs/designs/sessions/interactions/specs.md`

## Public API comparison

This comparison uses public vendor documentation. It describes interface shapes, not internal
implementations.

### Gumloop

Gumloop models one workflow execution as a run:

- `POST /api/v1/start_pipeline` starts work and returns `run_id`.
- `GET /api/v1/get_pl_run?run_id=...` returns the run state, logs, and outputs.
- `POST /api/v1/kill_pipeline` accepts `run_id` and stops that run.

The kill operation is a POST. It does not delete the workflow definition. The caller uses the
`run_id` returned by the start request.

Sources:

- https://docs.gumloop.com/api-reference/running-an-automation/start-automation
- https://docs.gumloop.com/api-reference/running-an-automation/retrieve-run-details
- https://docs.gumloop.com/api-reference/running-an-automation/kill-automation

### OpenAI Responses background mode

OpenAI models one background execution as a Response:

- `POST /v1/responses` with `background: true` starts work and returns a Response with an ID.
- `GET /v1/responses/{response_id}` retrieves its current state and result.
- `POST /v1/responses/{response_id}/cancel` cancels it. Repeating Cancel is idempotent.
- Creating with both `background: true` and `stream: true` provides live events. A disconnected
  reader can reconnect with `starting_after=<sequence_number>`.

This is the closest public example to the target read model. Execution continues independently
of the first stream. The same response ID identifies retrieval, cancellation, and resumed
streaming.

Source: https://developers.openai.com/api/docs/guides/background

### Claude Managed Agents

Claude Managed Agents models control as events sent to a persistent session:

- A `user.message` event starts or continues work.
- A `user.interrupt` event stops current work.
- Sending `user.interrupt` followed by `user.message` redirects the session.
- `GET /v1/sessions/{session_id}/events/stream` provides session events. Optional delta events
  provide live text previews. Buffered message events remain authoritative.
- Tool confirmation is another event, `user.tool_confirmation`, tied to the pending tool event ID.
- Deleting a session is separate. Deletion permanently removes its events and sandbox.

The public interrupt targets a session. The service resolves which internal execution must stop.
Claude also documents that model output can stop immediately while an active tool can take longer.

Sources:

- https://platform.claude.com/docs/en/managed-agents/events-and-streaming
- https://platform.claude.com/docs/en/managed-agents/session-operations

## Findings from the public comparison

The three interfaces use different names, but they agree on four points:

1. Starting work returns or uses a stable public identifier.
2. Reading status is separate from stopping work.
3. Stop is an action. It does not mean deleting the session or workflow.
4. Deletion remains a separate destructive operation.

They differ on the Stop target:

- Gumloop and OpenAI target a specific execution ID.
- Claude targets the session and lets the service interrupt its current work.

Agenta can support both safety and convenience. The browser can send a session-scoped Cancel with
an `expected_execution_id` prefilled from state. A human never types the execution ID. The API
rejects the Cancel if that execution already ended and another one started.

## Public queue visibility

The reviewed Gumloop public API exposes a run state of `QUEUED`, but its documented run API does
not expose an editable per-session message queue. It starts runs, retrieves run state, and kills a
run. This is a workflow-run queue rather than a conversation input queue.

OpenAI background Responses expose a `queued` execution status and allow cancellation. The public
background-mode documentation does not expose editing or reordering queued conversation inputs.

Claude Managed Agents comes closer to a conversation inbox. User events are persisted in order.
Each event has `processed_at=null` while it waits behind earlier events, and past events can be
listed. The reviewed documentation does not describe patching or reordering an already-sent user
event.

The proposed Agenta pending-input API therefore goes beyond these reviewed public interfaces. It
addresses a product-specific need: Queue currently exists in browser state, and multiple clients
need one visible shared copy. The initial design keeps queued inputs immutable.
