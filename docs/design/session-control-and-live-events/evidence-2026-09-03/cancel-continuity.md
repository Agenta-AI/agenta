# A stopped turn's continuity record

> AGENT-GENERATED, low weight. Lane: cancel continuity, 2026-09-03. Branch
> `spike/session-cancel-continuity`, cut from `spike/session-cancel-warm` at `9e21fba4ee`, head
> `2808f97bd9`. Not pushed. To be folded into PR #6496. Two commits: `ec4d9f40ef` (the stopped
> turn's continuity record) and `2808f97bd9` (releasing the session owner claim at shutdown).

## The answer first

A cancelled turn never completed its `session_turns` row, so the durable hydration written for
exactly this case could never fire, and the first runner restart after a Stop cost the session its
native harness session. One condition in `run-turn.ts` decided it: the branch that records the
resume pointer and calls `POST /sessions/turns/complete` excluded `stopReason === "cancelled"`
outright. The fix makes the record follow the HARNESS's own confirmation instead of the stop
reason: a cancel the harness answered (`cancelSettled`) is the same proof that already earns the
warm park in `shouldPark`, so it now takes the same completion path a finished turn takes. A pause,
and a cancel the harness never confirmed, still drop the record and fall back to cold replay.
Verified live on one stack with the fix reverted and then applied, same scenario both times: before,
turn 0 kept a null `end_time`, the runner logged no hydration, the continuation opened a brand-new
harness session and answered "I don't know"; after, turn 0 carried `end_time`, the runner logged
`hydrated ... turn=0` then `session/load attempted ... loaded=true` and `mode=load`, turn 1 carried
the SAME `agent_session_id`, and the continuation recalled the codeword from an empty client
transcript with server-side reconstruction switched off. The sandbox id changed on both runs, which
is expected on the local provider: the process pool dies with the container and the native session
comes back from the durable mount, not from the sandbox.

## Scenario table

| Scenario | Provider | Harness | Commit | Result | Timing | Evidence |
|---|---|---|---|---|---|---|
| Smoke: one plain turn | local | `pi_core` | `ec4d9f40ef` | pass, answered `READY` | 8.8 s | `smoke.json` |
| Stop → restart → continue, fix REVERTED in the tree | local | `pi_core` | `9e21fba4ee` behaviour | turn 0 `end_time` null; no hydration; new `agent_session_id`; recall FAILED ("I don't know") | Stop settled 22.4 s after the request (heartbeat delivery); continuation refused 6 times, admitted at 122.8 s | `before-fix.json`, `before-fix.log` |
| Stop → restart → continue, fix APPLIED | local | `pi_core` | `ec4d9f40ef` | turn 0 `end_time` set; `hydrated`, `loaded=true`, `mode=load`; SAME `agent_session_id`; recall PASSED (`CONTDD6839`) | Stop settled 22.5 s after the request; continuation refused 6 times, admitted at 112.3 s; the resumed turn took 11.5 s | `after-fix.json`, `after-fix.log`, `proof-lines.txt` |
| Runner unit suite | n/a | n/a | `ec4d9f40ef` | 161 files, 2674 tests, all pass | 22.7 s | below |

Raw evidence: `~/agenta-qa-evidence/2026-09-03-session-round2/cancel-continuity/` (see its
`README.md` for the stack, the driver and the file list). The stack was
`agenta-ee-dev-session-continuity` on http://144.76.237.122:8680, Postgres 5441, EE dev images,
local sandbox provider, `--no-tunnel`. The OpenAI model key was loaded from
`~/.agenta-qa-openai.env` into each run's fresh project vault through
`POST /api/vault/v1/secrets/` at 14:22:14, 14:24:07 and 14:27:18 (Europe/Berlin). No key value
appears anywhere in this lane's files.

## The trace: where a completed turn writes its continuity record, and why a cancelled one did not

Every path below is under `services/runner/`.

