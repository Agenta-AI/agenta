# Session control and live events QA

> **AGENT-GENERATED, low weight.**

## Evidence rule

Every run records the exact commit, provider, harness, session ID, execution ID, command ID,
timings, terminal records, Redis ownership, Postgres state, client state, and runner logs. A row is
proven only when one run checks visible behavior, durable state, and a successful continuation.

Tonight's HTTP cells ran on integrated head `3c9ce08a29` from stack
`agenta-ee-dev-session-integration`, with `AGENTA_SESSIONS_DURABLE_STOP=true` and the driver from PR
#6518. They checked visible behavior, the terminal record count, and continuation with the same
sandbox ID before and after. The table marks these results as proven (HTTP cells). The hook rows
retain the stored-state checks.

The local Pi hook run at `~/agenta-qa-evidence/20260903-235010-3823500-session-control` passed all
13 cells. Each stopped session had one `session_executions` row with
`terminal_outcome=stopped` and `settled_by=runner`. Each also had one applied
`session_commands` row. No command remained claimed or pending. The `sandbox-gone` cell read
`is_running=false` and `is_alive=true`. The `stale-tail` cell quarantined its late `done`
record. It left the three on-time records unquarantined.

The final candidate reruns every applicable row after selected packages are integrated.

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

Each `Proven` column records prior evidence. It does not prove a future release commit.

