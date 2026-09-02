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

Pending discussion.

### Immediate control

Pending discussion.

### Live frame ingress and relay

Pending discussion.

### Durable events and replay

Pending discussion.

### Detached sender

Pending discussion.

### Durable commands

Pending discussion.

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
