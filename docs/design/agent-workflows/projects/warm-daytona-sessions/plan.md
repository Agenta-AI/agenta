# Plan: warm and resumable Daytona sessions

Read `research.md` first. The single most important fact: the runner-side warm plumbing already
exists (keepWarm park, stored-id reconnect, native `session/load`, `ephemeral: false` plus idle
timers), but the vendored Daytona provider (`sandbox-agent@0.4.2`, `dist/providers/daytona.js`)
implements only `create`, `destroy`, `getUrl`, and `ensureServer`. It has no `pause` and no
`reconnect`. So today:

- On a successful turn, `pauseSandbox()` finds no `provider.pause` and falls back to
  `provider.destroy()`, which calls `sandbox.delete()`. The sandbox is deleted at turn end,
  keepWarm or not. (Verified in the vendored `chunk-TVCDKGSM.js`: `pauseSandbox` calls
  `provider.destroy(rawSandboxId)` when `provider.pause` is absent.)
- The `ephemeral: false` plus autoStop/autoArchive/autoDelete timers never get to act, because
  the sandbox is already gone.
- Next turn, `readStoredSandboxId` resolves a deleted id; `start({sandboxId})` calls the missing
  `provider.reconnect`, then `ensureServer`, which cannot start a dead instance, so it throws and
  the runner creates fresh.

F-020's conclusion therefore still holds at HEAD, for a deeper reason than F-020 stated. The
correctness path (durable `session/load` over the mounted transcript) makes resume answer
correctly in about 20 seconds, but no instance is ever reused. This plan makes reuse real.

The Daytona SDK already exposes what the provider is missing. `sandbox.stop()`,
`sandbox.start()` (which also resumes an archived sandbox), `sandbox.delete()`, and a `state`
field are all present in `@daytonaio/sdk` 0.187.0. But the design review (see status.md)
established that two optional hooks alone are not enough: two failure-cleanup seams in the
vendored lifecycle must be fixed with them, and reuse needs a compatibility check and write
fencing. Those are the P0 items below.

## Tier 1: cheap resume (park to stopped)

Goal: at a clean turn end, stop the Daytona sandbox instead of deleting it; on the next turn,
start the same instance and `session/load` the harness. Parked cost is storage only. Resume cost
is "create minus start": the restart path still pays sandbox start, daemon startup, asset
preparation, cwd and transcript mounts, harness startup, and `session/load`. The win is real but
unmeasured; Phase 3 measures it before any latency number is claimed.

### What is already done (HEAD, untested)

- `provider.ts`: `ephemeral: false`, autoStop 5, autoArchive 15, autoDelete 30. The three
  `DAYTONA_AUTOSTOP` / `DAYTONA_AUTOARCHIVE` / `DAYTONA_AUTODELETE` envs are forwarded by every
  compose file and by the Helm runner deployment (verified; PR #5197's "compose gap" risk note
  is stale).
- `sandbox_agent.ts`: `destroy({ keepWarm })` park branch; `shouldPark` gating; both run paths
  pass keepWarm on a clean resumable Daytona turn.
- `sandbox-reconnect.ts`: store and read-back of the Daytona instance id in
  `session_states.sandbox_id`; the reconnect ladder in acquire.
- `patches/sandbox-agent@0.4.2.patch`: native ACP `session/load` and local process-group kill.

### P0: correctness gaps to close before Tier 1 can be enabled

These came out of the design-review round. Each is a real leak or race, not polish.

