# Plan: refresh a running mount's credentials from the runner

Runner-only change. The API signing path, the wire contract, and the geesefs pin are
all untouched. Four slices; slice 0 is a one-day empirical spike that gates the
rest, and slice 1 is shippable alone.

## The fix in one paragraph

Instead of handing geesefs static credentials in its process environment, the runner
starts each daemon with `--profile agenta-mount --shared-config <config file>` where
the config file's one directive is `credential_process = cat <lease file>`. The
vendored SDK re-runs that `cat` whenever the lease file's reported `Expiration`
passes, so rewriting the file IS the refresh: no remount, no daemon restart, no
interruption to in-flight I/O. The runner re-signs each mount's lease shortly before
it expires, during turns, with the per-run credential it already holds, and rewrites
the file (a local write for the local sandbox, a push through the provider's
authenticated API for Daytona). The lease file reports an expiration slightly
earlier than the real one, so the SDK rotates while the old lease is still valid
and no request straddles expiry within the stated skew and delay bounds. Arming the
refresher performs an awaited PREFLIGHT refresh before the turn's first mounted
I/O whenever the remaining lease cannot cover the turn; if the preflight fails,
acquisition falls back to today's cold rebuild, so the backstop protects the
active turn, not just the next dispatch. The session pool's installed-lease
bookkeeping is updated by every refresh, which turns the existing
evict-before-expiry machinery into the refresh-failure backstop. Warm reuse stops
being bounded by the lease, and a turn keeps live files for its whole length
(bounded guarantee: research.md section 7).

## Mechanism spec

Shared by both sandboxes; paths differ.

- **Config file** (written once per mount, at mount time):

  ```ini
  [agenta-mount]
  credential_process = /usr/bin/cat -- "<abs path to lease.json>"
  ```

  Absolute binary path (the command runs through `sh -c`; no PATH resolution), a
  `--` guard, and a quoted path. The section header without the `profile ` prefix
  is accepted by the vendored loader (research.md section 2). The file never
  changes after mount.

- **Lease file** `lease.json` (rewritten by every refresh):

  ```json
  {
    "Version": 1,
    "AccessKeyId": "...",
    "SecretAccessKey": "...",
    "SessionToken": "...",
    "Expiration": "<RFC3339: real expiry minus the rotation margin>"
  }
  ```

  `Expiration` must always be present; an absent one makes the SDK treat the
  credentials as permanently static (research.md section 2).

- **Write atomicity and file hygiene**: temp file created exclusively in the SAME
  directory as the target (random suffix, `O_EXCL`, `O_NOFOLLOW`), then renamed
  over `lease.json`; `cat` therefore never reads a torn file and a same-user
  symlink plant cannot redirect the write. Remotely the push uploads to a unique
  temp path in the target directory, verifies the upload completed, then runs
  `mv -f -- <tmp> <target>` through the provider exec and checks its exit status
  (rename(2) within one directory is the atomic step; the upload itself need not
  be atomic because the temp path is unpublished). Orphaned temps are cleaned on
  the next write.

- **geesefs invocation in refresh mode**: `geesefsArgs` gains
  `--profile agenta-mount --shared-config <config path>`, and the spawn passes NO
  `AWS_*` credential variables. The explicit profile also defends against stray
  `AWS_*` variables in the runner container env, because a passed profile wins the
  whole resolution (research.md section 2; the local spawn merges the full runner
  env, `mount.ts:341`, which is why slice 0 tests precedence with deliberately
  invalid ambient `AWS_*` set).

- **File locations, ownership, cleanup**:
  - Local: `<runner state dir>/mount-leases/<acquisition id>/<mount name>/`, on
    the runner's own filesystem, outside every mount (never inside a mounted
    path: the lease must not land in the durable store, and the mount cannot
    bootstrap from a file behind itself). The root is per-ACQUISITION-unique, not
    per-session: a deterministic session path collides when two acquisitions
    share an artifact mount. Directories 0700, files 0600.
  - Remote: `/tmp/agenta/mount-leases/<acquisition id>/<mount name>/` inside the
    sandbox.
  - Cleanup: unmount/destroy deletes the mount's lease directory (local and
    remote), so still-valid credentials never accumulate on disk after the
    daemon that needed them is gone.

