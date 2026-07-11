# Plan: warm and resumable Daytona sessions

Read `research.md` first. Two facts shape this plan.

First, the runner-side warm plumbing already exists (park at turn end, reconnect by stored id,
native session reload, `ephemeral: false` with idle timers), but the code that talks to Daytona
(the "provider" in `sandbox-agent@0.4.2`) implements only `create`, `destroy`, `getUrl`, and
`ensureServer`. It has no pause and no reconnect. So today:

- On a successful turn, `pauseSandbox()` finds no pause function and falls back to a delete. The
  sandbox is deleted at turn end, whether the runner asked to keep it warm or not.
- The `ephemeral: false` idle timers never get to act, because the sandbox is already gone.
- On the next turn, the runner looks up the stored id, tries to reconnect, hits the missing
  reconnect function, and builds a fresh sandbox.

Second, the measurements (research.md, 2026-07-11) say the sandbox itself is not the slow-turn
problem. A cold create to a usable exec is 1.2 to 1.7 seconds; a start from stopped is 0.7 to
0.8 seconds. The measured cold Daytona turn is about 15 seconds of client wall time, of which
about 12.3 seconds is our own per-turn pipeline; the full stage split is in research.md ("Where
the time goes"). About 7.2 seconds of that pipeline (a redundant Pi install, whose skip is
already live on the dev sidecar, and the pi-acp version probes, removal planned in PR #5221) is
removable by config and patch fixes independent of this plan. Stopping and restarting the
sandbox keeps its disk but kills every process, so a restarted sandbox still pays the harness
respawn and the mounts. Only a sandbox that stays running, with its daemon, mounts, and harness
session alive, skips the pipeline. That is why this plan builds all the way to park-to-running
instead of stopping at park-to-stopped, and why it drops the archive state entirely (restoring
from archive is slower than creating fresh; see research.md).

The Daytona SDK already exposes what the provider is missing: `sandbox.stop()`, `sandbox.start()`
(which also resumes an archived sandbox), `sandbox.delete()`, and a `state` field are all present
in `@daytonaio/sdk` 0.187.0. But adding the two functions is not enough on its own. Two spots in
the vendored teardown code clean up incorrectly and must be fixed alongside them, and safe reuse
needs a compatibility check and a guard against racing writes. Those are the must-fix items under
park-to-stopped below.

## The two levels of reuse

The plan builds two levels, in one progressive sequence:

- **Park-to-stopped** (the floor above cold). At a clean turn end, stop the sandbox instead of
  deleting it; on the next turn, start the same one and reload the harness session. The parked
  sandbox costs disk storage only (about $0.0009/hour measured against our sandbox shape). Most
  of this is already prototyped in the working tree, and its correctness work is a prerequisite
  for everything above it.
- **Park-to-running** (the target). Keep the sandbox running with its live session between turns
  for a short window, so the next turn is near-instant. The parked sandbox costs live compute
  (about $0.0028/minute for our 2 vCPU / 4 GiB shape), so it gets a short time-to-live and a hard
  cap on concurrently running sandboxes, as configuration with conservative defaults.

Each maps onto one level of the fallback ladder in `research.md`: park-to-stopped builds the
stopped-restart level, park-to-running builds the live-warm level. They compose rather than
compete: a park-to-running entry that outlives its window is evicted by stopping it, which drops
it to the park-to-stopped state, which degrades to the cold rebuild floor. The always-correct
cold rebuild plus transcript replay stays underneath both. Two flags stay independent on purpose:
turning the live pool off must never disable stopped reuse on the cold path.

## Park-to-stopped: the correctness base

Goal: at a clean turn end, stop the Daytona sandbox instead of deleting it; on the next turn,
start the same instance and reload the harness session. The parked cost is disk storage only.

The measured stage split (research.md, "Where the time goes") bounds its latency win honestly:
the create it skips costs about 1 second, and a restarted sandbox still pays the ~5.15-second
harness respawn, ~0.7 seconds of mounts, and (until the skip is everywhere) the Pi install,
because the current Daytona path re-uploads assets and rematerializes workspace files on every
start. So park-to-stopped saves about 1 second out of a roughly 10-second pipeline once the
install skip is live. Its real value is that it is the state a park-to-running eviction lands
in, and that its correctness work is the base every higher level stands on.

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

One consequence of "already built" matters for sequencing: both run paths already request
`keepWarm` on clean Daytona turns. The moment a real `pause` lands, parking activates. So the
feature flag is part of Slice 1, not a later addition, and it gates all three moving parts
together: the stored-id read and reconnect, the pointer write, and the stop at turn end.

### Must-fix before it can be turned on

Each of these is a real leak or race, not polish. They block enabling the feature.

1. **The two provider functions, plus the two teardown cleanup gaps.**
   - `pause(id)`: fetch the sandbox handle (`client.get(id)`), inspect its state, and call
     `sandbox.stop()` only from a running state. Already stopped counts as success. The SDK's
     `stop()` calls the stop endpoint unconditionally, so idempotence is the wrapper's job.
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
   of the baked-in settings next to the sandbox id, derived from the resolved create specification
   in `provider.ts` (snapshot or image, target, env names, network policy) plus a credential
   generation. The live pool's `configFingerprint()` is not sufficient here: it hashes request
   fields and omits resolved operator settings such as `DAYTONA_SNAPSHOT`, `DAYTONA_IMAGE`, and
   `DAYTONA_TARGET`, which also invalidate a stopped sandbox. On a mismatch, delete the old
   sandbox and build fresh.

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
   - Explicit `/kill`, a failed turn, an aborted turn, or a compatibility or credential mismatch:
     delete.
   - A clean resumable turn end: stop (this is the park).
   - Shutdown (SIGTERM) with a turn in flight: delete, since the transcript may be partial.
   - Shutdown while idle: stop, so a rolling restart keeps the sandbox warm.
   - A failed stop: delete. A failed stop and failed delete: treat the instance as still running
     for capacity accounting until a later reconciliation confirms otherwise.
   Today `/kill` and shutdown share the same drain mechanics, so reinterpreting all teardown as a
   stop would break explicit kill semantics. The reason has to travel into the teardown as a typed
   value; this same reason-to-disposition mapping is what the pool eviction reuses in the
   park-to-running slice.

6. **The idle timers are the sweeper, with measured defaults.** Once a sandbox survives turn end,
   Daytona's own timers reap abandonment. Two settings change from the current working-tree values:
   - Configure the archive step out by setting `DAYTONA_AUTOARCHIVE` strictly greater than
     `DAYTONA_AUTODELETE` (equal values would race; Daytona's own "archive interval 0 means
     maximum" convention is unusable here because our `positiveMinutes()` parser treats 0 as
     unset). Daytona documents auto-delete as firing after a sandbox has been continuously
     stopped, with no archive step required, but the archive-disabled path is worth one explicit
     live check in Slice 5: stop a sandbox with delete set shorter than archive and confirm it
     goes stopped to destroyed without passing through archived. Why drop archive at all:
     measured restore from archive takes 33 to 66 seconds, slower than the 1.2 to 1.7 second
     fresh create, and the disk it frees costs under a tenth of a cent per hour. The ladder is
     stop, then delete.
   - Set the stop timer to 15 minutes, not 5. Daytona's idle clock resets on external API calls,
     not on processes running inside the sandbox, so a stop timer shorter than the longest silent
     stretch of a live turn (the run-limits guard alone allows 300 seconds) can stop a sandbox
     mid-turn. At measured prices the difference is small money: a crash orphan bills about 4
     cents with a 15-minute stop timer versus about 1.4 cents with a 5-minute one. Paying 3 cents
     per crash to never stop a live turn is the right trade.
   The API-side `orphan_sweep.py` does not participate: it cleans only Postgres rows and Redis
   locks and never contacts Daytona. No new sweeper is needed; the timers are the sweeper, and at
   these prices the abandonment budget no longer needs a billing-owner sign-off, only review.

7. **Clean up a stale stored id.** When the delete timer reaps a sandbox, `session_states.sandbox_id`
   goes stale. The reconnect ladder degrades gracefully (failed lookup, fresh build), but the
   doomed reconnect repeats every turn. Clear the stored id after a failed reconnect, conditionally
   (see must-fix item 3).

8. **Tests, no live Daytona.** The lifecycle commit is labelled "(untested)". Unit-test the wrapper
   functions against a fake Daytona client (idempotent stop by state; start on reconnect only from
   stopped or archived; waits through transitional states; refusal on error states), the two
   cleanup fixes (a failed pause still deletes; a failed reconnect stops the half-started
   instance), the teardown-by-reason matrix (park on clean resumable turns, delete on failed,
   aborted, or killed turns), and the guarded pointer write. Live testing on E3 is the
   verification slice, gated on credits.

### Cost and fidelity

- Parked cost: about $0.0009/hour (the reserved 8 GiB disk), bounded by the delete timer.
- Resume cost: 0.7 to 0.8 seconds to restart the sandbox, plus the measured ~5.15-second harness
  respawn, ~0.7 seconds of mounts, and the session reload (research.md, "Where the time goes").
  Net saving versus cold: about the 1-second create.
- Fidelity: full for completed turns. The session reload restores the harness's own state from the
  durable transcript mounts. A stop kills process memory, so a turn parked mid-approval cannot be
  resumed byte-exact from stopped; it takes the cold approval path (see the approval section under
  park-to-running).

## The provider-aware keepalive refactor

Local (non-Daytona) sessions already get live warm reuse from the in-memory pool in
`session-pool.ts`. The pool class itself is engine-agnostic (an opaque environment, fingerprints,
a credential epoch, one idempotent `destroy()` closure), so it is the right machinery to reuse.
What keeps it local today is one policy gate: `runWithKeepalive` in `server.ts` sends any request
that does not resolve to the `local` provider straight to the cold path
(`resolvesToLocalProvider`, `isLocalSandbox`).

The refactor separates two things that must not be one record:

- **Operator configuration**, per provider name (`local`, `daytona`): enabled, idle time-to-live,
  approval time-to-live, pool cap. Env-var backed, read once. The local values reproduce today's
  behavior (the `AGENTA_RUNNER_SESSION_*` env vars keep working); the Daytona ones ship disabled.
- **Lifecycle mechanisms**, owned by the engine, not by config: the typed teardown-reason mapping
  from item 5 (the pool passes a reason such as idle-expiry, capacity-eviction, failed-turn, or
  shutdown to an engine-owned lifecycle function, which picks stop or delete), awaited versus
  fire-and-forget teardown, and (for Daytona) the capacity admission described in the
  park-to-running section. The pool's `destroy: () => Promise<void>` closure becomes
  `teardown(reason)`; `destroyAll` passes its reason too, so shutdown can split idle-stop from
  in-flight-delete.

Shape: one `SessionPool` instance per enabled provider, all of the same class. Entries never mix
across pools, because the caps measure different resources: the local cap is a host-memory budget
(about 330 MB per hot Claude tree), the Daytona cap bounds concurrently running billed sandboxes.
Do not overload one `poolMax` to mean both. The dispatch in `runWithKeepalive` looks up the
provider's config and routes to that provider's pool, or cold when absent or disabled; unknown
providers keep failing closed to cold. Local semantics are preserved deliberately rather than
promised byte-identical: the one visible change is the teardown signature, and local eviction
stays fire-and-forget.

Two boundaries stay put: `resolveKeepaliveMount()` is already provider-neutral and serves the
Daytona path unchanged, and the continuation path operates on an opaque live environment, so it
does not care which provider produced it.

## Park-to-running: the live warm window

Goal: keep the Daytona sandbox running with its live session between turns for a short window, so
a second turn is near-instant (no start, no remount, no daemon or harness startup, no reload).
This is the only level that removes the pipeline rather than shaving the sandbox-create second
off it: a resumed turn is the model time plus small overheads, roughly 2 to 3 seconds against
today's ~15-second cold turn (estimated from the measured stage split; confirmed in Slice 5).

### The work

1. **Capacity admission before anything starts a Daytona sandbox.** The pool alone cannot enforce
   a running cap: a fresh miss acquires its environment before the pool ever sees the session, so
   concurrent misses could create arbitrarily many sandboxes while the pool holds four. The cap
   therefore lives in a small admission gate (a permit counter) taken before create and before a
   reconnect's `start()`, and released only when Daytona confirms the instance stopped or deleted.
   It counts everything that can be running: reserved, creating, starting, busy in a turn, parked
   live, and stopping. When the gate is full: evict an idle parked entry and await its confirmed
   stop, then admit; if every permit belongs to an active or approval-waiting turn, queue briefly
   or reject the run with a clear error. Daytona never gets the local pool's "run unparked
   best-effort" behavior; that rule is what makes the local cap soft, and a soft cap on billed
   compute is not a cap.

2. **Enable the Daytona pool** from the refactor above, behind its own flag, off by default until
   the verification slice passes.

3. **Daytona-scoped configuration, with conservative defaults** (lifecycle and billing differ per
   provider, so the names say `DAYTONA`, not "remote"):
   - `AGENTA_RUNNER_DAYTONA_SESSION_KEEPALIVE_ENABLED` (default off; flipped on after
     verification). Independent of the park-to-stopped flag: disabling the live pool must not
     disable stopped reuse.
   - `AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS` (default 60000; at $0.0028 per parked minute this
     is about a third of a cent per parked turn).
   - `AGENTA_RUNNER_DAYTONA_SESSION_MAX_RUNNING` (default 4; worst-case burn with all four parked
     is about $0.67/hour). This is the admission gate's permit count.
   These live in the runner config module next to the existing keepalive config, read once, never
   via ad-hoc environment lookups. They are operator policy with stated defaults, not open
   decisions: the defaults above are conservative enough to ship, and an operator can tighten or
   widen them without a code change.

4. **Eviction wired to the lifecycle, awaited.** When the window expires or the admission gate
   forces an eviction, a Daytona entry is stopped, not deleted, so it drops to the
   park-to-stopped state and the session can still reconnect after the live window closes. The
   eviction goes through the typed teardown reason from the refactor, is awaited before a
   replacement is admitted, and releases the capacity permit only on a confirmed stop. A failed
   stop escalates to a delete; a failed stop plus failed delete keeps the permit consumed until a
   reconciliation pass confirms the instance is gone.

5. **Daytona's own timers versus the pool window.** With a 15-minute stop timer and a 60-second
   window, overlap is unlikely but not impossible: Daytona's idle clock may be old when the pool
   parks the entry (a long silent tool stretch resets nothing, since only external API calls
   count). On entering the live parked state, refresh the sandbox's activity once through the API
   so the full window is guaranteed, then let the pool's own timer do the stopping. No recurring
   heartbeats: a periodic keepalive ping would keep a leaked sandbox alive forever and defeat the
   auto-stop backstop.

6. **Runner restart and the parked live session.** The in-memory pool does not survive a restart.
   On a graceful shutdown, drain idle Daytona entries to stopped (not deleted), so the next turn
   falls to park-to-stopped reconnect and then durable reload; delete entries whose turn was in
   flight. On a hard kill, the sandboxes leak until the stop timer, the same abandonment budget as
   park-to-stopped (about 4 cents per crash at a 15-minute stop timer). So park-to-running never
   sits below park-to-stopped: its worst case degrades to park-to-stopped, which degrades to cold.

7. **Credentials and mounts.** A parked running Daytona session holds signed mount credentials
   with a real expiry. The existing credential-epoch check already evicts to cold on expiry. Keep
   the Daytona time-to-live comfortably under the mount-credential lifetime, so a live turn never
   runs against an expired mount.

### Pending approvals, aligned with the F-018 gate plan

The `daytona-gate-delivery` workspace (the F-018 fix, in implementation) defines how an approval
gate raised inside a Daytona sandbox reaches the runner: a file-based gate for residual builtin
calls, custom-tool authorization at the execution relay, and a two-lifetime timeout. Its resume
model is the contract this plan follows, not a thing this plan redefines:

- **Cold path (its default, and ours below park-to-running):** when a turn pauses on a pending
  approval, the turn ends and the sandbox is torn down with the pending gate inside it. The
  human's decision is stored; on the next turn the transcript is restored, the model reissues the
  tool call, and the reissued gate resolves instantly from the stored decision. A stopped sandbox
  cannot do better, because stopping kills the waiting process. So under park-to-stopped, a
  pending approval always takes this path.
- **Live path (park-to-running only):** holding a gate open byte-exact requires the sandbox to
  stay running and the gate plan's parked-gate machinery to support the file transport (its
  "file-transport parked-gate variant": resume writes the authenticated decision file instead of
  answering an ACP permission id). Until that variant exists, a Daytona file gate must take the
  cold path even when the sandbox is parked running. Whether a paused turn may park live is an
  explicit capability check on the gate's transport, never inferred from
  `result.stopReason === "paused"` or the mere presence of a pending gate.