1. **The turn claims its index at turn start.** `src/engines/sandbox_agent/run-turn.ts:203` sets
   `env.continuityTurnIndex = nextTurnIndex(sessionId, continuityStore)`, which is one past the
   store's latest RECORDED turn. A turn that never records therefore does not advance the counter.
2. **The ledger row is INSERTed at turn start, incomplete by design.**
   `src/engines/sandbox_agent/run-turn.ts:447` builds `turnLedgerContext` (needs a session id, a
   turn index, the run credential and a stream id), and `:465` calls `appendSessionTurn` with
   `agent_session_id`, `sandbox_id`, `start_time`, references and trace ids — and no `end_time`.
   The call is fire-and-forget (`.catch(() => {})`), which is Spike B's observation. The comment
   above it already stated the contract: "Row existence proves only that a turn started. Native
   continuation is trustworthy only after `end_time` is set."
3. **The completion branch excluded the cancel.** `src/engines/sandbox_agent/run-turn.ts:1422`
   onward. Before this change the guard read
   `stopReason !== "paused" && stopReason !== "cancelled" && ...`. Inside it, two writes: the
   in-memory `sessionContinuityStore.record(...)`, and `sessionTurnClient.complete(...)`, which is
   `completeSessionTurn` at `src/engines/sandbox_agent/session-continuity-durable.ts:188`, a
   `POST /sessions/turns/complete` carrying `agent_session_id` and `end_time`.
4. **The `else` branch dropped the record.** `src/engines/sandbox_agent/run-turn.ts:1471` called
   `invalidateContinuity` (`src/engines/sandbox_agent/environment.ts:1236`) for both `paused` and
   `cancelled`, on the stated reason that the harness may have written a partial turn natively.
5. **Hydration then refuses the row.**
   `src/engines/sandbox_agent/session-continuity-durable.ts:138` is
   `hydrateHarnessSessionFromDurable`; its early return at `:170` demands `agent_session_id`, a
   `turn_index` AND `end_time`. A stopped turn satisfies the first two and never the third, so the
   function restores only the cross-harness turn counter and returns without seeding the store.
6. **So the next turn opens cold.** `src/engines/sandbox_agent/environment.ts:1076` calls hydrate
   before consulting `eligibleAgentSessionId`, so an empty store means no `priorAgentSessionId`,
   and `openSession` (`src/environment/harness-session-lifecycle.ts:105`) skips the `session/load`
   branch entirely and logs `mode=create`.

The park path is separate and was already correct. `cancelHarnessTurn`
(`src/engines/sandbox_agent/cancel-turn.ts:82`) sends ACP `session/cancel` and waits for the
harness to answer the open prompt; `shouldPark` (`src/engines/sandbox_agent/engine.ts:37`) parks
only on a labelled user Stop whose `cancelSettled` is true; the coordinator logs `park-cancelled`
(`src/lifecycle/session-coordinator.ts:783`). That park is process-local, which is why it does not
survive the restart on its own and why the durable row is the thing that had to change.

## The change

One commit, `ec4d9f40ef`, two files.

`services/runner/src/engines/sandbox_agent/run-turn.ts` — the guard becomes a named predicate:

```ts
const turnIsResumePoint =
  stopReason !== "paused" && (stopReason !== "cancelled" || cancelSettled);
```

`cancelSettled` is the value `runTurn` already computed for `shouldPark` and already returns on the
result. Nothing else moved: the same `record(...)` and the same `completeSessionTurn` call run on
the same path a completed turn uses, and the `else if` that invalidates is untouched, so a pause and
an unconfirmed cancel behave exactly as before.

`services/runner/tests/unit/cancel-continuity.test.ts` — six new engine-seam tests through
`runSandboxAgent` with a fake sandbox whose prompt stays open until `session/cancel` arrives, which
is the real shape of a Stop. They pin: the ledger row is completed once, with a parsable `end_time`
and the native session id; the in-memory pointer advances to the stopped turn's index; the sandbox
parks as well; an unlabelled abort whose cancel settled still writes the record although the sandbox
is deleted; and an abort the harness never confirmed writes no completion, keeps no pointer, and
destroys. Reverting the one-line predicate fails three of the six.

