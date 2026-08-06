# Plan: make mount credentials outlive every turn, and honor their expiry

Four small changes. Three make the credential lifetime real, configurable, and
trustworthy (API). One makes the runner track the credentials its mounts actually
hold, and rebuild before they die (runner). No new daemons, no wire changes, no
refresh machinery inside the sandbox.

## The fix in one paragraph

Today a mount credential requested for 3600 seconds really lives 900 seconds on
SeaweedFS, because the web-identity token that authenticates the STS call expires
after 15 minutes and SeaweedFS caps the session at that expiry. And even the true
expiry is ignored: the session pool overwrites its expiry bookkeeping on every warm
turn with a freshly signed credential that never reaches the running mounts. The fix
mints the web-identity token with a lifetime matching the requested duration, makes
that duration an env-configurable TTL, and refuses to hand out credentials whose
expiry the store did not report. On the runner side the pooled environment records
the expiry of the credentials actually installed in its geesefs daemons, and only
that recorded value ever governs reuse. The pool then does what it was designed to
do: evict the environment to a cold rebuild, with fresh credentials and fresh mounts,
before the installed credentials can die under a turn. The required validity window
is the worst-case turn duration plus a fixed clock-skew allowance, so no turn starts
on credentials that could expire before it ends.

## Scope against the issue's four fix directions

1. **Detect EACCES like ENOTCONN**: partially already true, remainder deferred. The
   acquisition probe (`isMounted`) already treats an EACCES `ls` failure as
   not-mounted and remounts. Extending the mid-turn event watcher to EACCES is
   deferred: "Permission denied" appears in legitimate agent output constantly, and
   the trigger becomes unnecessary once credentials outlive every turn
   (research.md section 5).
2. **Refresh before expiry**: adopted in its boundary form. Fresh credentials arrive
   via evict-to-cold at the turn boundary, which is the mechanism the credential
   epoch was built for. In-place refresh of a running daemon (credential_process or
   a container-credentials endpoint) is real machinery and is deferred
   (research.md section 3).
3. **Raise duration_seconds**: adopted as "make the already-requested 3600 real and
   configurable". The default stays 3600.
4. **Per-mount RoleSessionName**: deferred. Isolation hygiene, orthogonal to expiry.

## Change 1: configurable TTL (API)

### `api/oss/src/utils/env.py`

`MountsConfig` is currently empty (env.py:1117):

```python
class MountsConfig(BaseModel):
    """Mounts-domain config. Store credentials live in StoreConfig."""

    model_config = ConfigDict(extra="ignore")
```

Add the TTL, following the existing `int(os.getenv(...) or "...")` pattern
(compare `catalog_cache_ttl_seconds`, env.py:622). The `or` also absorbs an empty
string, which is what an unset compose passthrough delivers:

```python
class MountsConfig(BaseModel):
    """Mounts-domain config. Store credentials live in StoreConfig."""

    # Lifetime of signed mount credentials. The store backends clamp it to their own
    # STS bounds (SeaweedFS: effective floor via the web-identity token, hard range
    # 900-43200 for DurationSeconds; AWS GetFederationToken: 900-129600). QA lowers
    # it to force fast expiry; only SeaweedFS honors values below 900.
    credentials_ttl_seconds: int = int(
        os.getenv("AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS") or "3600"
    )

    model_config = ConfigDict(extra="ignore")
```

The config stays on the shared `env` object, per the repo convention that
application config is read through `env` and never through a bare `os.getenv` at
the call site.

### `api/oss/src/core/mounts/service.py`

Current (service.py:57-59 and 606-611):

```python
# Default TTL (seconds) for signed mount credentials. Covers the mount lifetime for a
# turn; geesefs holds the creds without refresh, so a turn outliving this hits ExpiredToken.
_CREDENTIALS_TTL_SECONDS = 3600
...
    async def sign_mount_credentials(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        duration_seconds: int = _CREDENTIALS_TTL_SECONDS,
    ) -> MountCredentials:
```

