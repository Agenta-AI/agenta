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

The working public interface separates four operations. This is a proposal, not an approved API.

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
cancels whichever execution is active when the request is applied.

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

Follow durable events and live frames:

```http
GET /sessions/{session_id}/events?after=<cursor>
Accept: text/event-stream
```

Rename, archive, delete, and hard termination remain explicit session resource or lifecycle
operations. Attach is replaced by reading the snapshot and event stream.

### Current and proposed public behavior

| Operation | Today | Proposed direction | Change |
|---|---|---|---|
| Send | Invoke a workflow and read its response stream | Keep this during migration. Later accept work independently and return an execution ID | Later change |
| Stop | `POST /sessions/streams/` with no inputs and `force=false` | `POST /sessions/{id}/cancel` with an expected execution ID supplied by the client | Clearer endpoint and faster delivery |
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
input.updated
input.removed
input.promoted
```

The smallest useful management interface is:

```http
PATCH /sessions/{session_id}/inputs/{input_id}
DELETE /sessions/{session_id}/inputs/{input_id}
```

PATCH edits pending content. DELETE removes pending input. Both reject changes after the input was
promoted into active work. Reordering is an open choice. It can use `position` in PATCH if the
product needs it.

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

The runner can hold an authenticated outbound control stream to the API. This keeps Redis and
Redis credentials behind the API boundary. In a multi-API deployment, Redis can route wake-ups to
the API instance that holds the runner connection. A per-runner Redis channel is simpler but
couples the runner directly to Redis. Direct pod addresses are the least portable option.

### Immediate control

The existing `/sessions/streams/` endpoint is a coordination-state edit, not a durable command
inbox. It derives Send, Steer, Cancel, and Attach from inputs plus a `force` flag. Normal desktop
Send does not use this endpoint. A future explicit command contract must replace the ambiguous
shape without silently changing existing invoke behavior.

### Live frame ingress and relay

Pending discussion.

### Durable events and replay

Pending discussion.

### Detached sender

Pending discussion.

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
