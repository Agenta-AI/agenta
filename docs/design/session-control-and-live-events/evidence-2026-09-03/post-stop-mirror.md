# Post-Stop mirror: the stream row after a durable Stop settles

> AGENT-GENERATED, low weight. Every conclusion below is an agent's, not a decision. The live
> measurements are real and reproducible; the judgement calls around them are not binding.

## Answer

The claim in `post-stop-liveness.md` is confirmed, and it is worse on this branch than the trace
estimated. Measured on the local sandbox with Pi, a durable Stop released the Redis `running`
key within 0.5 s but left the `session_streams` row reading `is_running: true`, with its
`updated_at` frozen at the pre-Stop value, for the whole 193 s sample. The row never corrected
itself because settlement tombstones the stopped execution before it releases `running`, so the
runner's own final `is_running=false` heartbeat is refused by the tombstone check and returns
before the mirror write at the end of `heartbeat`. The runner log shows exactly that beat:
`heartbeat OK ... running=false INTERRUPTED`. The trace put the stale window at 90 to 150 s from
the orphan sweep, but `feat/session-durable-cancel` still carries the 300 s sweep threshold
(`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:34`), so on this branch the row stays wrong
for 5 to 6 minutes. The fix is one call: settlement now writes the mirror itself, re-reading the
nest from Redis so a newer turn that already took `running` is reported rather than erased. After
the fix the row reads `is_running: false, is_alive: true` within 0.15 s of the Stop request, the
project-scoped liveness query the desktop actually polls reports the session as not running, and
the parked sandbox still resumes warm in 2.0 s against 14.2 s for a cold rebuild.

One correction to the trace. It says the mirror gap is user-visible because `query_streams` reads
Postgres only. That is true of the collection query, but NOT of the single-session read
`GET /sessions/streams/?session_id=`: `SessionStreamsService.fetch` overlays the Redis nest onto
the row and already reported `is_running: false` correctly before the fix. Both were sampled
separately below. The stale surface is the project-scoped `POST /sessions/streams/query` that
`querySessionStreams` drives, which is what every liveness poll and every "running elsewhere"
surface reads.

## Scenarios

| Scenario | Provider | Harness | Commit | Result | Timing | Evidence |
|---|---|---|---|---|---|---|
| Stop a `sleep 45` turn, sample 193 s (before) | local | pi_core | `58bec4d382` | Row stuck `is_running: true` for the whole sample | Redis `running` gone at Stop+0.5 s; row never corrected | `~/agenta-qa-evidence/2026-09-03-session-round2/post-stop-mirror/before-fix.json` |
| Same, after the fix, sample 193 s | local | pi_core | `8b221df293` | Row `is_running: false`, `is_alive: true` | Mirror written 0.15 s after the request | `.../after-fix.json` |
| Same, resume inside the 60 s park window | local | pi_core | `8b221df293` | Warm reuse, conversation continues | Resume 2.01 s | `.../after-fix-warm.json`, `.../runner-log.txt` |
| Resume after the park window expired | local | pi_core | `8b221df293` | Cold rebuild, conversation continues | Resume 14.16 s | `.../after-fix.json` |

Raw evidence, including the probe script, is in
`~/agenta-qa-evidence/2026-09-03-session-round2/post-stop-mirror/`.

## Before: the timeline

Session `abb5ddbc-73b9-4a06-ac7a-1c0b66cc3b57`, turn `53ac2c3f-25e6-4738-a636-e1a3d88ccb2f`.
`POST /sessions/{id}/cancel` with `expected_execution_id` answered 202 at t=10.11 s.

| t (s) | Postgres `is_running` | Postgres `is_alive` | Row `updated_at` | Redis keys held |
|---|---|---|---|---|
| 9.0 (pre-Stop) | true | true | 11:53:50.452 | alive, owner, running |
| 10.6 (Stop+0.5) | true | true | 11:53:50.452 | alive, owner, superseded |
| 13.8 (Stop+3) | true | true | 11:53:50.452 | alive, owner, superseded |
| 60.0 | true | true | 11:53:50.452 | alive, owner, superseded |
| 120.0 | true | true | 11:53:50.452 | alive, superseded |
| 192.5 (end) | true | true | 11:53:50.452 | alive, superseded |

The runner log gives the settlement race directly:

```
11:53:59.987 [control] aborted command=… turn=53ac2c3f…
11:54:00.006 [sandbox-agent] stage=harness_cancel sent=true settled=true elapsed_ms=18
11:54:00.029 [control] outcome reported command=… state=stopped
11:54:00.883 [keepalive] park key=… ttl=60000ms state=idle (re-park)
11:54:00.908 [sessions/alive] heartbeat OK … running=false INTERRUPTED
```

The outcome report at 11:54:00.029 is where settlement tombstoned the turn. The runner's
`running=false` beat arrived 0.88 s later and was refused, which is the `INTERRUPTED` on that
line. The row was never written.

