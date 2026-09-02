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
