# Session control and live events architecture

> **AGENT-GENERATED, low weight.**

## Components

- **Client:** Desktop, mobile, or an external API consumer.
- **API:** The public authority for accepting work and reading session state.
- **Runner:** The private service that starts a sandbox and drives a coding harness.
- **Sandbox:** The isolated environment that holds files and processes for a session.
- **Harness:** Pi, Claude Code, Codex, or another program that drives the model and tools.
- **Postgres:** Durable commands, inputs, interactions, records, and session projections.
- **Redis:** Current execution ownership, health leases, temporary frames, and wake-up signals.

## Command path

The client submits an operation to the API. The API validates ownership and optional execution
guards, commits the operation to Postgres, and returns acceptance. After the commit, a delivery
adapter sends the command to the runner.

```text
Client -> API -> Postgres commit -> direct delivery -> Runner -> settlement -> Postgres
```

A failed delivery does not erase acceptance. The command remains recoverable. The public client
follows execution state rather than private delivery state.

## Live-output path

The runner emits one ordered sequence of temporary frames. The API writes those frames to a bounded
Redis Stream. The API relays them to all connected clients through Server-Sent Events (SSE).

```text
Runner -> API -> Redis Stream -> API SSE -> Client A
                                      `-> Client B
                                      `-> Mobile
```

The runner never waits for a browser. The API closes a slow reader when its buffer fills. A client
that disconnects reloads durable state before following again.

## Durable-history path

Complete messages, tool results, interactions, and execution outcomes become durable records in
Postgres. The database assigns each new durable fact the next sequence for its session in the same
transaction that inserts it.

```text
temporary frames -> complete checkpoint -> Postgres record + session sequence
```

The snapshot and replay interfaces read Postgres. Redis notifications only wake readers so they can
query after their last sequence.

## Ownership and health

Redis stores current `alive`, `running`, `owner`, and `superseded` values. The runner refreshes its
lease through heartbeats. The Postgres session row mirrors user-facing liveness for queries.

Direct delivery carries Stop. Heartbeats answer another question: whether the runner is still
healthy and still owns the execution. When heartbeats stop, the watchdog writes a terminal `lost`
outcome and releases the session.

## Stop sequence

1. The client asks the API to stop the session. It may name the expected execution.
2. The API validates the guard and commits a Stop command.
3. The API delivers the command directly to the owning runner.
4. The runner stops new work and asks the harness to cancel active work.
5. The runner verifies that active tool children ended.
6. The runner writes the stopped outcome and parks the safe sandbox.
7. Settlement clears `running`, keeps `alive` during the park window, and updates Postgres.
8. A later message resumes the parked session. Normal idle expiry eventually clears `alive`.

If cancellation cannot prove a safe park, the runner destroys or isolates the sandbox and reports
that outcome. It never advertises warm continuation while abandoned work remains active.

## Failure recovery

- A browser failure does not affect execution.
- An API replica failure leaves commands and history in shared storage.
- A runner failure expires through its lease and watchdog.
- A Redis live-frame failure can lose animation but not committed history.
- A Postgres failure leaves unacknowledged record work in the Redis ingest stream.
- A stale runner that sends output after terminal settlement receives `execution_terminal`.
- Any terminal failure releases the session for another message.

## Migration

The first shared-output stage keeps the sender on its existing invoke response and sends the same
runner frames to secondary readers through the relay. After shared reading and replay pass their QA
gates, the sender becomes an ordinary event reader. Only then can the start request finish without
owning the execution stream.