- **Timing invariants**, with derived defaults, no new operator knobs. The
  invariants are what matter; the formulas are one concrete satisfaction of them:
  - Invariant A (margin): the reported expiration precedes the real one by more
    than the worst-case request-admission delay plus clock skew between runner,
    store, and sandbox. Default: `margin = clamp(ttl / 6, 30 s, 120 s)`. The
    refresher assumes total skew under 30 s and states it; nothing else in the
    refresh path absorbs skew (`MOUNT_LEASE_SKEW_MS` only feeds the coordinator's
    horizon arithmetic, `session-identity.ts:689`, and that check is gated for
    refresh-managed environments).
  - Invariant B (lead): a fresh file must be in place before the SDK looks, with
    room for sign, write, and several retries. Default:
    `lead = clamp(ttl / 3, 60 s, 600 s)`, measured from the reported expiration.
  - Invariant C (minimum TTL): below `3 x margin floor` (90 s) refresh mode
    refuses to arm and logs; the static path and today's eviction apply. A
    too-small TTL cannot be made safe by any schedule.
  - Retries: bounded exponential backoff with jitter, floor 1 s, cap
    `min(15 s, lead / 4)`, continuing past real expiry while a turn is active (a
    late success self-heals the mount with no remount; research.md section 5).
    Every sign and every remote write is timeout-bounded (`AbortSignal.timeout`;
    the existing signer fetch has no timeout, `mount.ts:68`, and an un-bounded
    awaited preflight would hang the turn).
  - At the default TTL 3600 s: margin 120 s, lead 600 s, one refresh roughly every
    48 minutes per mount. At QA TTL 120 s: margin 30 s, lead 60 s.

## New runner modules

- `src/environment/mount-lease.ts`: pure lease/config file content builders
  (`leaseFileJson(creds, reportedExpiryIso)`, `leaseConfigIni(leasePath)`) plus the
  atomic local writer. Pure functions so the unit tests assert bytes.
- `src/environment/mount-refresh.ts`: `MountLeaseRefresher`, owned by the
  environment. Registry of managed leases, one entry per mounted daemon, identity
  and category kept separate:
  `{ category: "cwd" | "agent" | "harness-dir", mountId: string,
  sign: (authorization: string) => Promise<MountCredentials | null>,
  publish: (creds, reportedExpiryIso) => Promise<void>, realExpiryMs }`.
  - `armForTurn(credential: () => string)`: stores the turn's sign authority as a
    live ACCESSOR, never a snapshot — the run credential is an ephemeral ~15-min
    secret the alive watchdog re-mints (`alive.ts:196`), and `RunTurnOptions`
    already carries `credential?: () => string` for exactly this
    (`runtime-contracts.ts:175`). Arming performs the PREFLIGHT: an awaited
    refresh of any lease whose remaining life is below its lead, so the turn's
    first file operations cannot race the push. Preflight failure is reported to
    the caller (see slice 1: it can fail the acquisition over to a cold rebuild);
    it is the one refresh failure that is not swallowed. Then per-lease timers at
    `reported - lead`.
  - Concurrency contract: refreshes are serialized per mount; each arm carries a
    generation token, and a completion from a stale generation (after `disarm()`,
    after a newer arm, during destroy) is discarded without publishing. Clearing
    timers alone does not cancel an in-flight sign or remote write, so every
    in-flight call holds an abort token tied to its generation.
  - `disarm()`: aborts and AWAITS in-flight work, cancels timers, drops the
    accessor. Called in the turn's `finally`. Environment `destroy()` calls it
    and drains before unmount/teardown, joining the existing quiesce contract
    (`environment.ts:369`).
  - On each successful refresh: publish the lease file, update `realExpiryMs`,
    stamp `environment.installedMountExpiries` for every registered mount so the
    parked epoch keeps telling the truth, and seed the new secret values into the
    turn's live redactor — the redactor is seeded only with turn-start
    credentials today (`run-turn.ts:274`), and a refreshed lease echoed by the
    agent must not escape trace/persistence redaction.
  - On scheduled-refresh failure: keep the old file, do NOT advance the
    bookkeeping, log and count it (see observability), retry on the backoff
    above. Never throw into the turn.
  - Observability: structured, low-cardinality counters/log fields for refresh
    attempt, success, sign failure, publish failure, lateness (published after
    reported expiry), seconds-remaining at publish, retry count, and backstop
    eviction; labeled by provider and mount category, never by session id, and
    never carrying secret material.

## Slice 0: prove the mechanism with the pinned binary (gates everything)

