# Slice: the durable Stop command, with the direct-call adapter

> AGENT-GENERATED, low weight. Built and verified live. Mahmoud makes final decisions.

Branch `feat/session-durable-cancel`, rebased onto `spike/session-cancel-warm` at `f5b1ae6244`.
It implements [the durable command design](spike-b-durable-commands-design.md) at `86281fa313`
and [the route contracts](api-design.md), with the direct-call adapter of that design's
section 9. The long-poll adapter is not built.

Every claim below is marked **verified** (observed on the running stack, or read in this
branch's code with a `path:line`) or **reported** (taken from a document).

---

## What a Stop does now

**Verified live.** A user Stop reaches the running turn in 82 milliseconds, ends it, and leaves
the sandbox and the native harness session warm. Before this branch it reached the runner on the
next heartbeat, up to 30 seconds later.

| Step | Observed at | After the Stop request |
|---|---|---|
| The browser's request arrives, the command row commits, the API calls the runner | 00:12:45.624 | 0 |
| The runner aborts the execution | 00:12:45.706 | 82 ms |
| The harness confirms it stopped | 00:12:45.730 | 106 ms |
| The runner reports, and the API settles the command and the execution | 00:12:45.750 | 126 ms |
| The sandbox is parked warm, not deleted | 00:12:46.617 | 993 ms |

The 5 second budget in the design is met with two orders of magnitude to spare. The next message
on that session recalled a codeword from the stopped turn, which is warm resume measured from
the product rather than from a timer.

---

## What changed, with references

### The record

`session_commands` holds one row per durable request to change an execution
(`api/oss/src/dbs/postgres/sessions/commands/dbes.py:14`, migration
`api/oss/databases/postgres/migrations/core_oss/versions/oss000000022_add_session_commands.py`).
Two columns are never merged: `state` says where the COMMAND is (`pending`, `claimed`,
`applied`, `obsolete`) and `outcome` says what happened to the EXECUTION (`stopped`,
`not_running`, `superseded_by_newer_turn`, `failed`, `lost`).

`session_streams` gains `stopping_turn_id` and `turn_started_at`
(`api/oss/src/dbs/postgres/sessions/streams/dbes.py:73` and `:82`). The start time is stamped
only when the turn id actually changes
(`api/oss/src/dbs/postgres/sessions/streams/mappings.py`, the edit mapper), so the heartbeat that
restamps the same id every 30 seconds never moves it.

Every transition is one `UPDATE ... WHERE <expected state> RETURNING *` decided by
`scalar_one_or_none()` (`api/oss/src/dbs/postgres/sessions/commands/dao.py`). Two API replicas
cannot both win a claim or both write a terminal outcome.

### Admission

`SessionCommandsService.request_cancel`
(`api/oss/src/core/sessions/commands/service.py:111`) stamps the arrival time before it reads
anything, resolves the target once from Redis `running` falling back to `alive`
(`service.py:217`), applies the three late-Stop guards, then writes the command and the session's
`stopping_turn_id` in one transaction. **Redis is not written at admission**, so the stopping
execution keeps both locks while it stops, which is what prevents a second message from starting
underneath it.

### Settlement

`SessionCommandsService.settle` (`service.py:419`) settles the command and the execution
together, guarded on the command's state so a repeat changes nothing. For a `stopped` outcome it
tombstones the turn, then releases `running` under an owner check, then cancels that execution's
pending interactions, then publishes the existing `lifecycle: ended` notification. **It leaves
`alive` to its own time to live**, exactly as the end of an ordinary turn does. That single
decision is what makes Stop a stop rather than a session teardown.

### Delivery

`ControlDeliveryPort` (`api/oss/src/core/sessions/commands/interfaces.py`) is the port. The one
adapter is `DirectControlDelivery`
(`api/oss/src/dbs/http/sessions/control_delivery_direct.py`), which posts to the runner's own
`/cancel` beside the existing `kill_runner_sandbox`
(`api/oss/src/core/sessions/streams/runner_client.py`). The command row is committed BEFORE the
runner is called, and a delivery failure never fails the request.

### The runner

`POST /cancel` sits beside `POST /kill` behind the same token gate
(`services/runner/src/server.ts:821`). It resolves a live execution through a module-level
registry (`services/runner/src/sessions/execution-registry.ts`), falls back to the keep-alive
pool for a parked approval, and answers 404 when it holds neither.

**The abort carries the user-stop label.** `shouldPark` parks only an abort the runner can prove
was a cooperative Stop (`services/runner/src/sessions/stop-signal.ts`, from Spike A), so the
registry aborts with `USER_STOP_ABORT_REASON`. Without it a Stop delivered as a command ends the
turn `cancelled` and then DESTROYS the sandbox, which is the failure Stop exists to avoid. Two
tests pin both directions, and the live run after the rebase logs `park-cancelled`. The applier
sits above the transport (`services/runner/src/sessions/control-channel.ts`) with the
deduplication set beside the session pool (`services/runner/src/sessions/applied-commands.ts`),
so a long-poll loop would reuse every guard unchanged.

### The routes

`POST /sessions/{session_id}/cancel` and
`POST /sessions/control/commands/{command_id}/outcome`, both on `SessionControlRouter`
(`api/oss/src/apis/fastapi/sessions/router.py:1909`). The public route checks
`Permission.RUN_SESSIONS` and is deliberately **not** behind `check_runner_concurrency_limit`:
refusing to STOP work because a project is at its run limit is the wrong answer to a busy
project. The internal route authenticates with the shared runner token
(`router.py:2027`) and resolves the project from the command id, so the auth exemption
(`api/oss/src/middlewares/auth.py`, the `/sessions/control/` prefix) widens no tenant boundary.

`POST /sessions/streams/` is untouched. Its cancel branch becomes a thin wrapper over this
command in a later change, together with the mobile client; do both in one change so one revert
restores one behaviour.

### The desktop

The Stop button posts the new route
(`web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts`, `stopCurrentExecution`),
awaits it, and refreshes the session state on the answer. It names the execution it means, read
FRESH from the session row rather than from the project-wide liveness poll, which is up to
15 seconds stale; a stale id is refused with a conflict and the Stop would silently do nothing.
The client is `cancelSessionExecution`
(`web/packages/agenta-entities/src/session/api/api.ts`), written against raw axios because the
Fern client does not know the route yet. Mobile is untouched.

---

## Four defects the live run and the rebase found

None were visible in unit tests. The first three were found by pressing Stop against a real
agent turn; the fourth by rebasing onto Spike A's final tip. Each is committed with its own fix.

1. **The execution registry never held the session, so every Stop got a 404 and the turn ran to
   completion.** The entry was keyed by `<projectId>:<sessionId>`, but the project scope is not
   known when a run starts: `runContext.project.id` is empty on the live invoke path and the
   scope that forms the pool key comes from the signed mount, which the coordinator resolves
   after the run is in flight (`services/runner/src/lifecycle/session-coordinator.ts:281`,
   verified). The registry is now keyed by session id and the coordinator fills the project in
   through `onScopeResolved`. A lookup with a disagreeing project is refused; an entry whose
   project is not known yet matches, because refusing every Stop in the first moments of a run is
   the bug being replaced.
2. **The outcome report was refused with a 409, leaving the command `claimed` and the session
   marked stopping forever.** The API claimed on the runner's behalf under a placeholder while
   the runner reported under its own replica id, and the settle guard compares the two. The
   runner's acknowledgement now carries its replica id and the API claims under that.
3. **The multi-replica census refused delivery for five minutes after every runner restart.** A
   runner mints a fresh replica id at boot when `AGENTA_RUNNER_REPLICA_ID` is unset
   (`services/runner/src/sessions/alive.ts:31`, verified), so its previous id is still inside the
   window and the count reads two, which broke Stop after every ordinary deploy. **The census is
   now removed entirely**, on the revised design's guidance that it is optional and the exact
   detector is the one to build. That deletes a Redis write on every heartbeat, two settings and
   a module. What remains is the detector that cannot be fooled: a `not_held` for a session whose
   row says alive with a heartbeat younger than one interval means some process is running that
   session and it is not the one we called. It logs at error level naming the owner replica from
   the Redis `owner` key, and settles the command `lost` rather than `not_running`, so the user
   is told the Stop failed instead of that the work had already finished
   (`api/oss/src/core/sessions/commands/service.py`, `_settle_not_held`).

4. **The control-plane abort carried no label, so after the rebase every Stop would have
   destroyed the sandbox.** Spike A's `96012e8d8e` made `shouldPark` require proof that an abort
   was a cooperative Stop, because inferring it from the stop reason alone would let any future
   `controller.abort()` park a sandbox nobody had checked. The registry handed the applier a bare
   `controller.abort()`. It now aborts with `USER_STOP_ABORT_REASON`, and two tests pin both
   directions of the contract.

A fifth, smaller one: two Stops **in the same instant** both inserted, because admission reads
for an open command and then inserts and neither request can see a row the other has not
committed. Sequential Stops always collapsed. A unique partial index over the open states now
makes the database decide, and the losing insert reads the winner back.

---

## Live verification

Stack: `http://144.76.237.122:9180`, project `agenta-ee-dev-session-cancel`, EE, dev images,
built from this worktree. The agent ran the `pi_core` harness on the local sandbox with an
OpenAI model.

| Scenario | Result | Evidence |
|---|---|---|
| 1. Stop during a 60 s tool call | **Pass**, re-verified after the rebase. Turn ends at 26.2 s instead of 77.6 s. Command `pending` to `applied`, outcome `stopped`, settled 116 ms after the request. Runner logs `aborted`, then `harness_cancel sent=true settled=true elapsed_ms=17`, then `park-cancelled`. Next message recalled the codeword. | command `01a0641f-b775-75c1-bfe1-32a80e85f85e` |
| 2. Stop when nothing runs | **Pass.** 200, one row inserted already settled: `obsolete` with outcome `not_running`, no target, no Redis write. | command `01a0641f-5535-7130-a6be-537d287b6d9b` |
| 3. Stop with a stale `expected_execution_id` | **Pass.** 409 naming the current execution, and no row inserted. | `detail.current_execution_id` returned the live turn |
| 4. Two Stops in a row | **Pass.** Two simultaneous requests return the same command id and one row exists. Sequentially, the second now correctly reports nothing running, because a Stop settles in about 100 ms. | command `01a06423-c067-7c80-9b68-636953655698` returned to both |
| 5. Stop a turn parked for approval | **Pass.** The interaction goes `pending` to `cancelled`, the command settles `applied` with `not_running` in 68 ms, the pool keeps the entry, and the next message recalled the codeword. | command `01a06424-102b-76d0-a7cf-9e7d25c88041` |
| 6. Runner gone while a command is open | **Not settled, as expected.** No sweep exists in this slice. | see below |

**Redis after a Stop, verified by direct inspection:** `running` gone, `alive` still present and
by then held by the resuming turn, and `superseded:<project>:session:<id>:turn:<stopped turn>`
written. That is the same shape an ordinary turn end leaves, which is the point.

**Scenario 6 in detail.** A command that is claimed and never reported stays `claimed`, and the
session's `stopping_turn_id` stays set, indefinitely. Observed directly: command
`01a0641a-d3c0-7980-8675-5349d0e3a118` sat `claimed` for over ten minutes with nothing to settle
it, and two session rows were left marked stopping. **This slice does not build the settlement
sweep.** The DAO exposes `expire_claims(now, max_deliveries)` and `settle_command` for it. The
handoff is to the branch `feat/session-execution-watchdog`, and the rule both sides must obey is
that one execution reaches exactly one terminal outcome from exactly one writer. It has to be
agreed before either lands; a second sweep racing the first is a worse bug than the one being
fixed.

### Tests

| Suite | Result |
|---|---|
| `api/oss/tests/pytest/unit/sessions/test_session_cancel_admission.py` | 15 pass. Admission guards, the arrival-time stamp, the collapse, the settlement, and the assertion that pins warm resume: `alive` survives a Stop. |
| `api/oss/tests/pytest/unit/sessions/test_session_commands_dao.py` | 17 pass against a real Postgres. Two concurrent claims yield one winner, two concurrent admissions yield one command, the settle guard refuses a foreign replica, a terminal command cannot be settled twice. |
| `api/oss/tests/pytest/unit/sessions` (whole directory) | 553 pass. Four failures in `test_records_turn_span_dao.py` are a DNS failure reaching the tracing database from the host, unrelated to this branch. |
| `cd services/runner && pnpm test` | 2663 pass, 4 fail. All four are `gateway-run-turn-composition.test.ts`, verified failing on the base commit before any change here. |
| `cd web && pnpm lint-fix` | 25 tasks, no errors. |
| `ruff format` and `ruff check` in `api/` | Clean, run with the CI-pinned 0.15.12. |

---

## What is left

- **The settlement sweep.** Named above. It is the difference between "a Stop the runner missed
  settles in two minutes" and "it never settles".
- **The long-poll adapter.** Not built. `AGENTA_SESSIONS_CONTROL_ADAPTER` defaults to `direct`
  and any other value refuses to boot (`api/entrypoints/routers.py`) rather than falling back
  silently to a transport the operator did not choose. Building it changes one file plus one
  runner module, and no route, data shape, or transition.
- **The wrapper.** `POST /sessions/streams/` still does what it always did. Its cancel branch
  becomes a call to `request_cancel` in the same change that flips mobile, so released clients
  get the new behaviour with no client change.
- **The Fern client.** The desktop calls the new route through raw axios. Move it when the API
  client is next regenerated.
- **Mobile.** Untouched, as the brief asked.

---

## Open questions for Mahmoud

1. **Is the exact `not_held` detector enough on its own, with no replica census?** Settled in
   the revised design and built that way. Recommendation: **yes**. Reason: the census could not
   tell two live replicas from one that had restarted and broke Stop after every deploy, while
   the `not_held` condition is produced by nothing but the wrong-replica failure. Listed here
   only so the removal is on the record.
2. **Who owns settling an abandoned command?** Recommendation: **the execution watchdog**, using
   the DAO methods this slice exposes. Reason: one execution must reach exactly one terminal
   outcome from one writer, and two sweeps racing to write `lost` is worse than the bug. Until
   it exists, a Stop the runner never reports leaves the session reading "stopping" forever.
3. **Does the desktop read the execution id with an extra request?** Recommendation: **yes, as
   built.** Reason: the cached liveness poll is up to 15 seconds stale and a stale id is refused
   with a conflict, which would make Stop silently do nothing. The extra read costs about 30
   milliseconds inside a budget of five seconds. The alternative is to send no expectation, which
   switches off the cheapest late-Stop guard.
4. **Should a Stop settle before the sandbox has finished parking?** Recommendation: **yes, as
   built.** The runner reports as soon as it has issued the abort, about 70 milliseconds in,
   while the park completes around a second later. Reason: the command's job is to deliver the
   Stop, and waiting for the teardown would make a Stop that worked look stuck. The cost is that
   `outcome = stopped` means "the cancel was delivered", not "the sandbox is parked".
5. **Do we keep `session_commands` rows forever?** Recommendation: **delete settled rows seven
   days after `settled_at`**, as the design says. Not built here, because it belongs with the
   sweep. Commands are operational state; durable history stays in `session_records`.
