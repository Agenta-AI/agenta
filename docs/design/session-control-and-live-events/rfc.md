# RFC: Session control and shared live events

> **AGENT-GENERATED, LOW WEIGHT, DRAFT.** This RFC contains decisions confirmed by Mahmoud and
> provisional choices made by an AI agent on 2026-09-02. Nothing in this document is approved for
> implementation until a human reviews it. Sections marked **Reviewer gate** require explicit
> review before implementation.

## Status

Draft pull request. Ready for architectural review and focused spikes.

## Summary

Agenta will separate session commands from session reading.

- Clients submit Send, Stop, Queue, Steer, and interaction responses to the API.
- The API durably accepts commands before reporting success.
- The API delivers commands directly to the runner through a replaceable delivery adapter.
- The first version keeps the existing Redis execution ownership model.
- The runner sends live frames to one shared backend path.
- All authorized clients read the same session snapshot and event stream.
- Temporary live frames stay in bounded Redis storage.
- Permanent session facts live in Postgres and support replay after an opaque cursor.
- Stop preserves the sandbox and native harness session for warm resume.

The implementation proceeds in independent control and read programs. Fast Stop does not wait for
the shared event stream. Shared reading does not wait for Queue or Steer.

## User problems

The current design causes five visible problems:

1. Only the browser that started work receives the original live output stream.
2. Another browser learns about completed records through a change notification and then refetches
   the transcript.
3. Stop changes Redis ownership and waits for the runner heartbeat to notice.
4. Queue exists in browser memory, so other clients cannot see or manage pending messages.
5. Session state comes from local run state, Redis-backed flags, records, and interactions that
   update at different times.

The issue inventory and evidence are in [requirements.md](requirements.md).

## Terms

- **Session:** One durable conversation and its workspace.
- **Conversation turn:** One user message and the resulting agent response.
- **Execution:** One attempt by a runner to advance a session. An approval can pause one
  conversation turn and cause a later continuation execution.
- **Runner:** The service that starts a sandbox and drives the coding harness.
- **Harness:** The coding-agent program inside the sandbox, such as Pi or Claude Code.
- **Command:** A durable request that can change execution, such as Stop or Steer.
- **Input:** Durable user content that can be pending, promoted, or removed.
- **Live frame:** Temporary output such as a text delta or tool progress update.
- **Durable event:** An immutable saved fact used for replay and recovery.
- **Cursor:** The latest committed per-session sequence a reader has received.
- **Lease:** Temporary evidence that a runner remains alive and owns current work.

Existing `turn_id` fields often identify an execution. Existing `turn_index` fields identify
conversation order. New interfaces use `execution_id` and `conversation_turn_index`. Migration
code can map existing fields without renaming every stored column in the first release.

## Required behavior

### Commands

1. A successful submission means the API durably saved the request and its idempotency identity.
2. Acceptance does not wait for a runner, harness, or first output frame.
3. Command delivery can happen more than once. The runner applies a command at most once by
   `command_id`.
4. Public Stop can optionally include `expected_execution_id`. Without it, Stop targets the
   current execution when the API accepts the request.
5. First-party clients send `expected_execution_id` whenever they know the active execution. A
   mismatch returns a conflict and leaves the current execution untouched.
5. Internal command delivery state does not define public execution state.

### Execution

1. At most one execution owns a session under the current Redis ownership contract.
2. Every accepted execution reaches one terminal outcome: completed, waiting, stopped, failed, or
   lost. `waiting` ends that execution at an interaction boundary; it does not keep a runner active.
3. After that terminal outcome, later non-terminal output for the execution is rejected or
   quarantined.
3. Stop prevents new model and tool work within five seconds under normal operation.
4. Stop preserves the sandbox and native harness session for warm resume.
5. Delete remains separate and can remove the session and its resources.

### Reading