One scripted probe, run before any manager code is written, using the actual
geesefs v0.43.0 binary from the runner image against a local SeaweedFS with
`AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS=120`:

1. Export deliberately INVALID ambient `AWS_*` variables, then mount through the
   explicit profile and a counting `credential_process` wrapper (proves profile
   precedence in the real invocation, and counts re-runs).
2. Atomically publish two fresh leases across multiple reported and real expiries
   while I/O runs (proves re-run at reported expiration and rotation under load).
3. Hold a stale lease past REAL expiry, then publish late; verify EACCES during
   the gap and recovery without remount (proves no negative caching and late
   self-heal).
4. Run one large multipart write across a rotation (proves per-part signing
   interleaves across leases).
5. Record the observed timing bounds; they validate or correct the margin floor.

Pass/fail is binary: if any of 1-4 fails, the mechanism table in research.md
section 2 gets re-litigated before any slice-1 work starts. The probe script is
kept (it becomes the base of the low-TTL gate variant below).

## Slice 1: local sandbox (shippable alone)

Default behavior for local mounts, with a kill switch
(`AGENTA_RUNNER_MOUNT_REFRESH=off` restores today's static-env path; read once via
`loadRunnerConfig`, applied per acquisition so one environment is never half-and-half).

Changes per file:

1. `src/engines/sandbox_agent/mount.ts`
   - `geesefsArgs(creds, cwd, endpoint, foreground, leaseConfigPath?)`: append
     `--profile agenta-mount --shared-config <path>` when given.
   - `mountStorage` accepts an optional `lease` argument
     `{ configPath, leasePath }`; when present it spawns with the profile args and
     an EMPTY credential env instead of `credEnv(creds)`.
2. `src/environment/mount-lease.ts`, `src/environment/mount-refresh.ts`: as above.
3. `src/environment/mount-lifecycle.ts`
   - `mountLocalDurableCwd` / `mountLocalAgentCwd`: in refresh mode, write the
     config + initial lease files first, mount with the `lease` argument, and on
     success register the mount with `env.mountRefresh` (sign closure: the same
     `deps.signMount` / `deps.signAgentMount` already used by the ENOTCONN
     helpers). `commitLocalMount` keeps stamping `installedMountExpiries` exactly
     as today.
   - The ENOTCONN re-sign helpers keep working unchanged: they re-sign and remount,
     and in refresh mode the remount rewrites the lease files (a remount is a
     superset of a refresh).
4. `src/engines/sandbox_agent/runtime-contracts.ts`
   - `SessionEnvironment` gains `mountRefresh: MountLeaseRefresher | undefined`.
     `mountRefreshManaged` is derived: a refresher exists and every installed mount
     is registered with it.
5. Turn arming (engine side, `run-turn.ts` call path in `engine.ts`)
   - Arm `env.mountRefresh` with the LIVE credential accessor
     (`RunTurnOptions.credential`, watchdog-refreshed; artifact runs without a
     watchdog pass a constant accessor over the request credential) before the
     harness prompt is sent; disarm in the turn's `finally`. Both the cold path
     and the warm continuation path go through `runTurn`, so one site covers
     both.
   - The awaited preflight runs inside arming, BEFORE the first mounted I/O. If
     the preflight fails and the remaining lease does not cover the turn horizon,
     the acquisition fails over to a cold rebuild instead of starting the turn on
     a bet (research.md section 7); if the remaining lease does cover the
     horizon, the turn proceeds and the scheduled refresher keeps retrying.
6. `src/lifecycle/session-coordinator.ts`
   - The idle-branch and approval-branch `credentials-expiring` checks are skipped
     when the parked environment is refresh-managed (`mountCredentialsExpireBy`
     still runs for everything else). This skip is safe only because of the
     arming preflight above: the pair together mean "reuse now, but prove renewal
     works before mounted I/O, and rebuild if it does not". `credentials-expired`
     keeps evicting unconditionally: a dead lease at checkout means refresh
     failed for a whole park, and the backstop must fire.
   - The `lease-short` warning is skipped for refresh-managed environments.
7. `config/runner-config.ts`: the kill switch.
8. Lease-file lifecycle: created at mount, deleted at unmount/destroy (both the
   per-mount files and the acquisition root when its last mount goes).

Definition of done for the slice: the local live QA below passes, including one
single turn longer than the TTL, and the keepalive suite is green.