Two second-order facts fell out of the same run. The sandbox park window is 60 s local, and the
runner evicted the sandbox at 11:55:00.883 with no notice to the API, so `alive` outlived what it
protects by a wide margin, exactly as the trace predicted. And the orphan sweep on this branch
uses 300 s, not the 90 s the trace assumed, so the stale row survives longer than reported.

## After: the timeline

Session `fd40ed3b-796a-4766-bd86-e7164b7a5296`. Cancel request at 12:09:11.6; the row's
`updated_at` is 12:09:11.736.

| t (s) | Postgres `is_running` | Postgres `is_alive` | Row `updated_at` | Collection query says running |
|---|---|---|---|---|
| 9.0 (pre-Stop) | true | true | 12:09:01.908 | yes |
| 10.6 (Stop+0.5) | false | true | 12:09:11.736 | no |
| 13.6 (Stop+3) | false | true | 12:09:11.736 | no |
| 32.0 | false | true | 12:09:11.736 | no |

Then the resume, 23 s after the Stop and inside the park window:

```
12:09:34.897 [keepalive] hit-continue key=…
12:09:34.897 [reconcile] shadow … decision=reuse(hit-continue) plan=reuse(no-op) agree facets=[none]
```

The reply came back in 2.01 s. The same probe with the resume placed after the park window had
expired took 14.16 s and logged `decision=rebuild(miss)`, which is the control that makes the
2.01 s meaningful.

## The change

Two commits on `feat/session-durable-cancel`, both small.

**`8b221df293` — settlement writes the row.**

- `api/oss/src/core/sessions/streams/service.py:1057` adds `mirror_liveness`, a public entry
  point onto the existing `_mirror_flags`. It re-reads the Redis nest and writes the row. It
  re-reads rather than writing a literal `false` so that a newer turn holding `running` is
  reported and not erased.
- `api/oss/src/core/sessions/commands/service.py:495` calls it inside `settle`, after
  `release_running` and inside the `outcome == stopped and target` branch. The tombstone order is
  unchanged, so a late beat still cannot re-arm the locks. Nothing in the orphan sweep was
  touched; that belongs to `feat/session-execution-watchdog`.
- `api/oss/tests/pytest/unit/sessions/test_session_cancel_admission.py:594` asserts the ROW after
  settlement, which the existing test at `:553` does not: it asserts Redis with a fake streams
  service that never looked at a row. The fake now records the nest exactly as the real mirror
  would read it, so the assertion is about content and not about a call happening. A second test
  at `:632` pins that a `not_running` settlement writes no row at all, because a newer turn may
  hold the nest and settlement has no business writing over it. The first test was checked
  against the unfixed code and fails there, so it pins the behavior rather than describing it.

**`76e4b1368b` — the four polls key on running.**

The trace's second recommendation, done as one shared predicate rather than four copies.

- `web/packages/agenta-entities/src/session/core/liveness.ts` adds `livenessPollInterval`: 15 s
  while any row is running, 60 s while a row is merely alive, and the caller's `idle` value
  otherwise, which defaults to `false`.
- `web/oss/src/components/AgentChatSlice/state/liveness.ts:45` and
  `web/mobile/src/features/sessions/useLivenessPoll.ts:26` call it with the default, so they stop
  polling when nothing is alive, exactly as they do today.
- `web/packages/agenta-navigation/src/dynamic/sessionsSource.ts:131` passes `{idle: 60_000}`. The
  rail's slow baseline is deliberate: it must discover a run started under another agent or in
  another browser. That behavior is unchanged; only the fast tier narrowed.
- `web/mobile/src/features/sessions/useActionableInteractions.ts:34` keys on running directly. A
  running turn is what mints new gates, which its own comment already said.
- `web/packages/agenta-navigation/tests/unit/sidebarChildren.test.ts:481` asserted the old rule
  (`is_alive` alone gives 15 s) and now asserts the new one.

## Findings

1. **The single-session read was never stale.** `SessionStreamsService.fetch` overlays Redis on
   the row, so `GET /sessions/streams/?session_id=` reported the truth throughout the before-fix
   run. Only the project-scoped collection query is served from Postgres alone. Any future claim
   that "the API reads the row" needs to name which of the two routes it means.
2. **The stale window on this branch is 5 to 6 minutes, not 90 to 150 s.** The trace read the
   sweep thresholds off the watchdog branch. `feat/session-durable-cancel` still has
   `ORPHAN_THRESHOLD_SECONDS = 300`, and the sweep runs every 60 s.
3. **`alive` outlives the sandbox by 30 to 60 times.** Measured: the runner parked for 60 000 ms
   and evicted at exactly 60 s after the Stop, silently. The `alive` key had 3540 s left at that
   moment. "Ready to resume" is therefore honest for one minute and a promise of a cold start for
   the following 59.
