# Work package: Queue, Steer, and approvals

> **AGENT-GENERATED, low weight.**

## User-visible result

Every client sees pending input. Queue and Steer apply one server policy, and approval responses
cannot disappear when continuation delivery fails.

## Current behavior

The desktop queue lives in browser memory. A second client cannot inspect it. Approval responses
use a separate continuation path. Current Steer behavior is not one durable server operation.

## Scope

- Durable pending input and admission order.
- Queue visibility and removal.
- Normal first-in, first-out promotion.
- Manual Stop pausing promotion.
- Steer save, Stop, and priority promotion.
- Atomic interaction response, continuation execution, and command.
- Stop, Steer, and response races.

## Dependencies

Reliable Stop and the command contract must pass first. The public snapshot must expose pending
input and interactions before the busy default can change from `reject` to `queue`.

## Implementation sequence

1. Add durable input storage and snapshot visibility.
2. Move the browser queue to the server.
3. Add normal promotion and manual Stop pause.
4. Route approval continuation through durable commands.
5. Add Steer as save, Stop, then priority promotion.
6. Run concurrency and failure tests for every race.

## Completion gate

- Every client shows the same pending order.
- Accepted input survives client and delivery failures.
- Manual Stop starts no pending input automatically.
- Failed Steer preserves its saved input.
- One interaction response wins, and its continuation is recoverable.