1. Provider `pause` and `reconnect` hooks, plus the two broken failure-cleanup seams.
   - `pause(id)`: fetch the handle (`client.get(id)`), call `sandbox.stop()`.
   - `reconnect(id)`: fetch the handle; drive a small state machine, not a two-state check. The
     Daytona state enum includes `starting`, `stopping`, `restoring`, `archiving`, `destroying`,
     and error states alongside started/stopped/archived. Wait out transitional states with a
     bound, `start()` a stopped or archived instance (archived resumes via plain `start()`, just
     slower), reattach a running one, and fail cleanly on error states.
   - Seam A (failed pause loses its delete fallback): the vendored `pauseSandbox()` clears
     `sandboxProvider` and the raw id in its `finally`, even when `provider.pause()` throws. The
     runner's follow-up `destroySandbox()` then has no provider attached and silently does
     nothing, leaving the sandbox running. Fix in the dist patch (or a replacement seam): a
     failed pause must keep the handle so the delete fallback actually deletes.
   - Seam B (reconnect failure leaks a double sandbox): `SandboxAgent.start({sandboxId})` runs
     `reconnect`, `ensureServer`, `getUrl`, and client construction, but only cleans up sandboxes
     it created itself. If `sandbox.start()` succeeds and a later step throws, the old sandbox is
     left running and the runner's ladder creates a second one. The reconnect path needs an
     ownership-aware cleanup: if it transitioned the sandbox to running and attachment failed,
     stop it before falling back to a fresh create.
   - Home: the hooks themselves fit a runner-side wrapper over the vendored `daytona(...)`
     provider (survives package bumps). The two seams live inside the vendored `SandboxAgent`
     lifecycle, so they need the dist patch that PR #5197 already established. Accept the split:
     hooks in the wrapper, seam fixes in the patch.

2. Compatibility fingerprint before reuse. A Daytona sandbox bakes create-time state: env vars,
   resolved secrets, snapshot/image, target, and the network policy. Reconnect applies none of
   the new request's create configuration, so reuse keyed only on `session_id` can resurrect
   stale credentials or a weaker network policy. Store a fingerprint over the sandbox-baked
   configuration next to the sandbox id; on mismatch, delete the old sandbox and create fresh.
   This mirrors the keep-alive pool's `configFingerprint` and credential epoch, applied at the
   reconnect rung.

3. Fencing on the sandbox pointer. `writeSandboxId` is a fire-and-forget last-writer-wins PUT,
   and the remote path is excluded from the runner ownership check. Two turns racing on one
   `session_id` (or a forced steer that starts the replacement before the old turn stops) can
   cross-write the pointer, orphaning one instance and double-using another. Await the write,
   and make read-modify-write conditional (compare-and-set on a generation or turn index; the
   `session_states` row already carries a turn counter). A stale turn must not overwrite or stop
   the current turn's sandbox. Clearing a stale id after a failed reconnect must be conditional
   for the same reason.

4. Mount hygiene on reattach. Reconnecting an already-running sandbox can find an old geesefs
   mount with expired credentials; `mountStorageRemote()` accepts any live mount and does not
   verify it uses the new credentials. Require a clean remount or verify the mount generation
   before `session/load`.

### The rest of the Tier 1 work

5. Teardown by reason, not one generic destroy. The cases want different dispositions:
   - `/kill`, failed turn, aborted turn, config/policy mismatch: delete.
   - Clean resumable turn end: stop (this is the Tier 1 park).
   - SIGTERM with a turn in flight: delete (the transcript may be partial).
   - SIGTERM idle: stop, so a rolling restart keeps warmth.
   Today `/kill` and shutdown share the same drain mechanics; reinterpreting all teardown as
   stop would break explicit kill semantics, so the reason has to travel into the teardown.

6. The reaper cascade is the sweeper, and the orphan budget is a decision. Once a sandbox
   survives turn end, Daytona's own timers reap abandonment: autoStop (5 min) stops a warm
   sandbox, autoArchive (15) colds it, autoDelete (30) deletes it. No runner cron is needed.
   Two open points for a billing owner:
   - Crash orphans. `ephemeral: true` auto-deleted on stop, so a crashed runner leaked little.
     Now a SIGKILL'd runner leaves a running sandbox billing compute for up to 5 idle minutes,
     then storage until autoDelete. Note the API-side `orphan_sweep.py` does NOT help here: it
     only cleans Postgres rows and Redis locks and never contacts Daytona. If the 5-minute
     compute budget is unacceptable, the options are a lower `DAYTONA_AUTOSTOP` or a new
     provider-side sweeper; do not lean on the existing sweep task.
   - Auto-stop can fire mid-turn. Daytona's inactivity clock resets on external API
     interactions, not on processes running inside the sandbox. A long silent tool call or an
     unanswered approval gate can outlast a 5-minute autoStop and the sandbox stops under a live
     turn. The old default was 15. Compare the autoStop value against the runner's maximum
     silent interval (the 300s run-limits guard is one bound) before keeping 5.