4. **A stopped turn does still reach the runner mid-tool.** The after-fix run had a bash call
   with `tool-input-available` frames 0.9 s before the Stop, and it settled cleanly with one
   terminal outcome and no error frames.

## Open questions for Mahmoud

1. **Should the mirror write happen for `not_running` and `lost` settlements too, or only for
   `stopped`?** Recommendation: only `stopped`, as built. Reason: those two outcomes change no
   lock, so the nest they would mirror belongs to whatever turn holds it now, and a write from
   the obsolete command's settlement is a write it has no basis for. The live turn's own
   heartbeats already keep the row current.
2. **Should the orphan sweep threshold on `feat/session-durable-cancel` be left at 300 s?**
   Recommendation: leave it, and let the watchdog lane own the number. Reason: with the mirror
   written at settlement a stopped session no longer lands in the running branch at all, so the
   threshold stops mattering for this path. Changing it here would collide with
   `feat/session-execution-watchdog`.
3. **Should the desktop and mobile liveness polls stop entirely when nothing is alive, or take a
   slow floor like the rail?** Recommendation: keep them stopping, as they do today and as this
   change preserves. Reason: widening them to a 60 s baseline in every open tab is a request-count
   decision with a real cost, and it is a separate question from the cadence bug. Say the word and
   it is a one-argument change.
4. **Should `alive`'s time to live be cut toward the park window now that the row is honest?**
   Recommendation: no, not in version one, and the trace's reasoning holds. Reason: the API cannot
   learn the true window without a wire change and the pool can evict early anyway. The measured
   60 s eviction above is the evidence that the honest fix is a sandbox-state signal, not a
   shorter lock.
5. **Should the sidebar "Idle" filter and the sessions page "Live" chip be re-cut?** Not touched
   here; it is a product-vocabulary decision, and the trace already put it to you as its question
   two. Recommendation: yes, and it is now more urgent, because after this change a stopped
   session is a correct, common, long-lived member of the alive set.

## What this did not cover

Daytona was not exercised; every run used the local sandbox provider, so the 120 s Daytona park
window is untested here. No browser was driven, so the "running somewhere else" strip was verified
through the query that feeds it and not by looking at it. The mobile surfaces were changed and
unit-tested but not run. The second-Stop-after-settlement case that the trace raises as its
question four was not probed.

---

# Addendum: the restart refusal, and two more settlement defects

> Same weight and same caveats as above. Added after the lead sent three follow-ups.

## The restart refusal is the `owner` key, and the mirror fix does not remove it

The restart lane saw a continuation refused for 90 to 150 s after a settled Stop plus a runner
restart. It is neither the Redis `running` key nor the `session_streams` row. It is the `owner`
affinity key, and the refusal is raised in the runner, by name.

Reproduced on this branch WITH the mirror fix in place. At the moment of the refusal the row
already read `is_running: false, is_alive: true` and `running` was absent from Redis. The
continuation still failed, with the runner's own message:

```
Agent run failed: local sandbox requires a single runner: replica
'b0d4696a-…' is not the owner of session 'c17216a5-…' (owned by 'abc294f0-…').
Refusing to cold-start on the wrong host.
```

The mechanism, read end to end:

- `claim_owner` in `api/oss/src/dbs/redis/sessions/locks.py:330` never steals. It returns the
  current owner when another replica holds the key.
- `OWNER_TTL_SECONDS` is 120 (`api/oss/src/utils/env.py:1476`), so a dead replica's claim
  survives up to two minutes. Measured TTL at the refusal: 101 s.
- A restarted runner is a new process with a new `REPLICA_ID`, so it can never match.
- `assertLocalRunnerOwnership`, called from
  `services/runner/src/engines/sandbox_agent/environment-setup.ts:87-101` through
  `defaultResolveLocalRunnerOwner` (`runtime-policy.ts:224-234`), turns a known-different owner
  into a hard refusal rather than a wrong-host cold start.
- The runner never speaks Redis and never clears `owner` at shutdown, and nothing on the API
  side clears it at settlement.

The timings the lane recorded, refusals through 90 s and admission at 123.6 s, are the 120-second
owner lease expiring, not the sweep. On the watchdog branch the sweep also calls
`force_clear_owner`, which would clear the same key, so the two explanations co-time.

**The decisive test.** Timing agreement is not causation, so the probe deleted ONE key by hand and
retried immediately:

| t (s) | Step | Result |
|---|---|---|
| 10.6 | Stop settled | row `is_running: false`, `running` absent, `alive` held, tombstone written |
| 18.3 | runner restarted, healthy | `owner` unchanged, still the dead replica's id |
| 19.1 | continuation | REFUSED, naming the owner replica |
| 20.2 | `DEL owner:<project>:session:<id>` | 1 key deleted, nothing else touched |
| 27.6 | continuation | ADMITTED, replied "RESUMED" |