Replace the module constant with the env value, resolved at call time (a default
argument would freeze the import-time value):

```python
    async def sign_mount_credentials(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        duration_seconds: Optional[int] = None,
    ) -> MountCredentials:
        ...
        ttl = (
            duration_seconds
            if duration_seconds is not None
            else env.mounts.credentials_ttl_seconds
        )
        creds = await self.mounts_store.sign_temp_credentials(
            bucket=bucket,
            prefix=prefix,
            duration_seconds=ttl,
        )
```

Add `from oss.src.utils.env import env` to the imports. Delete
`_CREDENTIALS_TTL_SECONDS` (both sign routes reach this method with the default, so
no other caller changes).

### `hosting/docker-compose/oss/docker-compose.dev.yml`

The knob has to reach the container that signs. The dev `api` service declares only
`DOCKER_NETWORK_MODE` under `environment:` and otherwise reads `env_file`
(docker-compose.dev.yml:119-122), so a shell `export` before `run.sh` never arrives.
Mirror the store variables' pattern (dev uses map form, the gh file uses list form,
compare docker-compose.gh.yml:57-62):

```yaml
        environment:
            DOCKER_NETWORK_MODE: ${DOCKER_NETWORK_MODE:-bridge}
            AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS: ${AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS:-}
```

Add the same line to the `api` service of `docker-compose.gh.yml` (list form) so
self-hosted operators can set it too.

The QA below also lowers the runner's turn budget, and the `runner` service takes no
`env_file` at all (docker-compose.dev.yml:380-408). Add the passthrough there as
well:

```yaml
            AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS: ${AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS:-}
```

Both variables are optional. An empty value leaves the code default in place.

## Change 2: make the requested duration real on SeaweedFS (API)

### `api/oss/src/core/store/storage.py`

Current `_sign_web_identity` body (storage.py:232-241):

```python
        body = urlencode(
            {
                "Action": "AssumeRoleWithWebIdentity",
                "Version": "2011-06-15",
                "RoleArn": webidentity.role_arn(),
                "RoleSessionName": webidentity.STORE_SUBJECT,
                "WebIdentityToken": webidentity.mint_web_identity_token(),
                "DurationSeconds": str(duration_seconds),
                "Policy": scope_policy,
            }
        )
```

Two problems: the token's fixed 15-minute lifetime caps the session (research.md
section 2), and a sub-900 `DurationSeconds` is a hard SeaweedFS request error rather
than a clamp. Fix both with two private, unit-testable helpers and a token cap:

```python
# SeaweedFS caps every session at 12h (`maxSessionLength`), so no web-identity token
# needs to outlive the longest session it could mint.
_SEAWEEDFS_MAX_SESSION_SECONDS = 43200


# SeaweedFS validates DurationSeconds in [900, 43200] when present; the EFFECTIVE
# lifetime is min(DurationSeconds, web-identity token expiry, maxSessionLength).
# Minting the token with the requested lifetime makes the request honest, and lets
# a sub-900 TTL (QA) take effect through the token-expiry cap, which has no floor.
def _seaweedfs_duration_seconds(duration_seconds: int) -> int:
    return min(max(duration_seconds, 900), _SEAWEEDFS_MAX_SESSION_SECONDS)


# AWS GetFederationToken accepts DurationSeconds in [900, 129600].
def _federation_duration_seconds(duration_seconds: int) -> int:
    return min(max(duration_seconds, 900), 129600)
```

```python
                "WebIdentityToken": webidentity.mint_web_identity_token(
                    ttl_seconds=min(duration_seconds, _SEAWEEDFS_MAX_SESSION_SECONDS)
                ),
                "DurationSeconds": str(_seaweedfs_duration_seconds(duration_seconds)),
```

