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
command after direct delivery fails.

After cancellation settles, clear `running`. Retain `alive` only when the runner confirms that
the harness, all tool child processes, and the sandbox are safely parked. Normal idle expiry later
clears `alive`. A failed or unsafe park clears both flags.

### Add new read contracts beside old endpoints

The snapshot and replayable event routes do not change the meaning of current stream and watch
routes. Clients migrate before obsolete endpoints are removed. Final route names remain open.

### Use one canonical live-frame path

The runner emits one ordered frame sequence to the API. The API places it in a bounded Redis
Stream. The live relay forwards temporary frames to every reader. The durable projector combines
the same frames into complete immutable records in Postgres.

During migration, the initiating browser keeps its existing invoke response while other readers
use the relay. After multi-reader behavior is proven, the initiating browser becomes an ordinary
relay reader and the start request no longer owns execution.

## Provisional AI-selected defaults

### Use repaired records as durable session history

Records become the canonical durable source for the conversation, harness reconstruction, session
snapshots, and replay. Before immutable inserts are enabled, the runner must stop progressively
updating tool-call and tool-result records, and every durable record must receive a stable producer
ID.

The migration is additive. Existing rows are not rewritten or backfilled. A snapshot continues to
return the complete legacy and current transcript. Its cursor covers ordered records committed
under the new contract. Clients do not require event-by-event replay of history created before the
migration.

Session-history retention must be separated from tracing quota and retention before records can
serve as permanent session history. A separate `session_events` table remains a fallback only if
that separation or lifecycle representation proves structurally unsafe.

### Use a database-assigned per-session sequence as the cursor

The snapshot returns `latest_sequence`. The event route accepts `after=<latest_sequence>`. A new
empty session starts at `0`. The database assigns the next sequence when a durable record commits,
and a snapshot and its sequence come from one consistent database view.

Temporary live frames do not receive a sequence and do not advance the cursor. In the first
version, a reconnect fetches a fresh snapshot and follows after its returned sequence. Stable
session, execution, message, tool, interaction, and record IDs identify objects. The sequence only
orders durable session facts.

### Default busy sends to reject during migration

The first public default remains `reject` until every first-party client displays the server queue.
The product can later change the default to `queue`.

### Pause queue promotion after manual Stop

Manual Stop leaves pending inputs visible and does not immediately start the next one. Normal
completion promotes one pending input in admission order. This avoids making Stop appear to fail.

### Model Steer as saved input followed by Stop

The API saves the steering input first, stops current work, and promotes the input after terminal
settlement. A failed Stop does not discard the steering input. The steering input runs before
older queued input because it expresses an immediate change of direction. Older queued input
remains pending and visible, then returns to normal first-in, first-out promotion after the
steering execution completes normally.

### Accept bounded in-memory delivery in version one

The runner may buffer unconfirmed durable checkpoints in memory. Temporary delivery failures retry
with the same stable IDs. Before terminal settlement, the runner waits for a bounded final flush.
A runner crash may lose the unconfirmed tail. The watchdog then records `lost`, marks history
incomplete, releases the session, and allows the user to continue from the last committed history.

The first version does not add a persistent runner spool. Clean failure and continued session use
take priority over preserving unconfirmed output.

### Reject output after terminal settlement

A committed terminal outcome closes that execution's session history. The API rejects later
non-terminal records with a non-retryable `execution_terminal` conflict. The runner stops
sending output for that execution. The API records diagnostic logs and metrics but does not add a
permanent quarantine table in version one. A watchdog-lost execution is already marked incomplete,
and the session remains available for a new message.

### Use one client reducer

Desktop and mobile apply the same snapshot and event vocabulary. Temporary frames create previews.
Durable checkpoints replace those previews.

## Reviewer gates

1. Warm cancellation behavior in each harness and sandbox.
2. Confirm direct-delivery failure recovery. Keep long-poll authentication and claim-expiry design
   parked in Linear AGE-4253.
3. Manual Stop behavior for pending input.
4. Verify the additive repaired-record migration, retention separation, and lifecycle record
   vocabulary.
5. Per-session commit-order implementation.
6. Temporary frame retention and slow-reader limits.
7. Stop, Steer, and interaction-response races.
8. Final public endpoint names.
9. Confirm Spike D covered every intentional progressive record update before any immutable-record
   migration.
10. Confirm the remaining API status codes and payload fields for retryable delivery failure,
    duplicate success, conflicting payload, and `execution_terminal`.
11. Verify every current liveness consumer implements the confirmed post-Stop `running` and
   `alive` contract.

## Deferred decisions

- Postgres execution ownership.
- Ownership generations and full stale-writer rejection.
- Multiple-runner guarantees beyond current behavior.
- User-operated runner requirements.
- Runner-initiated command long polling, tracked in Linear AGE-4253.
- WebSocket or gRPC control transport.
- Queue editing and reordering.
- Permanent token storage.