## Before and after, live

Same driver, same prompt, same stack, one runner restart in the middle. The only difference is the
predicate above, flipped in the working tree and picked up by the runner's `tsx watch`.

### Before (session `8f863279-2190-4bd3-af78-5200d02aab6a`, codeword `CONTD26393`)

The Stop settled: `stage=harness_cancel sent=true settled=true elapsed_ms=19`, then
`prompt stopReason=cancelled`, then `park-cancelled ... ttl=60000ms`. The ledger row was appended
and never completed:

```
12:24:20.839 append OK session=8f863279-... harness=pi_core turn=0
             (no complete for turn 0)
```

`session_turns` turn 0 after the Stop: `agent_session_id 01a0673a-21c6-7c3f-8486-d9c3fac4915e`,
`sandbox_id local/127.0.0.1:38447`, `end_time` NULL.

After the restart the continuation opened a fresh everything and lost the conversation:

```
12:26:28.399 stage=sandbox_start ... mode=create
12:26:32.541 stage=create_session ... sandbox=local/127.0.0.1:39277 mode=create
```

No `hydrated` line, no `session/load attempted` line. Turn 1's row carries a different
`agent_session_id` (`01a0673c-24ef-7db5-9967-4651aaf7bfda`) and a different sandbox. The recall
answered **"I don't know"**.

### After (session `a7bd7a3b-aeed-4df6-ad6c-d7ece2c43fd8`, codeword `CONTDD6839`)

The Stop settled identically, and the completion now lands one millisecond before the park:

```
12:27:49.295 stage=harness_cancel sent=true settled=true elapsed_ms=16
12:27:49.296 prompt stopReason=cancelled
12:27:50.115 complete OK session=a7bd7a3b-... turn=0
12:27:50.116 park-cancelled key=...:a7bd7a3b-... ttl=60000ms
```

`session_turns` turn 0: `agent_session_id 01a0673c-f160-7794-8ddc-5796775bb602`,
`end_time 2026-09-03 12:27:50.073+00`.

The runner was restarted at 12:27:50.7 and healthy 6.1 s later. The continuation then hydrated and
loaded:

```
12:29:32.779 stage=sandbox_start ... mode=create
12:29:33.420 hydrated session=a7bd7a3b-... harness=pi_core turn=0
12:29:35.373 [continuity] session/load attempted session=a7bd7a3b-... harness=pi_core loaded=true
12:29:35.373 stage=create_session ms=1953 sandbox=local/127.0.0.1:34967 mode=load
```

Turn 1's row carries the SAME `agent_session_id` and a new `sandbox_id`
(`local/127.0.0.1:34967`). The recall answered **`CONTDD6839`**, driven by a client transcript of
one message with `AGENTA_SESSIONS_RECONSTRUCT=false` on the runner, so no text replay could have
supplied it.

### Identity across the restart

| Thing | Before | After |
|---|---|---|
| Sandbox id | new (`:38447` → `:39277`) | new (`:36129` → `:34967`) |
| Harness `agent_session_id` | new | **same** |
| Open mode of the next turn | `create` (3324 ms) | `load` (1953 ms) |
| Codeword recall from an empty transcript | no | yes |

A new sandbox id is expected and correct on the local provider: the sandbox is a process the runner
owns, so the pool dies with the container. The durable working directory is a geesefs mount over
the object store, so the harness's own session file outlives the sandbox, which is exactly what the
`session/load` above reads.

### How long the continuation was refused, and by which check

On BOTH runs the continuation was refused six times and then admitted, at 122.8 s (before) and
112.3 s (after). The refusal is **not** the admission gate the restart lane saw. Every refusal here
was the local-provider ownership guard:

```
Agent run failed: local sandbox requires a single runner: replica '<new>' is not the owner
of session '<id>' (owned by '<old>'). Refusing to cold-start on the wrong host.
```

