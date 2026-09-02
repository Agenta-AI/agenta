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

The working public interface separates resources, commands, queries, and events.

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

Control an active execution:

```http
POST /sessions/{session_id}/commands

{
  "type": "cancel",
  "expected_execution_id": "execution-12"
}
```

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

Read current state:

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