`mint_web_identity_token` already takes a keyword-only `ttl_seconds`
(webidentity.py:104); no change there. The 15-minute constant
(`_TOKEN_TTL_SECONDS`, webidentity.py:35) remains the default for any other caller.

In `_sign_federation_token`, replace the bare floor (storage.py:278):

```python
                "DurationSeconds": str(max(duration_seconds, 900)),
```

with:

```python
                "DurationSeconds": str(_federation_duration_seconds(duration_seconds)),
```

Behavior notes, both modes:

- SeaweedFS, default TTL 3600: token lives 3600s, `DurationSeconds` is 3600, effective
  lifetime rises from 900s to the intended 3600s. The store-reported `Expiration`
  stays authoritative and flows to the runner unchanged.
- SeaweedFS, QA TTL 120: token lives 120s, `DurationSeconds` is 900 (clamped to pass
  validation), effective lifetime 120s via the token-expiry cap.
- AWS: the token change is inert (no web-identity path); TTL passes through with
  AWS's own [900, 129600] bounds. Sub-900 QA values silently become 900, which the
  QA plan accounts for.

## Change 3: fail closed on a missing expiry (API)

`_parse_sts_credentials` (storage.py:24-52) turns a missing or unparsable
`Expiration` into `None`, the service passes that through as `expires_at`
(service.py:639), and the runner reads a missing expiry as "never expires"
(research.md section 1). One malformed STS response would therefore disable the
entire safety mechanism silently, for the lifetime of the pooled environment.

Both branches of `sign_temp_credentials` end in this parser and nothing else
produces mount credentials, so raising here is exactly "the STS paths fail closed"
(research.md section 1 records the check). Replace the swallow:

```python
    raw_exp = _text("Expiration")
    if not raw_exp:
        raise MountStorageUnavailable("STS response carried no credential expiry.")
    try:
        expiration = datetime.fromisoformat(raw_exp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise MountStorageUnavailable(
            "STS response carried an unparsable credential expiry."
        ) from exc
```

A refused sign is not a failed turn. The runner already treats a missing mount as a
degraded, mount-less run (`mount degraded kind=... cause=sign_returned_no_mount`,
environment-setup.ts:118-122), which is the same outcome as any other sign failure.

## Change 4: track the installed credentials and rebuild before they die (runner)

### The installed lease

The pooled environment must answer one question honestly: "when do the credentials
that my running geesefs daemons actually hold expire?" Nothing tracks that today.
The credential epoch is filled from the credentials signed for the current dispatch
(`computeCredentialEpoch(request, signed?.expiresAt)`, server.ts:382), and those
credentials never reach the daemons on a warm turn.

Record the answer where it is known: at the moment a mount succeeds. Add to
`SessionEnvironment` (`services/runner/src/engines/sandbox_agent/runtime-contracts.ts:179`,
initialized alongside `mountedCwd` in environment-setup.ts:328-338):

```ts
  /**
   * Expiry (epoch millis) of the credentials actually installed in each running geesefs
   * daemon, recorded at successful mount time. Per mount, because a remount replaces one
   * mount's credentials and must not inherit the other's. The environment's lease is the
   * minimum over the entries; see `installedMountLease`.
   */
  installedMountExpiries: { cwd?: number; agent?: number };
```

The session cwd and agent mounts go through four call sites, and each stamps its own
entry from the credentials it just used:

- `mountLocalDurableCwd` (environment.ts:427) and `mountLocalAgentCwd`
  (environment.ts:448), used both by the initial acquire (environment.ts:596,
  environment.ts:599) and by the ENOTCONN remount helpers
  (`reSignAndRemountLocalCwd`, environment.ts:511; `reSignAndRemountLocalAgentMount`,
  environment.ts:479), which re-sign first and mount second. Stamping inside the
  mount helpers therefore covers the remount path for free.
- The two remote mounts, environment.ts:744 (durable cwd) and environment.ts:800
  (agent mount).

