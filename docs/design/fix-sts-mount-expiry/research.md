# Research: how mount credentials flow, expire, and can be refreshed

All paths are relative to the repo root. Line numbers reference the current tree.
External sources: geesefs v0.43.0 (the pinned binary, see
`services/runner/docker/Dockerfile.dev:24`, `Dockerfile.gh:34`, and
`services/runner/images/sandbox/daytona/build_snapshot.py:59`) and SeaweedFS 4.37
(the bundled store, see `hosting/docker-compose/oss/docker-compose.dev.yml:521`).

## 1. The credential path, end to end

### Signing (API side)

- The runner calls `POST /sessions/mounts/sign` for the session scratch mount
  (`api/oss/src/apis/fastapi/sessions/router.py:920`) and
  `POST /mounts/agents/sign` for the durable agent mount
  (`api/oss/src/apis/fastapi/mounts/router.py:151`). Both land in
  `MountsService.sign_mount_credentials`
  (`api/oss/src/core/mounts/service.py:606`), which requests a lifetime of
  `_CREDENTIALS_TTL_SECONDS = 3600` (`service.py:59`).
- `ObjectStore.sign_temp_credentials` (`api/oss/src/core/store/storage.py:188`)
  builds one inline session policy scoped to the mount prefix, then branches on the
  backend:
  - **SeaweedFS** (selected when `AGENTA_STORE_SIGNING_KEY` is set,
    `storage.py:93-97`): `_sign_web_identity` (`storage.py:226`) posts an
    unauthenticated `AssumeRoleWithWebIdentity` carrying a self-minted RS256 JWT
    (`webidentity.mint_web_identity_token`, `storage.py:238`) and
    `DurationSeconds=str(duration_seconds)` (`storage.py:239`).
  - **Remote S3-compatible store (AWS, MinIO)**: `_sign_federation_token`
    (`storage.py:258`) posts a SigV4-signed `GetFederationToken` with
    `DurationSeconds=str(max(duration_seconds, 900))` (`storage.py:278`).
- The web-identity JWT is minted with a fixed 15-minute lifetime:
  `_TOKEN_TTL_SECONDS = 15 * 60` (`api/oss/src/core/store/webidentity.py:35`),
  used by `mint_web_identity_token` (`webidentity.py:104`).
- The STS XML response is parsed into a miniopy `Credentials` including
  `Expiration` (`storage.py:24-52`), and the service returns
  `expires_at=getattr(creds, "_expiration", None)`
  (`service.py:639`). miniopy-async stores the constructor's `expiration` as
  `_expiration` (site-packages `miniopy_async/credentials/credentials.py:54`), so
  the true store-side expiry reaches the wire as an ISO datetime
  (`api/oss/src/core/mounts/dtos.py:132`).
- **The expiry is optional the whole way down.** `_parse_sts_credentials` turns a
  missing or unparsable `Expiration` into `None` (`storage.py:39-45`), the DTO field
  is `Optional[datetime]` (`dtos.py:132`), and the runner reads a missing expiry as
  "never expires": `computeCredentialEpoch` leaves `mountExpiresAtMs` undefined
  (`session-identity.ts:333-347`) and both expiry checks return false on undefined
  (`session-identity.ts:356-367`). One malformed STS response therefore disables the
  whole reuse bound silently, for as long as that environment stays parked.
  Fail-closing is safe on both backends: `sign_temp_credentials` is the only producer
  of mount credentials, and both of its branches are STS calls that end in this one
  parser (`storage.py:222-224`). No static or master-key path hands credentials to a
  mount; the master keys are used only to sign the `GetFederationToken` request and
  for the API's own file operations (`_client`, `storage.py:107`). So there is no
  legitimate no-expiry case to preserve.

### Mounting (runner side)

- `signSessionMountCredentials` (`services/runner/src/engines/sandbox_agent/mount.ts:68`)
  and `signAgentMountCredentials`
  (`services/runner/src/engines/sandbox_agent/agent-mount.ts:39`) fetch the sign
  endpoints and surface `expiresAt` on `MountCredentials` (`mount.ts:36`).