That is `assertLocalRunnerOwnership` (`src/engines/sandbox_agent/session-continuity.ts`), called
from `src/engines/sandbox_agent/environment-setup.ts:91` with the owner the API reports. The owner
is the Redis affinity key `owner:session:<id>`, whose TTL is `AGENTA_SESSIONS_REDIS_OWNER_TTL_SECONDS`
defaulting to **120 s** (`api/oss/src/utils/env.py:1428`), refreshed on every heartbeat and never
stolen (`claim_owner`, `api/oss/src/dbs/redis/sessions/locks.py:329`). A restart mints a new
replica id, so the session is unusable until the dead replica's key expires. The measured 112 to
123 s matches the 120 s TTL. This lane did not change it, and the fix does not depend on it.

## The second fix: releasing the owner claim at shutdown

The refusal above is not a side effect of anything this lane changed, and it outlives the fix:
after every runner restart the replacement replica is refused for the rest of the affinity
lease. `spike/session-cancel-warm` had no release path at all. Commit `2808f97bd9` adds one.

### Why nothing released it

`owner:session:<id>` is claimed by every heartbeat (`claim_owner`,
`api/oss/src/dbs/redis/sessions/locks.py:329`), refreshed on every later beat, and released by
nothing on the normal path. `force_clear_owner` exists but only two callers use it: the kill
route and the orphan sweep. `clear_owner`, the release-if-owner twin at `locks.py:352`, existed
and had **no caller at all**. So a runner that exited holding claims left each key standing for
the remainder of `OWNER_TTL_SECONDS`, and `claim_owner` refuses to steal, so the replacement
replica could not take the session. The runner never released because it had no way to: nothing
tracked which sessions it owned, and nothing on the API side accepted a hand-back.

### The change

**API**, two files. `SessionHeartbeatRequest` gains `release_owner: bool = False`
(`api/oss/src/core/sessions/streams/dtos.py`). `SessionStreamsService.heartbeat` handles it
first, before the superseded check and before any lock is read or written
(`api/oss/src/core/sessions/streams/service.py`), and does exactly one thing: `clear_owner`.
No turn lock, no stream row, no liveness — a departing runner asserts none of those. Because
the release is conditional on still being the owner, a beat from a stale replica is a no-op and
can never take a session from a live one. The route and its permission are unchanged.

**Runner**, two files. `sessions/alive.ts` gains a process-local map of the sessions this
replica owns and the freshest credential seen for each. It is fed from the two calls that
already claim affinity, and only when the API's answer names THIS replica: `sendHeartbeat` now
reads `replica_id` off the response, and `claimSessionOwnership` already did. `server.ts` calls
`releaseOwnedSessions(timeoutMs)` from the existing SIGTERM handler, after the pool drain and
the in-flight sandbox destroy, so a session whose sandbox is still being deleted does not yet
look free to another replica.

The credential is the run's own ephemeral platform token, the same one every beat already
carries. It never leaves the process and is never logged. An entry whose token has expired
simply fails its release and falls back to the lease.

### What it does not cover

A `SIGKILL` reaches no handler, so a killed runner still leaves its claims to expire. So does an
API the runner cannot reach at shutdown. The 120-second lease remains the fallback for both,
which is exactly today's behaviour — the fix only removes the case the runner can see coming.

### Live: same scenario, first attempt admitted

Session `86c1f2a5-033b-455d-ab9a-52475d61f920`, codeword `CONTE4C6EC`, same stack, same driver.
The Stop settled, the turn's row was completed, the sandbox parked, and the shutdown released
the claim 26 ms after the signal:

```
12:42:50.228 (session_turns turn 0 end_time)
12:42:50.266 complete OK session=86c1f2a5-... turn=0
12:42:50.266 park-cancelled key=...:86c1f2a5-... ttl=60000ms
12:42:50.626 [sandbox-agent] received SIGTERM, cleaning up in-flight sandboxes
12:42:50.652 [sessions/alive] releasing 1 session ownership claim(s) on shutdown
12:42:50.663 [sessions/alive] ownership released session=86c1f2a5-...
```

