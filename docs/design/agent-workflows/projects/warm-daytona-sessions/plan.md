# Plan: warm and resumable Daytona sessions

Read `research.md` first. The one fact this plan turns on: the runner-side warm plumbing already
exists (park at turn end, reconnect by stored id, native session reload, `ephemeral: false` with
idle timers), but the code that talks to Daytona (the "provider" in `sandbox-agent@0.4.2`)
implements only `create`, `destroy`, `getUrl`, and `ensureServer`. It has no pause and no
reconnect. So today:

- On a successful turn, `pauseSandbox()` finds no pause function and falls back to a delete. The
  sandbox is deleted at turn end, whether the runner asked to keep it warm or not.
- The `ephemeral: false` idle timers never get to act, because the sandbox is already gone.
- On the next turn, the runner looks up the stored id, tries to reconnect, hits the missing
  reconnect function, and builds a fresh sandbox.

F-020's conclusion still holds at HEAD, for a deeper reason than F-020 gave. Durable continuity
makes the resumed turn answer correctly in about twenty seconds, but no sandbox is ever reused.
This plan makes reuse real.

The Daytona SDK already exposes what the provider is missing: `sandbox.stop()`, `sandbox.start()`
(which also resumes an archived sandbox), `sandbox.delete()`, and a `state` field are all present
in `@daytonaio/sdk` 0.187.0. But adding the two functions is not enough on its own. Two spots in
the vendored teardown code clean up incorrectly and must be fixed alongside them, and safe reuse
needs a compatibility check and a guard against racing writes. Those are the must-fix items under
park-to-stopped below.

## The two levels of reuse

The plan proposes two levels, in order of cost:

- **Park-to-stopped** (cheaper, ships first). At a clean turn end, stop the sandbox instead of
  deleting it; on the next turn, start the same one and reload the harness session. The parked
  sandbox costs disk storage only. Most of this is already prototyped in the working tree.
- **Park-to-running** (more expensive, deferred). Keep the sandbox running with its live session
  between turns, for a short window, so the next turn is near-instant. The parked sandbox costs
  live compute, so it needs cost limits and a billing owner to set them.

Each maps onto one level of the fallback ladder in `research.md`: park-to-stopped builds the
stopped-restart level, park-to-running builds the live-warm level. They compose. The cold-rebuild
floor stays underneath both.

## Park-to-stopped: cheap resume

Goal: at a clean turn end, stop the Daytona sandbox instead of deleting it; on the next turn,
start the same instance and reload the harness session. The parked cost is disk storage only. The
resume cost is "a full build minus the build": the restart path still pays sandbox start, daemon
startup, asset preparation, file mounts, harness startup, and the session reload. The win is real
but unmeasured. Phase 3 measures it before any latency number is claimed.

### What is already built (at HEAD, untested)

