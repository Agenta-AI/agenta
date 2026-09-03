# Session control and live events QA

> **AGENT-GENERATED, low weight.**

## Evidence required for every run

Record the exact commit, provider, harness, session ID, execution ID, command ID, timings, terminal
records, Redis ownership, Postgres session state, and runner logs. A passing test proves visible
behavior and durable state on the same run.

The final candidate reruns every applicable row after all selected packages are integrated.

## Invariants

1. One execution has one effective terminal outcome.
2. Previously committed conversation history remains readable.
3. The session accepts another message after failure recovery.
4. A stale runner cannot change visible history after terminal settlement.
5. Stop does not claim warm resume while a tool child remains active.
6. A browser or live relay cannot slow or stop the runner.
7. Snapshot sequence N followed by events after N loses no committed event.

## Provider and harness matrix

Run the Stop, approval, restart, and child-cleanup scenarios on every supported combination.

| Provider | Pi | Claude Code | Codex |
|---|---:|---:|---:|
| Local | Required | Required | Required |
| Daytona | Required | Required | Required before claiming Codex warm Stop on Daytona |

For Codex, run the matrix on the current pin and a candidate current ACP version. Prefer the
upgrade only if cancellation, approvals, tools, warm continuation, and child cleanup all pass.

## Reliable session control

| Scenario | Expected result |
|---|---|
| Stop during output | One stopped outcome; warm continuation succeeds |
| Stop during a long tool | Tool child ends; one stopped outcome; warm continuation succeeds |
| Stop while approval waits | Interaction is cancelled; late answer conflicts; continuation succeeds |
| Second Send during execution | Clear busy conflict; first execution and sandbox remain healthy |
| Stale execution guard | Conflict; current work remains untouched |
| Repeated Stop | One command effect and one terminal outcome |
| Stop immediately after completion | `not_running`; warm sandbox remains available |
| Runner dies while Stop is claimed | Watchdog settles command and execution; next Send succeeds |
| Sandbox disappears | `sandbox_gone`; next Send succeeds |
| Normal runner shutdown | Owner claims release before process exit |
| Forced runner kill | Lease and watchdog recover without cleanup-handler assumptions |
| Runner sends a stale tail | Every late record receives `execution_terminal` and remains absent from history |
| Post-Stop state | Redis and Postgres show `running=false`; `alive=true` only during safe parking |
| Postgres outage during record ingest | Entries remain pending and commit once after recovery |

Normal Stop must reach the runner within five seconds. Current evidence measured 72 to 82
milliseconds locally and 70 to 104 milliseconds for the Daytona Stop response.

## Durable commands and pending input

- Identical idempotent retries return the same command and execution IDs.
- Conflicting reuse of an idempotency key returns a conflict.
- A response lost after commit does not require new work.
- Duplicate delivery applies a command once.
- An unguarded idle Stop returns `already_idle`.
- A guarded stale Stop returns an execution mismatch.
- Stop and approval response have one committed winner.
- Accepted approval continuation survives delivery failure.
- Normal completion promotes one queued input in first-in, first-out order.
- Manual Stop promotes nothing.
- Steer saves its input before Stop and preserves it if Stop fails.

## Durable history and replay

- The records worker acknowledges Redis only after Postgres commits.
- One malformed record does not discard unrelated valid records.
- Identical record retries do not duplicate or reorder history.
- Conflicting record content under one ID is rejected.
- Concurrent commits receive one database-defined session order.
- Snapshot sequence N followed by replay after N loses no event.
- Replay-to-live registration misses no commit.
- The client reducer ignores duplicate durable events.
- Legacy sessions without sequences load completely.
- A crash with an unconfirmed tail marks history incomplete and permits another message.

## Shared live reading

- Sender, second browser, and mobile render the same text and tool progress.
- Closing or refreshing the sender does not stop execution.
- A slow reader disconnects without changing runner throughput.
- Reconnect discards temporary previews, reloads the snapshot, and follows its sequence.
- A durable checkpoint repairs expired temporary frames.
- Runner ingress and browser reading work through different API replicas.
- Redis enforces measured age and size limits.
- Authorization matches the current session transcript and invoke stream.

## Operational and security checks

- Container shutdown grace exceeds bounded runner cleanup.
- Codex leaves no child process after Stop on either provider.
- Failed cleanup does not advertise safe warm resume.
- Claude Code shell permission behavior is documented separately and not misrepresented.
- `AGENTA_RUNNER_SESSION_STOPPED_TTL_MS` matches the tested deployment policy.

## Current timing reference

| Mechanism | Value |
|---|---:|
| Heartbeat interval | 30 seconds |
| Redis `alive` and `running` expiry | 3600 seconds |
| Runner owner lease | 120 seconds |
| Local park window | 60 seconds |
| Daytona park window | 120 seconds |
| Watchdog stale threshold | 90 seconds |
| Watchdog sweep interval | 60 seconds |
| Effective abandoned-execution settlement | 90 to 150 seconds |
| Required normal Stop delivery | At most 5 seconds |
