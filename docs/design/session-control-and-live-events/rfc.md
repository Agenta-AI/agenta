# RFC: Session control and live events

> AGENT-GENERATED, low weight. Draft for discussion. No architecture is approved yet.

## Status

Pre-design. The problem inventory and process decisions exist. Technical sections will be written
after each design-track discussion.

## Problem statement

Agenta currently couples live output to the sending request, uses a heartbeat response as the
normal cancellation signal, and lacks an append-only replay cursor for session changes. This makes
multi-client reading, fast Stop, durable queueing, and reliable reconnect difficult to compose.

## Required properties

See [Requirements](requirements.md). The RFC will include only requirements confirmed during the
track discussions.

## Proposed architecture

Pending discussion.

### Public interface boundary

The working public interface separates four operations. Every route in this section is a proposed
new public contract, not a description of an existing endpoint and not yet an approved API.

1. Send intent to a session.
2. Read the current session snapshot.
3. Follow session changes.
4. Delete a session permanently.

The proposal does not require one generic public command endpoint. Clear resource-specific
endpoints can all feed one private command-delivery mechanism.

Create or send session work:

```http
POST /sessions/{session_id}/commands
Idempotency-Key: <client-generated-key>

{
  "type": "send",
  "message": "Explain this failure",
  "delivery": "reject"
}
```

Stop the current execution, but only if it is still the execution the caller observed:

```http
POST /sessions/{session_id}/cancel

{
  "expected_execution_id": "execution-12"
}
```

The browser learns `execution-12` from the session snapshot or the `execution.started` event. The
person pressing Stop never enters it. This field prevents a delayed Stop request from cancelling
new work that started after the button was pressed. The field is optional. Without it, the API
uses Redis arrival and turn-start timestamps and refuses the request if the active execution began
after the request arrived. A client that needs unconditional session-scoped cancellation must use
a future command contract.

Respond to an interaction through a resource-specific public endpoint:

```http
POST /sessions/{session_id}/interactions/{interaction_id}/responses

{
  "answer": {"approved": true},
  "expected_execution_id": "execution-12"
}
```

The API can translate the response into the same internal command envelope used by Send, Cancel,
Queue, and Steer. The public caller does not need to understand internal runner routing.

Read current state. This is an ordinary query, not an event endpoint:

```http
GET /sessions/{session_id}
```

This is not the current `GET /sessions/streams/?session_id=...`, which returns only coordination
and liveness data.

Follow durable events and live frames:

```http
GET /sessions/{session_id}/events?after=<cursor>
Accept: text/event-stream
```

This is not the current `GET /sessions/streams/watch`, which sends change notifications and asks
the client to refetch records. The proposed endpoint sends replayable session events and then live
events.

Rename, archive, delete, and hard termination remain explicit session resource or lifecycle
operations. Attach is replaced by reading the snapshot and event stream.

### Current and proposed public behavior

| Operation | Today | Proposed direction | Change |
|---|---|---|---|
| Send | Invoke a workflow and read its response stream | Keep this during migration. Later accept work independently and return an execution ID | Later change |
| Stop | `POST /sessions/streams/` with no inputs and `force=false` | `POST /sessions/{id}/cancel` with an optional expected execution ID | Clearer endpoint and faster delivery |
| Hard kill | `DELETE /sessions/streams/?session_id=...`; destroys the sandbox | Keep as a separate destructive operation with an explicit name | Rename or reshape only |
| Answer approval | `POST /sessions/interactions/{interaction_id}/respond` | Keep a resource-specific response endpoint. Improve acknowledgement and resume guarantees internally | Public shape mostly unchanged |
| Queue while busy | Browser-local queue | Save the message on the server with `on_busy: queue` | Changes ownership from browser to server |
| Steer while busy | Ambiguous `force=true` coordination mode; normal send still uses invoke | Save the message, request interruption, then start the saved message | Behavior becomes explicit and durable |
| Attach | `force=true` without inputs records watcher state but does not provide live output | Remove the command. Load a snapshot, then follow events | Replaced by read operations |
| Load current state | Several queries for records, liveness, and pending interactions | One versioned session snapshot, or a documented composition of existing queries | Open design choice |
| Follow changes | SSE sends change notifications; the browser refetches records | Replay events after a cursor, then continue with live frames | Changes from invalidation to replay plus live tail |
| Delete | Separate destructive behavior exists through the stream API | Explicit session deletion after work is stopped | Public naming changes |

