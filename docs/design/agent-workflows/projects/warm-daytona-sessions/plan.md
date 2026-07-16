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

Second, the measurements (research.md) say the sandbox itself is not the slow-turn
problem. A cold create to a usable exec is 1.2 to 1.7 seconds; a start from stopped is 0.7 to
0.8 seconds (both provider operations alone, not what a user waits; "The three resume paths,
compared" below prices the user-visible totals). The measured cold Daytona turn is about 15
seconds of client wall time, of which
about 12.3 seconds is our own per-turn pipeline; the full stage split is in research.md ("Where
the time goes"). About 7.2 seconds of that pipeline (a redundant Pi install that a config
switch removes, and the pi-acp version probes that PR #5221 removes) goes away independently of
this plan. Stopping and restarting the
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
cold rebuild plus transcript replay stays underneath both. The two controls stay independent on
purpose: setting the live window to zero must never disable stopped reuse on the cold path.

## The three resume paths, compared

A second turn in a conversation starts from one of three states. This section prices each from
the measured stage table (research.md, "Where the time goes") so the decision can be made from
this document alone. One labelling rule: the fresh-create total is measured end to end; the
other two totals are constructed from the stage measurements and are verified end to end in
Slice 5.

**Path 1: fresh create (today's behavior).** The old sandbox is gone. Every stage is paid:
sandbox create (~1.05 s), the Pi install (~5.2 s where the skip is not live), extension upload,
mounts (~0.7 s), harness spawn (~5.15 s), session reload, then the model. User-visible total:
about 15 seconds measured; about 10 with the Pi install skipped; about 8 once the pi-acp probe
removal (PR #5221) lands.

**Path 2: stop, then restart (park-to-stopped).** Stopping destroys every process in the
sandbox: the harness, the geesefs mount processes, the daemon. Only the disk survives. So the
restart pays, stage by stage: start-from-stopped (~0.7 to 0.8 s) in place of create (~1.05 s);
the mounts again (~0.7 s, new processes); the harness respawn again (~5.15 s today, ~3.15 s
after the probe fix); the session reload again. The install is not paid, but only because the
binary survives on disk, and the install skip makes that saving moot on the fresh path too.
User-visible total, constructed: nearly the same as a fresh create, roughly 1 second cheaper.
Said plainly: the 0.7-second number is the provider operation, not what a user waits;
park-to-stopped buys durability of the disk, not latency.

**Path 3: kept running (park-to-running).** Everything survives: the processes, the mounts, the
daemon, the open harness session. The turn pays the keepalive checkout overheads plus the model
time. User-visible total: roughly 2 to 3 seconds, estimated.

The decision this comparison forces: if the goal is latency, park-to-stopped is not the
mechanism; park-to-running is. Park-to-stopped is still worth shipping first, but for exactly
two reasons: it is the safety and lifecycle base park-to-running builds on (the reconnect
machinery, the pointer guard, the compatibility fingerprint, and the state a live eviction lands
in), and it saves its small create second. The slices below are ordered by that logic.

## Park-to-stopped: the correctness base

Goal: at a clean turn end, stop the Daytona sandbox instead of deleting it; on the next turn,
start the same instance and reload the harness session. The parked cost is disk storage only.

The measured stage split (research.md, "Where the time goes") bounds its latency win honestly:
the create it skips costs about 1 second, and a restarted sandbox still pays the ~5.15-second
harness respawn, ~0.7 seconds of mounts, and (where the install is not skipped) the Pi install,
because the current Daytona path re-uploads assets and rematerializes workspace files on every
start. So park-to-stopped saves about 1 second out of a roughly 10-second pipeline with the
install skipped. Its real value is that it is the state a park-to-running eviction lands
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
`keepWarm` on clean Daytona turns. The moment a real `pause` lands, parking activates. So Slice 1
keeps the park path inert (the default teardown stays delete) until the correctness work and its
tests are in place, and Slice 2 switches the default. The switch covers all three moving parts
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

3. **A write guard on the sandbox pointer.** The runner remembers which sandbox belongs to a
   conversation by writing the sandbox id to a database row (`session_states.sandbox_id`,
   written by `writeSandboxId`) at the start of each turn. Today that write has two weaknesses:
   the runner does not wait for it to finish, so a failure is silent, and whichever write lands
   last wins, with no check that it is the newest.

   When this bites: two turns run against the same conversation at nearly the same time. That
   happens when a user sends a second message before the first turn finishes, or cancels and
   immediately re-sends, so the platform starts a replacement sandbox while the old turn is
   still shutting down. Both turns write their own sandbox id; if the older write lands last,
   the row points at a sandbox that is being torn down. Without reuse this was harmless: the
   row was never read back against a live sandbox. With reuse it costs two things: the next
   turn tries to restart the wrong instance (one doomed reconnect, then a cold build), and the
   newer sandbox is orphaned, running until the idle timers reap it (cents per incident, but
   the conversation also loses its warm sandbox).

   The fix is small: wait for the write, and make it conditional so an older turn cannot
   overwrite a newer one (a compare-and-set on the turn counter the `session_states` row
   already carries). This is plumbing inside one function plus one conditional check on the
   sessions API; it is not a re-architecture, and it is unrelated to the F-018 transport work.
   The only open choice is which existing counter to compare against; `open-questions.md`
   item 1 lays out the candidates. Clearing a stale id after a failed reconnect must be
   conditional for the same reason.

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
   - Remove the auto-archive logic entirely: drop the `autoArchiveInterval` field from the
     create call and the `DAYTONA_AUTOARCHIVE` override with it. Archive can never be the right
     state for us: restoring from it takes 33 to 66 seconds, slower than the 1.2 to 1.7 second
     fresh create, and the disk it frees costs under a tenth of a cent per hour. With the field
     unset, Daytona's own archive default (7 days) sits far past our 30-minute delete, so the
     ladder is simply stop, then delete. Daytona documents auto-delete as firing after a sandbox
     has been continuously stopped, with no archive step required; Slice 5 confirms this once
     live (stop a sandbox and watch it go stopped to destroyed without passing through
     archived).
   - Set the stop timer to 15 minutes, not 5, via the existing `DAYTONA_AUTOSTOP` env override.
     The timer counts idle time since the last API interaction with the sandbox and resets on
     every turn (each turn drives exec and file calls), so an active conversation never hits it;
     it only fires after 15 minutes of silence. What it does not reset on is work running purely
     inside the sandbox, so a stop timer shorter than the longest silent stretch of a live turn
     (the run-limits guard alone allows 300 seconds) could stop a sandbox mid-turn; 15 minutes
     clears that comfortably. At measured prices the difference is small money: a crash orphan
     bills about 4 cents at 15 minutes versus about 1.4 cents at 5. Paying 3 cents per crash to
     never stop a live turn is the right trade. All three timer values stay env-overridable.
   The API-side `orphan_sweep.py` does not participate: it cleans only Postgres rows and Redis
   locks and never contacts Daytona. No new sweeper is needed; the timers are the sweeper, and at
   these prices the abandonment budget needs review, not a billing-owner sign-off.

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
off it. A resumed turn still pays the request's own path even though the sandbox is up: the hop
through the services layer (measured 100 to 220 ms locally), the pool checkout with its
validation (config and history fingerprints, credential expiry), and forwarding the prompt over
the open session. That plus the model's own generation time puts the resumed turn at roughly 2
to 3 seconds against today's ~15-second cold turn (estimated; Slice 5 confirms).

### The work

1. **A hard cap on warm sandboxes, enforced where they are kept, not where turns run.** An
   active turn always gets a sandbox; the platform's own concurrency limits govern that, and a
   turn a user is waiting on is never blocked by warmth accounting. What the cap bounds is idle
   spend: how many sandboxes may stay running between turns. At turn end, the session asks for a
   warm slot; if none is free (and no idle entry can be evicted to stopped first, awaited), the
   sandbox is stopped instead of kept running. The conversation degrades to the stop-then-restart
   path for its next turn, nothing fails, and idle compute stays bounded. The slot accounting
   must count everything warm or on its way there (parked live, being reattached, being stopped),
   and a reconnect's `start()` takes a slot before starting, so concurrent resumes cannot
   overshoot. Daytona never gets the local pool's "run unparked best-effort" rule; that rule is
   what makes the local cap soft, and a soft cap on billed compute is not a cap.

2. **Daytona-scoped configuration, with the time-to-live as the on/off switch** (lifecycle and
   billing differ per provider, so the names say `DAYTONA`, not "remote"):
   - `AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS`: how long a sandbox stays running after its
     turn. Default 120000 (two minutes, about half a cent per parked turn at $0.0028 per
     minute). 0 disables keeping sandboxes running entirely; there is no separate enabled flag.
     Independent of park-to-stopped: setting it to 0 must not disable stopped reuse.
   - `AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM`: the warm-slot cap from item 1. Default 20
     (worst case with all 20 idle at once: about $3.33/hour, and the time-to-live bounds how
     long that worst case can last). This is deliberately its own variable, not the local
     pool's `AGENTA_RUNNER_SESSION_POOL_MAX`: that one budgets host memory (about 330 MB per
     hot Claude tree), this one budgets billed compute, and an operator will want to tune them
     apart.
   These live in the runner config module next to the existing keepalive config, read once,
   never via ad-hoc environment lookups. Both are plain env vars from day one, so they can be
   tuned per deployment without a code change.

3. **Eviction wired to the lifecycle, awaited.** When the window expires or a full warm cap
   forces an eviction, a Daytona entry is stopped, not deleted, so it drops to the
   park-to-stopped state and the session can still reconnect after the live window closes. The
   eviction goes through the typed teardown reason from the refactor, is awaited before a
   replacement takes the slot, and frees the warm slot only on a confirmed stop. A failed stop
   escalates to a delete; a failed stop plus failed delete keeps the slot consumed until a
   reconciliation pass confirms the instance is gone.

4. **Daytona's own timers versus the pool window.** With a 15-minute stop timer and a two-minute
   window, overlap is unlikely but not impossible: Daytona's idle clock may be old when the pool
   parks the entry (a long silent tool stretch resets nothing, since only external API calls
   count). On entering the live parked state, refresh the sandbox's activity once through the API
   so the full window is guaranteed, then let the pool's own timer do the stopping. No recurring
   heartbeats: a periodic keepalive ping would keep a leaked sandbox alive forever and defeat the
   auto-stop backstop.

5. **Runner restart and the parked live session.** The in-memory pool does not survive a restart.
   On a graceful shutdown, drain idle Daytona entries to stopped (not deleted), so the next turn
   falls to park-to-stopped reconnect and then durable reload; delete entries whose turn was in
   flight. On a hard kill, the sandboxes leak until the stop timer, the same abandonment budget as
   park-to-stopped (about 4 cents per crash at a 15-minute stop timer). So park-to-running never
   sits below park-to-stopped: its worst case degrades to park-to-stopped, which degrades to cold.

6. **Credentials and mounts.** A parked running Daytona session holds signed mount credentials
   with a real expiry. The existing credential-epoch check already evicts to cold on expiry. Keep
   the Daytona time-to-live comfortably under the mount-credential lifetime, so a live turn never
   runs against an expired mount.

7. **Leak safety is a review focus, not one mechanism.** The catastrophic failure here is a bug
   that keeps many sandboxes running unnoticed. Four defenses stack: the warm cap (item 1)
   bounds how many sandboxes the pool will ever hold running; every sandbox carries its stop
   and delete timers from creation, so a sandbox the runner forgets stops billing compute
   within 15 idle minutes and deletes within 30, no matter what the bug is; recurring
   keepalive pings are prohibited, so a forgotten sandbox cannot be kept alive by accident;
   and the verification slice ends with a zero-live-sandboxes check after abandonment. Code
   review of the pool and teardown paths must treat "can this path leave a sandbox out of the
   accounting" as its first question.

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
not couple this plan's defaults to the gate work.

### Cost and fidelity

- Parked cost: $0.0028 per parked minute per sandbox, bounded by the time-to-live and the warm
  cap (defaults: two minutes, 20 sandboxes, worst case about $3.33/hour while fully loaded).
- Resume cost: near zero. The sandbox is up, the mount is live, the session is open.
- Fidelity: highest. It is the only level that can hold an open approval gate for byte-exact
  resume, once the gate plan's file-transport parked-gate variant exists.

## Recommendation

Build the whole ladder, in slices, each shippable on its own: the correctness base first, then
park-to-stopped, then the provider-aware pool refactor, then park-to-running with the warm cap
and the defaults above, then live verification. The finished feature ships on by default with no
feature flags; the off switches are configuration (the live window's time-to-live, 0 to disable)
and the timers, all env vars. Until the live verification passes, the defaults stay at today's
behavior; the final slice changes the defaults. Park-to-stopped can graduate from verification
independently of park-to-running.

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
  specification. The park path stays inert in this slice (the default teardown remains delete),
  because the run paths already request `keepWarm` and landing a real `pause` would otherwise
  activate parking before its correctness work is verified. Unit tests for all of it. No live
  Daytona.
- **Slice 2 (park-to-stopped).** Wire the park path end to end and make stop the default
  teardown for clean resumable turns; timer
  defaults per item 6 (stop at 15 minutes, archive configured out with strict inequality, delete
  at 30); conditional stale-id cleanup; the mount-generation check.
- **Slice 3 (provider-aware pool refactor).** Per-provider operator config, the engine-owned
  lifecycle adapter with typed teardown reasons, one pool instance per provider, dispatch by
  resolved provider, local semantics preserved, Daytona pool present but disabled. This slice
  depends on Slice 1's teardown-reason contract; it does not depend on Slice 2.
- **Slice 4 (park-to-running).** The warm-slot cap (slots counted for parked, reattaching, and
  stopping entries; a reconnect's start takes a slot first; awaited evict-to-stop; a finished
  turn that finds no free slot parks to stopped instead); the one-time activity refresh at live
  park; drain-to-stop on graceful shutdown, delete-in-flight on shutdown; credential-epoch bound
  on the window. Ships with the live window at zero until Slice 5 passes. Pending approvals take
  the cold path until the gate plan's file-transport parked-gate variant lands (see the approval
  section).
- **Slice 5 (live verification, then the defaults change).** Credit-controlled E3 passes, in two
  independent gates, compared against the stage-split baseline in research.md. First
  add the duration log lines that baseline had to hand-instrument (the Pi install, sandbox
  created, `prepareWorkspace`, `probeCapabilities`, `createSession`). Park-to-stopped: measure
  cold versus stopped-restart, confirm one instance serves consecutive turns, confirm the stop
  and delete timers fire once with no archive state observed, and confirm zero live sandboxes
  afterwards. Park-to-running additionally needs a concurrency
  test: more than `MAX_WARM` distinct sessions at once, the cap holding (overflow parks to
  stopped, never over-holds), a window expiry confirmed as a stop, a SIGTERM drain, and one
  forced stop failure escalating to delete. Chat first; tool and approval turns wait on F-018.
  Then change each default (stop-not-delete teardown; the two-minute live window) as its gate
  passes.

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