| Provider and harness | Requirement | Proven: commit, provider, harness, evidence path |
|---|---|---|
| Local, Pi | Full Stop, approval, restart, and child-cleanup set | Proven at `3c9ce08a29`, local, Pi, `~/agenta-qa-evidence/20260903-235010-3823500-session-control`; all 13 hook cells passed |
| Local, Claude Code | Full set on candidate | Proven (HTTP cells) at `3c9ce08a29`, local, Claude Code, `~/agenta-qa-evidence/20260903-230015-3207644-session-control`; six applicable cells passed, and the built-in shell requested no approval |
| Local, Codex | Full set on candidate | Partly proven at `3c9ce08a29`, local, Codex, `~/agenta-qa-evidence/20260904-003056-143305-session-control`; `codex-child`, `repeat-stop`, and `stop-during-completion` passed one cell at a time with a one-sandbox pool on a healthy runner. `stale-tail` did not apply because Codex produced no late record after the pause |
| Daytona, Pi | Full set on candidate | Proven (HTTP cells) at `3c9ce08a29`, Daytona, Pi, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`; all seven cells passed |
| Daytona, Claude Code | Full set on candidate | Partly proven at `9110c08000`, Daytona, Claude Code, `daytona-pi-claude.md` |
| Daytona, Codex | Full set on candidate | Proven (HTTP cells) at `3c9ce08a29`, Daytona, Codex, `~/agenta-qa-evidence/20260903-234628-3777662-session-control`; six applicable cells passed, the warm resume recalled the codeword, and the shell tool requested no approval |
| Codex 1.1.7 versus 1.8.0 | Full Codex matrix on both pins | Not proven; no 1.8.0 run or evidence path |

The earlier local Codex hook run at
`~/agenta-qa-evidence/20260904-000419-session-control` reported four failures. The runner entered a
cgroup freeze after the restart cell. The driver also hit one `KeyError`. The healthy one-cell
reruns resolved all failures.

## Stop and recovery

| Scenario | Expected result | Proven: commit, provider, harness, evidence path |
|---|---|---|
| Stop during output | One stopped outcome; warm continuation succeeds | Proven (HTTP cells) at `3c9ce08a29`, local Claude Code, Daytona Pi, and Daytona Codex, `~/agenta-qa-evidence/20260903-230015-3207644-session-control`, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`, and `~/agenta-qa-evidence/20260903-234628-3777662-session-control`; proven hooks at `3c9ce08a29`, local, Pi, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` |
| Stop during a long tool | Tool child ends; one stopped outcome; warm continuation succeeds | Partly proven at `9110c08000`, local and Daytona, Pi and Claude Code, `daytona-pi-claude.md` and `local-claude-and-restart.md` |
| Stop while approval waits | Interaction cancels; late answer conflicts; continuation succeeds | Proven (HTTP cells) at `3c9ce08a29`, Daytona, Pi, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`; Stop cancelled the parked approval, the late answer returned `409`, and continuation recalled the codeword in the same sandbox. Before PR #6501, this failed in five of five local and Daytona Pi attempts across `~/agenta-qa-evidence/20260903-214848-2179056-session-control`, `~/agenta-qa-evidence/20260903-214916-2186506-session-control`, `~/agenta-qa-evidence/20260903-215100-2212560-session-control`, and `~/agenta-qa-evidence/20260903-215210-2229665-session-control`: the runner kept the gate after Stop, and the next message took the approval-resume path. PR #6501 fixed the defect. Claude Code and Codex have no applicable interaction because their built-in shell tools do not ask for approval; proven hooks at `3c9ce08a29`, local, Pi, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` |
| Two Sends arrive together | One admits; one returns busy; first execution stays healthy | Proven (HTTP cells) at `3c9ce08a29`, local Claude Code, Daytona Pi, and Daytona Codex, `~/agenta-qa-evidence/20260903-230015-3207644-session-control`, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`, and `~/agenta-qa-evidence/20260903-234628-3777662-session-control`; proven hooks at `3c9ce08a29`, local, Pi, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` |
| Stale execution guard | Conflict; current work remains untouched | Proven (HTTP cells) at `3c9ce08a29`, local Claude Code, Daytona Pi, and Daytona Codex, `~/agenta-qa-evidence/20260903-230015-3207644-session-control`, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`, and `~/agenta-qa-evidence/20260903-234628-3777662-session-control`; proven hooks at `3c9ce08a29`, local, Pi, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` |
| Repeated Stop | One command effect and one terminal outcome | Proven (HTTP cells) at `3c9ce08a29`, local Claude Code, Daytona Pi, and Daytona Codex, `~/agenta-qa-evidence/20260903-230015-3207644-session-control`, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`, and `~/agenta-qa-evidence/20260903-234628-3777662-session-control`; proven hooks at `3c9ce08a29`, local, Pi and Codex, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` and `~/agenta-qa-evidence/20260904-003056-143305-session-control` |
| Stop immediately after completion | `not_running`; warm sandbox remains available | Proven (HTTP cells) at `3c9ce08a29`, local Claude Code, Daytona Pi, and Daytona Codex, `~/agenta-qa-evidence/20260903-230015-3207644-session-control`, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`, and `~/agenta-qa-evidence/20260903-234628-3777662-session-control`; proven hooks at `3c9ce08a29`, local, Pi, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` |
| Restart after Stop | The harness restores its native session; continuation succeeds | Proven at `3c9ce08a29`, local, Pi hooks, `~/agenta-qa-evidence/20260903-235010-3823500-session-control`; the native session rehydrated |
| Stop while execution completes | One committed winner; never both completed and stopped | Proven (HTTP cells) at `3c9ce08a29`, local Claude Code, Daytona Pi, and Daytona Codex, `~/agenta-qa-evidence/20260903-230015-3207644-session-control`, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`, and `~/agenta-qa-evidence/20260903-234628-3777662-session-control`; proven hooks at `3c9ce08a29`, local, Pi and Codex, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` and `~/agenta-qa-evidence/20260904-003056-143305-session-control` |
| Runner dies while Stop is claimed | Watchdog settles command and execution; next Send succeeds within 150 seconds | Not run at `3c9ce08a29`; every settled Stop tonight had a live runner. Prior evidence passed at `e6a033063a`, local, Pi, `integration-refresh.md`, in 137.5 seconds |
| Sandbox disappears | Explicit failure; next Send succeeds | Proven at `e6a033063a`, local, Pi, `integration-refresh.md`, 101.5 seconds; proven at `3c9ce08a29`, local, Pi hooks, `~/agenta-qa-evidence/20260903-235010-3823500-session-control`; `session_streams` read `is_running=false` and `is_alive=true` |
| Normal runner shutdown | Claims release before process exit | Partly proven at `5a10e6b100`, local, Pi, `cancel-continuity.md` |
| Forced runner kill | Lease and watchdog recover inside the accepted bound | Partly proven at `5a10e6b100`, local, Pi, `cancel-continuity.md` |
| Runner sends a stale tail | Output stays out of canonical history for every terminal cause | Partly proven at `e6a033063a`, local, Pi, `integration-refresh.md` and `watchdog-stale-tail.md`; only watchdog quarantine ran; proven at `3c9ce08a29`, local, Pi hooks, `~/agenta-qa-evidence/20260903-235010-3823500-session-control`; the late `done` record had `quarantined_at`, and the three on-time records did not. Not applicable for Codex at `3c9ce08a29`, local hooks, `~/agenta-qa-evidence/20260904-003056-143305-session-control`; Codex produced no late record after the pause |
| Post-Stop state | Redis and Postgres show `running=false`; `alive=true` only during safe park | Proven at `e6a033063a`, local, Pi, `integration-refresh.md` and `post-stop-mirror.md`; proven at `3c9ce08a29`, local, Pi hooks, `~/agenta-qa-evidence/20260903-235010-3823500-session-control`; `is_running` became false 0.18 seconds after Stop |
| Postgres outage during record ingest | Entries remain pending and commit once after recovery | Proven at `e6a033063a`, local, Pi, `integration-refresh.md`; proven at `3c9ce08a29`, local, Pi hooks, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` |
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
| Guarded stale Stop | `execution_mismatch`; new execution untouched | Proven at `e6a033063a`, local, Pi, `integration-refresh.md`; proven at `3c9ce08a29`, local, Pi hooks, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` |
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
| Codex child cleanup | No child remains after Stop on local and Daytona | Partly proven at `9e21fba4ee` and `e6a033063a`, local, Codex, `child-process-cleanup.md` and `integration-refresh.md`; proven on local at `3c9ce08a29`, Pi and Codex hooks, `~/agenta-qa-evidence/20260903-235010-3823500-session-control` and `~/agenta-qa-evidence/20260904-003056-143305-session-control`; the Pi run reaped the child in 1.0 seconds |
| Failed cleanup | Unsafe sandbox never reports warm resume | Partly proven at `38cbc92201`, local, Pi, `post-stop-mirror.md`; no deliberate injection |
| Bounded sweep pass | Timed-out pass logs; a later pass settles stale work | Not proven; required watchdog cell |
| Failed notification | Committed record remains readable | Not proven; required failure injection |
| Redis frame loss | Durable records still commit | Not proven; required failure injection |
| Feature rollback | Each env flag returns to its mounted old path without data loss | Not proven; required for increments 2 through 5 |
| Log privacy | Captured logs contain no message content or tokens | Not proven; grep captured logs for seeded secret prefix |
| Minimal metrics | Required counters and histograms emit without high-cardinality labels | Not proven; metrics not implemented |
| Claude Code shell permission | Dedicated Linear security issue contains repro and status | Partly documented at `9110c08000`, local and Daytona, Claude Code, `local-claude-and-restart.md` and `daytona-pi-claude.md`; exact issue link missing |

On the local provider, every sandbox shares one process table. The Codex reap disabled itself when
it saw more than one Codex app-server. PR #6496 fixed this at `cce2b21bc35091` by anchoring the reap
to the daemon port for that sandbox. Daytona was never affected.

Tonight did not drive the lost-outcome case where a runner dies while a Stop is claimed. Every
settled Stop had a live runner.

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
| Alive and running key TTL | 3600 seconds | Configuration reference only |
| Park window | 60 seconds local, 120 seconds Daytona | Measured live in the round-two reports |
| Watchdog stale threshold | 90 seconds | Configuration reference only |
| Watchdog sweep interval | 60 seconds | Configuration reference only |
| Abandoned settlement | At most 150 seconds | 137.5 seconds runner-gone and 107 seconds stale-tail at `e6a033063a`, local, Pi, `integration-refresh.md` |
| Normal Stop alert | 5 seconds | Proven at 42 to 97 ms at `3c9ce08a29`, Daytona, Pi, `~/agenta-qa-evidence/20260903-233439-3632265-session-control`; earlier runs stayed below 300 ms |
| Release-note threshold | More than 1 second needs a written reason | Not yet applied to a release |