## Slice 2: remote sandbox (Daytona)

Same mechanism; the writes travel through the provider's authenticated channel.

1. `mountStorageRemote` (`mount.ts`): in refresh mode, before starting geesefs,
   create the lease dir and place config + initial lease in the sandbox; spawn with
   the profile args and no credential env on the `runProcess` call.
2. Lease push: `pushLeaseFile(sandbox, path, json)` using the same in-sandbox file
   delivery primitive the workspace/system-prompt uploads use, then an atomic `mv`
   via `runProcess`. Lives beside `mount-lease.ts`; the refresher entry's `write`
   closure binds it to `environment.sandbox`.
3. Registration: the remote cwd and agent mount sites (`environment.ts:668-683`,
   `740-760`) register with the refresher on success, mirroring the local sites.
4. Harness session/transcript mounts (`mountHarnessSessionDirs`): each mounted dir
   registers its own lease entry, signed by name through the existing
   `signSessionMountCredentials(sessionId, deps, name)`, and they JOIN the lease
   epoch. The predecessor excluded them from `installedMountExpiries` because all
   mounts were signed seconds apart at the same TTL, so they could never be the
   minimum; independent per-mount refresh failures break that argument (cwd can
   advance while a transcript mount quietly dies, and the pool would park a false
   healthy epoch). `InstalledMountExpiries` therefore grows from the fixed
   `{cwd, agent}` shape (`session-identity.ts:633`) to a map over every installed
   daemon, and `installedMountLease` keeps reducing to the minimum. This requires
   `mountHarnessSessionDirs` to stop hiding its outcomes behind `Promise<void>`
   (`mount.ts:727`): it returns per-dir results (mounted or skipped, credentials
   expiry) so the epoch and the refresher registry see exactly what is running.
   Reverses decision 10; recorded there.
5. Reattach of a stopped sandbox is already a fresh mount
   (`mountStorageRemote` force-detaches first), so it flows through step 1
   naturally.

No Daytona snapshot change: the geesefs binary is already in the image, and every
new file is written at mount time.

## Slice 3: retune and simplify (decision slice, with Mahmoud)

Nothing here is needed for correctness; it harvests what refresh makes possible.

1. Decouple the v0.112.3 patch numbers: the run deadline
   (`AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS`, 11 h in the patch) becomes a pure product
   knob; the lease TTL (`AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS`, 12 h in the patch)
   becomes a pure security knob and can drop back to 3600 s or lower, shrinking the
   leak window of any exfiltrated lease. Numbers are Mahmoud's call (open question
   1).
2. Documentation sync (`keep-docs-in-sync`): the operator note "keep the TTL above
   the turn budget plus skew" and the `lease-short` guidance in the predecessor's
   rollout notes become conditional on the kill switch; the hosting docs inherit
   the new default story.
3. Optional cleanup once gate evidence is in: remove the kill switch and the
   static-env spawn path. The horizon check and the `credentials-expired` eviction
   are NOT deletion candidates at any point: they are rare-incident backstops, and
   "never fired in healthy production" is exactly the wrong evidence for removing
   one. Deliberately NOT part of slices 1 and 2.

## Failure modes, walked

- **Preflight refresh fails at arm**: the one non-swallowed failure. Lease covers
  the horizon: proceed, scheduled retries continue. Lease does not cover it: fail
  the acquisition over to a cold rebuild; the turn never starts on a bet.
- **Sign endpoint down mid-turn**: retries on backoff; if the real expiry passes,
  the mount EACCESes, then self-heals without remount on the first successful
  retry (slice-0-verified behavior). The epoch was never advanced, so the next
  dispatch takes the backstop eviction path. This is the honest limit of the
  guarantee once TTL is below the turn budget (research.md section 7).
- **Sign or write hangs**: every call is timeout-bounded; a hung preflight cannot
  hang the turn past its timeout, a hung scheduled refresh is aborted and retried.
- **One mount refreshes while another fails**: per-mount entries fail
  independently; the epoch is the minimum over ALL registered mounts (slice 2), so
  a single dead mount drags the epoch and the backstop evicts at next dispatch
  instead of parking a false healthy state.
- **Stale completion after disarm/destroy**: generation tokens; a completion from
  a previous arm publishes nothing. `destroy()` drains in-flight refreshes before
  unmounting.
