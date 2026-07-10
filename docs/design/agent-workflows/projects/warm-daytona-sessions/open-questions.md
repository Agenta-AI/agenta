# Open questions

For the reviewer and the billing owner. Each needs a decision before the matching phase ships.

1. Orphan compute budget (Phase 2, billing owner). With `ephemeral: false` and real
   stop-not-delete, a SIGKILL'd runner leaves a running Daytona sandbox billing compute until
   `autoStop` (5 idle minutes), then storage until `autoDelete` (30). Is that acceptable as the
   price of warm reuse? The API-side `orphan_sweep.py` does not help (verified: it cleans DB
   rows and Redis locks only, never contacts Daytona). If the budget is unacceptable, the
   options are a lower `DAYTONA_AUTOSTOP` or a new provider-side sweeper.

2. AutoStop value versus long silent turns (Phase 2). Daytona's inactivity clock resets on
   external API interactions, not on in-sandbox processes, so a 5-minute autoStop can stop a
   sandbox under a live long tool call or an unanswered approval gate (the run-limits guard
   allows 300s). The old default was 15. What value balances the crash-orphan budget against
   mid-turn stops?

3. Fencing design for the sandbox pointer (Phase 1, reviewer). `writeSandboxId` is a
   fire-and-forget last-writer-wins PUT, and the remote path skips the runner ownership check.
   The plan calls for awaited, compare-and-set writes. Where does the fence live: a generation
   column on `session_states`, the existing turn counter, or the Redis owner claim PR #5197
   added for local sessions?

4. Graceful-shutdown policy (Phase 2). The plan splits SIGTERM by state: delete when a turn is
   in flight (partial transcript), stop when idle. Confirm that split, and that `/kill` keeps
   hard-delete semantics.

5. Daytona TTL and running cap (Phase 4, billing owner). What idle TTL and
   `AGENTA_RUNNER_DAYTONA_SESSION_MAX_RUNNING` make Tier 2 affordable? These are the direct
   cost knobs. Until set, Tier 2 stays off.

6. Should Tier 2 ship at all, given Tier 1 plus durable `session/load`? Tier 1 replaces the
   cold create with a stopped-start plus daemon plus mounts plus load; the actual saving is
   unmeasured ("create minus start"). Measure Tier 1's real second-turn latency on E3 (Phase 3)
   before committing to Tier 2.

7. Does `session/load` behave identically on a reattached same-instance sandbox? With harness
   mounts enabled the transcript comes from the durable mounted prefixes either way, so it
   should. Confirm live in Phase 3, including the mount-hygiene case (an old geesefs mount with
   expired credentials surviving a stop/start; see plan.md P0 item 4).
