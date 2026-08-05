# Decisions: what was chosen, why, and how to back each choice out

Every decision this fix embeds, explicit or implicit, with its trade-off and the
cheapest way to reverse it. Ordered from the ones that shape the fix down to
mechanical details. "Backtrack" states what changing the decision costs later.

## 1. Fix the two real defects, not the issue's headline remedies

The issue proposed raising the TTL and adding refresh machinery. Research showed
the requested TTL was already 3600 seconds; two defects made it a lie: the
web-identity JWT was hardcoded to 15 minutes and capped every SeaweedFS session,
and the runner's session pool overwrote its expiry bookkeeping on every warm turn
with the expiry of credentials that never reached the running mounts. The fix
repairs exactly those two defects.

- Trade-off: none. This is smaller than any alternative and removes the root
  cause instead of moving it.
- Backtrack: not applicable; the defects are defects.

## 2. Fresh credentials arrive by rebuilding at the turn boundary, not by
refreshing a running daemon

geesefs v0.43.0 offers no zero-machinery in-place refresh: it reads a
credentials file exactly once (research.md section 3 rules the rewrite idea out
against the vendored SDK source), and the two real refresh mechanisms
(credential_process, the container-credentials endpoint) each add a
credential-serving surface, with the remote variant putting API auth inside the
agent-reachable sandbox. The session pool already evicts to a cold rebuild on
credential grounds; the fix makes that designed mechanism truthful instead of
adding a new one.

- Trade-off: an active conversation rebuilds cold once per lease. At default
  knobs the warm window is TTL (3600s) minus turn budget (2700s) minus skew
  (60s), about 14 minutes, so long busy conversations pay a cold rebuild
  roughly every 14 minutes. On the local sandbox that is sub-second-to-seconds;
  on Daytona a credential eviction deletes the remote sandbox and the next turn
  pays a full create. Before the fix those same conversations did not pay a
  rebuild; they broke outright at minute 15.
- Backtrack: if production shows the churn hurts, implement the
  container-credentials endpoint (research.md section 3, mechanism 4). Nothing
  in this fix blocks it; the lease bookkeeping stays correct either way.

## 3. Default TTL stays 3600 seconds

Raising the default to the SeaweedFS ceiling (43200s) would widen the warm
window from ~14 minutes to ~11 hours, but every extra hour of lifetime is an
hour a leaked prefix-scoped credential (and the now-matching web-identity JWT)
stays usable.

- Trade-off: more frequent cold rebuilds for long active conversations until
  the rebuild rate is measured in production.
- Backtrack: set `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS` on the API service.
  No code change; the clamps keep any value legal per backend.

## 4. The eviction margin is the full worst-case turn budget, plus fixed skew

A parked environment is reused only when its lease covers `now + total turn
deadline + 60s`. The total deadline (default 45 minutes,
`AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS`) is the longest a turn started now could
still be running, so no turn can start on credentials it could outlive.

- Alternative considered: margin from the idle timeout (5 minutes), which would
  widen the warm window to ~54 minutes. Rejected because a single long turn
  could then cross expiry mid-flight, which is the bug this fix exists to
  remove.
- Trade-off: the margin is pessimistic; most turns finish in seconds.
- Backtrack: lower `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS` if turns are known to
  be short on a deployment; the margin follows it automatically.

## 5. Clock-skew allowance is a fixed 60-second constant, not a knob

`MOUNT_LEASE_SKEW_MS` covers API/runner/store clock differences and the seconds
a rebuild spends mounting. It protects an invariant, and a third time knob that
operators must relate to the other two invites mis-setting.

- Backtrack: one constant in `session-identity.ts`.

## 6. A lease too short for the turn budget warns and runs; it never fails

When the TTL is below budget plus skew, even a fresh mount cannot satisfy the
reuse window, so every dispatch rebuilds cold and logs `lease-short` naming both
knobs. The stricter alternative, refusing to start or failing configuration
validation, was considered and rejected: it would turn one mis-set number into a
full outage, proceeding is never worse than the pre-fix behavior, and QA lowers
the TTL on purpose.

- Trade-off: a misconfigured deployment churns instead of stopping; the log
  line is the only signal.
- Backtrack: tighten the same branch in `coldAndPark` if operations later
  prefers fail-fast.

## 7. The lease tracks the cwd and agent mounts only

`installedMountExpiries` records the two durable mounts. The Daytona harness
session-directory and transcript mounts are excluded: they are signed seconds
after the cwd mount with the same TTL, so their expiry is never the minimum and
tracking them would add entries that cannot change the outcome.

- Trade-off: if that signing order or TTL parity ever changes, the exclusion
  argument breaks silently.
- Backtrack: add fields to `InstalledMountExpiries` and stamp the two remote
  session-dir mount sites; `installedMountLease` already reduces over whatever
  entries exist.

## 8. A re-park always describes the live environment