1. Every authorized reader can follow the same live execution.
2. The initiating client has no special access to live frames.
3. Closing or refreshing a client does not stop execution.
4. A snapshot identifies the durable cursor it represents.
5. A reader can request durable events after a cursor and then follow new events without a gap.
6. Missing temporary frames do not corrupt durable state. A durable checkpoint repairs the client.

### Pending input

1. Pending inputs live on the server and appear in every client snapshot.
2. Normal queue promotion uses first-in, first-out order. A newly admitted Steer input is the
   explicit exception and runs before older queued input after its target execution stops.
3. A client can remove a pending input but cannot edit or reorder it.
4. Changing pending content means removing it and submitting a replacement.

## Scope

### First implementation scope

- A durable command store.
- Direct authenticated API-to-runner Stop delivery behind a replaceable adapter.
- Durable recovery when direct delivery fails.
- Heartbeats used for health and ownership, not normal Stop delivery.
- Warm cancellation and a durable stopped outcome.
- Current Redis ownership held until Stop settles.
- Existing watch notifications used to refresh clients.

### Target RFC scope

- Durable Send, Queue, Steer, Stop, and interaction-response commands.
- Shared live frames for every reader.
- A session snapshot and replayable event stream.
- A detached sender that reads the same stream as other clients.
- One client state reducer shared by desktop and mobile.

### Out of scope

- Replacing Redis execution ownership in the first version.
- Postgres ownership generations and full stale-writer rejection.
- Multiple-runner correctness beyond current behavior.
- A requirement to support user-operated runners. This remains a future consideration.
- WebSocket, gRPC, NATS, Kafka, Temporal, or Centrifugo adoption.
- Permanent token storage.
- Queue editing or reordering.
- Final endpoint naming. Names below express resource boundaries, not final spelling.

## Current architecture

### Execution ownership

Redis stores `alive`, `running`, `owner`, and `superseded` keys. Their values identify the current
`turn_id` and runner replica. The `session_streams` Postgres row mirrors this state for listing and
recovery. Redis remains authoritative.

The runner heartbeats the API while work runs. The response tells the runner whether its turn is
still current. Current Stop removes or replaces coordination state. The runner normally discovers
that change on a later heartbeat.

### Live output and records

The runner returns raw events through the invoke response. The initiating browser receives those
events live. The runner separately combines text, thought, and tool progress before record ingest.
The API adds coalesced records to a Redis Stream. A worker writes them to Postgres.

After the database write, the API publishes a Redis Pub/Sub change notification. The current watch
Server-Sent Events endpoint forwards that notification. A client then refetches records. The watch
endpoint does not carry the original live output.

### Queue and interactions

The desktop queue lives in browser state. Interaction requests and responses have their own
durable API and worker paths. These paths do not share one command admission contract.

## Architecture

```text
                              durable inputs and commands
Client ---------------------> API --------------------------> Postgres
  |                            ^                                |
  | snapshot and SSE           | direct command delivery        |
  v                            |                                |
Client <--------------------- API <-------------------------- Runner
                               |          live frames           |
                               v                                |
                         bounded Redis Stream ------------------+
                               |
                               +--> live relay
                               |
                               +--> durable projector --> Postgres
```

The architecture has four boundaries:

1. The public session API accepts intent and exposes state.
2. The command store owns durable command truth.
3. The control-delivery adapter moves commands to the runner.
4. The shared event path moves runner output to readers and durable projections.

## Public session interface

The same public interface serves desktop, mobile, integrations, and external API clients.

The durable command store is private implementation. Public routes describe session operations,
not internal command types or claim states. Existing invoke, interaction, record, and watch routes
remain available while clients migrate. New behavior must not add more overloaded boolean modes
such as using one route's `force` value to switch between unrelated operations. Final route names
receive a separate API review.

### Submit input

```http
POST /sessions/{session_id}/commands
Idempotency-Key: <client-generated-key>

{
  "type": "send",
  "message": "Check the deployment",
  "on_busy": "reject"
}
```

