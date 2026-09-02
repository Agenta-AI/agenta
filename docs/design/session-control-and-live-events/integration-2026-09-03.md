# Integration: the five session-control slices, merged and run

> AGENT-GENERATED, low weight. Written on the night of 2026-09-02 to 2026-09-03. Mahmoud
> decides. Every claim below is marked **verified** (observed on the running stack, or read in
> the merged code with a `path:line`) or **reported** (taken from a slice document).

Branch `agent/session-execution-integration`, on the RFC tip `f4a6834ba6`. Nothing is pushed.

## The answer first

The five slices compose. All seven live cells of the implementation plan pass on one stack.
Two defects were found by running them, both in the seam between two slices, and both are
fixed on this branch with a unit test that fails on the parent commit. One defect is open and
not fixed, because its fix is neither obvious nor small: a runner that outlives the execution
watchdog and then unwinds writes a SECOND terminal record for a turn the watchdog already
ended.

| Cell | Result | Where the evidence is |
|---|---|---|
| stop-warm | **Pass** | Stop settled in 58 ms, terminal record `stopReason: cancelled`, sandbox parked, resume recalled the codeword |
| double-send | **Pass** | Second send refused in 0.11 s, first turn ran its full 54 s, third message warm |
| stale-stop | **Pass** | 409 in 39 ms, no row written, turn two not tombstoned |
| stop-approval | **Pass after fix 1** | Gate `pending` to `cancelled`, late answer 409, pool entry reused |
| runner-gone | **Pass after fix 2** | One sweep pass settled the execution AND the command, 40 ms apart |
| sandbox-gone | **Pass** | Terminal record `sandbox_gone` 89 s after the kill, one pair only |
| records-outage | **Pass** | Postgres down 20 s, worker redelivered, all six records landed |

## Merge order and every conflict

Merged in the plan's order, one `git merge --no-ff` each. Six merge commits, because two
branches gained commits mid-session and were merged again at their new tips.

| # | Branch | Merge commit | Conflicts |
|---|---|---|---|
| 1 | `fix/records-worker-ack-after-commit` | `c177ee40de` | none |
| 2 | `feat/session-single-turn-admission` | `7d52ecb5d1` | none |
| 3 | `feat/session-execution-watchdog` | `7e99add241` | 1 |
| 4 | `feat/session-stop-guard` | `364e2b2da3` | 1 |
| 5 | `feat/session-durable-cancel` | `2988da7512` | 5 |
| 6 | `feat/session-stop-guard` again, at `1e4f911a59` | `a7c99f05c4` | 2 |

Nine conflicts. Seven were unions of the same list and needed no judgement. Two were real
and are described in full.

### The seven unions

| Conflict | Resolution |
|---|---|
| `services/runner/src/engines/sandbox_agent/errors.ts:83` | Both slices appended a member to the last line of the `RunErrorCode` union. Kept all three: `session_turn_in_use` from admission, `sandbox_gone` and `execution_lost` from the watchdog. |
| `api/oss/src/utils/env.py:572` | Both slices added a config class at the same point. Kept `SessionWatchdogConfig` and `SessionsCommandsConfig`, each with its own `model_config`. `SessionsConfig` already named both fields. |
| `api/oss/src/apis/fastapi/sessions/router.py:72` | Import block. Kept `derive_command_mode` from the Stop guard and the commands service and its error types from durable cancel. |
| `services/runner/src/server.ts:82` | Import block. Kept the admission refusal constants, the control channel and the execution registry. |
| `web/oss/src/components/AgentChatSlice/AgentConversation.tsx:25` | Import block. Kept `isSessionBusyRefusal` from admission and took the Stop guard's `getLivePendingApprovals`, which is the name the file calls at line 396. |
| `web/packages/agenta-entities/src/session/index.ts:21` (twice) | Export list. Kept `cancelSessionStream`, `CancelSessionOutcome`, `CancelSessionStreamParams` and `cancelSessionExecution`. |

### Conflict 1: the heartbeat interrupt callback

`services/runner/src/server.ts:596`. The watchdog slice resolves `markInterrupted` there, so the
request stops waiting on a run that may never return. The durable-cancel slice aborts with
`USER_STOP_ABORT_REASON`, so `shouldPark` keeps the sandbox warm instead of destroying it.