Evidence: `~/agenta-qa-evidence/2026-09-03-session-round2/post-stop-mirror/restart-owner-isolation.json`
and `restart_probe.py`.

**The smallest fix, and why I did not make it.** The honest fix is that a restarted runner must
be able to say it holds nothing, so affinity is released rather than waited out. Three shapes,
smallest first:

1. **Release the claim on the way out.** The runner clears the `owner` key for every session in
   its pool during shutdown, through a new authenticated API call. It is the smallest change that
   is unambiguously correct, because the runner knows the truth about its own pool. It does not
   help a runner that is killed rather than stopped.
2. **Let the API expire affinity faster when nothing is running.** `owner` protects a warm pool
   entry on a specific host. A session with no `running` turn and no beating replica has no pool
   entry to protect after that replica dies. Lowering `OWNER_TTL_SECONDS` shortens the outage
   proportionally and changes nothing else, but it also shortens legitimate affinity for a parked
   warm session, which is the property the key exists for.
3. **Make `claim_owner` steal from an owner that is provably gone.** Correct in principle and the
   largest change, because it needs a per-replica liveness key that does not exist today.

I did not implement any of them. The `owner` key is shared surface: the watchdog lane owns
`force_clear_owner`, and option 2 is a one-line TTL change with a warm-affinity cost that is
Mahmoud's call, not mine. Recommendation: option 1, on the runner lane, with option 2 as the
fallback for a killed runner.

## Defect: a named Stop was refused on a parked approval

Confirmed and fixed. Commit `fe1396625e`.

Admission resolved the target from `running` with a fallback to `alive`, then compared
`expected_execution_id` against `running` alone. A parked approval holds `alive` and not
`running`, so the guard read none, refused with a conflict, and left the gate pending. The same
Stop with no expectation was accepted. The browser always sends the id it streamed.

Verified live, one session, gate read straight from Postgres:

| Reading | Value |
|---|---|
| Redis when parked | `alive` = the turn id, `running` = none |
| Row when parked | `is_alive: true, is_running: false` |
| Gate before | `pending` |
| Named Stop | **202 accepted** |
| Gate after | `cancelled` |

Evidence: `.../settlement-defects-clean.json`, key `d1`.

The guard still refuses a stale id. A Stop naming a finished turn on a session parked under a
newer one is refused, and the conflict now names the turn that would have been stopped instead of
none. Both directions are pinned by unit tests.

## Defect: an outcome report could be refused and left unsettled

Confirmed and fixed. Commit `89d7c7c90d`.

Admission inserts the command `pending`, delivers it, and writes `claimed` on the runner's behalf
only after the runner answers. A runner that aborts fast reports inside that window, against a row
that still says `pending`, and the guard on `claimed` alone refused it.

The race showed itself unprompted during the first live run. Two outcome reports arrived 2 ms
apart for one command whose row was `pending` with `claimed_by` null: the runner's won and
returned 200, the duplicate correctly got 409. Under the old guard the runner's report would have
been the one refused, because `pending` is not `claimed`.

Then a clean single-writer run, with the runner frozen so nothing else could settle the row:

| Reading | Value |
|---|---|
| Row after admission | `state: pending`, `claimed_by: null` |
| Outcome report | **200**, settled_at 12:26:18.878 |
| Row after report | `state: applied`, `outcome: stopped` |
| Duplicate report | **409** |

Evidence: `.../settlement-defects-clean.json`, key `d2`.

The replica guard is widened only where there is nothing to guard: a `pending` row holds no claim,
so a null `claimed_by` passes, and a report from a replica that does not hold an existing claim is
still refused. Both are pinned by unit tests, and both new tests were checked against the unfixed
code first.

## Addendum: what was verified and what was not

The four commits were re-verified together after the last change: the mirror still writes
`is_running: false, is_alive: true` at the Stop, and the parked sandbox still resumes warm. The
API session unit suite is 563 passing.

Not covered: the runner-restart fix itself, because I did not make it; a killed rather than
stopped runner; and the claim race under real concurrency rather than the frozen-runner
substitute, which reproduces the row state but not the timing.

## Open questions for Mahmoud, second set

6. **Which shape should the restart-affinity fix take, and on whose lane?** Recommendation: the
   runner releases its owner claims at shutdown, on the runner lane. Reason: the runner is the only
   party that knows what its pool holds, and the alternative that needs no new call is a shorter
   owner lease, which buys restart recovery by shortening the warm affinity the key exists to
   protect.
7. **Should a killed runner be covered too, or is a stopped runner enough for version one?**
   Recommendation: enough for now, and note the gap. Reason: a kill leaves a two-minute affinity
   shadow, which is bad but bounded, and closing it properly needs replica liveness.