`on_busy` accepts:

- `reject`: reject the new input while an execution runs.
- `queue`: save it and promote it after the current execution completes normally.
- `steer`: save it, stop current work at a safe boundary, then promote it.

### Stop current work

```http
POST /sessions/{session_id}/stop

{
  "expected_execution_id": "execution-12"
}
```

The body is optional. The response reports durable acceptance and current public execution state.
It does not claim completion before the runner settles.

### Read a session snapshot

```http
GET /sessions/{session_id}
```

The response contains messages, current execution state, pending inputs, pending interactions, and
the latest committed per-session sequence. A new empty session returns sequence `0`:

```json
{
  "session_id": "session-1",
  "latest_sequence": 0,
  "messages": [],
  "current_execution": null,
  "pending_inputs": [],
  "pending_interactions": []
}
```

An existing session can return any later sequence. For example, `latest_sequence: 41` means that
the snapshot includes durable history through event 41. It does not mean that every newly opened
session starts at 41.

### Follow a session

```http
GET /sessions/{session_id}/events?after=<latest-sequence>
Accept: text/event-stream
```

The endpoint replays committed durable events after the cursor, then follows new durable events and
temporary live frames. The client opens this connection when it opens the session and keeps it open
while the session is active in the client. It does not reopen the connection for every Send.

For a new session, the client follows after `0`. If an accepted Send creates `execution-123`, the
connection can carry:

```text
id: 1
event: execution.started
data: {"execution_id":"execution-123"}

event: message.delta
data: {"execution_id":"execution-123","message_id":"message-456","delta":"The"}

id: 2
event: message.completed
data: {"execution_id":"execution-123","message_id":"message-456","text":"The error..."}

id: 3
event: execution.completed
data: {"execution_id":"execution-123"}
```

Only committed durable events carry a sequence and advance the cursor. Temporary frames such as
`message.delta` refer to stable object IDs but do not advance the durable cursor. On reconnection,
the first version fetches a fresh snapshot and follows after its `latest_sequence`. It does not try
to replay temporary token animation.

### Identifier responsibilities

The identifiers are separate because they name different objects or properties:

- `session_id` identifies the complete conversation and workspace.
- `execution_id` identifies one attempt by a runner to advance the session. Stop can use it as an
  optional guard against cancelling newer work.
- `message_id` identifies one user-visible message. Temporary deltas and the completed durable
  message use the same message ID so the client can replace the preview instead of adding a second
  copy.
- `record_id` identifies one durable producer fact. A retry uses the same record ID, allowing
  ingestion to recognize a duplicate without creating another fact.
- `sequence` is not an object ID. It orders committed durable facts within one session and lets a
  reader ask for everything committed after a known point.

One execution can create several messages, tool calls, interactions, and durable records. One
execution ID therefore cannot replace their individual IDs. The database assigns the per-session
sequence when the durable record commits. The producer assigns stable object and record IDs before
submitting their first frames or durable writes.

### Manage pending input

```http
DELETE /sessions/{session_id}/inputs/{input_id}
```

Removal fails after promotion. The first version does not support edit or reorder operations.

### Respond to an interaction

The current interaction response route may remain during migration. The target public shape can
place the interaction under its session:

```http
POST /sessions/{session_id}/interactions/{interaction_id}/responses
```

URL nesting does not provide correctness. Durable acceptance, single-winner resolution, and
recoverable continuation provide correctness.

### Delete a session

Delete remains a destructive session operation. It is not another meaning of Stop.

## Durable input and command model

### Inputs

An input stores user content independently from the execution that will process it.

```text
input_id
session_id
idempotency_key
content
on_busy
status: pending | promoted | removed
admitted_at
promoted_at
```

The API assigns admission order. A transaction promotes one eligible input at a time.

### Commands

Commands carry execution-affecting intent to a runner.

