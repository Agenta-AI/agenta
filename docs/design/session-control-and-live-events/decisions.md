# Decisions

> **AGENT-GENERATED, LOW WEIGHT, DRAFT.** Confirmed items record Mahmoud's statements from the
> 2026-09-02 discussion. Provisional items are AI-selected defaults for review. Nothing is approved
> for implementation until a human reviews the draft RFC.

## Confirmed direction

### Start from bugs and requirements

The design starts with the open issue inventory and the properties the final system must satisfy.
An issue observation does not by itself approve a feature or implementation.

### Keep control and reading independent

The client-to-runner control path and runner-to-client read path can proceed in parallel. Stop does
not wait for shared live output. Shared live output does not wait for Queue or Steer.

### Preserve live output

Moving readers behind the API must not reduce live output to completed paragraphs. Every authorized
reader should receive temporary text and tool progress frames.

### Separate temporary frames from permanent facts

Temporary frames can expire. Completed messages, tool results, interaction state, and execution
outcomes need durable recovery.

### Separate Stop from Delete

Stop preserves the session and workspace. Delete removes the session and its scoped resources.

### Require warm resume after Stop

The Stop spike must prove that the next message resumes the same sandbox and native harness
session. If the current sandbox agent cannot do this, the spike must identify the patch and Daytona
snapshot work.

### Use five seconds as the provisional Stop target

Within five seconds of accepted Stop under normal operation, the runner stops starting new model
and tool actions. The deadline for interrupting an already-running provider or tool call depends on
the capability spike.

### Use one public session interface

Desktop, mobile, integrations, and external clients use the same public session resources. The
runner uses a private protocol for trusted execution work.

### Make the expected execution guard optional

Stop can include `expected_execution_id`. When omitted, it targets the current execution at API
acceptance. When supplied, a mismatch prevents an old request from stopping newer work. First-party
clients must send the guard whenever they know the active execution. A mismatch returns a conflict
and leaves the current execution untouched.

### Make accepted input durable

A successful Send, Queue, or Steer response means the API saved the input and idempotency identity.
It does not wait for runner claim or output.

### Keep pending inputs visible and immutable

Every client can see pending input. A client can remove it before promotion. Editing means remove
and replace. The initial interface does not reorder pending input.

### Separate delivery state from execution state

Internal commands use `pending`, `claimed`, `applied`, and `obsolete`. Claims can expire and retry.
Public clients follow execution state and durable outcomes rather than transport acknowledgements.

### Use direct delivery behind an adapter

The first version uses a direct authenticated API-to-runner call. The command service depends on a
delivery port, not on this transport. Runner-initiated HTTP long polling remains a designed,
parked adapter for a future runner that cannot accept inbound calls. See
[Linear AGE-4253](https://linear.app/agenta/issue/AGE-4253/parked-add-runner-initiated-long-polling-for-session-commands).

### Keep Redis ownership in the first version

The first version retains the existing Redis `alive`, `running`, `owner`, and `superseded` model.
It does not add Postgres ownership generations or full stale-writer rejection. The current system
has one runner and does not plan near-term runner scaling.

### Keep ownership while Stop settles

Accepting Stop does not immediately free current ownership. Direct delivery sends the command.
Heartbeat remains a health and ownership signal, and recovery can reconcile a pending durable
command after direct delivery fails. The exact post-Stop `alive` rule remains open: the candidate
is to clear `running` after settlement and retain `alive` while the sandbox remains parked.

### Add new read contracts beside old endpoints

The snapshot and replayable event routes do not change the meaning of current stream and watch
routes. Clients migrate before obsolete endpoints are removed. Final route names remain open.

## Provisional AI-selected defaults

### Use one canonical live-frame path

The runner emits one ordered frame sequence to the backend. A bounded Redis Stream feeds the live
relay and durable projector. Existing sender streaming and record persistence remain during
migration.

### Keep the durable-history storage choice open

Spike D found that immutable records mainly require producer changes for progressive tool calls and
tool results, plus stable producer IDs for terminal events. This makes repaired records more viable
than the original draft assumed. Records still follow tracing retention and omit some session
lifecycle facts. A separate `session_events` table and repaired records therefore remain equal
review alternatives until retention and lifecycle coverage are decided.

### Use an opaque per-session cursor

The event store assigns commit-safe per-session order. Clients treat cursors as opaque values. A
snapshot and its cursor come from one consistent database view.

### Default busy sends to reject during migration

The first public default remains `reject` until every first-party client displays the server queue.
The product can later change the default to `queue`.

### Pause queue promotion after manual Stop

Manual Stop leaves pending inputs visible and does not immediately start the next one. Normal
completion promotes one pending input in admission order. This avoids making Stop appear to fail.

### Model Steer as saved input followed by Stop

The API saves the steering input first, stops current work, and promotes the input after terminal
settlement. A failed Stop does not discard the steering input.

### Use one client reducer

Desktop and mobile apply the same snapshot and event vocabulary. Temporary frames create previews.
Durable checkpoints replace those previews.

## Reviewer gates

1. Warm cancellation behavior in each harness and sandbox.
2. Confirm direct-delivery failure recovery. Keep long-poll authentication and claim-expiry design
   parked in Linear AGE-4253.
3. Manual Stop behavior for pending input.
4. Separate session events versus repaired records.
5. Per-session commit-order implementation.
6. Temporary frame retention and slow-reader limits.
7. Stop, Steer, and interaction-response races.
8. Final public endpoint names.
9. Confirm Spike D covered every intentional progressive record update before any immutable-record
   migration.
10. Decide whether late output after watchdog settlement is rejected or quarantined.
11. Define `running` and `alive` after warm Stop against every current liveness consumer.

## Deferred decisions

- Postgres execution ownership.
- Ownership generations and full stale-writer rejection.
- Multiple-runner guarantees beyond current behavior.
- User-operated runner requirements.
- Runner-initiated command long polling, tracked in Linear AGE-4253.
- WebSocket or gRPC control transport.
- Queue editing and reordering.
- Permanent token storage.