### Busy-message policies

The words `reject`, `queue`, and `steer` apply only when a new user message arrives while an
execution is already running:

- `reject`: return a conflict response. Do not save or start the new message.
- `queue`: save the new message. Start it after current work stops normally.
- `steer`: save the new message. Interrupt current work, then start the new message.

When the session is idle, all accepted messages start normally. The contract may call this field
`on_busy` so its purpose is clear.

### Visible pending messages

Once Queue moves from the browser to the server, every client must be able to see the same pending
messages. A session snapshot can include them:

```json
{
  "pending_inputs": [
    {
      "id": "input-24",
      "type": "user_message",
      "content": "Then check the database",
      "position": 1,
      "status": "pending"
    }
  ]
}
```

The event stream announces changes:

```text
input.queued
input.removed
input.promoted
```

Queued inputs are immutable. The management interface only needs removal:

```http
DELETE /sessions/{session_id}/inputs/{input_id}
```

To change a pending message, the client removes it and submits a replacement. DELETE rejects the
request after the input was promoted into active work. The server processes pending inputs in FIFO
order, which means first in, first out. The initial interface does not support reordering.

This keeps clients synchronized. A message is no longer hidden inside one browser's local queue.

### One public interface for all clients

Agenta desktop, mobile, bots, and external API users should call the same public session API. A
first-party browser must not depend on a separate privileged execution endpoint.

The runner still needs a private protocol because it performs trusted internal work. That private
protocol carries claims, heartbeats, event frames, acknowledgements, and control wake-ups. It is
not a second product API.

### Interaction responses

Moving interaction response under the session URL does not itself improve correctness. It only
makes session ownership and authorization visible in the path. The current endpoint can remain:

```http
POST /sessions/interactions/{interaction_id}/respond
```

or the clean public contract can use:

```http
POST /sessions/{session_id}/interactions/{interaction_id}/responses
```

The material change is internal. The API must durably accept the response, make one response win,
and expose whether continuation is pending, running, or failed. URL nesting is a consistency
choice, not the reason for changing approval handling.

### Private control path

The public Cancel request does not need a runner address. A simple internal flow is:

1. The browser sends Cancel to the API.
2. The API records that execution 12 must stop.
3. The API sends a private wake-up to the runner that owns execution 12.
4. The runner stops local work and reports `execution.cancelled`.
5. Every browser receives that event.

The API already knows the logical runner owner as `replica_id`. It does not yet know a reliable
network address for that replica. The implementation must add one of these private delivery
mechanisms:

- The runner keeps an outbound connection open to the API. The API sends control messages on it.
- The runner subscribes to a private per-runner broker channel.
- The runner service adds owner-aware routing behind one internal URL.

This private choice does not change the public Cancel endpoint. A heartbeat remains useful for
renewing ownership and detecting a crashed runner. It stops being the normal way to deliver
Cancel.

### Execution identity and ownership

Current Redis state identifies a logical runner replica and the current `turn_id`. The API does
not currently map that replica identifier to a replica-specific network address. The hard-kill
path calls one configured runner service URL. The RFC must select an immediate-control routing
mechanism before it can define fast Cancel delivery.

The recommended routing pattern for discussion is:

1. The API saves or atomically records the command.
2. The API identifies the logical owner `replica_id`.
3. A private control channel wakes that runner immediately.
4. The runner acknowledges and applies the command.
5. Heartbeat or periodic recovery finds commands whose wake-up was lost.

The runner can initiate the control connection to the API. This would support possible future
user-operated runners behind firewalls and keep Redis credentials behind the API boundary. That
future deployment model is a consideration, not a confirmed requirement.

The simplest first implementation is durable long polling. The runner makes an authenticated
request that the API holds briefly until a command is available. The runner receives the command,
acknowledges it, and immediately opens the next request. A disconnected runner reconnects and
claims commands that remain durable. Redis or Postgres notifications may wake API replicas
internally, but the runner never connects to either system.