Both are needed and neither is optional: without the first a wedged turn holds the request for
hours, without the second every Stop through the heartbeat path destroys the sandbox. The
callback now does both, in that order. The later bare `controller.abort()` inside
`awaitTurnOrAbandon` is a no-op on an already-aborted controller, so the user-stop label
survives. **Verified**: `server.ts:592-602`, and the stop-warm cell parked rather than
destroyed.

### Conflict 2: two Stop clients

`web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:532`, and again at `:558`
after the Stop guard branch moved. Three different Stop implementations met here across the two
merges:

- the Stop guard's, which posts `POST /sessions/streams/` and READS the outcome, so a refused
  Stop withdraws the local "Stopped" marker instead of being invisible;
- the durable cancel's, which posts `POST /sessions/{id}/cancel` and discards the outcome;
- the Stop guard's second version, which names the turn from `message.metadata.turnId`.

The new route wins, as the integration brief directs. Nothing else was dropped. The refusal
handling moved into `stopCurrentExecution`, and the expectation now comes from
`getSessionTurnId`, which is the id this browser was watching and costs no request; the
session-row read the durable-cancel slice used is the fallback for a stream that never named a
turn. **Verified**: `useAgentChatSession.ts:505-530`.

## The turn id reaches the new route

The chain the brief asked to check, **verified** end to end in code:

| Step | Where |
|---|---|
| The runner streams the admitted turn id | `services/runner/src/server.ts`, `liveEmit({type: "turn", turnId})` |
| The SDK turns it into message metadata | `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:378` |
| The conversation remembers it per session | `web/packages/agenta-chat/src/state/sessionEphemera.ts`, `setSessionTurnId` |
| Stop sends it | `useAgentChatSession.ts:513`, `getSessionTurnId(sessionId)` |
| As `expected_execution_id` on the new route | `web/packages/agenta-entities/src/session/api/api.ts:1056` |

Mobile now calls the same route. The composer's Stop names the turn; the running-elsewhere
button does not, because the turn it stops belongs to another device and this one never saw its
id. `POST /sessions/streams/` keeps its cancel mode, with the same late-Stop guard, for callers
outside this repository.

## The handoff between the watchdog and the commands plane

Both slice documents named the same rule: **one execution reaches exactly one terminal outcome
from exactly one writer, and the watchdog is that writer.** Wired in `e65e025ab0`.

`SessionCommandsService.settle_abandoned_commands` reads the abandoned commands through the DAO
and settles each `obsolete` with outcome `lost` through the existing `settle`, so the side
effects are the ones a reported settlement already runs. `run_orphan_sweep` calls it once per
pass, AFTER it collapses the stale rows: a command is abandoned only when its session has
stopped beating, and the collapse is what makes that true, so calling it first would make the
runner-gone case wait a second pass. A command whose session is still beating is left alone,
because that report is merely late. The call never raises; settling executions is the sweep's
first duty.

**Verified live**, one pass doing both halves 40 ms apart:

```
22:58:39.534 [WARN.] watchdog: settled a session_stream whose runner went silent
  extra={'session_id': '9a130493-2343-4f1b-8d7e-745311fd9b03',
         'turn_id': '99b83cc9-3e7f-4745-9100-9197a2063046', 'lost': True}
22:58:39.573 [WARN.] watchdog: settled a session command whose runner never reported
  extra={'command_id': '01a06456-e406-7470-b5c6-3965b6107241', 'claim_count': 0}
22:58:39.574 [INFO.] watchdog: settled 1 sessions (1 turns marked lost, 1 commands lost)
```

## Two defects found by running the cells

### Fix 1: a Stop outcome that beats its own claim was refused

Commit `8b2f8d67ae`. Found by the stop-approval cell.

The direct adapter claims the command row only AFTER the runner has answered the delivery call,
and the runner reports on its own clock as soon as it has applied the command. When there is
nothing to abort, which is exactly a session parked awaiting an approval, the runner decides
`not_running` and returns at once, so its report reaches the outcome route while the row is
still `pending`. The route's guard expects `claimed` and answered 409.

**Verified live before the fix**: command `01a06443-8985-7e71-afa0-be366c39face`, session
`0742bbc1-52cf-4332-90d6-eb03e1ab6086`. The runner logged
`[control] outcome HTTP 409`, the row stayed `claimed` with nothing to settle it, the session
read "stopping", and the approval gate stayed `pending` through the Stop.