This also covers the acquire-time sign fallback: when the dispatch's up-front sign
threw, `prepareEnvironmentSetup` signs its own credentials
(environment-setup.ts:105-114) and the mount helper records whatever was actually
used, not what the dispatch pre-signed.

The lease itself is a pure helper next to the epoch code
(`services/runner/src/engines/sandbox_agent/session-identity.ts`):

```ts
/** The environment's credential lease: the earliest expiry among its installed mounts. */
export function installedMountLease(expiries: {
  cwd?: number;
  agent?: number;
}): number | undefined {
  const values = [expiries.cwd, expiries.agent].filter(
    (v): v is number => v !== undefined,
  );
  return values.length ? Math.min(...values) : undefined;
}
```

### Park and repark from the lease, never from the dispatch

Both park paths in `services/runner/src/server.ts` read the environment instead of
the incoming epoch. `parkFreshOrDestroy` (server.ts:460-470) currently parks with
`credentialEpoch: incomingEpoch`. After a cold acquire the incoming credentials are
usually the mounted ones, but not always (the acquire may have re-signed), so it
takes the lease too:

```ts
      credentialEpoch: {
        secretsHash: incomingEpoch.secretsHash,
        mountExpiresAtMs: installedMountLease(env.installedMountExpiries),
      },
```

`reparkOrEvict` (server.ts:497-506) is the drift defect. It must carry the installed
lease forward, and on the approval-resume path it must also keep the live
environment's secrets hash: that path deliberately ignores the resume request's
re-minted credentials (server.ts:650-680), so adopting the incoming hash would
re-label an environment running old secrets as if it ran the new ones.

```ts
  const reparkOrEvict = async (
    live: LiveSession<SessionEnvironment>,
    result: AgentRunResult,
    opts?: { keepSecretsHash?: boolean },
  ): Promise<void> => {
    const env = live.environment;
    env.clearTurn();
    const update = {
      configFingerprint: cfgFp,
      historyFingerprint: nextHistoryFp(env),
      credentialEpoch: {
        // The resume path never re-baked secrets into this environment, so the parked
        // hash still describes what it runs.
        secretsHash: opts?.keepSecretsHash
          ? live.credentialEpoch.secretsHash
          : incomingEpoch.secretsHash,
        // The environment runs on the credentials installed in its daemons, not on the
        // ones this dispatch signed to compute the pool key.
        mountExpiresAtMs: installedMountLease(env.installedMountExpiries),
      },
    };
```

The continuation path keeps calling `reparkOrEvict(live, result)` (server.ts:638);
the approval-resume path calls `reparkOrEvict(live, result, { keepSecretsHash: true })`
(server.ts:749).

### Lease sufficiency is a separate question from identity

A turn dispatched one minute before expiry would still die mid-turn, so reuse needs
credentials valid through the end of the turn, not merely valid now. That is a
different question from "is this the same environment the request expects", and it
gets its own check rather than a future timestamp threaded through the identity
comparison. `credentialEpochMismatch` (session-identity.ts:369) keeps its current
meaning: secrets rotated, or credentials already dead. Next to it:

```ts
/**
 * A fixed allowance for clock differences between the API, the store, and the runner, plus
 * the seconds a cold rebuild spends mounting before the turn starts. Not operator-tunable:
 * it protects an invariant, and a third time knob would only invite mis-setting it.
 */
export const MOUNT_LEASE_SKEW_MS = 60_000;

/**
 * Whether the parked mount credentials would expire before `requiredValidThroughMs`, i.e. the
 * lease cannot cover a full worst-case turn. Distinct from `mountCredentialsExpired`, which
 * asks only whether the lease is already dead.
 */
export function mountCredentialsExpireBy(
  epoch: CredentialEpoch,
  requiredValidThroughMs: number,
): boolean {
  return (
    epoch.mountExpiresAtMs !== undefined &&
    epoch.mountExpiresAtMs <= requiredValidThroughMs
  );
}
```

