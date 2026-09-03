# Session control and live events architecture

> **AGENT-GENERATED, low weight.**

## What runs today

The initiating browser reads its invoke response. Secondary clients receive watch notices and
reload completed records. Redis stores runner liveness and ownership, while the records pipeline
writes history to the analytics database.

Stop can travel through a heartbeat. The existing stream runner client treats delivery as best
effort and swallows failures. The command sweep also skips a pending command while the session
still beats.

## Components

- **Client:** Desktop, mobile, or an external API consumer.
- **API:** The public authority for Stop, snapshots, events, and session state.
- **Agent service:** The existing invoke admission path.
- **Runner:** The private service that starts a sandbox and drives a coding harness.
- **Sandbox:** The isolated environment that holds files and processes for a session.
- **Harness:** Pi, Claude Code, Codex, or another program that drives models and tools.
- **Postgres:** Durable commands, inputs, interactions, records, cursors, and projections.
- **Redis:** Ownership, health leases, the records ingest stream, and wake-up signals.

## Command path

The client submits Stop to the API. The API validates access and the optional execution guard,
commits a private command, and returns acceptance. A delivery adapter then calls the runner.

```text
Client -> API -> Postgres command -> deliver(command) -> Runner
```

The transport returns a receipt. The command service owns retry scheduling, recovery, and
settlement. Stop uses an adapter in the commands domain and never reuses
`streams/runner_client.py`, whose best-effort failure policy serves a different purpose.

If direct delivery fails or the API dies after commit, the command remains `pending`. The sweep
redelivers it with the same command ID and bounded attempts while the target session still beats.
If the runner is gone, the sweep settles the command and execution as `lost`.

## Live-output path

The runner wraps invoke frames in the shared envelope and posts them through the existing records
ingest stream. A relay consumer reads temporary frames and forwards them through Server-Sent Events
(SSE). The records worker ignores temporary frames and persists durable events.

```text
Runner -> records ingest stream -> relay consumer -> API SSE -> secondary clients
                              `-> records worker -> Postgres
```

Increment 4 serves secondary readers while the sender stays on invoke. Increment 5 moves the sender
to the same reducer and event connection. A slow reader never blocks the runner.

## Durable-history path

Complete messages, tool results, and execution outcomes become immutable records. A records-domain
cursor allocates the next session sequence in the same analytics transaction as the record unless
Mahmoud chooses to move records to core.

```text
temporary frames -> complete checkpoint -> record plus session sequence
```

The snapshot reads one consistent database view. The event route subscribes before its first replay
query, then queries after the last sequence whenever a wake-up arrives. Redis notifications carry
no durable truth.

## Ownership and health

Redis stores `alive`, `running`, `owner`, and `superseded`. Heartbeats refresh the lease and prove
health. The Postgres session row is a user-facing mirror, not the ownership authority.

The runner and watchdog are the two terminal writers. Both call the same compare-and-set on the
execution row. The runner normally updates the mirror during settlement. The watchdog updates it
when the runner cannot.

## Stop sequence

1. The client sends `POST /sessions/{session_id}/cancel` with an idempotency key and optional
   `expected_execution_id`.
2. The API validates access, the guard, and idempotency. It commits the private Stop command.
3. The API calls `deliver(command)`. A lost delivery result leaves the command recoverable.
4. The runner stops new work and asks the harness to cancel active work.
5. The runner verifies that tool child processes ended.
6. The runner writes the terminal outcome with `UPDATE ... WHERE terminal_state IS NULL`.
7. Where the data shares a database, one transaction settles the command, clears the stopping
   marker, updates the Postgres mirror, and cancels interactions.
8. After commit, an idempotent Redis write clears `running` and keeps `alive` only for a safe park.
9. A later message resumes the safe parked session. Idle expiry eventually clears `alive`.

If the runner cannot settle, the watchdog uses the same terminal compare-and-set. It writes the
ending, clears `running`, releases `alive`, updates the mirror, and settles the command. A sweep
repairs any Redis write missed after the Postgres commit.

The runner and watchdog can race, but only one compare-and-set wins. Late records consult that same
terminal row for every outcome. Their final quarantine or rejection policy remains open.

## Failure recovery

- A browser failure does not affect execution.
- An API failure after command commit leaves the command available for redelivery.
- A runner failure expires through its lease and settles within the 150-second recovery SLO.
- The client shows `recovering` while the watchdog owns recovery.
- A Redis frame failure can lose temporary animation but not committed history.
- A Postgres failure leaves unacknowledged record work pending in the ingest stream.
- A database failure during the terminal check leaves records pending instead of admitting them.
- A timed-out sweep pass is logged, and the loop continues with a later bounded pass.
- Every terminal failure releases the session for another message.

## Migration and rollback

Increment 2 gates durable Stop with `AGENTA_SESSIONS_DURABLE_STOP`. Increment 3 gates new history
writes with `AGENTA_SESSIONS_HISTORY_WRITES`. Increments 4 and 5 gate shared readers with
`AGENTA_SESSIONS_SHARED_READER`.

The API reads all switches through `env.py`. Turning a switch off restores the mounted old path.
Every durable write after sequence migration allocates a sequence, including old endpoint writes.
A compatibility path that cannot meet that rule remains disabled behind the history flag.
