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

### Execution identity and ownership

Current Redis state identifies a logical runner replica and the current `turn_id`. The API does
not currently map that replica identifier to a replica-specific network address. The hard-kill
path calls one configured runner service URL. The RFC must select an immediate-control routing
mechanism before it can define fast Cancel delivery.

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