The dispatch resolves the run limits once and derives the window (server.ts, next to
`incomingEpoch` at server.ts:382). `resolveRunLimits` is imported directly from
`./engines/sandbox_agent/run-limits.ts`, as server.ts already imports other engine
internals:

```ts
  // Resolved once per dispatch: the longest a turn started now could still be running.
  const requiredValidThroughMs =
    Date.now() + resolveRunLimits().totalMs + MOUNT_LEASE_SKEW_MS;
```

The idle-reuse branch (server.ts:569-577) gains the lease check after the identity
check, with its own reason string, because credentials that are still valid at
eviction time are expiring, not expired:

```ts
    const credMismatch = credentialEpochMismatch(
      existing.credentialEpoch,
      incomingEpoch,
    );
    let mismatch: string | undefined;
    if (cfgFp !== existing.configFingerprint) mismatch = "config";
    else if (priorFp !== existing.historyFingerprint) mismatch = "history";
    else if (credMismatch) mismatch = credMismatch;
    else if (
      mountCredentialsExpireBy(existing.credentialEpoch, requiredValidThroughMs)
    )
      mismatch = "credentials-expiring";
    else if (!tailIsFreshUserMessage(request)) mismatch = "tail";
```

The approval-resume branch (server.ts:678) keeps its hard-expiry check and gains the
same lease check:

```ts
    } else if (mountCredentialsExpired(existing.credentialEpoch)) {
      mismatch = "credentials-expired";
    } else if (
      mountCredentialsExpireBy(existing.credentialEpoch, requiredValidThroughMs)
    ) {
      mismatch = "credentials-expiring";
    }
```

The skew allowance applies at both moments that matter. At dispatch it keeps a turn
from starting on a lease it could outlive. After a cold rebuild it is respected by
construction, because the lease is recorded after the mount succeeds, so the mount
and provisioning time is already spent when the clock starts.

### A short lease warns, it never fails the turn

When the configured TTL is smaller than the turn budget plus skew, even a freshly
mounted environment cannot satisfy `requiredValidThroughMs`, and every dispatch
evicts to cold. That state is correct (fresh credentials every turn, no EACCES) and
it is exactly what a QA-lowered TTL asks for, so it must not be an error. A hard
failure would turn one mis-set number into a full outage, while proceeding is no
worse than today's behavior. So the runner logs once per acquisition, naming both
knobs and both values, and runs the turn:

```ts
    // Once per acquisition: the lease cannot cover a worst-case turn even when brand new.
    klog(
      `lease-short key=${key} leaseMs=${leaseMs} required=${requiredMs} ` +
        `(AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS on the API vs ` +
        `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS=${totalMs}ms + skew ${MOUNT_LEASE_SKEW_MS}ms); ` +
        `running anyway, every dispatch will rebuild cold`,
    );
```

### What this yields per failure mode

- Active conversation crossing expiry (the observed outages): the first dispatch
  inside the required-validity window logs `mismatch (credentials-expiring)`,
  evicts, rebuilds cold with fresh mounts. Sub-second blip instead of a
  multi-minute window.
- Turn longer than the remaining lease: cannot happen while the TTL exceeds the turn
  budget plus skew, because the lease check already forced a cold rebuild.
- Hard daemon death: unchanged, the existing ENOTCONN probe and watcher handle it,
  and a successful remount now updates the lease it re-signed.
- Sessionless runs: mount at acquire with fresh full-TTL credentials, turn bounded
  by the 45-minute deadline. Covered.
- Daytona remote: identical logic; the lease and the window are backend-neutral.

### Rebuild rate, honestly