- `provider.ts`: `ephemeral: false`, with idle timers at 5 minutes (stop), 15 (archive), 30
  (delete). Every compose file and the Helm runner deployment forward the three
  `DAYTONA_AUTOSTOP` / `DAYTONA_AUTOARCHIVE` / `DAYTONA_AUTODELETE` overrides (verified; PR
  #5197's "compose gap" risk note is stale).
- `sandbox_agent.ts`: the `destroy({ keepWarm })` park branch, the `shouldPark` gate, and both run
  paths passing `keepWarm` on a clean, resumable Daytona turn.
- `sandbox-reconnect.ts`: storing and reading back the Daytona instance id in
  `session_states.sandbox_id`, and the reconnect ladder at the start of a run.
- `patches/sandbox-agent@0.4.2.patch`: the native session reload and the local process-group kill.

### Must-fix before it can be turned on

Each of these is a real leak or race, not polish. They block enabling the feature.

1. **The two provider functions, plus the two teardown cleanup gaps.**
   - `pause(id)`: fetch the sandbox handle (`client.get(id)`), call `sandbox.stop()`.
   - `reconnect(id)`: fetch the handle, then drive a small state machine, not a two-state check.
     Daytona's state field includes transitional values (`starting`, `stopping`, `restoring`,
     `archiving`, `destroying`) and error states alongside started, stopped, and archived. Wait
     out the transitional states with a time bound, `start()` a stopped or archived instance
     (archived resumes via plain `start()`, just slower), reattach a running one, and fail cleanly
     on error states.
   - Cleanup gap A (a failed pause loses its delete fallback): the vendored `pauseSandbox()` clears
     the provider handle and the raw id in its `finally` block, even when `pause()` throws. The
     runner's follow-up `destroySandbox()` then has no provider attached and silently does nothing,
     leaving the sandbox running. Fix in the package patch: a failed pause must keep the handle so
     the delete fallback actually deletes.
   - Cleanup gap B (a failed reconnect leaks a second sandbox): `SandboxAgent.start({sandboxId})`
     runs reconnect, `ensureServer`, `getUrl`, and client construction, but cleans up only
     sandboxes it created itself. If `sandbox.start()` succeeds and a later step throws, the old
     sandbox is left running and the runner builds a second one. The reconnect path needs
     ownership-aware cleanup: if it started the sandbox and then failed to attach, it must stop the
     sandbox before falling back to a fresh build.
   - Where the code lives: the two functions fit a runner-side wrapper over the vendored Daytona
     provider, which survives package bumps. The two cleanup gaps are inside the vendored
     `SandboxAgent` teardown, so they need the package patch that PR #5197 already established.
     Accept the split: functions in the wrapper, cleanup fixes in the patch.

2. **A compatibility check before reuse.** A Daytona sandbox bakes in its create-time settings:
   env vars, resolved secrets, the snapshot or image, the target, and the network policy.
   Reconnect applies none of the new request's settings, so reusing a sandbox keyed only on the
   conversation id can resurrect stale credentials or a weaker network policy. Store a fingerprint
   of the baked-in settings next to the sandbox id. On a mismatch, delete the old sandbox and build
   fresh. This mirrors the local pool's config fingerprint and credential epoch, applied at the
   reconnect step.

3. **A write guard on the sandbox pointer.** `writeSandboxId` is a fire-and-forget,
   last-writer-wins PUT, and the Daytona path skips the runner's ownership check. Two turns racing
   on one conversation (or a forced re-steer that starts a replacement before the old turn stops)
   can cross-write the pointer, orphaning one instance and double-using another. Await the write,
   and make it conditional (a compare-and-set on a generation number or the turn index; the
   `session_states` row already carries a turn counter). A stale turn must not overwrite or stop
   the current turn's sandbox. Clearing a stale id after a failed reconnect must be conditional for
   the same reason.

4. **Mount hygiene on reattach.** Reconnecting to an already-running sandbox can find an old file
   mount with expired credentials. `mountStorageRemote()` accepts any live mount and does not check
   that it uses the new credentials. Require a clean remount, or verify the mount generation, before
   the session reload.

### The rest of the park-to-stopped work

5. **Teardown by reason, not one generic destroy.** Different endings want different dispositions:
   - Explicit `/kill`, a failed turn, an aborted turn, or a compatibility mismatch: delete.
   - A clean resumable turn end: stop (this is the park).
   - Shutdown (SIGTERM) with a turn in flight: delete, since the transcript may be partial.
   - Shutdown while idle: stop, so a rolling restart keeps the sandbox warm.
   Today `/kill` and shutdown share the same drain mechanics, so reinterpreting all teardown as a
   stop would break explicit kill semantics. The reason has to travel into the teardown.