- The two timeout models compose: a live-pool window expiring under a parked gate changes the
  execution path from live to cold; it does not expire the human's stored decision.

One consequence worth stating: park-to-running's chat benefit does not wait for F-018 (a pure
chat turn raises no gate), but its approval benefit does. Sequence the slices accordingly and do
not couple the flag flip to the gate work.

### Cost and fidelity

- Parked cost: $0.0028 per parked minute per sandbox, bounded by the time-to-live and the running
  cap (defaults: 60 seconds, 4 sandboxes, worst case about $0.67/hour).
- Resume cost: near zero. The sandbox is up, the mount is live, the session is open.
- Fidelity: highest. It is the only level that can hold an open approval gate for byte-exact
  resume, once the gate plan's file-transport parked-gate variant exists.

## Recommendation

Build the whole ladder, in slices, each shippable on its own: the correctness base with its flag,
then park-to-stopped enabled behind that flag, then the provider-aware pool refactor, then
park-to-running behind its own flag with capacity admission and the conservative defaults above,
then live verification, and only then flip the flags on. Park-to-stopped can graduate from
verification independently of park-to-running.

The measurements are what moved park-to-running from "deferred" into the main line: sandbox
creation costs about 1 second of a ~15-second turn, so park-to-stopped alone cannot fix it; the
~12-second pipeline can only be skipped by a sandbox that stays running (about 7 seconds of it
falls to config and patch fixes outside this plan, leaving a ~5-second floor that only
park-to-running removes); and the compute cost that justified deferral is small and bounded
(about a third of a cent per parked turn at the default window).
The billing questions that previously gated it are now configuration defaults backed by measured
prices. What remains genuinely open is listed in `open-questions.md` and is about correctness
(the pointer-write guard, the shutdown split), not cost.