A persistent WebSocket or bidirectional stream can later reduce repeated requests and carry richer
runner status. It is not required for the first contract. Direct API calls into runner pods and
per-runner Redis subscriptions are poor fits for user-operated runners because they require inbound
reachability or infrastructure credentials.

Control delivery must sit behind an internal port. Session command handling depends on this port,
not on a particular transport:

```text
deliver(owner, command)
acknowledge(command_id, owner)
recover(owner)
```

Initial adapter: authenticated long polling. Possible later adapters: persistent WebSocket,
private Redis delivery, or direct managed-runner routing. Durable command state, authorization,
idempotency, execution fencing, and terminal settlement remain outside the adapter. Replacing the
adapter must not change the public session API or command state machine.

The required invariant is stronger than “the second start usually gets a conflict”: at most one
execution is active for a session, and only the current owner can write or cause external effects.
The current Redis `alive` lease, owner affinity, heartbeat refresh, and superseded markers reduce
overlap. They do not fully enforce this invariant after lease expiry or a network partition because
record ingest does not reject a stale ownership generation.

The target design therefore separates two jobs:

1. **Admission and fencing.** The API atomically accepts one execution and assigns an increasing
   ownership generation. Every runner event carries the execution ID and generation. The API
   rejects stale generations. Settlement releases ownership only when both values match.
2. **Failure detection.** A heartbeat renews the active lease. If it expires, recovery can mark the
   execution lost and assign a newer generation. The heartbeat detects failure, but it is not the
   only protection against two writers.

The RFC does not yet choose whether admission state belongs in Postgres, Redis with a durable
command record, or a transaction across projections. The selected design must prove atomic
concurrent admission and stale-write rejection.

### Immediate control

The existing `/sessions/streams/` endpoint is a coordination-state edit, not a durable command
inbox. It derives Send, Steer, Cancel, and Attach from inputs plus a `force` flag. Normal desktop
Send does not use this endpoint. A future explicit command contract must replace the ambiguous
shape without silently changing existing invoke behavior.

### Command delivery and execution settlement

Command delivery and execution lifecycle are separate state machines:

```text
command:   pending -> claimed -> applied
                              -> obsolete

execution: running -> stopping -> stopped
                              -> failed
                              -> lost
```

The API accepts Stop by durably creating the command and moving the matching execution to
`stopping` in one transaction. `expected_execution_id` remains optional. A command claim has a
lease and can be delivered again after disconnection. The runner deduplicates by `command_id` and
validates the execution ID and ownership generation before applying it.

Claiming or acknowledging a command does not prove that execution stopped. Public clients follow
execution state. The runner normally reports the terminal outcome and the API settles the command
and execution together. If the runner disappears, a watchdog records `lost`; another runner cannot
claim that it stopped work on the missing machine. The settlement deadline will be selected after
the sandbox cancellation spike.

### First-version ownership scope

The first version retains Redis as the execution ownership authority. It does not introduce a new
Postgres execution table, ownership generation, or general fencing migration.

When Stop is accepted, the API saves the durable command but does not immediately free the current
`alive` lock. Long polling delivers the command. The heartbeat can discover the same pending
command as a fallback. The runner releases owner-checked `running` and `alive` keys only after
cancellation settles, so new work cannot start during normal cancellation.

This scope accepts the current network-partition limitation. Full multi-runner correctness and
stale-writer fencing remain future work. The command and control-delivery ports must not depend on
Redis-specific ownership details, so that later work can replace the ownership adapter.

### Live frame ingress and relay

The working model has one raw runner event ingress. The API acknowledges a frame only after it is
accepted into the shared Redis Stream. Live readers consume temporary frames from that stream.
The durable projector consumes the same source and commits permanent facts.

Browser delivery never blocks the runner. A slow reader is disconnected and later recovers from
durable state. With multiple API replicas, the runner and readers can connect to different
replicas because Redis and Postgres hold the shared state. A runner-to-API disconnect does not
stop execution; the runner reconnects and resends unacknowledged frames.

### Durable events and replay

The durable history requires immutable event IDs, an order whose visibility matches database
commit order, idempotent retries, and a replay-to-live handoff that cannot miss a commit. A plain
Postgres `BIGSERIAL` is insufficient by itself because sequence allocation can precede an
out-of-order transaction commit.