- **Runner crashes between sign and publish**: the old file stays authoritative;
  nothing observed the new lease. Between publish and epoch update: the file is
  fresher than the bookkeeping, which is the conservative direction (worst case an
  unnecessary rebuild).
- **Publish succeeds but geesefs never consumes it**: the epoch says "installed"
  for credentials no daemon has read. Harmless while the daemon keeps using its
  current lease (it re-reads at its own reported expiration); if the daemon is
  dead, the ENOTCONN/mount-lost backstops catch it, not the epoch.
- **Run credential expires mid-turn**: prevented by arming with the live accessor
  (watchdog re-mints ~15-min secrets); artifact runs without a watchdog stop
  refreshing when the request credential dies and fall to the backstop.
- **Sign returns null or an invalid/absent `expiresAt`**: treated as a failed
  refresh (keep old file, retry); never publish a lease file without a valid
  future expiration (an absent one would freeze the SDK on static credentials
  forever, research.md section 2).
- **Retry amplification**: backoff has a 1 s floor and jitter, and refresh runs
  only during turns, so a fleet-wide signer outage produces at most a few requests
  per active turn per backoff cap, not a synchronized storm.
- **Refreshed lease leaks through logs/traces**: every published secret is seeded
  into the live redactor at publish time (the turn-start seeding at
  `run-turn.ts:274` alone would miss them).
- **Refresher never armed (turn crashed early, or kill switch off)**: bookkeeping
  never advances; the coordinator behaves byte-for-byte as today.
- **Lease file deleted or corrupted inside the sandbox by agent code**: the SDK's
  `cat` fails or parses garbage, the SDK surfaces a credentials error, geesefs I/O
  fails; the agent can only break its own mount, which it could already do with
  `fusermount -u`. The next refresh rewrite restores the file; the mount-lost and
  ENOTCONN backstops cover the rest.
- **Runner restarts mid-turn**: same as today; local daemons die with the runner,
  Daytona sandboxes are reattached or rebuilt through the existing continuity path,
  and mounts are re-established fresh.
- **Clock skew**: the margin is the ONLY thing absorbing API/store/runner/sandbox
  clock disagreement on the refresh path; `MOUNT_LEASE_SKEW_MS` feeds the
  coordinator's horizon arithmetic (`session-identity.ts:689`), which is exactly
  the check that is gated for refresh-managed environments, so it protects
  nothing here. Hence the 30 s margin floor and the stated assumption: total skew
  plus request-admission delay stays under the margin. The refresher works off
  the store-reported `expiresAt` exactly as the epoch does today.

## Tests

### Runner unit tests (vitest)

- New `tests/unit/mount-lease-refresh.test.ts`:
  - `leaseFileJson`: schema (`Version: 1`, all four fields), reported expiration is
    real minus margin, margin/lead derivation at TTL 3600 and TTL 120.
  - Atomic write: tmp + rename ordering via an injected fs seam.
  - Refresher scheduling with fake timers: arm schedules at `reported - lead`;
    the preflight fires when armed inside the lead window and is awaited; disarm
    cancels; a failed sign retries with backoff and never advances
    `installedMountExpiries`; a late success updates the file and the expiries.
  - Concurrency and lifecycle: a sign resolving after `disarm()` (or after a
    newer arm) publishes nothing; refreshes for one mount serialize; `destroy()`
    drains in-flight work before completing; every sign/write observes its
    timeout.
  - Preflight failover: arm with a lease below the horizon and a failing sign
    reports failure to the caller (the acquisition-failover case); with a
    covering lease it proceeds and schedules retries.
  - Redaction: a published refresh seeds its secret values into the injected
    redactor.
- `tests/unit/sandbox-agent-mount.test.ts` (existing seams): refresh-mode argv
  contains `--profile agenta-mount --shared-config <path>` and the spawn env
  carries NO `AWS_ACCESS_KEY_ID`; kill-switch mode reproduces today's argv and env
  byte-identically; remote variant asserted through the fake `SandboxExec`.
- `tests/unit/session-keepalive-dispatch.test.ts` (fake engine + real pool):
  - A refresh-managed parked environment whose lease falls inside the horizon
    window is REUSED (`hit-continue`), where the same setup without the flag
    evicts `credentials-expiring` (the existing case, kept as the contrast).
  - A refresh-managed environment with a lease already past expiry still evicts
    `credentials-expired`.
  - A mid-turn refresh (fake engine advances `installedMountExpiries` during
    `runTurn`) re-parks with the advanced lease.