Drop the archive state from the design entirely: restoring from archive is slower than creating
fresh, so it can never be the right move for us.

## Slices

Each slice lands independently, with tests, and does not regress the one below it.

- **Slice 1 (correctness base, everything disabled).** The provider wrapper functions plus the
  two package-patch cleanup fixes; the reconnect state machine; teardown by typed reason; guarded
  and awaited pointer writes; the compatibility fingerprint derived from the resolved create
  specification; and the park-to-stopped feature flag, default off, gating reconnect, pointer
  writes, and stop-at-turn-end together. The flag belongs here, not later: the run paths already
  request `keepWarm`, so landing a real `pause` without the flag would activate parking
  immediately. Unit tests for all of it. No live Daytona.
- **Slice 2 (park-to-stopped, enabled behind its flag).** Wire the park path end to end; timer
  defaults per item 6 (stop at 15 minutes, archive configured out with strict inequality, delete
  at 30); conditional stale-id cleanup; the mount-generation check.
- **Slice 3 (provider-aware pool refactor).** Per-provider operator config, the engine-owned
  lifecycle adapter with typed teardown reasons, one pool instance per provider, dispatch by
  resolved provider, local semantics preserved, Daytona pool present but disabled. This slice
  depends on Slice 1's teardown-reason contract; it does not depend on Slice 2.