A `pending` row is one no replica holds, so there is no other writer to protect it from, and the
caller is the runner authenticated with the shared runner token. The route now retries the
settlement against `pending` when the claimed guard finds nothing. The claim that lands a moment
later is a no-op, because `claim_for_delivery` only ever moves a `pending` row.

The regression test reproduces the ordering by reporting from inside `deliver`, and fails on the
parent commit with the same refusal.

### Fix 2: a Stop no runner ever claimed was never settled

Commit `c8bb504a85`. Found by the runner-gone cell.

A Stop sent while the runner is unreachable times out at the delivery timeout, the receipt is
`unreachable`, and the row stays `pending` with `claim_count` zero. The handoff above read
`expire_claims`, which selects `claimed` rows only, so nothing could ever see that row.

**Verified live before the fix**: command `01a0644c-63a1-70f1-b8a2-1e4c35fbc766` sat `pending`
across five sweep passes over five minutes, each logging `0 commands lost`, while the execution
beside it was settled correctly by the same passes.

`expire_unclaimed` returns rows still `pending` since before the admission deadline, which is
the existing and until now unused `AGENTA_SESSIONS_COMMAND_ADMISSION_TIMEOUT_SECONDS`, 90
seconds by default. The settle is guarded on the state the row was actually read in, so a
delivery that succeeds in the meantime still wins the row. A command younger than the deadline
is left alone: its delivery may still be in flight.

### Fix 3, a smaller one: a control cancel did not arm the abandon window

Commit `137f2bc303`. Found by reading the merged code, not by a cell.

The durable-cancel slice registers each execution so `POST /cancel` can abort it. The watchdog
slice stops the request waiting on a run that may never return, but its grace window is armed
only by the interruption signal, which the control command never sent. A run that ignores its
abort therefore held the request until the hard per-turn deadline, hours away.

**Verified live** in the stop-warm cell, the line that only exists because of this fix:

```
[control] aborted command=01a06441-1d67-7720-ab60-1fb4921f7051 ...
[turn-settle] a control command stopped this turn; aborting and waiting 60000ms
```

## The defect that is NOT fixed

**A runner that outlives the watchdog and then unwinds writes a second terminal record.**

The RFC's core invariant is one durable terminal outcome per execution. It is broken when the
API watchdog settles a turn whose runner request is still alive and later completes.
`turnClosed` in `server.ts` guards only the case where THAT request abandons its own run; it
knows nothing about an ending the platform wrote.

**Verified live, twice.** Freezing the runner with `docker pause` past the 90-second threshold
and thawing it produced, for one turn:

| Writer | Records |
|---|---|
| The watchdog | `error` (`code: execution_lost`), then `done` |
| The runner, on thaw | `done` (`stopReason: cancelled`), session `9a130493`, turn `99b83cc9` |
| The runner, on a longer freeze | `error` (`runner_error`, "no first response within 120000ms"), then `done`, session `40dc5121`, turn `68c695c8` |

A `docker restart` does NOT produce it, because the process dies and never unwinds; the plain
runner-gone cell wrote exactly one pair. The real-world shape is a runner wedged or stalled past
the watchdog threshold whose run later returns, which is precisely the case
`awaitTurnOrAbandon` exists for.

The fix does not belong in the runner. A runner-side guard cannot tell this case from an
ordinary Stop, where the heartbeat also reports `is_current_turn: false` and the runner's own
terminal record is the only one there will ever be; suppressing it would leave those turns with
no ending at all. The guard belongs on the ingest side, where `RecordsDAO.settled_turns:233`
already answers "does this turn already carry a terminal record" and only the sweep asks it.
That is a records-plane change, and it sits naturally with the records repair the plan lists as
the next project.

## Test counts on the merged tree

| Suite | Result |
|---|---|
| `services/runner`, `pnpm exec vitest run --project unit` | 2692 pass, 4 fail |
| `api/oss/tests/pytest/unit/sessions`, with Postgres | **608 pass, 0 skipped, 0 failed** |
| `api/oss/tests/pytest/unit/sessions`, no Postgres | 547 pass, 58 skipped |
| `@agenta/chat` | 644 pass |
| `@agenta/entities` | 1472 pass, 31 skipped |
| `cd web && pnpm lint-fix` | 25 tasks, no errors |
| `services/runner`, `tsc --noEmit` | clean |
| `ruff format` and `ruff check`, CI-pinned 0.15.12 | clean |