- Coordinator characterization suites
  (`lifecycle-session-coordinator.test.ts`,
  `session-lifecycle-characterization.test.ts`) updated for the two gated
  branches, everything else pinned unchanged.

### Release gate (agent-release-gate skill)

- The `warm` journey (three turns, one daemon, one sandbox id, `hit-continue` in
  the runner log) and the `mount` journey across the local and Daytona cells; the
  lifecycle cells (`matrix_l1_lifecycle_routes.py`, `matrix_l3_abandoned_approval.py`,
  `matrix_l5_live_route_observed.py`) must stay green.
- One dedicated low-TTL local gate variant: TTL 120 s, then the `warm` journey run
  with deliberate pauses so the three turns span at least three lease cycles. The
  assertion that matters: the turn ledger still shows ONE sandbox id, and the
  runner log shows `mount-refresh` lines and ZERO `credentials-expiring`
  evictions.

### Live QA (local OSS stack, SeaweedFS, then Daytona)

Numbers: `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS=120` (margin 30 s, lead 60 s).

1. **The previously impossible case**: one single turn that runs longer than the
   TTL. Prompt the agent to loop for 5 minutes appending a timestamp to a mounted
   file every 10 seconds and then print the file. Expect: every write succeeds,
   the file shows an unbroken series across at least two lease boundaries, runner
   log shows two `mount-refresh` renewals, zero EACCES.
2. **Warm reuse across many leases**: turns every ~45 s for 10 minutes. Expect:
   `hit-continue` on every turn, zero `credentials-expiring`, one environment
   throughout.
3. **Backstop**: stop the API container mid-run (or point the sign closure at a
   dead port via the test seam in a rehearsal), let the lease die, confirm EACCES
   then self-heal after the API returns, and confirm a parked environment with a
   dead lease evicts `credentials-expired` at next dispatch.
4. **Kill switch**: `AGENTA_RUNNER_MOUNT_REFRESH=off`, rerun scenario 2, confirm
   today's periodic `credentials-expiring` cold rebuild returns (proves the
   fallback path stayed intact).
5. Repeat 1 and 2 against a Daytona cell after slice 2.
6. Restore defaults; run the standard gate.

Per the QA-recording rule, capture scenario 1 as an MP4 for the PR.

## Rollout

- Slice 1 ships alone: local mounts refresh, Daytona unchanged (still protected by
  the patch-release numbers). Mixed operation is safe because the refresh flag and
  machinery are per-environment.
- Slice 2 ships next: Daytona refreshes; credential-driven sandbox deletes stop.
- Slice 3 is a knobs-and-docs pass gated on Mahmoud's decisions and gate evidence.
- Runner-only images; no API redeploy, no compose change required (the existing TTL
  knob passthroughs from the predecessor suffice for QA). No wire change, so no
  SDK/service coordination.

## Open questions for Mahmoud

1. **Post-refresh defaults** (slice 3): keep the run deadline at the patch's 11 h or
   restore 45 min? Drop the TTL from the patch's 12 h back to 3600 s, or lower,
   now that renewal is free? Recommendation: deadline stays a product choice
   (11 h seems intended), TTL back to 3600 s.
2. **Kill switch default**: the plan ships refresh ON with
   `AGENTA_RUNNER_MOUNT_REFRESH=off` as the escape hatch, on the argument that a
   default-off mechanism never gets exercised and skipped paths are untested
   claims. Confirm, or ask for default-off-first.
3. **Availability trade under a short TTL** (folds into question 1): once the TTL
   drops below the turn budget, a signer outage longer than the remaining lease
   breaks an active turn's mount until recovery (research.md section 7). Accept
   that with TTL 3600 s, or keep the TTL above the deadline and take the larger
   leak window? The design recommends accepting it: the outage must outlast the
   full remaining lease mid-turn, the mount self-heals, and the eviction backstop
   bounds the damage to one turn.

Two questions from the first draft were closed by the Codex review rather than
left to taste: transcript mounts now JOIN the lease epoch in slice 2 (independent
refresh failures break the predecessor's exclusion argument; decisions.md item
10), and E2B is explicitly out of scope because the provider currently rejects
`e2b` as planned-but-unsupported (`provider.ts:230`), so nothing inherits the
mechanism today; re-open when an E2B provider actually lands.
