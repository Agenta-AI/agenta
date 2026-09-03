# Session control and live events QA

> **AGENT-GENERATED, low weight.**

## Evidence rule

Every run records the exact commit, provider, harness, session ID, execution ID, command ID,
timings, terminal records, Redis ownership, Postgres state, client state, and runner logs. A row is
proven only when one run checks visible behavior, durable state, and a successful continuation.

The final candidate reruns every applicable row after selected packages are integrated. Historical
proof below records prior evidence, not proof for a future release commit.

## Invariants

1. One execution has one effective terminal outcome enforced by the database.
2. Previously committed conversation history remains readable.
3. Failure recovery ends within 150 seconds and permits another message.
4. A terminal execution cannot add output to canonical history.
5. Stop does not claim warm resume while a tool child remains active.
6. A browser or live relay cannot slow or stop the runner.
7. Snapshot sequence N followed by events after N loses no committed event.
8. A committed command survives API death and retries with the same command ID.

## Provider and harness matrix

| Provider and harness | Requirement | Proven: commit, provider, harness, evidence path |
|---|---|---|
| Local, Pi | Full Stop, approval, restart, and child-cleanup set | Proven at `e6a033063a`, local, Pi, `integration-refresh.md` |
| Local, Claude Code | Full set on candidate | Partly proven at `9110c08000`, local, Claude Code, `local-claude-and-restart.md` |
| Local, Codex | Full set on candidate | Partly proven at `9e21fba4ee` and `e6a033063a`, local, Codex, `child-process-cleanup.md` and `integration-refresh.md` |
| Daytona, Pi | Full set on candidate | Partly proven at `9110c08000` and one cell at `e6a033063a`, Daytona, Pi, `daytona-pi-claude.md` |
| Daytona, Claude Code | Full set on candidate | Partly proven at `9110c08000`, Daytona, Claude Code, `daytona-pi-claude.md` |
| Daytona, Codex | Full set on candidate | Not proven; no run or evidence path |
| Codex 1.1.7 versus 1.8.0 | Full Codex matrix on both pins | Not proven; no 1.8.0 run or evidence path |

## Stop and recovery

| Scenario | Expected result | Proven: commit, provider, harness, evidence path |
|---|---|---|
| Stop during output | One stopped outcome; warm continuation succeeds | Proven at `e6a033063a`, local and Daytona, Pi, `integration-refresh.md` and `daytona-pi-claude.md` |
| Stop during a long tool | Tool child ends; one stopped outcome; warm continuation succeeds | Partly proven at `9110c08000`, local and Daytona, Pi and Claude Code, `daytona-pi-claude.md` and `local-claude-and-restart.md` |
| Stop while approval waits | Interaction cancels; late answer conflicts; continuation succeeds | Proven at `e6a033063a`, local, Pi, `integration-refresh.md` |
| Two Sends arrive together | One admits; one returns busy; first execution stays healthy | Not proven; no simultaneous-arrival run |
| Stale execution guard | Conflict; current work remains untouched | Proven at `e6a033063a`, local, Pi, `integration-refresh.md` |
| Repeated Stop | One command effect and one terminal outcome | Not proven; no run |
| Stop immediately after completion | `not_running`; warm sandbox remains available | Proven at `e6a033063a`, local, Pi, `integration-refresh.md` and `post-stop-mirror.md` |
| Stop while execution completes | One committed winner; never both completed and stopped | Not proven; required overlap cell |
| Runner dies while Stop is claimed | Watchdog settles command and execution; next Send succeeds within 150 seconds | Proven at `e6a033063a`, local, Pi, `integration-refresh.md`, 137.5 seconds |
| Sandbox disappears | Explicit failure; next Send succeeds | Proven at `e6a033063a`, local, Pi, `integration-refresh.md`, 101.5 seconds |
| Normal runner shutdown | Claims release before process exit | Partly proven at `5a10e6b100`, local, Pi, `cancel-continuity.md` |
| Forced runner kill | Lease and watchdog recover inside the accepted bound | Partly proven at `5a10e6b100`, local, Pi, `cancel-continuity.md` |
| Runner sends a stale tail | Output stays out of canonical history for every terminal cause | Partly proven at `e6a033063a`, local, Pi, `integration-refresh.md` and `watchdog-stale-tail.md`; only watchdog quarantine ran |
| Post-Stop state | Redis and Postgres show `running=false`; `alive=true` only during safe park | Proven at `e6a033063a`, local, Pi, `integration-refresh.md` and `post-stop-mirror.md` |
| Postgres outage during record ingest | Entries remain pending and commit once after recovery | Proven at `e6a033063a`, local, Pi, `integration-refresh.md` |
| Desktop failed Stop request | UI restores `running` and observation | Not proven; client cell required |
| Recovery UI | Client shows `recovering` until watchdog settlement | Not proven; client cell required |

## Commands, idempotency, and approvals

| Scenario | Expected result | Proven: commit, provider, harness, evidence path |
|---|---|---|
| Identical idempotent retry | Same command and execution IDs; no new work | Not proven; no live run |
| Conflicting idempotency reuse | `409 idempotency_key_reused`; original work unchanged | Not proven; no live run |
| Client retry after lost response | Same result and one command effect | Not proven; required lost-response cell |
| Duplicate delivery | Command applies once | Not proven; required duplicate-delivery cell |
| API death after command commit | Sweep redelivers with same ID or settles bounded `lost` | Not proven; required failure injection |
| API death during settlement | Postgres facts stay atomic; Redis sweep repairs state | Not proven; required failure injection |
| Unguarded idle Stop | `already_idle` success | Partly proven at `38cbc92201`, local, Pi, `post-stop-mirror.md`; test observed `not_running` after a turn |
| Guarded stale Stop | `execution_mismatch`; new execution untouched | Proven at `e6a033063a`, local, Pi, `integration-refresh.md` |
| Stop and approval response in one window | One transaction wins; loser conflicts; session continues | Not proven; prior runs were sequential |
| Approval continuation delivery fails | Accepted answer remains durable and recoverable | Not proven; no run |
| Queue promotion | Normal completion promotes one input in order | Not proven; Queue not implemented |
| Manual Stop with pending input | Stop promotes nothing | Not proven; Queue not implemented |
| Failed Steer | Saved input remains visible and recoverable | Not proven; Steer not implemented |