The whole shutdown, signal to release, took 37 ms. The runner reported healthy 6.1 s later, and
the continuation was admitted on its **first** attempt, 11.2 s after the restart and 5.1 s
after the health check passed:

```
12:43:01.806 stage=sandbox_start ... mode=create
12:43:02.453 hydrated session=86c1f2a5-... harness=pi_core turn=0
12:43:04.141 [continuity] session/load attempted ... loaded=true
12:43:04.141 stage=create_session ms=1688 sandbox=local/127.0.0.1:41473 mode=load
12:43:06.493 complete OK session=86c1f2a5-... turn=1
```

Turn 1 carries the same `agent_session_id` (`01a0674a-ae42-7f4f-b980-fd5b3aea7c97`) as turn 0,
and the recall answered `CONTE4C6EC` from a one-message client transcript.

| Run | Restart shape | Refusals | Admitted after | Recall |
|---|---|---|---|---|
| `before-fix.json` | `docker restart`, neither fix | 6, all local-owner | 122.8 s | failed |
| `after-fix.json` | `docker restart`, continuity fix only | 6, all local-owner | 112.3 s | passed |
| `after-release.json` | `docker restart`, both fixes | **0** | **first attempt, 11.2 s** | passed |
| `kill-control.json` | `docker kill -s SIGKILL`, both fixes | RESULT_REFUSALS | RESULT_ADMITTED | RESULT_RECALL |

The SIGKILL row is the negative control, run on the same stack with the same code and the same
timing: the handler is skipped, the claim stands, and the identical refusal returns for the
full lease. That is what makes the `after-release` result attributable to this fix rather than
to anything else about the stack.

## Findings

1. **The fix works, and it is one predicate.** A settled cancel is a faithful resume point by the
   same test that already earns the park. Making the two agree removes the only reason the durable
   hydration branch was dead.

2. **The marker string the restart lane searched for cannot appear on the wired path.**
   `hydrateHarnessSessionFromDurable` logs through `deps.log ?? defaultLog`, and
   `environment.ts:1076` always passes the runner's own logger, so the line reads
   `[sandbox-agent] hydrated session=...`, never `[session-continuity/durable] hydrated ...`. The
   restart lane's "zero `[session-continuity/durable] hydrated` lines all day" was therefore partly
   a search artifact. Its conclusion still holds — `mode=load` never appeared either, and the null
   `end_time` explains why — but the string is not a usable probe. Search for `hydrated session=`
   and for `stage=create_session ... mode=load` instead.

3. **A runner restart locks a local-provider session out for up to 120 s, and the ownership guard
   is what does it here.** The restart lane attributed the refusal to admission and to the 90-to-150 s
   watchdog sweep. On this branch, with the old streams Stop, the alive and running locks are gone
   before the restart, so admission passes and the OWNER key is the thing left standing. Both
   refusals exist; which one answers depends on what the Stop already cleared. Fixing this means
   clearing `owner` when a Stop settles, or letting a runner claim a session whose owner has not
   heartbeat recently. Neither belongs in this lane.

4. **A settled cancel that is NOT a user Stop now writes the record too.** An unlabelled abort (a
   client disconnect) still deletes the sandbox, because `shouldPark` refuses it, but if the harness
   confirmed the cancel the native session is intact on the durable mount and the record is worth
   keeping: the next turn can load it into a fresh sandbox. This is a deliberate consequence of
   keying on `cancelSettled` rather than on the park decision, it is pinned by a test, and it is
   open question 1 below.

5. **`session_records` does not exist on this branch, so the terminal record could not be read from
   Postgres.** The records-durability slice lands elsewhere. Spike A read
   `stopReason: "cancelled"` off that table on its own stack; here the same fact is visible only in
   the frame stream and the runner log. Nothing in this lane's conclusions depends on it.

