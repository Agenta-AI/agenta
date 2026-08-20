# Research: how a running geesefs mount can be given fresh credentials

All repo paths are relative to the repo root; line numbers reference the current
tree. External source: geesefs v0.43.0, the pinned binary
(`services/runner/docker/Dockerfile.gh:34`, `Dockerfile.dev`, and
`services/runner/images/sandbox/daytona/build_snapshot.py`). Its vendored AWS SDK
fork lives under `s3ext/` in that release; every SDK claim below was verified against
that source, not against upstream aws-sdk-go docs. The predecessor's research
([../fix-sts-mount-expiry/research.md](../fix-sts-mount-expiry/research.md)) covers
the signing path, the expiry enforcement, and the session pool; this file only
restates what this design builds on.

## 1. Where credentials enter a mount today

Every mount gets its credentials exactly once, as static environment variables on the
geesefs process:

- **Local sandbox** (the runner's own container): `mountStorage` spawns
  `geesefs --no-detect --fsync-on-close -f -o allow_other <bucket>:<prefix> <cwd>`
  (`services/runner/src/engines/sandbox_agent/mount.ts:214`) with
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` in the child
  env (`credEnv`, `mount.ts:237`, spawned at `mount.ts:341`).
- **Remote sandbox** (Daytona): `mountStorageRemote` runs the same argv inside the
  sandbox through the provider's exec API, credentials again as process env
  (`mount.ts:644`, env at `mount.ts:667-671`).
- **Install sites.** Local: `mountLocalDurableCwd` and `mountLocalAgentCwd`
  (`services/runner/src/environment/mount-lifecycle.ts:190,229`), called at acquire
  (`environment.ts:500,503`) and by the ENOTCONN re-sign helpers
  (`mount-lifecycle.ts:274,315`). Remote: the durable cwd at
  `environment.ts:668-683`, the agent mount at `environment.ts:740-760`, and the
  per-harness session/transcript mounts at `environment.ts:694`
  (`mountHarnessSessionDirs`, `mount.ts:727`, one sign + one mount per directory).
- **Lease bookkeeping.** Each successful mount stamps
  `environment.installedMountExpiries.{cwd,agent}` from the credentials it used
  (local via `commitLocalMount`,
  `src/environment/acquire-context-impl.ts:144-165`; remote inline at
  `environment.ts:679,749`). The session pool parks that record as the credential
  epoch (`parkedEpoch`, `src/lifecycle/session-coordinator.ts:678-685`) and evicts
  before a worst-case turn could cross it (`requiredValidThroughMs`,
  `session-coordinator.ts:300-302`; the `credentials-expiring` branch,
  `session-coordinator.ts:905-911`; the approval branch, `1124-1140`; the
  `lease-short` warning, `833-843`).
- **Signing.** The runner calls `POST /sessions/mounts/sign` and
  `POST /mounts/agents/sign` with the per-run credential; both land in
  `MountsService.sign_mount_credentials` (`api/oss/src/core/mounts/service.py:856`)
  at `env.mounts.credentials_ttl_seconds` (`service.py:880`, knob
  `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS`, `api/oss/src/utils/env.py:1212-1224`).
  Backends: SeaweedFS `AssumeRoleWithWebIdentity` or AWS/MinIO `GetFederationToken`,
  both scoped by one inline session policy
  (`api/oss/src/core/store/storage.py:146,201`).

Two facts to carry forward. First, the store enforces expiry per request: each S3
call presents the session token and gets 403 once it is expired; there is no
connection-level session to renew, so "refresh" means only "sign new HTTP requests
with newer credentials". Second, signing a new lease does not revoke the old one;
both backends let independently signed leases overlap until each one's own expiry.

## 2. What the pinned SDK actually supports, verified against v0.43.0 source

geesefs builds its AWS config in `core/cfg/conf_s3.go` (`ToAwsConfig`). Explicit
`--access-key` flags become static credentials; otherwise it constructs a session
with `session.NewSessionWithOptions({Profile: c.Profile, SharedConfigFiles:
c.SharedConfig, SharedConfigState: session.SharedConfigEnable})`. The flags exist:
`--profile` and `--shared-config` (`core/cfg/flags.go:218-225`, wired at
`flags.go:924-925`).

### Credential resolution order (`s3ext/aws/session/credentials.go:25-48`)

1. **An explicitly passed profile wins over everything**, including environment
   variables: `case len(sessOpts.Profile) != 0` is checked before
   `envCfg.Creds.HasKeys()`. Passing `--profile` therefore pins resolution to the
   shared config file even if stray `AWS_*` variables exist in the daemon's env.
2. Environment credentials (static, never refresh).
3. The default profile from the shared config files.

Within profile resolution (`resolveCredsFromProfile`,
`credentials.go:85-146`): static keys in the file win, then SSO, then
`credential_process` (`case len(sharedCfg.CredentialProcess) != 0` builds
`processcreds.NewCredentials`). The config key is `credential_process`
(`session/shared_config.go:51`), and the section lookup accepts both `[name]` and
`[profile name]` headers (`shared_config.go:288-292`).

### credential_process semantics (`s3ext/aws/credentials/processcreds/provider.go`)

- The command runs through `sh -c` (`prepareCommand`, around line 300) and must
  print JSON: `{"Version": 1, "AccessKeyId": ..., "SecretAccessKey": ...,
  "SessionToken": ..., "Expiration": <RFC3339>}` (`credentialProcessResponse`,
  lines 229-235).
- **`Expiration` present means refreshing**: `p.SetExpiration(*resp.Expiration,
  p.ExpiryWindow)` (line 277). The shared `credentials.Credentials` object checks
  `IsExpired()` before signing each S3 request and re-runs the process when true
  (lines 275-296). `Expiration` absent means the credentials are treated as static
  forever (`p.staticCreds = resp.Expiration == nil`, line 275), so the lease file
  must always carry an expiry.
- geesefs never sets `ExpiryWindow` for processcreds, so it defaults to zero: the
  SDK re-runs the process exactly when the reported `Expiration` passes, not
  before. The refresh moment is therefore fully controlled by the `Expiration` the
  lease file reports, which is the lever section 5 uses.

This is the mechanism the design uses: the "process" is `cat <lease-file>`, and the
runner rewrites the lease file. The predecessor ruled out rewriting the SHARED
CREDENTIALS file because `SharedCredentialsProvider` reads it once and never again
(`shared_credentials_provider.go`, `IsExpired` returns `!p.retrieved`); that finding
stands and does not apply here, because processcreds re-reads by re-running the
command.

### What the citations prove, and what they do not

The citations establish the narrow conclusion: an explicit profile selects
`credential_process`, a present `Expiration` makes the credentials refreshing, and
the command is re-run once the reported expiration passes. They do NOT prove the
operational claims the design also leans on: that stale expired output is re-tried
on every subsequent request with no negative caching, that a late successful
rewrite self-heals after earlier retrieval failures, that every multipart part
request is signed with the then-current credentials, that requests already
constructed before rotation pick up the new lease, or that the real geesefs
invocation honors profile precedence when ambient `AWS_*` variables are present
(the local spawn merges the full runner env into the child,
`services/runner/src/engines/sandbox_agent/mount.ts:341`). Plan slice 0 is a
mandatory empirical spike against the pinned binary that settles all of these
before any manager code is written.

### Container-credentials endpoint: loopback-only in this fork

`AWS_CONTAINER_CREDENTIALS_FULL_URI` is supported
(`s3ext/aws/defaults/defaults.go:116-118`), refreshes with a 5-minute expiry window,
and honors `AWS_CONTAINER_AUTHORIZATION_TOKEN` (`httpCredProvider`,
`defaults.go:188-196`). But `localHTTPCredProvider` (`defaults.go:158-186`) rejects
ANY non-loopback host, with no HTTPS exception: "invalid endpoint host, %q, only
loopback hosts are allowed". So the endpoint must listen on 127.0.0.1 inside the
geesefs process's own network namespace. For a Daytona mount that means a listener
INSIDE the sandbox, which would itself need a way to obtain fresh leases, which is
the same problem again plus a daemon. This finding revises the predecessor's
decisions.md item 2, which named the container endpoint as the intended follow-up:
in this SDK generation the endpoint cannot be served from outside the sandbox at
all, so credential_process in push form is the better carrier of the same idea.

### The full mechanism table, updated

| Mechanism | Refreshes? | Verdict for in-place refresh |
| --- | --- | --- |
| Static `AWS_*` env (today) | No | Status quo; what this project replaces. |
| Rewriting the shared credentials file | No (read once) | Ruled out, unchanged. |
| `credential_process` = `cat <lease-file>`, runner rewrites the file | Yes, re-runs at the reported `Expiration` | **Chosen.** No daemon, no port, no credential-fetching logic inside the sandbox; the runner pushes. |
| Container endpoint (`FULL_URI`) | Yes (5-min window) | Loopback-only in this fork; remote would need an in-sandbox serving daemon. Rejected. |
| IMDS emulation, `--iam`, `--role-arn` | various | Rejected by the predecessor for reasons that still hold (link-local ownership, non-SigV4 signing, bucket-wide base keys). |
| Evict-and-rebuild at the boundary (today's designed behavior) | N/A | Becomes the BACKSTOP for refresh failure, no longer the primary mechanism. |

## 3. The push model: who writes the lease file, and with what authority

The runner signs; the sandbox reads a file. Concretely:

- **Local**: the geesefs daemons are children of the runner container. The runner
  writes `<lease-dir>/<mount>/lease.json` on its own filesystem and the daemon's
  `credential_process` cats it. No new channel.
- **Remote (Daytona)**: the runner writes the lease file into the sandbox through
  the provider's authenticated exec/upload API, the same channel that already
  installs workspaces, system prompts, and the mounts themselves. The provider API
  credential stays in the runner; the sandbox receives only the file's content.

The re-sign itself uses the existing sign endpoints with the per-run credential the
runner already holds during a turn (`runCredential(request)`,
`environment-setup.ts:108`; the same authority the ENOTCONN re-sign helpers use,
`mount-lifecycle.ts:289,330`).

## 4. Why this preserves the sandbox trust boundary

The constraint: untrusted agent code runs in the sandbox, so no API auth and no
long-lived keys may exist inside it. Inventory of what each party holds under the
push model:

- Inside the sandbox, before: a prefix-scoped STS lease. On remote it is set via the
  provider exec env, plainly agent-readable. On LOCAL the picture must be verified,
  not asserted: the daemon runs on the runner host as the same user agent code runs
  as (`provider.ts:243` spawns the sandbox server on this host; the production image
  runs everything as `node`, `docker/Dockerfile.gh:109`; no filesystem jail exists),
  which suggests `/proc/<pid>/environ` is readable, yet the module doc claims the
  opposite ("the signed credentials never enter agent-reachable space",
  `mount.ts:9`). One of those statements is wrong. Slice 0 verifies the actual
  local exposure empirically; the design does not rest on either answer, but the
  "unchanged exposure" claim below is conditional on it.
- Inside the sandbox, after: the same prefix-scoped STS lease, in a file. On remote
  this changes nothing (the env was already readable). On local, if the env turns
  out to be agent-readable, the file is the same exposure in an easier-to-find
  place; if the env turns out NOT to be readable, the file is a new local exposure
  and the lease directory permissions below are what bounds it. Either way the
  lease grants only what the agent can already do THROUGH the mount, plus direct
  store-API access to the same prefix over an endpoint the sandbox must reach
  anyway for geesefs to work.
- File handling is part of the boundary, not a detail: lease directories are
  per-acquisition-unique, mode 0700, files 0600; temp files are created exclusively
  (random name, `O_EXCL`, `O_NOFOLLOW`) and renamed within the same directory; the
  config invokes `/usr/bin/cat -- "<abs path>"` (no PATH resolution, no option
  injection); lease and config files are deleted at unmount/destroy so valid
  credentials never accumulate on disk. A fixed, predictable temp path would be
  raceable and symlink-attackable by same-user code and is not acceptable.
- Never inside the sandbox: the per-run API credential (stays in the runner, used to
  call the sign endpoints), the store master keys (stay in the API service), the
  provider API key (stays in the runner).

The deferred designs failed exactly this inventory: a credential_process that CALLS
the sign endpoint would carry the API credential into the sandbox, and a
container-credentials listener reachable from the sandbox would be a credential
server the agent can query. `cat` carries nothing.

Two residual sharpenings, worth stating honestly. First, a fresh lease file gives
the agent a lease with LONGER remaining lifetime than the aging one it replaces;
each individual lease stays TTL-bounded. Second, and stronger: refresh turns the
sandbox's credential into a RENEWABLE STREAM for the duration of the turn. A
malicious agent that exfiltrates each replacement lease as it lands holds live
external access to the prefix for as long as the turn keeps refreshing, plus one
TTL after the last refresh; before this project the same agent got turn-start plus
one TTL. The stream is turn-bounded (the refresher disarms at turn end) and grants
no new scope, and the alternative that provides the same run length today (a TTL
above the maximum turn, currently 12 hours) leaks strictly more per token. Slice
3's proposal to SHORTEN the TTL (possible only because refresh exists) shrinks the
per-token window versus the 12-hour patch state; the stream property is the price
of in-place refresh and is accepted, recorded in decisions.md.

## 5. What happens to in-flight file operations at the rotation moment

Rotation should be invisible to I/O, by construction, given one margin; the claims
below follow from the cited SDK structure but the load-bearing ones are verified
empirically in slice 0 rather than trusted:

- The SDK's credentials object is process-wide and mutex-guarded; each S3 request
  checks `IsExpired()` before signing. Requests already in flight complete under the
  old lease; the store validates the token at request time, and the old lease is
  still valid because nothing revoked it (section 1).
- Multipart uploads are expected to sign every part request independently, so parts
  signed under the old and new lease interleave harmlessly. Expected, not proven:
  slice 0 runs a large multipart write across a rotation to confirm it.
- The race that must be engineered away: with `ExpiryWindow` zero, the SDK switches
  at exactly the reported `Expiration`. A request signed a moment BEFORE that
  instant, with real expiry equal to it, could reach the store a moment after and
  get 403. Fix: the lease file reports an EARLY expiration,
  `reported = real - margin`. The SDK then rotates while the old lease is still
  valid for the full margin. The margin does not make straddling impossible; it
  bounds the race under an assumed maximum of request-admission delay plus clock
  skew, which is why the margin has a floor and the skew assumption is stated
  explicitly in the plan. The runner controls the JSON, so this costs one
  subtraction.
- FUSE-level consequence: none. The daemon, the kernel mount, the inode cache, and
  open file handles are untouched; only the bytes used to sign future HTTP requests
  change. There is no unmount, no remount, and no window where the path is absent.
  This is the whole point over the evict-and-rebuild status quo.

Failure ordering: if the runner fails to rewrite the file before the reported
expiration, the SDK re-runs `cat`, gets the stale JSON, sees an already-past
expiration, and is expected to re-run `cat` on every subsequent request until the
file changes (no negative caching), so operations fail with EACCES only after the
REAL expiry passes (the margin and then some) and the mount self-heals the moment a
fresh file lands, with no remount. The re-try-on-every-request and late-self-heal
behaviors are exactly the kind of provider-internal detail the citations do not
prove; slice 0 verifies both (hold a stale lease past real expiry, publish late,
confirm recovery without remount). If they hold, this failure mode is strictly
better than today's; the eviction backstop behind it is section 7, with its limits
stated there.

## 6. When refresh must run, and what authority is available then

The refresher needs the per-run API credential to call the sign endpoints. Where the
environment spends its life:

- **In a turn** (the case that matters; only here can a lease die under I/O): a
  signing credential is available, but NOT as a fixed string. The incoming run
  credential is an ephemeral secret with a TTL around 15 minutes; the session alive
  watchdog re-mints it on a heartbeat cadence precisely so long turns never 401
  (`src/sessions/alive.ts:196`), and `RunTurnOptions` carries
  `credential?: () => string` as a live accessor for exactly this reason
  (`runtime-contracts.ts:175`). The refresher must be armed with that ACCESSOR and
  read it at each sign, never with a snapshot taken at turn start; a snapshot goes
  stale long before the first mount refresh at any sane TTL. Artifact-scoped runs
  that have no session watchdog arm with the request credential and accept that
  refresh stops signing when it expires, at which point the backstop path applies.
  A turn-scoped refresher then covers runs of unbounded length.
- **Parked idle**: 60 s local, 120 s Daytona (`DEFAULT_TTL_MS`,
  `DEFAULT_DAYTONA_TTL_MS`, `session-identity.ts:39,54`). Far below any sane TTL;
  no refresh needed while parked.
- **Parked awaiting approval**: 10 minutes by default. Still far below the TTL.
- **Daytona parked-to-stopped** (`PARK_CLEAN_RESUMABLE_TURNS`, `teardown.ts:51`): a
  stopped sandbox has no running daemons, and reattach already force-detaches and
  remounts with freshly signed credentials (`mountStorageRemote`'s unmount-first,
  `mount.ts:652-654`). Nothing to refresh.

So a refresher that is ARMED AT TURN START and DISARMED AT TURN END is sufficient,
with one addition: an eager refresh at arm time when the installed lease's remaining
life is below the refresh lead, so a turn checked out near the boundary does not
race its first file operations against the push. Between-turn gaps are covered by
the pool TTLs being two orders of magnitude below the lease TTL; the coordinator's
existing expiry checks remain as the backstop for pathological gaps.

A convenient near-miss worth noting and not using: every dispatch already signs
fresh cwd credentials up front (`resolveKeepaliveMount`,
`session-coordinator.ts:272`), which the predecessor flagged as waste. Pushing that
sign into the live environment on warm hits was considered and rejected: it covers
only the cwd mount (not the agent or transcript mounts), only at turn boundaries,
and would put lease-writing on the dispatch hot path. The turn-scoped refresher
re-signs everything it manages through one code path instead. The dispatch sign
stays what it is, a pool-key input.

## 7. What the refresh mechanism simplifies, and what stays

Once the installed lease advances instead of running out:

- `credentials-expiring` (`session-coordinator.ts:905-911`, and the approval-branch
  twin at `1124-1140`) stops firing in healthy operation, because
  `installedMountExpiries` is updated by every refresh and the parked epoch is
  stamped from it at park time. The check STAYS, unchanged, as the refresh-failure
  backstop: if signing breaks, the lease stops advancing and today's
  evict-before-expiry behavior returns automatically. No coordinator surgery is
  needed for slice 1 beyond the horizon question below.
- The lease-horizon arithmetic (`requiredValidThroughMs = now + turn budget + skew`)
  embeds the assumption that a turn runs on the credentials it starts with. With
  refresh active that assumption is false in the good direction, and left alone it
  would still evict any warm session whose remaining lease is shorter than the FULL
  turn budget (with the patch numbers, any session older than one hour of a 12-hour
  lease against an 11-hour budget). Slice 1 gates the horizon check on "is this
  environment refresh-managed", but the gate is only honest when paired with a
  PREFLIGHT: reusing an environment inside the old horizon is a bet that the turn
  will renew the lease, and if the renewal machinery is broken the bet loses
  mid-turn, which is worse than today. So arming performs an awaited refresh
  BEFORE the turn's first mounted I/O whenever the remaining lease does not cover
  the horizon; if that preflight fails, the acquisition fails over to a cold
  rebuild, which is exactly the outcome the ungated check would have produced, paid
  at the same moment. The next-dispatch eviction is NOT protection for an active
  turn and this design does not claim it is. Hard expiry (`credentials-expired`)
  keeps evicting even for refresh-managed environments; a dead lease at checkout
  means the refresher failed its whole park, which is the backstop doing its job.
- The honest limit, stated once: once the TTL is allowed to drop below the maximum
  turn length, "a turn of any length never sees EACCES" is not a guarantee anyone
  can make. The signer becomes a runtime availability dependency: a signer outage
  longer than the remaining real lease breaks the active turn's mount until the
  first successful retry (self-heal, no remount). The real guarantee is: an active
  turn keeps its files as long as signing and delivery recover within the
  remaining real lease lifetime, and a turn never STARTS on a lease it cannot
  cover without a successful preflight. Deployments that want the old absolute
  guarantee keep the TTL above the turn budget, which refresh makes safe to do
  with a short deadline or a long one; that trade is Mahmoud's slice-3 call.
- The `lease-short` warning (`session-coordinator.ts:833-843`) becomes vestigial for
  refresh-managed environments and is skipped for them; a short TTL with refresh is
  a legitimate configuration, not a misconfiguration.
- The teardown mapping (`credentials* -> runtime-incompatible -> delete`,
  `session-coordinator.ts:581`, `teardown.ts`) stays byte-identical; it just stops
  being exercised for credential reasons.
- The run-deadline / TTL coupling (the v0.112.3 patch's 11 h / 12 h truce)
  dissolves: `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS` and
  `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS` become independent knobs. Retuning their
  defaults is slice 3, with Mahmoud.
- **Stays untouched**: the ENOTCONN machinery (hard daemon death is a different
  failure; `mount-lifecycle.ts:274-385`), the `isMountAlive` backstop probe
  (`session-coordinator.ts:148`), the acquisition probe (`isMounted`,
  `mount.ts:255`), fail-closed signing on the API, and the API signing path
  entirely (this project is runner-only; the sign endpoints are reused as-is, no
  wire change, no API change).

## 8. Test infrastructure

- **Runner unit tests** (vitest, `services/runner/tests/unit/`):
  `sandbox-agent-mount.test.ts` has injectable `runGeesefs` / `checkMounted` seams
  for argv and env assertions; `session-keepalive-dispatch.test.ts` and
  `session-keepalive-engine.test.ts` drive the real coordinator + pool with a fake
  `KeepaliveEngine` whose environments a test can stamp
  (`installedMountExpiries`, and now the refresh-managed flag);
  `lifecycle-session-coordinator.test.ts` and
  `session-lifecycle-characterization.test.ts` pin the decision table;
  `session-steer-mount-loss.test.ts` covers the mount-lost backstop. Fake timers
  (`vi.useFakeTimers({toFake: ["Date"]})`) are the established pattern for lease
  clocks.
- **Release gate** (`.agents/skills/agent-release-gate/`): the `warm` journey
  asserts three turns on ONE live daemon over a store-backed cwd (turn ledger:
  one harness session id, one sandbox id; runner log: `[keepalive] hit-continue`),
  and the `mount` journey asserts durable file round-trips. The lifecycle cells
  (`resources/matrix_l1_lifecycle_routes.py`, `matrix_l3_abandoned_approval.py`,
  `matrix_l5_live_route_observed.py`) assert warm reuse across lifecycle events.
  These are exactly the assertions that must keep passing while a QA-shortened TTL
  cycles many times underneath them.
- **Live reproduction lever**: SeaweedFS honors sub-900-second effective lifetimes
  through the web-identity token expiry (predecessor's finding, still true), so
  `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS=120` on a local OSS stack makes a lease
  cycle 2 minutes long. The definitive new scenario, impossible before this
  project: one single turn that runs LONGER than the TTL while writing files
  throughout, and never sees EACCES.