7. Stale stored-id hygiene. When autoDelete reaps a sandbox, `session_states.sandbox_id` goes
   stale. The ladder degrades gracefully (failed get, fresh create), but the doomed reconnect
   repeats every turn. Clear the stored id on a failed reconnect, conditionally (see item 3).

8. Tests, no live Daytona. The lifecycle commit is labelled "(untested)". Unit-test the wrapper
   hooks against a fake Daytona client (stop on pause; start on reconnect only from
   stopped/archived; transitional-state waits; error-state refusal), the two seam fixes (failed
   pause still deletes; failed reconnect stops the half-started instance), the teardown-reason
   matrix (park on clean resumable turns, delete on failed/aborted/kill), and the fenced
   pointer write. Live E3 verification is Phase 3, gated on credits.

### Tier 1 cost and fidelity

- Parked cost: storage only (stopped disk), bounded by the archive-then-delete cascade.
- Resume cost: unmeasured; budget it as "create minus start" plus daemon, mounts, harness
  startup, and `session/load`. An archived restore is slower than a stopped start. Phase 3
  produces the number.
- Fidelity: full. `session/load` restores the harness's own session state from the durable
  transcript mounts (the per-harness geesefs prefixes), whether the instance was reused or not.
  The one caveat, from the `harness-session-resume` experiments: a tool call left dangling at a
  gate is not answered byte-exact after a reload; that is the durable-decision path's job,
  unchanged here.

## Tier 2: true warm pool (park to running)

Goal: keep the sandbox running with its live ACP session between turns for a short window, so a
second turn is near-instant (no start, no remount, no load). This is the `session-keepalive`
workspace's deferred "slice 3", now concrete.

### The work

1. Lift the local-only gate for a Daytona-warm mode. Today `runWithKeepalive` sends any
   non-local request straight to `runCold` (`server.ts` `isLocalSandbox`). Add a Daytona-warm
   path behind its own flag, off by default.

2. A separate pool instance, not shared entries. Reuse the `SessionPool` class (it is already
   engine-agnostic: opaque `environment`, one idempotent `destroy`), but instantiate a second
   pool for Daytona entries with its own cap and TTLs. Do not mix local and remote entries in
   one map, and do not reinterpret the local `poolMax`: locally it is a RAM budget (about 330 MB
   per hot Claude tree); for Daytona it bounds concurrently running billed sandboxes. Those are
   different resources with different eviction accounting.

3. Daytona-scoped config, named by provider (lifecycle and billing semantics differ per
   provider, so "remote" is too vague):
   - `AGENTA_RUNNER_DAYTONA_SESSION_KEEPALIVE_ENABLED` (default off).
   - `AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS` (short, for example 30000 to 60000).
   - `AGENTA_RUNNER_DAYTONA_SESSION_MAX_RUNNING` (a running-sandbox cap; call it that, not a
     spend cap, since sandboxes are not billed identically).
   These are operator cost/resource policy. They live in the runner config module next to the
   existing keepalive config, read once, never via ad-hoc `process.env`.

4. Eviction wired to the lifecycle, with awaited teardown. On TTL expiry or LRU eviction, a
   Daytona entry stops the sandbox (drop to Tier 1 warm) rather than deletes it, so the session
   can still reconnect after the live window closes. And unlike the local pool's fire-and-forget
   LRU destroy (fine for a soft RAM cache), the Daytona pool must await the stop before
   admitting a replacement, or the cap does not actually bound running sandboxes: the old one
   still bills while the new one starts, and a failed stop exceeds the cap indefinitely. A
   failed stop escalates to delete.

