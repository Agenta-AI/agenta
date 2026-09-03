# Session control and live events QA matrix

> **AGENT-GENERATED, LOW WEIGHT, DRAFT.** This matrix combines confirmed live evidence with
> proposed release coverage. A row marked confirmed was observed on the named branch and provider.
> Proposed rows remain release requirements until they pass on the final commit.

## Validation rules

Every release run records the exact commit, provider, harness, session ID, execution ID, command
ID, relevant timings, terminal records, Redis ownership state, Postgres session-row state, and
runner logs. A passing test must prove both the visible result and the durable state. The final
candidate runs the matrix again after all selected branches are integrated.

Five invariants apply to every failure cell:

1. One execution has exactly one effective terminal outcome.
2. Previously committed conversation history remains readable.
3. The session accepts a later message after recovery.
4. A stale runner cannot change visible history after terminal settlement.
5. Stop does not claim warm resume while a tool child remains active.

## Confirmed control and recovery cells

| Scenario | Provider and harness | Expected result | Current evidence |
|---|---|---|---|
| Stop during model output, then continue | Local Pi, Claude Code, Codex; Daytona Pi and Claude Code | One cancelled outcome; same warm sandbox and native harness session; later message succeeds | Confirmed on the 2026-09-02 and 2026-09-03 slice and integration branches |
| Stop during a long tool, then continue | Local Pi, Claude Code, Codex; Daytona Pi and Claude Code | Tool child ends; one cancelled outcome; warm continuation succeeds | Confirmed, except Codex child cleanup still needs Daytona verification |
| Stop while approval waits | Local Pi and Claude Code; Daytona Pi and Claude Code | Interaction becomes cancelled; late answer conflicts; session continues warm | Confirmed |
| Second Send during execution | Local Pi | Second Send returns a clear busy conflict; first execution and sandbox remain healthy | Confirmed |
| Stop with stale execution guard | Local Pi | Conflict names current execution; current work remains untouched | Confirmed |
| Stop immediately after completion | Local Pi | Stop becomes `not_running`; warm sandbox is not evicted | Confirmed |
| Runner dies while Stop is claimed | Local Pi | Watchdog writes one lost ending, settles command, releases session, next Send succeeds | Confirmed on the refreshed integration branch |
| Sandbox disappears during a tool | Local Pi | Execution ends as `sandbox_gone`; next Send is possible | Confirmed |
| Runner resumes after watchdog settlement | Local Pi | Every late record, including late `done`, is rejected; visible history keeps the watchdog ending | Failure reproduced; quarantine implementation proven; rejection remains required for version one |
| Restart after settled Stop | Local Pi | Normal shutdown releases ownership; native continuity reloads; next Send succeeds | Confirmed after continuity fix |
| Forced runner kill | Local Pi | No cleanup handler is assumed; owner lease expires; recovery settles and session becomes usable | Confirmed against the 120-second owner lease |
| Post-Stop liveness mirror | Local Pi and Claude Code | Redis and Postgres show `running=false`, `alive=true` while safely parked | Confirmed after settlement-mirror fix |
| Postgres outage during record ingest | Local Pi | Redis entry remains pending; all records commit after recovery; no duplicate visible history | Confirmed |

## Required provider and harness coverage

Run the core Stop, approval, restart, and child-cleanup cells on every supported combination:

| Provider | Pi | Claude Code | Codex |
|---|---:|---:|---:|
| Local | Required | Required | Required |
| Daytona | Required | Required | Required before claiming Codex warm Stop on Daytona |

For Codex, run the matrix on the current pin and on the candidate upgraded ACP version. Prefer the
upgrade only if cancellation, approvals, tools, warm continuation, and child cleanup all pass.

## Durable command cells

- Identical idempotent retries return the same command and execution IDs.
- Reusing an idempotency key with another payload returns a conflict.
- A delivery timeout after command commit does not ask the client to submit again.
- Duplicate command delivery applies the command once.
- Unguarded Stop on an idle session returns `already_idle`.
- Guarded Stop against an old execution returns an execution-mismatch conflict.
- Stop and approval response races have one committed winner.
- An accepted approval whose delivery fails remains answered and recoverable.
- Normal completion promotes one queued input in first-in, first-out order.
- Manual Stop leaves queued input pending.
- Steer persists its input before Stop and preserves it when Stop fails.

## Durable history and replay cells

- The worker acknowledges a Redis record only after Postgres commits.
- One malformed record does not discard unrelated valid records in the same batch.
- Identical record retries do not change durable order.
- Conflicting reuse of a record ID is rejected.
- Snapshot sequence N followed by events after N loses no committed event.
- Replay does not duplicate durable objects in the client reducer.
- The replay-to-live handoff does not miss a commit.
- Concurrent commits receive one database-defined session order.
- Legacy sessions without sequence values still load completely.
- A runner crash with an unconfirmed tail records `lost` and incomplete history, then permits a new
  message.
- Every record received after terminal settlement returns non-retryable `execution_terminal` and
  remains absent from canonical history.

## Shared live-reading cells

- The sender, a second browser, and mobile render the same live text and tool progress.
- Closing or refreshing the sender does not stop execution.
- A slow reader is disconnected without changing runner throughput.
- A disconnected reader discards temporary previews, reloads the durable snapshot, and follows
  from its returned sequence.
- Expired temporary frames are repaired by a durable checkpoint.
- Runner ingress and browser reading work through different API replicas.
- Redis frame eviction respects both age and size limits.
- Sensitive frame content follows the same project authorization rules as today's invoke stream.

## Operational and security checks

- Runner shutdown grace exceeds the measured bounded cleanup duration.
- SIGTERM releases every ownership claim held by the runner.
- SIGKILL recovery depends only on lease expiry and watchdog settlement.
- Codex leaves no shell child after Stop on each provider.
- A failed Codex cleanup reports a structured error and never falsely advertises safe warm resume.
- Claude Code's built-in shell permission behavior is documented and tracked separately. A release
  must not claim that the general `ask` policy gates that tool unless a test proves it.
- Post-Stop park time uses `AGENTA_RUNNER_SESSION_STOPPED_TTL_MS`; the evidence records 60 seconds
  locally and 120 seconds on Daytona.

## Current timing reference

| Mechanism | Observed or configured value |
|---|---:|
| Runner heartbeat interval | 30 seconds |
| Redis `alive` and `running` expiry | 3600 seconds |
| Runner ownership lease | 120 seconds |
| Local sandbox park window | 60 seconds |
| Daytona sandbox park window | 120 seconds |
| Watchdog stale-heartbeat threshold | 90 seconds |
| Watchdog sweep interval | 60 seconds |
| Effective abandoned-execution settlement | 90 to 150 seconds |
| Required normal Stop delivery | At most 5 seconds |
| Observed direct Stop to runner abort | 72 to 82 milliseconds locally |
| Observed Daytona Stop response | 70 to 104 milliseconds |