Two storage options remain under consideration.

#### Option A: Repair records into the session event history

Change records so every durable fact has a stable producer ID, immutable payload, and commit-safe
session cursor. Duplicate delivery becomes a no-op. Add execution, input, and interaction
lifecycle facts so the same append-only history can build the transcript and the session snapshot.

Benefits:

- One permanent history to write, retain, query, and debug.
- Existing transcript and harness reconstruction already read records.
- No consistency problem between two permanent logs.

Costs and risks:

- Changes the existing upsert contract and tool snapshot behavior.
- Expands a conversation-oriented tracing record into the public session event contract.
- Requires a migration story for old rows without cursors and current record retention.
- Requires commit-safe ordering and reliable delivery changes regardless of table reuse.

This option has a mandatory discovery gate. Today a repeated stable `record_id` can be an exact
transport retry or a later snapshot with changed payload. Only the exact retry becomes a no-op.
The producer-semantics spike in `records-invariants.md` must classify every reuse and add regression
tests before the upsert contract changes.

#### Option B: Keep records as a transcript projection and add a session event log

Keep current records for conversation and harness reconstruction. Add an immutable session event
history for input, execution, tool, interaction, and message lifecycle events. Build session
snapshots from that history or projections updated in the same transaction.

Benefits:

- Leaves the current transcript and harness path largely intact during migration.
- Gives the public event contract its own schema and retention policy.
- Separates mutable or coalesced transcript projections from immutable lifecycle facts.

Costs and risks:

- Two permanent representations of some conversation facts.
- The projector must keep records and session events consistent.
- Debugging and recovery must define which representation is authoritative.
- More schema, storage, migrations, and cleanup machinery.

#### Redis as permanent history

Redis remains the temporary ingress and delivery buffer. It is not a permanent session history in
this draft because the Stream is bounded, entries are acknowledged and deleted, and Redis does not
match the existing Postgres retention, query, and recovery model.

#### Snapshot and stream consistency

The snapshot is a durable projection through cursor N. The event endpoint replays durable events
after N and then follows newly committed events. Snapshot data and cursor must be read from one
consistent database view, or the projection and cursor must update in the same transaction.

Temporary live frames do not advance the durable cursor. The next durable completion repairs
missed previews. A reader subscribes to commit wake-ups before reading replay history so a commit
cannot fall between the historical read and live tail.

The delivery chain must handle these failure boundaries:

1. Runner to API: retry unacknowledged frames after reconnect.
2. API to Redis: acknowledge only after `XADD` succeeds.
3. Redis to projector: leave failed work pending for retry.
4. Projector to Postgres: append events and update projections in one transaction.
5. Postgres to live wake-up: a lost wake-up is repaired by querying after the cursor.
6. API to browser: reconnect after the last durable cursor.

### Detached sender

Starting work and watching work are separate operations. The API durably accepts an input and
returns without waiting for a runner claim, harness start, first output frame, or reader
connection. The execution then proceeds independently of the submitting HTTP request.

The durable acceptance boundary includes:

- The submitted input.
- Its idempotency identity.
- Its session association.
- Its accepted execution intent.

The sender then reads the same session event stream as desktop, mobile, bots, and external
clients. Disconnecting any reader does not cancel or park the execution. A convenience request
may submit and begin streaming in one call, but that response remains a reader of an independently
accepted execution.

During migration, the current invoke response can continue serving the sender while the shared
read path is introduced. The final client model removes this privileged sender path.

### Durable commands

Working scope for discussion:

- Send a user message.
- Cancel an expected execution.
- Respond to an interaction.
- Queue a message.
- Steer with a saved message.

Attach belongs to the read path. Kill, rename, archive, and delete remain separate lifecycle or
resource operations in the working model.

The internal command transport does not require every public action to use one generic endpoint.
Public resource endpoints can validate domain-specific input and then create the common internal
command.

### Queue and Steer

Pending discussion.

### Approvals and pauses

Pending discussion.

### Client state application

Pending discussion.

## Migration

Pending discussion. The migration must preserve the current sender stream until the shared read
path passes its live-stack tests.

## Test plan

Pending discussion. Each architecture section must add one invariant and one live-stack test.

## Rejected alternatives

Pending discussion.