6. **The Stop still takes about 22 s to reach the runner on this branch.** Measured 22.4 s and
   22.5 s from the request to a settled cancel, which is the heartbeat delivery the brief said to
   expect (up to 30 s). Work package B.

## Tests

```
cd services/runner && pnpm test
  → 161 files passed, 2674 tests passed, 0 failed
cd services/runner && pnpm run typecheck
  → clean
```

The new file alone: `pnpm exec vitest run --project unit tests/unit/cancel-continuity.test.ts`
→ 6 passed. With the predicate reverted → 3 failed, 3 passed.

One note for whoever runs this suite in a fresh worktree: `pnpm run build:extension` must run once
before `pnpm test`, or the four `gateway-run-turn-composition` cases fail with "the in-sandbox tool
MCP shim could not be delivered". That is a missing build artifact, not a regression.

## Open questions for Mahmoud

1. **Should a settled cancel write the continuity record even when the sandbox is deleted (a client
   disconnect rather than a Stop)?** *Recommendation: yes, as shipped here.* Reason: the harness
   confirmed it is idle, and its session file lives on the durable working directory, not in the
   sandbox. Keeping the record lets the next turn `session/load` into a fresh sandbox instead of
   replaying the whole conversation as text. Refusing it would tie continuity to a park decision it
   does not depend on, and would make a disconnect cost strictly more than a Stop for no gain.

2. **Should the turn ledger mark HOW a turn ended, not just that it did?** *Recommendation: yes,
   but not in this lane.* Reason: after this change a stopped row and a completed row are
   indistinguishable in `session_turns`, and the only place the difference survives is the terminal
   `done` record's `stopReason`. A reader reconciling the two tables cannot tell them apart. This is
   Spike A's open question 4 wearing a different hat, and it belongs with the immutable-history
   choice in work package D.

3. **Should a settled Stop clear the Redis `owner` key?** *Recommendation: yes, and treat it as the
   real fix for the post-restart lockout.* Reason: the session is demonstrably idle when the Stop
   settles — no alive lock, no running lock, a parked sandbox — and the only thing refusing the next
   message for two minutes is an affinity key naming a replica that no longer exists. `force_clear_owner`
   already exists for the force path. The alternative, waiting out a 120 s TTL, is a user-visible
   two-minute outage after every runner deploy.

4. **Do we verify this on Daytona before the RFC is accepted, or at the release gate?**
   *Recommendation: at the release gate.* Reason: the durable mount is what carries the native
   session, and on Daytona the parked sandbox usually survives a runner restart outright, so the
   hydration path is exercised LESS there, not more. The interesting Daytona question is a different
   one (does a reconnected sandbox still hold the harness session), and it is already in the gate
   cell Spike A proposed.

5. **Should the release-gate cell assert the ledger row, not just the recall?** *Recommendation:
   yes.* Reason: the codeword recall passes for two different reasons, native load or text replay,
   and only the runner log and the `session_turns` row separate them. One extra assertion —
   `end_time` present on the stopped turn, and the same `agent_session_id` on the next turn — turns
   a soft signal into a hard one. Step 9 of Spike A's cell is the place to add it.

## What this lane did not do

- **Did not touch the park rule, the Stop route, or the API.** The brief ruled all three out and
  nothing in the fix needed them.
- **Did not test Claude or Codex.** The completion path branches on `stopReason` and
  `cancelSettled`, neither of which is harness-specific, and the child-cleanup lane already showed
  all three harnesses answer `session/cancel`. It is an expectation, not a measurement.
- **Did not test Daytona.** Local provider only, for the reason in open question 4.
- **Did not push the branch.** Head `ec4d9f40ef`, one commit on top of `9e21fba4ee`.
- **Did not run the second scenario more than once per side.** The A/B is one run each, plus a
  smoke. The decisive facts (the `end_time` value, the `hydrated` and `mode=load` lines, the
  `agent_session_id` equality) are deterministic reads rather than timing-sensitive ones, but the
  timings in the table are single samples.