The four runner failures are all `gateway-run-turn-composition.test.ts` and are pre-existing:
they need a `dist/tools/tool-mcp-stdio.js` bundle that `build:extension` produces, and they fail
identically on the base commit.

**The 58 skips are worth naming.** Every slice reported them as skipped because Postgres was not
reachable from the host. Pointed at this stack's database on port 5440 they all run, and all
pass, including the `session_commands` DAO tests and the records turn-span DAO tests that the
durable-cancel slice reported failing on DNS. A skipped test is an untested claim; these claims
now hold.

## The stack

Running, project `agenta-ee-dev-session-integration`, EE, dev images, local sandbox provider.

| Thing | Value |
|---|---|
| Web and API | `http://144.76.237.122:8580` (health returns `{"status":"ok"}`) |
| Traefik UI | `http://144.76.237.122:8581` |
| Postgres | host port 5440, `username:password`, database `agenta_ee_core` |
| Env file | `hosting/docker-compose/ee/.env.ee.dev.integration`, gitignored, mode 600 |
| Evidence, drivers and raw output | `~/agenta-qa-evidence/2026-09-03-session-integration/` |

Built with `--build`, because `feat/session-durable-cancel` changed
`services/runner/patches/sandbox-agent@0.4.2.patch` and that patch is applied at image build
time.

Teardown, from this worktree:

```bash
set -a && . hosting/docker-compose/ee/.env.ee.dev.integration && set +a
bash ./hosting/docker-compose/run.sh --license ee --dev \
  --env-file .env.ee.dev.integration --no-tunnel --down
```

## Cell evidence

Each cell was driven at the wire level through `POST /services/agent/v0/invoke`, the same
endpoint the playground drives, with assertions on the frame stream, the durable records, the
`session_streams` row and the `session_commands` row. No assertion reads model prose.

### stop-warm

Stop returned 202 in 96 ms. The 45-second turn ended at 7.2 s. The runner log:

```
[control] aborted command=01a06441-1d67-7720-ab60-1fb4921f7051 turn=c3a5fba5-...
[turn-settle] a control command stopped this turn; aborting and waiting 60000ms
[control] outcome reported command=01a06441-... state=stopped
[sandbox-agent] stage=harness_cancel sent=true settled=true elapsed_ms=103
[sandbox-agent] prompt stopReason=cancelled
[keepalive] park-cancelled key=...:49ffea11-... ttl=60000ms
```

The terminal record carries `stopReason: cancelled`. The command row settled `applied` /
`stopped` 58 ms after it was created. The next message recalled the codeword `MANGO64AD77`. The
session row stayed `is_alive: true` with `stopping_turn_id` cleared.

### double-send

The second send was refused in 0.11 s with frames `data-agent-error`, `error` and the copy
"This session is already running a turn. Your message was not sent." The runner logged the line
that is the whole point of the slice:

```
[sessions] admission REFUSED session=571c28cb-... turn=663ae83a-...;
  another turn owns this session. No pool resolve, no eviction.
```

The first turn then ran its full 54.3 seconds and replied DONE. The third message ran in 5.2 s
and recalled `KIWICC3497`.

### stale-stop

A Stop naming turn one while turn two ran returned 409 in 39 ms, naming the current execution,
and inserted no row: the `session_commands` table held two rows for the whole project, both from
other cells. The session row after it still read `is_running: true` with `stopping_turn_id`
null, so turn two was not tombstoned. A Stop with no id then correctly targeted turn two, and
turn three ran and recalled the codeword.

### stop-approval

The gate went `pending` to `cancelled`. The late answer through
`POST /sessions/interactions/{id}/respond` was refused: `409 {"detail":"Interaction is no longer
pending"}`. The command settled `applied` / `not_running` in 35 ms. The pool entry survived:

```
[keepalive] resume key=...:2ce87022-... gates=1 answered=1 carried=0 approve=0 reject=1 tool=Bash
[sandbox-agent] [keepalive] resume answered gate reply=reject tool=Bash
```