5. Runner restart and the parked live session. The in-memory pool does not survive a restart.
   On graceful SIGTERM, drain idle Daytona entries to stop (not delete), so the next turn falls
   to Tier 1 reconnect and then durable `session/load`; delete entries whose turn was in flight.
   On SIGKILL, the sandboxes leak until autoStop, the same orphan budget as Tier 1. So Tier 2
   never has a floor below Tier 1: worst case it degrades to Tier 1, which degrades to cold.

6. Credential epoch and mount expiry are more load-bearing remotely. A parked Daytona session
   holds signed mount credentials with a real expiry. The existing credential-epoch check
   already evicts to cold on expiry; keep the Daytona TTL comfortably under the mount-credential
   lifetime so a live checkout never runs against an expired mount.

### Tier 2 cost and fidelity

- Parked cost: full running compute for the TTL window, bounded by the running cap. This is the
  honest downside and the reason it is opt-in.
- Resume cost: near zero. The sandbox is up, the mount is live, the session is open.
- Fidelity: highest. It is the only rung that can hold an open approval gate for byte-exact
  resume (the `session-keepalive` slice-2 result), though gate parking is a separate, Pi-gated
  concern (F-018) and not required for chat.

## Recommendation

Land Tier 1 behind a default-off rollout flag, not default-on. The plumbing is mostly built and
the parked cost is storage only, but the review round surfaced real P0 gaps (the broken
pause-delete fallback, the double-sandbox reconnect leak, unfenced pointer writes, no
compatibility check on reuse). Close those, then enable after one credit-controlled live
lifecycle test on E3 that measures the actual resume latency and confirms single-instance reuse
with zero leak. Keep durable `session/load` as the always-correct floor.

Defer Tier 2. The blockers, in order of strength: its eviction cannot enforce a running-sandbox
cap without awaited, reason-aware teardown (a billing-safety property, stronger than any latency
argument); a billing owner has to set the TTL and running cap; and F-018 means tool-using turns
cannot benefit or be validated yet. Wire Tier 2 eviction to stop-not-delete so it composes with
Tier 1 rather than replacing it.

## Phasing

- Phase 1 (Tier 1 activation, flag off): provider wrapper hooks + the two dist-patch seam fixes;
  reconnect state machine; teardown-by-reason; fenced and awaited pointer writes; compatibility
  fingerprint; unit tests for all of it. No live Daytona.
- Phase 2 (Tier 1 hardening): orphan-budget and autoStop-value decision with a billing owner;
  SIGTERM stop-vs-delete split; conditional stale-id cleanup; mount-generation check.
- Phase 3 (Tier 1 live verification, then enable): one credit-controlled E3 pass. Measure resume
  latency against the cold baseline, confirm one instance serves consecutive turns, confirm zero
  live sandboxes after abandonment (autoStop through autoDelete observed once). Chat first;
  tool turns wait on F-018.
- Phase 4 (Tier 2, opt-in): separate Daytona pool instance, Daytona-scoped config, awaited
  evict-to-stop, graceful drain-to-stop. Ships only after the billing owner sets the knobs.

## Interaction summary

- F-018 (Daytona tool-call hang): a tool turn fails, and a failed turn does not park, so warmth
  benefits chat first and cannot be validated on tool turns until F-018 lands.
- PR #5197 (durable continuity): transcript `session/load` (native) and text replay (fallback)
  stay the correct floor under both tiers. This project reuses its stored-id and continuity
  machinery; it does not replace it.
- Billing: Tier 1 parks to stopped (storage only); Tier 2 parks to running (compute, TTL and the
  running cap are the knobs); the archive-then-delete cascade bounds abandoned storage; deleted
  is free. Stopped sandboxes free CPU and RAM but keep billing disk, per Daytona's billing docs.