6. **The idle timers are the sweeper; the abandonment budget is a decision.** Once a sandbox
   survives turn end, Daytona's own timers reap abandonment: stop after 5 idle minutes, archive
   after 15, delete after 30. No runner cron job is needed. Two points need a billing owner:
   - Crash orphans. `ephemeral: true` auto-deleted a sandbox on stop, so a crashed runner leaked
     little. Now a hard-killed runner leaves a running sandbox billing compute for up to 5 idle
     minutes, then storage until the delete timer. The API-side `orphan_sweep.py` does not help:
     it cleans only Postgres rows and Redis locks and never contacts Daytona. If the 5-minute
     compute budget is unacceptable, the options are a lower `DAYTONA_AUTOSTOP` or a new
     provider-side sweeper. Do not lean on the existing sweep task.
   - The stop timer can fire mid-turn. Daytona's idle clock resets on external API calls, not on
     processes running inside the sandbox. A long, silent tool call or an unanswered approval gate
     can outlast a 5-minute stop timer, and the sandbox stops under a live turn. The old default
     was 15 minutes. Compare the stop timer against the runner's longest silent interval (the
     300-second run-limits guard is one bound) before keeping 5.

7. **Clean up a stale stored id.** When the delete timer reaps a sandbox, `session_states.sandbox_id`
   goes stale. The reconnect ladder degrades gracefully (failed lookup, fresh build), but the
   doomed reconnect repeats every turn. Clear the stored id after a failed reconnect, conditionally
   (see must-fix item 3).

8. **Tests, no live Daytona.** The lifecycle commit is labelled "(untested)". Unit-test the wrapper
   functions against a fake Daytona client (stop on pause; start on reconnect only from stopped or
   archived; waits through transitional states; refusal on error states), the two cleanup fixes (a
   failed pause still deletes; a failed reconnect stops the half-started instance), the
   teardown-by-reason matrix (park on clean resumable turns, delete on failed, aborted, or killed
   turns), and the guarded pointer write. Live testing on E3 is Phase 3, gated on credits.

### Cost and fidelity

- Parked cost: disk storage only (a stopped disk), bounded by the archive-then-delete timers.
- Resume cost: unmeasured. Budget it as a full build minus the build, plus daemon startup, mounts,
  harness startup, and the session reload. An archived restore is slower than a stopped start.
  Phase 3 produces the real number.
- Fidelity: full. The session reload restores the harness's own state from the durable transcript
  mounts, whether or not the instance was reused. The one caveat, from the `harness-session-resume`
  experiments: a tool call left dangling at an approval gate is not answered byte-exact after a
  reload. That is the durable-decision path's job and is unchanged here.

## Park-to-running: true warm pool

Goal: keep the sandbox running with its live session between turns for a short window, so a second
turn is near-instant (no start, no remount, no reload). This is the `session-keepalive` workspace's
deferred Daytona slice, now made concrete.

### The work

1. **Open a Daytona-warm path through the local-only gate.** Today the keep-alive path sends any
   non-local request straight to a cold build (`isLocalSandbox` in `server.ts`). Add a Daytona-warm
   path behind its own flag, off by default.

2. **A separate pool instance, not shared entries.** Reuse the pool class (it is already
   engine-agnostic: an opaque environment and one idempotent `destroy`), but create a second pool
   for Daytona entries with its own cap and timers. Do not mix local and remote entries in one map,
   and do not reinterpret the local size cap: locally it is a memory budget (about 330 MB per hot
   Claude tree); for Daytona it bounds the count of concurrently running billed sandboxes. Those
   are different resources with different accounting.

3. **Daytona-scoped config, named by provider** (lifecycle and billing differ per provider, so
   "remote" is too vague):
   - `AGENTA_RUNNER_DAYTONA_SESSION_KEEPALIVE_ENABLED` (default off).
   - `AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS` (short, for example 30000 to 60000).
   - `AGENTA_RUNNER_DAYTONA_SESSION_MAX_RUNNING` (a cap on running sandboxes; call it that, not a
     spend cap, since sandboxes are not billed identically).
   These are operator cost and resource policy. They live in the runner config module next to the
   existing keep-alive config, read once, never via ad-hoc environment lookups.

4. **Eviction wired to the lifecycle, with an awaited teardown.** When the timer expires or the pool
   evicts an entry, a Daytona entry stops the sandbox (dropping it to the park-to-stopped state)
   rather than deleting it, so the session can still reconnect after the live window closes. And
   unlike the local pool's fire-and-forget eviction (fine for a soft memory cache), the Daytona pool
   must wait for the stop to finish before admitting a replacement. Otherwise the cap does not
   actually bound running sandboxes: the old one still bills while the new one starts, and a failed
   stop exceeds the cap indefinitely. A failed stop escalates to a delete.