One observation, not a failure. After the Stop the next message is consumed by the parked gate's
resume: the harness delivers the rejection and answers about the refused command ("The command
was refused and did not run.") rather than the new question. The sandbox is warm and the context
is intact, so a following message works, but the user's first message after a Stop on an
approval does not get a direct answer.

The first run of this cell also showed that replaying a cancelled gate as an unanswered
`input-available` call makes the runner rebuild the sandbox cold
(`approval-mismatch (unknown); evict + cold`). That was an artefact of the test driver, not of
the product: the browser replays a cancelled row as `output-denied`
(`transcriptToMessages.ts:240`), and both that shape and an explicit `{approved: false}`
envelope resume warm. Checked with a two-arm experiment,
`~/agenta-qa-evidence/2026-09-03-session-integration/approval_warmth.py`.

### runner-gone

Two shapes were run.

**The runner restarts after the Stop settled.** The execution was settled by the watchdog 96.8
seconds after the restart, inside the 90-to-150-second budget, with `error`
(`code: execution_lost`) then `done`, the Redis nest cleared and a new message running normally.

**The Stop never reaches the runner.** The runner was frozen with `docker pause` before the
delivery, so the delivery timed out after 5.07 seconds and the row stayed `pending`. Before
fix 2 it stayed `pending` for the full five-minute wait. After fix 2 the same sweep pass settled
the execution and the command, quoted above under the handoff.

### sandbox-gone

The sandbox process group was killed under a running tool call. The turn ended 89 seconds later
with exactly one terminal pair: `error` (`code: sandbox_gone`) and `done`. The client's stream
carried a real ending rather than a broken pipe. The session row stayed
`is_alive: true, is_running: false`, which is correct: the turn is over and the session is
reattachable.

### records-outage

Postgres was stopped for 20 seconds mid-turn. The turn completed with no error frames. All six
records landed: `message`, `tool_call`, `tool_result`, `usage`, `message`, `done`. The records
worker logged the failure and then the recovery that the records slice exists for:

```
socket.gaierror: [Errno -3] Temporary failure in name resolution
22:54:46 [WARN.] [RECORDS] Redelivering unacknowledged messages
  stream=streams:records group=worker-records count=1
```

Nothing was acknowledged before its batch committed, so nothing was lost.

## What this integration did not do

- It did not push, open a pull request, or merge anything.
- It did not run the Daytona sandbox provider. Every cell used the local provider.
- It did not test the long-poll control adapter, which is not built.
  `AGENTA_SESSIONS_CONTROL_ADAPTER` still refuses to boot on any value but `direct`.
- It did not exercise a second runner replica, so the wrong-replica `not_held` path is covered
  by unit tests only.
- It did not make `POST /sessions/streams/` a wrapper over the durable command. Both Stop paths
  still have their own implementation, as the durable-cancel slice intended.
- It did not run the browser. Every cell drove the API directly, so the client changes are
  covered by their own package tests and by reading the code, not by clicking.

## Open questions for Mahmoud

1. **Who refuses a second terminal record for one execution?** *Recommendation: the records
   ingest, using `settled_turns`, and do it with the records repair rather than tonight.*
   Reason: it is the only place that can tell the difference between the runner writing the one
   ending and the runner writing a second one, and the runner cannot. Until then a wedged runner
   that thaws puts two endings in one transcript. This is the only known open defect.

2. **Should the sweep re-deliver an expired claim before settling it `lost`?** *Recommendation:
   no, settle it, as built.* Reason: the design allows a redelivery when the runner is alive and
   the turn is still running, but the sweep already leaves a beating session alone, so the only
   rows it settles are ones nobody can report. `AGENTA_SESSIONS_COMMAND_MAX_DELIVERIES` is
   therefore only a filter today. Say if you want the redelivery arm and it is a small addition.

3. **Should the first message after a Stop on an approval answer the user, or the gate?**
   *Recommendation: answer the gate, as built, and revisit if users complain.* Reason: the
   rejection has to reach the harness or the parked turn cannot finish, and the sandbox stays
   warm either way. The cost is that the user's first message after such a Stop gets a reply
   about the refused command instead of an answer.

4. **Does the desktop still need the session-row read for the turn id?** *Recommendation: keep
   it as the fallback only, as built.* Reason: `message.metadata.turnId` is the id the user was
   watching and costs nothing, but a client on an older runner never receives the `turn` frame,
   and sending no expectation switches off the cheapest late-Stop guard.

5. **Should `POST /sessions/streams/` become a wrapper now that both clients have moved?**
   *Recommendation: yes, in its own change, once this stack has run for a while.* Reason: two
   Stop implementations means two places to fix the next Stop bug, and the only remaining
   callers are outside this repository. Doing it tonight would have put an untested rewrite
   under seven cells that were passing.