## Durable history and replay

| Scenario | Expected result | Proven: commit, provider, harness, evidence path |
|---|---|---|
| Ack after commit | Redis entry is acknowledged only after Postgres commits | Partly proven at `e6a033063a`, local, Pi, `integration-refresh.md` |
| Malformed record in a batch | Invalid record fails; all valid records commit | Not proven; required batch cell |
| Identical record retry | No duplicate and no reorder | Not proven; no run |
| Conflicting record body | `record_conflict`; original record remains | Not proven; no run |
| Concurrent durable commits | One database-defined session order | Not proven; no run |
| Snapshot and replay handoff | Snapshot N plus events after N loses no commit | Not proven; no run |
| Replay-to-live registration | Commit between subscribe and query appears once | Not proven; no run |
| Old writer after migration | Compatibility write receives a sequence and reaches new reader | Not proven; required dual-client cell |
| Reducer duplicate | Duplicate durable event changes state once | Not proven; unit fixture required |
| Legacy session | Null-sequence history loads completely | Not proven; no run |
| Unconfirmed tail | `history_complete=false`; next message succeeds | Partly proven at `e6a033063a`, local, Pi, `integration-refresh.md`; client state not checked |
| Retention separation | Tracing quota and sweep cannot delete session history | Not proven; package completion gate |

## Shared live reading

| Scenario | Expected result | Proven: commit, provider, harness, evidence path |
|---|---|---|
| Sender, second browser, and mobile | Same text, tools, and terminal state | Not proven; no browser run |
| Sender close or refresh | Execution continues and reconnect converges | Not proven; no run |
| Slow reader | Reader closes; runner throughput stays within measurement noise | Not proven; no measured run |
| Reconnect | Previews clear; snapshot and sequence restore state | Not proven; no run |
| Expired frames | Durable checkpoint repairs the preview | Not proven; no run |
| Different API replicas | Ingress and SSE work on separate replicas | Not proven; no multi-replica run |
| Measured Redis bounds | Age and `MAXLEN` limits hold | Not proven; limits measured but not enforced |
| SSE authorization revocation | Access ends on recheck or within 15 minutes | Not proven; required revocation cell |
| Foreign frame ingress | Non-owner frame is rejected and counted | Not proven; required authorization cell |
| Malformed frame | Batch continues and bad frame is reported | Not proven; no run |
| Storybook client states | Incomplete history, slow-reader close, preview replacement, and legacy null sequences render; `/m` smoke passes | Not proven; stories not implemented |

## Operations, security, and rollback

| Scenario | Expected result | Proven: commit, provider, harness, evidence path |
|---|---|---|
| Runner shutdown grace | Grace exceeds bounded cleanup and owner releases before kill | Not proven; no configured value or run |
| Codex child cleanup | No child remains after Stop on local and Daytona | Partly proven at `9e21fba4ee` and `e6a033063a`, local, Codex, `child-process-cleanup.md` and `integration-refresh.md` |
| Failed cleanup | Unsafe sandbox never reports warm resume | Partly proven at `38cbc92201`, local, Pi, `post-stop-mirror.md`; no deliberate injection |
| Bounded sweep pass | Timed-out pass logs; a later pass settles stale work | Not proven; required watchdog cell |
| Failed notification | Committed record remains readable | Not proven; required failure injection |
| Redis frame loss | Durable records still commit | Not proven; required failure injection |
| Feature rollback | Each env flag returns to its mounted old path without data loss | Not proven; required for increments 2 through 5 |
| Log privacy | Captured logs contain no message content or tokens | Not proven; grep captured logs for seeded secret prefix |
| Minimal metrics | Required counters and histograms emit without high-cardinality labels | Not proven; metrics not implemented |
| Claude Code shell permission | Dedicated Linear security issue contains repro and status | Partly documented at `9110c08000`, local and Daytona, Claude Code, `local-claude-and-restart.md` and `daytona-pi-claude.md`; exact issue link missing |

## Required metrics

Before release, verify counters for command admitted, delivered, applied, obsolete, and lost. Verify
the Stop delivery latency histogram, harness cancel latency, watchdog settlement count, quarantined
or rejected late-record count, and sweep pass duration. Session and execution IDs must not appear as
metric labels.

## Timing contract

| Mechanism | Required value | Prior evidence |
|---|---:|---|
| Heartbeat interval | 30 seconds | Configuration reference only |
| Runner owner lease | 120 seconds | Partly measured in `cancel-continuity.md` |
| Watchdog stale threshold | 90 seconds | Configuration reference only |
| Watchdog sweep interval | 60 seconds | Configuration reference only |
| Abandoned settlement | At most 150 seconds | 137.5 seconds runner-gone and 107 seconds stale-tail at `e6a033063a`, local, Pi, `integration-refresh.md` |
| Normal Stop alert | 5 seconds | Proven below 300 ms at `9110c08000` and `e6a033063a`, local and Daytona, Pi and Claude Code, `daytona-pi-claude.md` and `integration-refresh.md` |
| Release-note threshold | More than 1 second needs a written reason | Not yet applied to a release |
