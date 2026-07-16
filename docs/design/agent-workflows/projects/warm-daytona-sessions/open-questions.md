# Open questions

The decisions a human still has to make, each with the context and trade-offs needed to make it
from this file alone. Answered questions move to the bottom with their answers.

## Still open

1. **Which counter guards the sandbox-pointer write** (Slice 1). Background, in brief (plan.md
   must-fix item 3 has the full story): the runner records which sandbox belongs to a
   conversation in a database row. Two turns racing on one conversation can leave the row
   pointing at the wrong sandbox, which orphans one instance (it runs until the idle timers reap
   it, cents per incident) and sends the next turn through one doomed reconnect. The fix is to
   wait for the write and make it conditional, so an older turn cannot overwrite a newer one.
   The open choice is what the condition compares against:
   - The turn counter already on the `session_states` row. No schema change; the counter is
     maintained by the continuity code, so this couples the pointer guard to that code's
     correctness.
   - A new generation column on `session_states`. Cleanest semantics, needs a schema migration.
   - The Redis session-owner claim PR #5197 added. No schema change and already per-session,
     but Redis contents can be flushed, and a flushed key silently drops the guard.
   Related: PR #5197's own durable-continuity write has the same unguarded pattern, so one
   mechanism should probably cover both writes.

2. **What happens to sandboxes when the runner shuts down** (Slice 2). Background: the runner
   process stops on every deploy, restart, or scale-down (a SIGTERM). At that moment some
   conversations have a turn mid-flight and others have an idle parked sandbox. The choice, per
   sandbox:
   - Turn mid-flight: delete, or stop? Delete is safe: the transcript may be missing the last
     exchange, and restarting later from a half-written state risks a wrong resume. Stop would
     save the next turn about a second but carries that risk.
   - Idle: stop, or delete? Stop means a rolling deploy keeps the parked disks, and the next
     turn restarts one instead of rebuilding. Delete is simpler and forces the next turn cold.
   The plan proposes delete for mid-flight, stop for idle, and `/kill` keeps its hard-delete
   meaning. The cost difference is about a second per affected conversation either way; the
   proposal favors correctness for mid-flight and warmth for idle. Confirm or override.

3. **Does the session reload behave identically on a reattached same-instance sandbox?** With the
   harness transcript mounts enabled, the transcript comes from the durable mounted files either
   way, so it should. Confirm live in Slice 5, including the mount-hygiene case (an old file mount
   with expired credentials surviving a stop and start; see plan.md must-fix item 4).

## Answered (kept for the record)

- **Warm-cap overflow behavior**: when every warm slot is taken, a finishing turn parks its
  sandbox to stopped instead of keeping it running. Active turns are never blocked by the warm
  cap; there is no queue and no rejection. (Mahmoud, PR review.)
- **The live-window default and the off switch**: two minutes
  (`AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS=120000`), and setting it to 0 disables keeping
  sandboxes running. No separate enabled flag, and no feature flags in the finished feature; the
  controls are env vars. (Mahmoud, PR review.)
- **The warm cap default**: 20 (`AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM`), sized so roughly 20
  parallel conversations can all stay warm; worst case about $3.33/hour while fully loaded,
  bounded in time by the two-minute window. A separate variable from the local pool's
  `AGENTA_RUNNER_SESSION_POOL_MAX`, because that one budgets host memory and this one budgets
  billed compute. (Mahmoud, PR review.)
- **The stop timer**: 15 minutes, env-overridable via `DAYTONA_AUTOSTOP`. The timer resets on
  every turn, so an active conversation never hits it; it only fires after 15 minutes of
  silence. (Mahmoud, PR review.)
- **Auto-archive**: removed entirely, not configured around. The create call drops the
  `autoArchiveInterval` field and the `DAYTONA_AUTOARCHIVE` override. Restoring from archive
  (33 to 66 seconds measured) is slower than a fresh create (1.2 to 1.7 seconds). The ladder is
  stop, then delete. (Mahmoud, PR review; measurement.)
- **Abandonment compute budget**: measured at about 1.4 to 4 cents per crashed-runner incident
  depending on the stop timer, plus a fraction of a cent of storage until the delete timer. No
  separate sweeper is needed; the timers are the sweeper.
- **Should park-to-running ship at all**: yes. Sandbox creation is about 1 second of a
  ~15-second turn, so park-to-stopped cannot fix latency; only a sandbox that stays running
  skips the per-turn pipeline. Park-to-running is Slice 4 of the main line.