With the default TTL of 3600s, the default turn budget of 2700s (45 minutes), and
60s of skew, the warm-reuse window is about 840 seconds. An active conversation
therefore rebuilds cold roughly every 14 minutes, not once an hour. That is the
price of guaranteeing that no turn starts on credentials it could outlive, and it is
no more churn than the 900-second lifetime produces today. A cold rebuild is
cheap locally. On Daytona it is not: a credential eviction tears the environment
down with reason `compatibility-mismatch`, which maps to `delete`
(`teardownDisposition`, teardown.ts:23-37), so the remote sandbox is destroyed and
the next turn pays a full create.

The default stays 3600. Measure the rebuild rate in production first. If the churn
hurts, the answer is in-place refresh through a container-credentials endpoint
(research.md section 3, mechanism 4), not a 12-hour TTL: a longer TTL only moves the
boundary, while every hour of extra lifetime is an hour a leaked credential stays
usable.

## Tests

### API unit tests (pytest)

Extend `api/oss/tests/pytest/unit/test_mounts_injection.py`, which already has the
`_CapturingPost` seam that stands in for `aiohttp.ClientSession` and captures the one
STS POST (test_mounts_injection.py:312-357):

- SeaweedFS request, TTL 3600: captured body has `DurationSeconds=3600`, and the
  captured `WebIdentityToken` decodes (PyJWT, `verify_signature: False`) to
  `exp - iat == 3600`.
- SeaweedFS request, TTL 120: body has `DurationSeconds=900` (the floor), token
  `exp - iat == 120` (the sub-900 lever).
- SeaweedFS request, TTL 90000: body has `DurationSeconds=43200` and the token is
  capped at 43200 as well.
- AWS `GetFederationToken`: TTL 60 becomes 900, 3600 passes through, 200000 becomes
  129600.
- Fail closed: an STS XML body with no `Expiration`, and one with
  `<Expiration>not-a-date</Expiration>`, each raise `MountStorageUnavailable` from
  `sign_temp_credentials`. The existing fixture XML carries a valid `Expiration`
  (test_mounts_injection.py:348-357), so the current cases keep passing.
- `MountsConfig.credentials_ttl_seconds`: default 3600; env override parses; an
  empty string falls back to 3600 (construct `MountsConfig` under
  `monkeypatch.setenv`).

Run: `cd api && uv run --no-sync pytest oss/tests/pytest/unit/test_mounts_injection.py`.

### Runner unit tests (vitest)

Extend `services/runner/tests/unit/session-keepalive-dispatch.test.ts` (fake
`KeepaliveEngine` plus real pool, the existing seam). No wall-clock waits: fake the
date only, so the pool's own timers and the test's `flush()` keep working.

```ts
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(T0);
// ... vi.setSystemTime(T0 + delta) between dispatches
vi.useRealTimers();
```

The fake engine gains a per-call sequence of signed expiries, and its
`acquireEnvironment` stamps `installedMountExpiries` on the fake environment from the
credentials it "mounted", exactly as the real mount helpers do. Cases:

- **Repark keeps the installed lease**: turn 1 acquires with an expiry at T0+10min;
  turn 2 runs warm while the dispatch signs a far-future expiry; advancing the clock
  so the installed lease falls inside the required-validity window forces turn 3
  cold (acquire called again). Without the fix turn 3 continues warm.
- **Approval resume preserves both**: an `awaiting_approval` repark keeps the live
  environment's secrets hash (a resume request carrying different secrets does not
  relabel the parked environment) and its installed lease.
- **The lease is the minimum**: an environment whose session-cwd mount expires
  before its agent mount is evicted on the earlier of the two.
- **Boundary cases**: a lease exactly at `now + totalMs + MOUNT_LEASE_SKEW_MS`
  evicts (`credentials-expiring`); one millisecond beyond it continues warm; one
  already in the past still reports `credentials-expired`. Drive `totalMs` through
  `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS`, restored after each case.

Run: `cd services/runner && pnpm test && pnpm run typecheck`.

## Live QA (local OSS stack, SeaweedFS)