```text
command_id
session_id
type
target_execution_id
payload
status: pending | claimed | applied | obsolete
claimed_by
claim_expires_at
created_at
applied_at
result
```

The command lifecycle is internal:

```text
pending -> claimed -> applied
                   -> obsolete
```

A claim is a lease. If the runner disconnects before settlement, the claim expires and delivery can
repeat. `applied` means the runner reported the result. It does not replace public execution state.

### Atomic acceptance

The API saves an input or command and its idempotency key in one Postgres transaction. A repeated
request with the same idempotency key returns the existing result. The transport runs only after
the transaction commits.

## Runner control delivery

The core command service depends on a port rather than a transport implementation:

```text
deliver(command, runner_target)
recover(command_id)
settle(command_id, result)
```

The first adapter uses the existing authenticated direct API-to-runner route. The API attempts
delivery only after the durable command commits. A failed call leaves the command pending for
reconciliation. Command truth remains in Postgres.

Runner-initiated authenticated HTTP long polling is a designed but parked adapter. It becomes
relevant if a future runner cannot accept inbound calls. Its design is tracked in
[Linear AGE-4253](https://linear.app/agenta/issue/AGE-4253/parked-add-runner-initiated-long-polling-for-session-commands)
and PR #6497.

Changing adapters must not change the public API, durable command states, idempotency, or settlement
rules.

## Stop

### Acceptance

The API resolves the session's current Redis-owned execution. It validates the optional
`expected_execution_id`, creates one Stop command, and reports `stopping`. Repeated Stop requests
return the existing pending or terminal result.

### Ownership while stopping

The first version keeps current ownership while cancellation runs. It does not free the session
when Stop is merely accepted. This prevents a normal second start before the old runner settles.

After settlement, clear `running`. Retain `alive` only when the runner confirms that the
harness, all tool child processes, and the sandbox are safely parked. Normal idle expiry later
clears `alive`. A failed or unsafe park clears both flags. Reviewers must verify every current
liveness consumer implements this contract.

### Delivery

The API delivers Stop directly to the runner after the durable command commits. Heartbeat remains
useful for health, ownership renewal, and missing-runner detection. It is not the normal Stop
signal. If direct delivery fails, the durable pending command remains available for recovery.

### Runner behavior

The runner stops starting model and tool work, interrupts the active operation where supported,
and settles partial output honestly. It parks the sandbox only after the harness prompt and every
in-flight tool child process have stopped. If the harness cannot prove this state, the runner
destroys or isolates the sandbox instead of claiming warm resume. It then reports the stopped
outcome, clears owner-checked `running`, and applies the reviewed post-Stop `alive` rule.

### Missing runner

If the runner disappears, the command claim expires. Existing heartbeat and orphan recovery clear
stale liveness. Recovery records `lost` rather than claiming that cancellation completed. The exact
settlement timeout depends on the sandbox cancellation spike.

### Reviewer gate: warm cancellation

Implementation must not claim warm Stop support until a spike proves Stop followed by resume in the
same sandbox and native harness session. The spike must cover model calls, active tools, partial
messages, Pi, Claude Code, sandbox-agent changes, and Daytona snapshot impact. Local Pi and Codex
prompt continuation passed, but Codex left an in-flight shell child running. Codex warm parking
therefore remains unsupported until child-process termination is proven.

## Queue and Steer

### Queue

The API saves a pending input. Every snapshot shows it. After the active execution completes
normally, the server promotes exactly one pending input in admission order and starts it. Manual
Stop pauses automatic promotion. Pending inputs remain visible until the user resumes, removes
them, or submits another explicit start action.

### Steer

The API first saves the steering input. It then creates a Stop command whose reason is `steer`.
After the old execution reaches a terminal outcome, the server promotes the saved input. A failed
or lost cancellation does not discard the input.

The steering input takes priority over older queued input because it expresses an immediate change
of direction. Older queued input remains pending and visible. It returns to normal first-in,
first-out promotion after the steering execution completes normally. Manual Stop does not promote
either the queue or a new input.

Steer uses Stop and continue. It does not inject text into an arbitrary provider request. A harness
with a native steering capability may later supply another adapter behind the same public policy.

### Busy default

**AI-selected default:** `reject` remains the default until all first-party clients display the
server queue. This avoids silently changing existing concurrent-send behavior. The product can
change the default to `queue` after the shared pending-input interface ships.

## Approvals and pauses

The current runner already ends an execution when the harness requests approval. It creates a
durable pending interaction, persists an `interaction_request` record, and parks the harness in its
process-local keepalive pool as `awaiting_approval`. An answer later invokes the workflow again with
a new execution ID. The runner resumes the parked harness when possible and otherwise reconstructs
the conversation from durable records.

The new contract preserves that behavior. It adds an explicit durable `execution.waiting` fact
that names the pending interaction IDs. `waiting` means that this execution has ended normally at
an interaction boundary and that the session can continue after an answer. It does not mean the
execution remains live, owns a runner, or keeps heartbeating. This removes the need for a client to
infer waiting from a pending interaction, records, Redis liveness, and process-local keepalive
state.

An interaction response uses a resource-specific public endpoint and the internal command path.
The API durably records one winning response before reporting success. In the same Postgres
transaction it creates a continuation execution and a durable continuation command. A successful
response means that the answer and continuation intent are saved. It does not claim that a runner
has started.

If the transaction fails, the interaction remains pending and no continuation exists. If delivery
fails after commit, the command remains retryable under the same command ID and the interaction
does not return to pending. Duplicate delivery cannot start another execution. If continuation
cannot start or starts and later fails, its execution reaches an explicit `failed` or `lost`
outcome. The accepted answer remains saved, and the session remains available for retry or a new
message.

Clients follow public interaction and execution facts rather than internal command claims. A
typical sequence is `interaction.responded`, `execution.accepted`, `execution.started`, and an
execution terminal outcome.

Stop cancels pending interactions that belong to the stopped execution. A late response cannot
resume a stopped or replaced execution. A response remains recoverable if continuation fails to
start. The interaction state and continuation outcome appear in the snapshot and durable events.

Stop and interaction response transitions are serialized in Postgres. The first committed
transition wins. If Stop cancels a pending interaction first, a later response returns a conflict
and creates no continuation. If a response commits first, its continuation execution becomes the
new work. A Stop guarded with the old execution ID returns a conflict rather than following the
relationship and stopping the continuation. The client refreshes and can explicitly stop the new
execution. An unguarded Stop still targets the session's current execution at API acceptance.

## Shared live frames

### Canonical runner output

The runner emits one ordered sequence of frames with stable frame IDs and execution identity. The
API places accepted frames in a bounded Redis Stream. Two independent consumers use it:

- The live relay forwards frames to connected session readers.
- The durable projector combines frames into permanent message, tool, interaction, and lifecycle
  facts.

The runner does not wait for browsers. A slow client cannot delay execution.

### Migration

The API intercepts the runner response stream already passing through it and places frames in
Redis. During the first migration stage, the initiating browser keeps its existing invoke response
while other readers use the shared relay. Both views derive from the same runner frame sequence.

After multi-reader streaming is proven, the initiating browser becomes an ordinary relay reader.
The start request can then return after durable acceptance, and client disconnection no longer owns
execution. A later resumable runner-to-API ingress can replace the initial adapter without changing
the relay, projector, or public read contract.

### Temporary retention

Redis retains frames for a bounded recovery window. Temporary frames do not advance the durable
cursor. Retention has both an age limit and a size or frame-count limit. Measurements of real
executions determine the initial values.

The runner never waits for a browser. Each reader has a bounded outgoing buffer. If a reader falls
too far behind, the API closes that reader's event connection. On every disconnect, the first
client implementation discards unfinished previews, fetches a fresh durable snapshot, and follows
again after the snapshot sequence. It does not require a separate `resync_required` event. Missing
temporary frames can reduce token animation but cannot block execution or corrupt durable state.

### Multiple API processes

Redis and Postgres hold shared state. A runner and a reader can connect to different API processes.
Each API process reads the same session frame stream and durable history.

## Durable events and snapshots

### Repaired records as durable history

Records are the canonical durable source for the conversation, harness reconstruction, session
snapshots, and replay. The design does not add a separate `session_events` table.

Spike D found three repeated-ID cases. Exact delivery retries already fit immutable inserts. Resume
re-emission uses a different execution identity and does not collide. Progressive tool calls and
tool results are the remaining intentional updates: the runner can persist an incomplete tool
payload, then repair the same row when later arguments or output arrive.

Before immutable inserts are enabled, the runner keeps progressive tool frames temporary and emits
one complete durable tool call and one complete durable tool result. Those final checkpoints must
commit before terminal settlement. Every terminal event also receives a stable producer-generated
ID so a transport retry cannot create two terminal rows.

Temporary tool frames can expire and may contain the same sensitive tool inputs that current live
events contain. They never serve as the resume source. A reconnect may miss partial animation, but
the next durable checkpoint repairs the client.

The migration is additive. Existing records are not rewritten or backfilled. Snapshot reads retain
the current legacy ordering and include all existing conversation history. Newly committed records
receive an ordered replay sequence. The snapshot returns the latest new-format cursor. Clients use
the snapshot as their baseline and do not request event-by-event replay of pre-migration history.

Existing clients continue using current record queries and ignore the additive sequence field. New
clients load the same transcript snapshot, then follow records after its cursor. Existing sessions
remain resumable. Their old ordering defects and duplicates are not rewritten.

Before this becomes permanent session history, implementation must separate session retention from
tracing quota and retention and add durable record types for execution and interaction lifecycle.
A separate event table is a fallback only if a spike proves one of those changes structurally
unsafe.

### Event model

Each durable event contains:

```text
event_id
session_id
session_sequence
type
execution_id
entity_id
payload
created_at
```

Events never change after insertion. Exact retries reuse `event_id` and become verified no-ops.
A progressive update uses a new event ID while retaining the same message, tool, or interaction ID.

### Ordering

The projector assigns `session_sequence` in the same Postgres transaction that inserts the event.
It serializes assignment per session, for example by locking one session cursor row. A plain global
database sequence is insufficient because sequence allocation can happen before transactions
commit in another order.

### Snapshot

The API reads the session projection and its durable cursor from one consistent database view. The
snapshot contains:

```text
session identity
messages
current execution state
pending inputs
pending interactions
cursor
history completeness
```

The cursor is opaque to clients.

### Replay and live handoff

The event endpoint registers its live wake-up before reading historical events. It then reads all
committed events after the requested cursor and follows new commits. A lost notification causes
another database read. It cannot create a permanent gap.

### Record delivery and incomplete history

The runner assigns a stable ID before sending each durable checkpoint. It retries timeouts,
disconnects, overload responses, and backend failures with the same ID. Identical duplicates count
as success. A conflicting payload under the same ID and output after terminal settlement are
non-retryable correctness responses. A committed terminal outcome closes the execution's session
history. Later non-terminal output receives `execution_terminal`, is excluded from the
conversation, and produces diagnostic logs and metrics. Version one adds no quarantine table.

The runner does not block model streaming on each database commit. It holds unconfirmed durable
checkpoints in a bounded in-memory buffer. Before submitting a successful terminal outcome, it
stops accepting new output and waits for a bounded final flush. It never reports successful
completion when durability remains unknown.

The first version does not add a persistent runner spool. A runner crash may lose the unconfirmed
tail. The watchdog records `lost`, marks history incomplete, releases the session for new input,
and preserves every previously committed record. The user can continue from the last committed
history.

The API also marks history incomplete when retention, truncation, quota rejection, or other
unrecoverable delivery loss prevents full reconstruction. It does not silently present partial
history as complete.

### Reviewer gate: stable record IDs

Before changing current record upserts, inventory every repeated stable `record_id`. Classify each
case as an exact retry, temporary progressive update, or resume re-emission. Preserve final tool
state, interaction responses, terminal outcomes, and harness reconstruction.

## Client state

Desktop and mobile use one state reducer over the same snapshot and event vocabulary.

Opening a session follows this sequence:

1. Read a snapshot with cursor N.
2. Open the event stream after N.
3. Apply durable events in sequence.
4. Apply temporary frames as previews.
5. Replace previews when durable checkpoints arrive.

The client does not infer remote execution from disagreement between a local request flag and a
cached liveness flag. It renders explicit execution, input, interaction, and history state from the
server.

The current watch endpoint remains during migration. Clients remove it only after the new event
stream provides lifecycle, interaction, and transcript updates.

## Failure handling

| Failure | Required behavior |
|---|---|
| Client disconnects | Execution continues. Client reloads a snapshot and reconnects after its cursor. |
| Long poll disconnects | Command remains pending or its claim expires for redelivery. |
| Duplicate command delivery | Runner returns the existing result for the same `command_id`. |
| Runner disappears | Heartbeat lease expires. Recovery records `lost`; pending inputs remain. |
| API process restarts | Runner and clients reconnect to another process. Shared state remains in Redis and Postgres. |
| Live relay fails | Durable projection continues. Clients repair from snapshot and durable events. |
| Durable projector fails | Redis entry remains pending. The projector retries before acknowledgement. |
| Postgres commit succeeds but wake-up fails | Readers query after their cursor and recover the event. |
| Slow browser | API disconnects it after a bounded buffer. Runner continues. |
| Old temporary frames expire | Durable checkpoint replaces the incomplete preview. |

## Ports and adapters

Core session logic must not import transport-specific Redis, SSE, long-poll, or WebSocket behavior.

```text
CommandRepository
InputRepository
CommandDelivery
ExecutionOwnership
LiveFrameIngress
SessionEventStore
SessionSnapshotStore
```

Initial adapters use Postgres, current Redis ownership, HTTP long polling, Redis Streams, and SSE.
Later adapters can change transport without changing public resources or state transitions.

## Migration plan

### Preparation and spikes

1. Map all current cancel, kill, steer, approval, heartbeat, and invoke paths.
2. Prove warm cancellation and identify sandbox-agent or Daytona work.
3. Inventory stable record-ID reuse.
4. Confirm the separate session-event table or select repaired records instead.

### Fast Stop

1. Add the command repository and service.
2. Add long-poll claim and acknowledgement endpoints.
3. Add the runner claim loop behind the delivery adapter.
4. Make Stop create a durable command with an optional execution guard.
5. Keep Redis ownership until cancellation settles.
6. Add heartbeat command discovery as fallback.
7. Emit stopped or lost outcomes and notify current watch clients.

### Shared live reading

1. Add stable frame envelopes.
2. Add the Redis frame stream and API relay.
3. Let secondary readers render live frames while the sender keeps its current stream.
4. Compare both paths in automated and live tests.
5. Move the sender to the shared stream after detached execution is ready.

### Durable snapshot and replay

1. Add the selected event store and per-session commit order.
2. Build projections and snapshots through a cursor.
3. Add replay followed by live delivery.
4. Migrate desktop and mobile.
5. Retire full transcript refetches and the old watch endpoint after compatibility coverage.

### Queue, Steer, and approvals

1. Add durable inputs and visible pending state.
2. Move the browser queue to the server.
3. Implement Queue promotion.
4. Implement Steer as saved input, Stop, then promotion.
5. Move interaction continuation through durable commands.

## Test plan

### Stop

- Stop reaches the runner within five seconds under normal operation.
- Stop followed by Send resumes the same warm sandbox and native harness session.
- Repeated Stop does not perform cancellation twice.
- A mismatched optional execution guard cannot stop newer work.
- New work cannot start while normal cancellation is unsettled.
- A broken long poll falls back to heartbeat command discovery.
- A missing runner reaches `lost` rather than remaining `running` forever.

### Commands and input

- A lost API response followed by retry creates one command or input.
- A runner disconnect after claim causes safe redelivery.
- Every client sees the same pending input order.
- Removing a promoted input fails without losing it.
- Failed Steer preserves its saved input.
- One interaction response wins under concurrent answers.

### Shared reading

- Sender, second browser, and mobile render the same live text and tool progress.
- A slow reader does not change runner throughput.
- Refresh during execution reconstructs durable state and continues live output.
- Different API processes can host the runner ingress and browser stream.
- Expired temporary frames are repaired by the next durable checkpoint.

### Replay

- Snapshot cursor N followed by events after N loses no committed event.
- Reconnect after cursor N does not duplicate durable state.
- Concurrent commits preserve the exposed per-session order.
- Projector failure does not acknowledge unwritten Redis entries.
- A detected persistence gap marks history incomplete.

## Alternatives

### Keep heartbeat-only Stop

Rejected because normal delivery can take one heartbeat interval and does not acknowledge the
command independently from ownership state.

### Direct runner calls

Deferred as a possible managed-runner adapter. The first design uses long polling because durable
claims and reconnection have a clearer recovery model. Possible user-operated runners strengthen
this choice but are not a current requirement.

### Runner Redis subscriptions

Not selected as the first adapter because they expose backend infrastructure credentials and make
Pub/Sub loss part of runner recovery. Redis can remain an internal API wake-up mechanism.

### WebSocket or gRPC control

Deferred. They reduce repeated requests but add connection ownership, routing, and recovery work.
The command-delivery port allows a later adapter.

### Persist every token

Rejected because durable transcript and recovery do not require token-level history. Redis retains
temporary frames for live experience; completed facts persist.

### Redis as permanent session history

Rejected because bounded streams, eviction, and operational recovery do not match permanent
session-history requirements.

### Repair records into the event log

Not rejected. This remains the main alternative to a separate session-event table. A reviewer must
decide after the stable-ID and retention analysis.

### Replace Redis ownership now

Deferred because Agenta currently operates one runner and does not plan near-term scaling. The
change has substantial migration cost and limited immediate user value.

## Reviewer gates

These points remain deliberately open even though this RFC provides provisional defaults:

1. Prove warm Stop and determine sandbox-agent and Daytona changes.
2. Confirm direct-delivery retry and recovery behavior. Keep long-poll claim design parked in
   Linear AGE-4253.
3. Confirm whether manual Stop pauses all queued input until an explicit resume action.
4. Verify the repaired-record migration, retention separation, and lifecycle record vocabulary.
5. Select the per-session cursor transaction strategy.
6. Define temporary frame retention and client buffer limits from measurements.
7. Confirm interaction behavior when Stop, Steer, and an answer race.
8. Confirm final public endpoint names.
9. Map each implementation phase to the issue inventory before claiming an issue fixed.
10. Confirm the exact API response contract for retryable delivery failure, duplicate success,
    conflicting payload, and output after terminal settlement.
11. Confirm Spike D found every intentional progressive record update.
12. Verify the terminal-settlement and record-ingest transaction prevents the demonstrated
    stale-tail race.
13. Verify every current liveness consumer implements the confirmed post-Stop `running` and
    `alive` contract.

## Approval

This RFC is not approved. Human review must distinguish:

- decisions confirmed during the 2026-09-02 discussion;
- provisional AI-selected defaults;
- spike results that can change the design;
- future work intentionally excluded from the first version.