- Locally, `mountStorage` (`mount.ts:299`) spawns
  `geesefs --no-detect --fsync-on-close -f -o allow_other <bucket>:<prefix> <cwd>`
  (`geesefsArgs`, `mount.ts:214`) with the credentials as static child environment
  variables `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
  (`credEnv`, `mount.ts:237`). Remotely (Daytona), `mountStorageRemote`
  (`mount.ts:641`) runs the same argv inside the sandbox.
- Mounts are established once, during environment acquisition:
  `environment.ts:596` and `environment.ts:599` (local session cwd + agent mount,
  before the harness daemon spawns), `environment.ts:744` and `environment.ts:800`
  (remote).
- **Where the installed credentials come from.** The local mounts go through two
  helpers, `mountLocalDurableCwd` (`environment.ts:427`) and `mountLocalAgentCwd`
  (`environment.ts:448`), which read `environment.mountCreds` /
  `environment.agentMountCreds` and pass them to geesefs. Those two fields are the
  only description of what a daemon holds, and they are set in three places: the
  acquire-time sign in `prepareEnvironmentSetup` (`environment-setup.ts:105-114`,
  which signs for itself when the dispatch's up-front sign threw and passed
  `undefined`), the agent-mount sign right after it (`environment-setup.ts:127-134`),
  and the ENOTCONN re-sign helpers, which overwrite one field and remount through the
  same helper (`environment.ts:479` and `environment.ts:511`). On Daytona the two
  remote mounts read the same fields. Anything that records "what is installed" has
  to hook these mount call sites, not the sign call sites: a sign whose credentials
  never reach a daemon changes nothing about the running mount.
- Daytona sandboxes additionally mount the harness session and transcript directories
  (`mountHarnessSessionDirs`, `environment.ts:766`), each signing its own credentials
  per directory (`mount.ts:735`) at the same TTL, seconds apart from the other two.

### Liveness probing and hard-death recovery (already present)

- `isMounted` (`mount.ts:255`) runs `mountpoint -q` then a real `ls -A`. Any `ls`
  failure, ENOTCONN or otherwise, counts as not-mounted, so `mountStorage`
  force-detaches and remounts. This probe runs only inside `mountStorage`, i.e.
  only during acquisition.
- Mid-turn, `remountLocalCwdAfterRuntimeEnotconn` (`environment.ts:540`) watches
  every ACP event for ENOTCONN markers
  (`containsTransportEndpointDisconnected`,
  `services/runner/src/engines/sandbox_agent/runtime-policy.ts:136`) and re-signs +
  remounts both local mounts, at most once per environment
  (`LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT = 1`, `environment.ts:141`).
- Nothing watches for EACCES. Expired credentials leave the daemon alive, so
  neither `mountpoint -q` nor the ENOTCONN watcher fires.

### Turn boundaries and the session pool (runner side)

- Every dispatch with a session id signs fresh session-cwd credentials up front
  (`engine.resolveKeepaliveMount`, called at
  `services/runner/src/server.ts:363`; implementation
  `environment.ts:225`). The result feeds two things: the pool key, and the
  incoming credential epoch
  (`computeCredentialEpoch(request, signed?.expiresAt)`, `server.ts:382`).
- The credential epoch
  (`services/runner/src/engines/sandbox_agent/session-identity.ts:326`) exists to
  bound how long a parked environment may reuse its baked credentials:
  `mountExpiresAtMs` holds the mount credential expiry, and
  `credentialEpochMismatch` (`session-identity.ts:369`) evicts a parked
  environment to a cold rebuild once that expiry passes.
- **The drift defect**: after a warm turn, `reparkOrEvict` re-parks the same
  environment with `credentialEpoch: incomingEpoch` (`server.ts:506`). The
  incoming epoch carries the expiry of the credentials signed for THIS dispatch,
  but those credentials were only used to compute the pool key; the running
  geesefs daemons still hold the credentials from acquisition, and the warm path
  never remounts (`hit-continue` goes straight to `runTurn`, `server.ts:587-600`).
  So every warm turn pushes `mountExpiresAtMs` forward while the real mount
  credentials age in place. An active conversation therefore never trips
  `credentials-expired` and keeps running turns against a mount whose credentials
  died at acquisition-time + TTL. A fresh park after a cold acquire
  (`parkFreshOrDestroy`, `server.ts:470`) is usually right, because the incoming
  credentials are normally the ones just mounted. It is not guaranteed: when the
  up-front sign threw, the acquire signed its own credentials
  (`environment-setup.ts:105-114`) and the incoming epoch describes a sign that never
  reached a daemon.
- Idle reaping is aggressive (`DEFAULT_TTL_MS = 60_000` local,
  `DEFAULT_DAYTONA_TTL_MS = 120_000`, `session-identity.ts:33,40`), so quiet
  sessions get torn down and remounted fresh anyway. Only conversations with
  turns arriving faster than the idle TTL keep one environment alive long enough
  to cross the credential expiry. That matches the field observation: active
  sessions on the durable agent volume were hit hardest.
- Evicting for a credential reason is not free on Daytona. The dispatch evicts with
  teardown reason `compatibility-mismatch` (`server.ts:583`, `server.ts:689`), and
  `teardownDisposition` maps that to `delete`, not `stop`
  (`services/runner/src/engines/sandbox_agent/teardown.ts:23-37`). The remote sandbox
  is destroyed and the next turn pays a full create; only clean, idle, and capacity
  teardowns park the sandbox in a stopped state.
- Turn length is bounded: `DEFAULT_TOTAL_DEADLINE_MS = 45 * 60_000`
  (`services/runner/src/engines/sandbox_agent/run-limits.ts:37`), overridable via
  `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS`.

## 2. What actually expires, and when: the 15-minute cap

The issue reports denial starting about 15 minutes after mount, yet the service
requests 3600 seconds. Both numbers are real. SeaweedFS 4.37 caps every STS session
at the expiry of the web-identity token presented to it
(`weed/iam/sts/sts_service.go`, `calculateSessionDuration`):

```go
// If the source token has an expiration, cap the session duration to not exceed it
if tokenExpiration != nil && !tokenExpiration.IsZero() {
    timeUntilTokenExpiry := time.Until(*tokenExpiration)
    ...
    } else if timeUntilTokenExpiry < duration {
        duration = timeUntilTokenExpiry
    }
}
```

Our JWT lives 15 minutes (`webidentity.py:35`), so every SeaweedFS mount credential
dies after at most 900 seconds regardless of `DurationSeconds=3600`. The STS
response's `Expiration` reflects the capped value (the response credentials are
generated from the capped `expiresAt`), so the runner's epoch data was always
truthful; only the repark drift (section 1) discarded it.

Timeline of one observed outage, with the pieces above:

1. Turn 1 (cold): sign, mount, park. Real expiry: T+15 min. Epoch records T+15 min.
2. Turns 2..N (warm, active conversation): each dispatch signs fresh credentials,
   overwrites the epoch with a new T'+15 min, never remounts.
3. T+15 min: the store starts answering 403 to the daemons; geesefs maps 403 to
   EACCES (`core/backend_s3.go`, `case 403: err = syscall.EACCES`). Every file
   operation in the mount fails "Permission denied". `mountpoint -q` still passes.
4. The outage persists until a turn fails hard enough to evict (history mismatch,
   thrown continuation, idle reap), up to the observed 14 minutes.

## 3. Mechanism space: getting fresh credentials into geesefs v0.43.0

geesefs v0.43.0 vendors a fork of aws-sdk-go v1 under `s3ext/`. Credential
resolution (`core/cfg/conf_s3.go:107-181`): explicit `AccessKey`/`SecretKey` flags
become static credentials; otherwise the SDK session default chain runs with
`SharedConfigState: session.SharedConfigEnable` (`conf_s3.go:157-161`), which
resolves, in order: static env vars, shared config/credentials files (including
`credential_process`), then remote providers (container endpoint, IMDS). Every
option, verified against the pinned source:

| # | Mechanism | Supported in v0.43.0? | Refreshes after expiry? | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Static `AWS_*` env vars (current approach) | Yes | No. Static provider never expires. | Status quo; credentials die at TTL. |
| 2 | Shared credentials file the runner rewrites (`~/.aws/credentials`, `--shared-config`) | Yes | **No.** `SharedCredentialsProvider.IsExpired()` returns `!p.retrieved` (`s3ext/aws/credentials/shared_credentials_provider.go:71-73`): the file is read once and never re-read. geesefs never calls `Expire()` on 403 either (`core/backend_s3.go` maps 403 to EACCES and treats it as non-retryable). | Ruled out. The "just rewrite a file" hope does not hold for this SDK generation. |
| 3 | `credential_process` in a shared config profile | Yes (`s3ext/aws/session/credentials.go:107-109` wires `processcreds`) | **Yes.** `processcreds` honors the process output's `Expiration` and re-runs the process when it passes (`s3ext/aws/credentials/processcreds/provider.go:109-132`). | Viable locally: the runner would install a config file plus a helper that re-calls the sign endpoint. Requires dropping the `AWS_*` env (env wins the chain) and giving the helper long-lived API auth. On Daytona the helper would put API credentials inside the agent-reachable sandbox. Real machinery; deferred. |
| 4 | Container credentials endpoint (`AWS_CONTAINER_CREDENTIALS_FULL_URI`) | Yes (`s3ext/aws/defaults/defaults.go:117-127`, `endpointcreds`) | **Yes.** `endpointcreds` sets expiry from the JSON response and re-fetches (`s3ext/aws/credentials/endpointcreds/provider.go:107-132`). | The strongest in-place-refresh option if ever needed: the runner serves a loopback JSON endpoint, geesefs polls it. Locally clean; remotely it needs a tunnel plus auth on the endpoint. Deferred for the same simplicity reason as #3. |
| 5 | IMDS emulation (`169.254.169.254`, `ec2rolecreds`) | Yes (default chain) | Yes | Requires owning the link-local address inside every container/sandbox. Impractical; rejected. |
| 6 | geesefs `--iam` / `--iam-url` built-in refresh | Yes, and it does refresh on a timer (`core/backend_s3.go:119-208`) | Yes, but | It replaces SigV4 signing entirely with a Yandex-style bearer header (`setIAMSigner` clears the Sign handler list and sets `X-YaCloud-SubjectToken`, `backend_s3.go:210-219`). SeaweedFS and AWS require SigV4. Rejected. |
| 7 | geesefs `--role-arn` (SDK `stscreds.AssumeRoleProvider`, auto-refreshing) | Yes (`conf_s3.go:169-177`) | Yes | Needs long-lived base credentials on the mount host to assume with. That breaks the design invariant that the runner never holds bucket-wide keys (`mount.ts:5-7`). Rejected. |
| 8 | Remount with fresh credentials at turn boundaries (evict the pooled environment to cold) | N/A (runner-side) | Yes | Already the designed behavior of the credential epoch; it is broken because the epoch tracks per-dispatch signing instead of what the daemons were given. Between turns nothing holds the mount, so a rebuild is safe. **Chosen.** |

Conclusion: within geesefs v0.43.0 there is no zero-machinery way to refresh a
running daemon's SigV4 credentials. The two real refresh mechanisms (#3, #4) both
add a credential-serving surface, and the remote variant weakens the security
boundary. Boundary remounting (#8) already exists as designed behavior; the fix
repairs it by recording what each mount was actually given, and sizes the TTL so no
turn can outlive its credentials.

## 4. Self-hosted SeaweedFS versus real AWS S3

The fix must be safe in both deployment modes. They differ in every relevant
detail, so each is analyzed separately.

### Self-hosted OSS: SeaweedFS 4.37 with its built-in STS

- **STS verb**: `AssumeRoleWithWebIdentity`, authenticated by our RS256 JWT
  validated against the API's JWKS
  (`hosting/docker-compose/oss/docker-compose.dev.yml:540` configures the OIDC
  provider; `webidentity.py` mints the token).
- **DurationSeconds floor and ceiling**: when the request carries
  `DurationSeconds`, SeaweedFS validates `900 <= v <= 43200`
  (`weed/iam/sts/sts_service.go:839-841`, "DurationSeconds must be between 900 and
  43200 seconds"). Values outside the range are a hard request error, not a clamp.
- **Effective lifetime**: `min(DurationSeconds, web-identity token expiry,
  maxSessionLength)` (`calculateSessionDuration`, `sts_service.go:1021-1054`).
  `maxSessionLength` is 12h in our compose config (`docker-compose.dev.yml:540`).
  The web-identity-token cap has **no 900-second floor**: a JWT that expires in 60
  seconds yields 60-second credentials even when `DurationSeconds=900`. This is
  the QA lever for sub-900 lifetimes.
- **Expiry enforcement**: the session token is a stateless JWT whose `exp` is
  validated on every S3 request (`weed/iam/sts/session_claims.go:137`). An expired
  token gets 403; geesefs maps 403 to EACCES. Matches the field observation.
- **Fix safety**: minting the web-identity JWT with a lifetime matching the
  requested duration removes the silent cap, so the requested 3600s becomes real.
  The JWT never leaves the API-to-store network hop; lengthening it from 15
  minutes to the configured TTL widens the replay window of that internal token
  accordingly, which is why the token lifetime is also capped at 43200 seconds: no
  bearer token should outlive the longest session it can mint. The token only
  permits assuming the store role, and prefix
  isolation continues to rest on the inline session policy
  (`storage.py:209-212`), unchanged by this fix. Note the pre-existing sharp
  edge, also unchanged: anyone holding that JWT could assume the role without a
  session policy and reach the whole bucket, which is why it must stay inside the
  API trust boundary.

### Real AWS S3 with real AWS STS

- **STS verb**: `GetFederationToken`, SigV4-signed with the deployment's IAM user
  keys against `AGENTA_STORE_STS_ENDPOINT_URL` (`storage.py:258-281`,
  `api/oss/src/utils/env.py:1092`). No web-identity token exists on this path, so
  the JWT change is inert here.
- **Who may call it**: AWS accepts `GetFederationToken` only from the long-term
  access keys of an IAM user. An assumed-role session or any other temporary
  credential is rejected outright, and root-account keys, while accepted, cap every
  federation token at 3600 seconds no matter what `DurationSeconds` asks for. An AWS
  deployment must therefore provision a dedicated IAM user for the store and put its
  keys in `AGENTA_STORE_ACCESS_KEY` / `AGENTA_STORE_SECRET_KEY`. The [900, 129600]
  range below assumes that; under root keys the effective TTL ceiling is one hour.
- **DurationSeconds floor and ceiling**: AWS enforces 900 minimum and 129600 (36h)
  maximum for `GetFederationToken`. The code already clamps the floor
  (`max(duration_seconds, 900)`, `storage.py:278`). QA cannot get sub-900
  credentials from real AWS; the low-TTL reproduction is SeaweedFS-only.
- **Effective lifetime**: exactly `DurationSeconds`; the response `Expiration` is
  authoritative and flows to the runner the same way.
- **Expiry enforcement**: S3 rejects expired session tokens with 403
  `ExpiredToken`; geesefs maps it to EACCES identically.
- **Fix safety**: the API change reduces to "the TTL constant becomes an env var,
  clamped into [900, 129600]", plus refusing a response with no parsable
  `Expiration`, which AWS always sends. The runner changes (record the installed
  lease, require it to cover a full turn) key off the `expires_at` the STS response
  reported, not off any backend assumption, so they behave identically against AWS.
  No AWS-side configuration changes beyond the IAM user the store already needs.

### Why one fix covers both

The runner never inspects which backend signed its credentials. It receives
`expires_at`, mounts, and later decides reuse-versus-rebuild from that timestamp.
Both backends report a truthful `Expiration` and both enforce it with 403. The fix
therefore lives in backend-neutral places: make the requested TTL real, configurable,
and never silently absent at signing time, and make the runner honor the expiry of
the credentials it actually installed.

## 5. EACCES as a remount trigger: false-positive analysis

The issue proposes treating EACCES like ENOTCONN. Two distinct places could do
that, with very different risk:

- **The acquisition probe** (`isMounted`, `mount.ts:255`) already does. It treats
  ANY `ls -A` failure as not-mounted, EACCES included. False positives are not a
  realistic concern there: the session policy grants read, write, and scoped list
  on the entire mount prefix (`_scope_policy`, `storage.py:132`), so no path
  inside the mount can legitimately deny a root listing while the credentials are
  alive. A root-listing EACCES implies dead or invalid credentials, and remounting
  is the right response to both. One caveat: geesefs caches directory listings
  (default `--stat-cache-ttl` 30s, `core/cfg/flags.go:1075`), so an `ls` within
  the cache window can pass while writes fail. The probe alone therefore cannot
  reliably detect a soft death, which is another reason not to build the fix on
  probing.
- **The mid-turn event watcher** (`containsTransportEndpointDisconnected`,
  `runtime-policy.ts:136`) scans full ACP event payloads for marker strings.
  "ENOTCONN" is distinctive; "EACCES" and "Permission denied" are not. Agents
  legitimately produce them constantly (reading `/root`, failed `sudo`, quoting
  error messages). Each false trigger would burn the single-shot remount budget
  (`environment.ts:141`) and race a live harness against an unmount. Extending the
  watcher to EACCES is the false-positive-prone half of the proposal, and it is
  unnecessary once credentials outlive every turn. Deferred.

## 6. Test infrastructure

- **Runner**: vitest, `services/runner/tests/unit/*.test.ts`, run with `pnpm test`
  from `services/runner`. The keep-alive dispatch already has a fake-engine seam
  (`tests/unit/session-keepalive-dispatch.test.ts` injects a `KeepaliveEngine`
  into the real `runWithKeepalive` + `SessionPool`), which is exactly where the
  installed-lease and lease-window tests belong. The fake engine hands the dispatch
  its own `SessionEnvironment` stand-in, so a test can stamp installed mount
  expiries on it directly. Mount behavior tests live in
  `tests/unit/sandbox-agent-mount.test.ts` with injectable `runGeesefs` /
  `checkMounted` seams.
- **API**: pytest, `api/oss/tests/pytest/`. Unit tests for the mounts service
  exist at `unit/test_mounts_service.py`; acceptance tests for mounts at
  `acceptance/mounts/`. `ObjectStore` signing is already covered at
  `unit/test_mounts_injection.py:306-438`, whose `_CapturingPost`
  (`test_mounts_injection.py:312`) replaces `aiohttp.ClientSession` and captures the
  single STS POST body and headers. That is the seam for asserting `DurationSeconds`
  and the minted token, with no new mocking layer.
- Commands: `cd services/runner && pnpm test && pnpm run typecheck`;
  `cd api && py-run-tests` (or targeted `uv run --no-sync pytest`).

## 7. Prior art

- Draft PR #5247 ("agent mounts", design issue #5215) introduced the durable
  agent mount; `agent-mount.ts:3` references its plan document
  (`docs/design/agent-workflows/projects/agent-mounts/plan.md`), which lives on
  that branch, not on main.
- `docs/design/mount-file-viewer/` documents the mounts file-listing UI on top of
  the same service; no credential-lifetime logic.
- The ENOTCONN detection and single-shot remount machinery
  (`environment.ts:478-567`) is prior art for the hard-death half of this bug and
  stays untouched.
- The mounts service comment at `service.py:57-58` already states the failure
  mode ("geesefs holds the creds without refresh, so a turn outliving this hits
  ExpiredToken"); what it misses is that SeaweedFS capped the real lifetime to
  900s and that the pool's expiry bookkeeping drifts.