- **Slice 4 (park-to-running, flag off).** The capacity admission gate (permits before create and
  reconnect-start, awaited evict-to-stop, release on confirmed stop or delete, queue-or-reject
  when saturated, never run-unparked); the one-time activity refresh at live park; drain-to-stop
  on graceful shutdown, delete-in-flight on shutdown; credential-epoch bound on the window.
  Pending approvals take the cold path until the gate plan's file-transport parked-gate variant
  lands (see the approval section).
- **Slice 5 (live verification, then flip the flags).** Credit-controlled E3 passes, in two
  independent gates, compared against the 2026-07-11 stage-split baseline in research.md. First
  add the duration log lines that baseline had to hand-instrument (the Pi install, sandbox
  created, `prepareWorkspace`, `probeCapabilities`, `createSession`). Park-to-stopped: measure
  cold versus stopped-restart, confirm one instance serves consecutive turns, confirm the stop
  and delete timers fire once with no archive state observed, and confirm zero live sandboxes
  afterwards. Park-to-running additionally needs a concurrency
  test: more than `MAX_RUNNING` distinct sessions at once, the cap holding (admission queues or
  rejects, never over-creates), a TTL expiry confirmed as a stop, a SIGTERM drain, and one forced
  stop failure escalating to delete. Chat first; tool and approval turns wait on F-018. Then flip
  each flag as its gate passes.

## How this fits with other work

- **F-018 / `daytona-gate-delivery` (in implementation):** a tool turn on Daytona currently fails,
  and a failed turn does not park, so warm reuse benefits chat until that fix lands. The approval
  section above binds this plan to its gate and resume model; the two plans must not define the
  pending-approval-at-park behavior differently.
- **PR #5197 (durable continuity):** native session reload and text replay stay the correct floor
  under both levels. This project reuses PR #5197's stored-id and continuity machinery; it does
  not replace it.
- **Billing, with measured prices:** park-to-stopped parks to stopped (about $0.0009/hour);
  park-to-running parks to running (about $0.17/hour per sandbox, bounded by the window and the
  cap); abandoned sandboxes cost cents per incident under the timers; deleted is free. The archive
  state is configured out.