Sequenced so the broken behavior is demonstrated with the same knobs that ship. The
numbers are chosen so a whole turn plus the 60-second skew still fits inside one
lease, which keeps the reproduction from depending on turn timing: TTL 120 seconds,
runner turn budget 30 seconds, required validity 90 seconds.

1. **Deploy the API half only** (TTL env, token fix, fail-closed parsing), runner
   unpatched. Add `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS=120` to
   `hosting/docker-compose/oss/.env.oss.dev` (or export it, now that the compose
   passthrough from Change 1 exists), then
   `load-env hosting/docker-compose/oss/.env.oss.dev` and
   `bash ./hosting/docker-compose/run.sh --oss --dev`. The dev API hot-reloads code
   but not env, so use `--recreate api` to pick the variable up.
2. **Reproduce the window**: start an agent session that touches its durable mount
   every turn (prompt the agent to run `date >> agent-files/log.txt && cat
   agent-files/log.txt`). Send turns every ~20 seconds. Within two turns past the
   120-second mark the agent reports "Permission denied" on `agent-files/`, while
   runner logs show `hit-continue` (warm reuse of the dead mount). This is the bug,
   on demand.
3. **Deploy the runner half**, same TTL, plus
   `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS=30000`. A lease now has to stay valid for 90
   seconds (30s budget plus 60s skew), so turns dispatched in the first ~30 seconds
   after a mount continue warm, and the next one logs
   `mismatch (credentials-expiring) ... evict + cold`. That turn succeeds, and the
   file written before the rebuild is still there (durability across the cold
   remount). No denial window at any cadence.
4. **Confirm the short-lease warning**: drop the TTL to 60 with the same 30-second
   budget. Every dispatch rebuilds cold, each acquisition logs `lease-short` naming
   both knobs, and turns still succeed.
5. **Restore defaults** (unset both, recreate), then rerun the original long
   scenario: an active conversation with periodic file writes for more than 20
   minutes shows no denial window (previously it broke at 15 minutes) and rebuilds
   cold about every 14 minutes.
6. **AWS mode**: not exercised in this QA. The AWS path is covered by the clamp unit
   tests and the analysis in research.md section 4; on real AWS the TTL floor is 900,
   so the fast reproduction is SeaweedFS-only. Optional follow-up: one staging pass
   with TTL 900 and a conversation longer than 15 minutes.

Per the QA-recording rule, capture step 2 and step 3 as an MP4 for the PR.

## Rollout notes

- API and runner halves are independently safe. API-only: the effective SeaweedFS
  lifetime rises from 900s to 3600s, windows become rarer but the drift remains.
  Runner-only: the real lifetime stays 900s, which is below the turn budget plus
  skew, so every dispatch rebuilds cold and logs `lease-short`. That is correct and
  denial-free, just churny. Ship both together.
- No wire change: `expires_at` already flows.
- Operators: keep `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS` above
  `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS` (as seconds) plus 60 seconds of skew, or
  every dispatch rebuilds cold and the runner says so in its log. SeaweedFS also
  caps the TTL at its configured `maxSessionLength` (12h in our compose file);
  values above 43200 are clamped in code before the request.
- Real AWS deployments must sign with long-term IAM user credentials.
  `GetFederationToken` rejects an assumed-role session, and root credentials cap the
  duration at 3600 seconds regardless of the TTL (research.md section 4).
- EE and production compose files need the same TTL passthrough as the OSS files
  before the knob is usable there.
- The web-identity JWT now lives as long as the TTL, capped at 12h (research.md
  section 4 covers the widened-replay-window tradeoff; the token never leaves the
  API-to-store hop).

## Open questions for review

1. **Remote transcript mounts**: on Daytona, the harness session and transcript
   directories are separate mounts, each signed at acquire with its own credentials
   (`mountHarnessSessionDirs`, environment.ts:766). They are signed seconds apart
   from the durable cwd and agent mounts at the same TTL, so the lease already
   bounds them within noise. Should they still get their own lease entries, or is
   the current minimum-of-two the right stopping point?
