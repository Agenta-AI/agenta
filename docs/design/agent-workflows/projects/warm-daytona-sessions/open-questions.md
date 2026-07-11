# Open questions

These are the decisions a human still has to make. The 2026-07-11 lifecycle measurement
(research.md) answered the cost questions that used to sit here: the abandonment budget is cents
per crash, the park-to-running knobs became configuration with stated defaults, and the archive
state is dropped outright. What remains open is about correctness, plus two proposed defaults
that need a reviewer's confirmation rather than an owner's decision.

## Still open (correctness, reviewer)

1. **How to guard the sandbox pointer write** (Slice 1). `writeSandboxId` is a fire-and-forget,
   last-writer-wins PUT, and the Daytona path skips the runner's ownership check. The plan calls
   for awaited, conditional (compare-and-set) writes. Where does the guard live: a new generation
   column on `session_states`, the existing turn counter, or the Redis owner claim PR #5197 added
   for local sessions? Related: PR #5197's own risk list flags the same missing concurrency guard
   on its durable-continuity write, so one guard mechanism should probably cover both writes.

2. **Shutdown policy** (Slice 2). The plan splits shutdown (SIGTERM) by state: delete when a turn
   is in flight (the transcript may be partial), stop when idle. Confirm that split, and that
   explicit `/kill` keeps its hard-delete meaning.

3. **Saturation behavior of the capacity gate** (Slice 4). When every running permit belongs to an
   active or approval-waiting turn, the plan says queue briefly or reject with a clear error.
   Which, and with what bound? A short queue is friendlier; a fast reject is simpler and easier to
   observe. This only bites when concurrent Daytona conversations exceed `MAX_RUNNING`.

4. **Does the session reload behave identically on a reattached same-instance sandbox?** With the
   harness transcript mounts enabled, the transcript comes from the durable mounted files either
   way, so it should. Confirm live in Slice 5, including the mount-hygiene case (an old file mount
   with expired credentials surviving a stop and start; see plan.md must-fix item 4).

## Proposed defaults awaiting confirmation

5. **The stop timer at 15 minutes** (Slice 2). Daytona's idle clock resets on external API calls,
   not on processes running inside the sandbox, so a short stop timer can stop a sandbox under a
   live long tool call or an unanswered approval gate (the run-limits guard allows 300 seconds).
   The measured cost of the longer timer is about 4 cents per crash orphan versus about 1.4 cents
   at 5 minutes. The plan proposes 15; confirm.

6. **The park-to-running defaults** (Slice 4). Idle window 60 seconds, cap of 4 concurrently
   running sandboxes; measured worst case about $0.67/hour with all four parked. These are
   env-configurable (`AGENTA_RUNNER_DAYTONA_SESSION_*`), so confirming them blocks nothing; they
   can be tuned after the Slice 5 measurement.

## Resolved by measurement or direction (kept for the record)

- **Abandonment compute budget**: measured at about 1.4 to 4 cents per crashed-runner incident
  depending on the stop timer, plus a fraction of a cent of storage until the delete timer. No
  separate sweeper is needed; the timers are the sweeper. (Was: a billing-owner gate.)
- **Should park-to-running ship at all**: yes, by direction (2026-07-11) and by measurement.
  Sandbox creation is about 1 second of a ~15-second turn, so park-to-stopped cannot fix it; only a
  sandbox that stays running skips the per-turn pipeline. Park-to-running is now Slice 4 of the
  main line, not a deferred level.
- **Archive**: dropped. Restoring from archive (33 to 66 seconds measured) is slower than a fresh
  create (1.2 to 1.7 seconds), and the freed disk costs under a tenth of a cent per hour. The
  demotion ladder is stop, then delete, with `DAYTONA_AUTOARCHIVE` strictly greater than
  `DAYTONA_AUTODELETE`.