`reparkOrEvict` keeps the live environment's secrets hash unconditionally. On
the idle path the mismatch gate has already proven the live and incoming hashes
equal; on the approval-resume path the resume deliberately ignores the incoming
credentials, so adopting its hash would relabel an environment running old
secrets as if it ran new ones. An earlier draft made this a per-call-site flag;
the unconditional form removes a default that would have been wrong to forget.

- Backtrack: none needed; this is an invariant, not a preference.

## 9. The incoming credential epoch no longer carries an expiry

Both park sites now derive `mountExpiresAtMs` from the installed mounts, so the
expiry of the credentials signed per dispatch had zero readers. The parameter
was removed rather than left as a plausible-looking dead input that would
mislead a reviewer into thinking dispatch signs govern reuse.

- Backtrack: re-add the second argument to `computeCredentialEpoch` if a future
  consumer appears.

## 10. Signing fails closed on a missing or unparsable STS expiry

`_parse_sts_credentials` raises `MountStorageUnavailable` instead of returning
credentials with no expiry, because the runner reads a missing expiry as "never
expires" and one malformed response would silently disable the reuse bound. Both
signing branches are STS, so no legitimate no-expiry path exists. A refused sign
degrades the turn to mount-less, the same handling as any other sign failure; it
does not fail the turn.

- Backtrack: relax the raise back to `None` only if a store appears whose STS
  legitimately omits `Expiration` (none known).

## 11. The web-identity JWT lives as long as the requested TTL, capped at 12h

Minting the token with the requested lifetime is what makes the TTL real on
SeaweedFS. The cap (`_SEAWEEDFS_MAX_SESSION_SECONDS`, mirroring the compose
`maxSessionLength: 12h`) keeps any token from outliving the longest session it
could mint.

- Trade-off: the internal token's replay window widens from 15 minutes to the
  TTL. The token never leaves the API-to-store network hop. The pre-existing
  sharp edge is unchanged and documented in research.md section 4: that JWT
  presented without a session policy grants the whole bucket, so it must stay
  inside the API trust boundary.
- Backtrack: none sensible; a shorter token re-caps the credential lifetime,
  which is the bug.

## 12. Sub-900-second lifetimes are a SeaweedFS-only QA lever

SeaweedFS hard-validates `DurationSeconds` in [900, 43200] but caps the
effective lifetime at the web-identity token's expiry with no floor, so a low
TTL takes effect through the token. AWS `GetFederationToken` has a hard 900
floor, requires long-term IAM-user credentials (root is capped at 3600s), and
was not exercised live; it is covered by the request-level unit tests and the
analysis in research.md section 4. The runner half keys only off the
STS-reported `expires_at`, which both backends report truthfully, so it is
backend-neutral by construction.

- Trade-off: the fast live reproduction exists only on SeaweedFS deployments.
- Backtrack: optional staging pass on AWS with TTL 900 and a >15-minute active
  conversation, as listed in plan.md.

## 13. The TTL is read through the shared env object, with fail-fast parsing

`MountsConfig.credentials_ttl_seconds` follows the repo convention (config via
`env`, never `os.getenv` at call sites) and uses a `default_factory` so the
variable is read when the config object is built, which keeps tests plain.
Parsing goes through the file's existing positive-int helper: unset or empty
falls back to 3600; garbage or a non-positive value raises at startup, matching
how every other knob in `env.py` behaves. Constructor injection of the TTL into
`MountsService` was considered and rejected as against the repo's convention.

- Backtrack: trivial; it is one field and one call site.

## 14. The mid-turn event watcher was not extended to EACCES

The acquisition probe already treats an EACCES listing as not-mounted and
remounts. Extending the mid-turn watcher (which scans agent event text) to
"Permission denied" would false-trigger constantly on legitimate agent output,
and becomes unnecessary once no turn starts on credentials that can die under
it.

- Backtrack: revisit only if a new failure mode produces mid-turn EACCES with
  live credentials; the ENOTCONN watcher shows the pattern to copy.

## 15. Per-mount RoleSessionName stays deferred

Every mount still shares one STS session identity (`agenta-store`). Worth
fixing on isolation grounds; orthogonal to expiry and left out to keep this fix
reviewable.

## 16. Deferred efficiency follow-ups (noticed, deliberately not done here)

- Every warm dispatch still signs mount credentials that are then unused (only
  the pool key and a project-id fallback consume the result). Skipping that
  sign on warm hits needs a lazy-sign restructure of the dispatch path; out of
  scope.
- `webidentity._private_key()` re-parses the PEM on every sign; a one-line
  cache is a safe follow-up outside this diff's files.

## 17. QA knobs ship as first-class passthroughs in all seven compose files

`AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS` (api service) and
`AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS` (runner service) were added to the OSS and
EE dev/gh/gh.local/gh.ssl compose files, unset by default, so operators and QA
can set them without editing compose files. The live reproduction in this PR
uses exactly these knobs.
