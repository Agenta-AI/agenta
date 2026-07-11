# Open questions

These are the decisions a human still has to make. A reviewer owns the correctness ones; a billing
owner owns the cost ones. Each names the phase it gates. The three that gate shipping at all are
the abandonment budget, the pointer write guard, and the park-to-running cost limits.

1. **Abandonment compute budget** (Phase 2, billing owner). With `ephemeral: false` and a real
   stop-not-delete park, a hard-killed runner leaves a running Daytona sandbox billing compute
   until the 5-minute stop timer fires, then billing storage until the 30-minute delete timer.
   Is that acceptable as the price of warm reuse? The API-side `orphan_sweep.py` does not help:
   it cleans only database rows and Redis locks and never contacts Daytona. If the budget is too
   large, the options are a lower `DAYTONA_AUTOSTOP` or a new provider-side sweeper.

2. **Stop-timer value versus long silent turns** (Phase 2, billing owner). Daytona's idle clock
   resets on external API calls, not on processes running inside the sandbox. So a 5-minute stop
   timer can stop a sandbox under a live long tool call or an unanswered approval gate (the
   run-limits guard allows 300 seconds). The old default was 15 minutes. What value balances the
   crash-orphan budget against stopping a sandbox mid-turn?

3. **How to guard the sandbox pointer write** (Phase 1, reviewer). `writeSandboxId` is a
   fire-and-forget, last-writer-wins PUT, and the Daytona path skips the runner's ownership check.
   The plan calls for awaited, conditional (compare-and-set) writes. Where does the guard live: a
   new generation column on `session_states`, the existing turn counter, or the Redis owner claim
   PR #5197 added for local sessions?

4. **Shutdown policy** (Phase 2, reviewer). The plan splits shutdown (SIGTERM) by state: delete when
   a turn is in flight (the transcript may be partial), stop when idle. Confirm that split, and that
   explicit `/kill` keeps its hard-delete meaning.

5. **Park-to-running cost limits** (Phase 4, billing owner). What idle time-to-live and what value
   for `AGENTA_RUNNER_DAYTONA_SESSION_MAX_RUNNING` make park-to-running affordable? These are the
   direct cost knobs. Until they are set, park-to-running stays off.

6. **Should park-to-running ship at all**, given park-to-stopped plus durable reload? Park-to-stopped
   replaces the cold build with a stopped-start plus daemon plus mounts plus reload; the actual
   saving is unmeasured (a full build minus the build). Measure park-to-stopped's real second-turn
   latency on E3 (Phase 3) before committing to park-to-running.

7. **Does the session reload behave identically on a reattached same-instance sandbox?** With the
   harness transcript mounts enabled, the transcript comes from the durable mounted files either
   way, so it should. Confirm live in Phase 3, including the mount-hygiene case (an old file mount
   with expired credentials surviving a stop and start; see plan.md must-fix item 4).