5. **Runner restart and the parked live session.** The in-memory pool does not survive a restart.
   On a graceful shutdown, drain idle Daytona entries to stopped (not deleted), so the next turn
   falls to park-to-stopped reconnect and then durable reload; delete entries whose turn was in
   flight. On a hard kill, the sandboxes leak until the stop timer, the same abandonment budget as
   park-to-stopped. So park-to-running never sits below park-to-stopped: its worst case degrades to
   park-to-stopped, which degrades to cold.

6. **Credentials and mounts matter more here.** A parked running Daytona session holds signed mount
   credentials with a real expiry. The existing credential-epoch check already evicts to cold on
   expiry. Keep the Daytona time-to-live comfortably under the mount-credential lifetime, so a live
   turn never runs against an expired mount.

### Cost and fidelity

- Parked cost: full running compute for the window, bounded by the running-sandbox cap. This is the
  honest downside and the reason it is opt-in.
- Resume cost: near zero. The sandbox is up, the mount is live, the session is open.
- Fidelity: highest. It is the only level that can hold an open approval gate for byte-exact
  resume, though holding a gate open is a separate concern (F-018) and is not needed for chat.

## Recommendation

Ship park-to-stopped behind a flag that is off by default, not on by default. The plumbing is
mostly built and the parked cost is storage only, but the review found real must-fix gaps: the
broken pause-delete fallback, the double-sandbox reconnect leak, the unguarded pointer writes, and
the missing compatibility check on reuse. Close those, then turn it on after one credit-controlled
live test on E3 that measures the real resume latency and confirms one instance is reused with zero
leak. Keep durable reload as the always-correct floor.

Defer park-to-running. The reasons, strongest first: its eviction cannot enforce a running-sandbox
cap without an awaited, reason-aware teardown (a billing-safety property, stronger than any latency
argument); a billing owner has to set the time-to-live and the cap; and F-018 means tool-using
turns cannot benefit or be validated yet. Wire park-to-running eviction to stop-not-delete, so it
composes with park-to-stopped rather than replacing it.

## Phasing

- **Phase 1 (build park-to-stopped, flag off).** The provider wrapper functions plus the two
  package-patch cleanup fixes; the reconnect state machine; teardown by reason; guarded and awaited
  pointer writes; the compatibility fingerprint; unit tests for all of it. No live Daytona.
- **Phase 2 (harden park-to-stopped).** The abandonment-budget and stop-timer-value decision with a
  billing owner; the shutdown stop-versus-delete split; conditional stale-id cleanup; the
  mount-generation check.
- **Phase 3 (verify park-to-stopped live, then turn it on).** One credit-controlled E3 pass. Measure
  resume latency against the cold baseline, confirm one instance serves consecutive turns, and
  confirm zero live sandboxes after abandonment (watch the stop, archive, and delete timers fire
  once). Chat first; tool turns wait on F-018.
- **Phase 4 (park-to-running, opt-in).** The separate Daytona pool instance, the Daytona-scoped
  config, awaited evict-to-stop, and graceful drain-to-stop. Ships only after a billing owner sets
  the limits.

## How this fits with other work

- **F-018 (Daytona tool-call hang):** a tool turn fails, and a failed turn does not park, so warm
  reuse helps chat first and cannot be validated on tool turns until F-018 lands.
- **PR #5197 (durable continuity):** native session reload and text replay stay the correct floor
  under both levels. This project reuses PR #5197's stored-id and continuity machinery; it does not
  replace it.
- **Billing:** park-to-stopped parks to stopped (storage only); park-to-running parks to running
  (compute, with the time-to-live and the running cap as the knobs); the archive-then-delete timers
  bound abandoned storage; deleted is free. A stopped sandbox frees CPU and RAM but still bills for
  its disk.
