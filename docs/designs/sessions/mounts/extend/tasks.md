# Extend mounts: tasks

Work in `vibes.worktrees/feat-extend-mounts` (branch `feat/extend-mounts`, off
`big-agents`). Read `specs.md` in this folder first. This is infra + config + wiring; the
mounts API domain code already exists and is correct.

## M1 — Config: add the bucket var

- `api/oss/src/utils/env.py`, `MountsConfig`: add
  `storage_bucket: str | None = os.getenv("AGENTA_MOUNTS_STORAGE_BUCKET")`. Keep `enabled` as-is
  (endpoint + creds).
- Verify: `ruff format` + `ruff check` in `api/`.

## M1b — Domain: slug-derived identity + mount_id-keyed storage

Implements the "Identity, slug, and storage key" section of `specs.md`. The caller no longer
supplies a bucket or prefix.

- `api/oss/src/core/mounts/`: define
  `_MOUNTS_NAMESPACE = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "mounts")` (module constant, mirror
  `static_catalog.py` style).
- Slug minting in `create_mount`:
  - session mount (`session_id` present): stored slug =
    `f"__ag__{uuid5(_MOUNTS_NAMESPACE, session_id)}__{name}"` (full dashed uuid5). The caller's
    `slug` field carries the short `name`.
  - non-session mount: caller's slug verbatim.
  - Reserved-slug guard: reject a caller slug starting with `__ag__` (HTTP 400), mirroring
    `_reject_static_slug`. Add a typed domain exception in `core/mounts/types.py` + translate at
    the router.
- Storage key: derive `<project_id>/<mount_id>/` wherever storage is touched (list/get/put/
  delete in `service.py`). Stamp `bucket` from `env.mounts.storage_bucket`. Remove
  `MountData.{bucket, prefix}` as caller inputs (drop from `MountCreate`/request models); keep
  `validate_file_path` on caller file paths under the prefix.
- Keep the `session_id` column + its partial index (used by the session-scoped query view).
- `uq_mounts_project_id_slug` is unchanged — uniqueness holds by construction. No migration to
  the constraint. (If `MountData` shape changes require a migration, edit the existing mounts
  migration in place — no backward compat needed.)
- Verify: `ruff format` + `ruff check`; mounts unit tests updated (slug minting, reserved-slug
  rejection, key derivation, session re-derivation determinism).

## M2 — SeaweedFS in the dev compose stacks (as built)

- `hosting/docker-compose/oss/docker-compose.dev.yml` AND
  `hosting/docker-compose/ee/docker-compose.dev.yml`: add a single `seaweedfs` service, this
  repo's block style (IMAGE/EXECUTION/STORAGE/NETWORK/LIFECYCLE banners, `agenta-network`), with
  `seaweed-data` in the `volumes:` section.
  - The entrypoint GENERATES `/etc/seaweedfs/s3.json` from the env credentials (single source of
    truth, no committed s3.json file), then `exec weed server -dir=/data -ip=seaweedfs -s3
    -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json`. Healthcheck
    `curl -sf http://localhost:9333/cluster/healthz`.
  - NO `seaweedfs-init` container: the bucket is created lazily on first write (Option A).
- API (and worker) services `depends_on: seaweedfs (service_healthy)`.
- Skippable dev defaults: every API-image service AND the seaweedfs service set the
  `AGENTA_MOUNTS_STORAGE_*` vars via compose `${VAR:-default}` (endpoint `http://seaweedfs:8333`,
  key `agenta-dev`, secret `agenta-dev-secret`, region `us-east-1`, bucket `agenta-mounts`), so
  mounts work with an empty env file and the API + seaweedfs always agree on the credentials.
- Do NOT add ngrok here (that is M9, the remote sandbox-injection step).

## M3 — Env example files (as built)

- All four examples got a `# Mounts (object storage)` block:
  - dev (`env.oss.dev.example`, `env.ee.dev.example`): the SeaweedFS dev values
    (`AGENTA_MOUNTS_STORAGE_*`), documented as the single source the seaweedfs identity reads.
  - gh/prod (`env.oss.gh.example`, `env.ee.gh.example`): commented placeholders, with a note that
    prod points at a real S3-compatible store (AWS S3 / R2 / MinIO) and an empty endpoint = AWS S3.
- The live `.env.*` files are user-local/gitignored; the compose `${VAR:-default}` fallbacks mean
  dev needs no entries at all.

## M4 — Dependencies (as built)

- Storage client swapped from `aioboto3` (heavy AWS SDK) to `miniopy-async` (lean S3-protocol
  client): `api/pyproject.toml` declares `miniopy-async>=1.21,<2`; `aioboto3`/`botocore` removed;
  lock updated. `core/mounts/storage.py` rewritten against the miniopy-async `Minio` client. No
  Dockerfile change.

## M5 — Prove it works

- Deploy dev: `load-env hosting/docker-compose/ee/.env.ee.dev` then
  `bash ./hosting/docker-compose/run.sh --ee --dev --build`. Confirm `seaweedfs` is healthy.
  The bucket is created lazily on first write (no init container).
- Run the mounts acceptance tests against the live stack:
  `api/oss/tests/pytest/acceptance/mounts/test_mounts_basics.py`. If they skip when storage
  is unavailable, confirm they now RUN and pass. Round-trip: create mount -> put file ->
  list -> get (bytes match) -> delete -> folder delete cascades.
- If a test was written to skip-without-storage, adjust it to run in the dev stack (do not
  weaken assertions).

## M6 — Verify

- `api/`: `ruff format` + `ruff check` clean.
- Mounts acceptance + unit tests green (`test_mounts_basics.py`, `test_mounts_service.py`,
  `test_mounts_file_ops.py`).
- Dev stack: `seaweedfs` healthy, bucket present, a manual put/get via the API returns the
  bytes.

## M7 — Bind + sign credentials (API) — BUILT

Implements the "Sandbox injection" section of `specs.md`. As built:

- DAO upsert: `MountsDAO.upsert_mount` mirrors `SessionStatesDAO.set_session_state` —
  `insert(MountDBE).values(...).on_conflict_do_update(constraint="uq_mounts_project_id_slug",
  set_=...).returning(MountDBE)`, a single statement. `id` is minted in the values map (explicit
  `insert().values()` bypasses the ORM `default=uuid7`). On re-bind it touches the audit fields and
  clears any archive (re-activates the row) without clobbering name/description/flags. Mapping:
  `map_mount_dto_to_dbe_upsert`.
- Service: `MountsService.get_or_create_session_cwd(project_id, user_id, session_id)` pre-mints the
  deterministic `cwd` slug and upserts → same session always lands on the same row.
- Credentials DTO: `MountCredentials` in `core/mounts/dtos.py`
  (`endpoint, region, bucket, prefix, access_key, secret_key, session_token, expires_at`).
- Storage STS: `MountStorage.sign_temp_credentials(bucket, prefix, duration_seconds)` uses
  miniopy-async `AssumeRoleProvider` (no botocore) — SigV4-signed `AssumeRole` against the same S3
  endpoint, inline policy scoped to `<bucket>/<prefix>/*` (object RW) + `ListBucket` on that prefix.
  ONE path for S3/R2/SeaweedFS. `endpoint_url`/`region` exposed as read-only props.
- Service: `MountsService.sign_mount_credentials(project_id, mount_id, duration_seconds=900)` →
  resolves the mount, derives prefix `<project_id>/<mount_id>`, signs, returns `MountCredentials`.
  Master credentials never leave the API.
- Endpoints (BOTH surfaces, shared `utils.sign_mount_credentials`, mirroring upload/download):
  - `POST /mounts/{mount_id}/sign` → `MountCredentialsResponse` (sign any accessible mount).
  - `POST /sessions/mounts/sign?session_id=...` → bind-and-sign: `get_or_create_session_cwd` then
    sign (the runner's entry point). Both gated on `RUN_SESSIONS`.
- Tests: `test_mounts_injection.py` — upsert idempotency (same session → same row), prefix/bucket
  scope, scoped-not-master credentials, short TTL, storage-unavailable, and the policy-resource
  scope string. 8 tests green (36 total mounts unit tests).

## M8 — Runner geesefs mount (local) — BUILT

DESIGN REFINEMENT (no wire change): the spec assumed the signed credentials ride
`AgentRunRequest.secrets` / a new `mountConfig` field. As built, the runner **signs at mount
time itself** — it already authenticates to the API (heartbeat/record-ingest as the invoke
caller via `runCredential(request)` + `AGENTA_API_URL`), so it calls `POST /sessions/mounts/sign`
directly. No `protocol.ts`/`wire.py`/golden/run-plan change; the credentials are minted with the
freshest TTL at the moment of mount, and the master key still never leaves the API.

- New `services/agent/src/engines/sandbox_agent/mount.ts`:
  - `signSessionMountCredentials(sessionId, {apiBase, authorization})` — POSTs `/sessions/mounts/sign`,
    maps the snake_case `MountCredentials` → camelCase; returns null on 503/non-2xx/incomplete (run
    without a durable cwd, never abort the turn).
  - `mountStorage(cwd, creds)` — geesefs `--endpoint --region --no-detect --fsync-on-close -o
    allow_other <bucket>:<prefix> <cwd>`; idempotent (`mountpoint -q`); creds ride the child ENV
    (`AWS_*`), never argv; returns false (no throw) on failure.
  - `unmountStorage(cwd)` — `fusermount -u`, best-effort (data lives in the store).
- `sandbox_agent.ts`: after `prepareWorkspace`, before `createSession`, a session-owned LOCAL run
  signs + mounts (`mountedCwd` tracked); the `finally` unmounts before the dir is removed. Added
  `apiBase()` helper. Local mounts on-host → scoped creds never enter agent space.
- Sandbox-agent image (`docker/Dockerfile` + `Dockerfile.dev`): `fuse` + `user_allow_other` in
  `/etc/fuse.conf` + arch-matched geesefs binary (`dpkg --print-architecture`, amd64/arm64).
- Compose (OSS + EE): the `sandbox-agent` service gets `cap_add: SYS_ADMIN`, `devices: /dev/fuse`,
  `security_opt: apparmor:unconfined`.
- Runner unit tests (`sandbox-agent-mount.test.ts`): sign mapping + graceful null, geesefs argv
  shape (creds in env not argv), `--endpoint` omitted for AWS S3, idempotency, mount-failure-no-throw.

## M9 — Remote (Daytona/E2B) + ngrok — BUILT

- `ngrok` compose service (OSS + EE) behind a `remote` profile (off by default), tunneling
  `seaweedfs:8333`; `NGROK_AUTHTOKEN` from env; depends_on seaweedfs healthy.
- `mount.ts` remote path: `discoverTunnelEndpoint()` (queries `http://ngrok:4040/api/tunnels`,
  prefers https public_url, null when no tunnel) + `mountStorageRemote(sandbox, cwd, creds,
  {endpoint})` runs geesefs INSIDE the sandbox via `sandbox.runProcess` with the tunnel endpoint
  and scoped creds in the process env. Shared `geesefsArgs`/`credEnv` helpers (endpoint override).
- `sandbox_agent.ts`: the Daytona branch discovers the tunnel + remote-mounts; only the scoped,
  short-lived credentials cross into the sandbox.
- Daytona snapshot (`sandbox-images/daytona/build_snapshot.py`): `fuse` + geesefs (amd64 — Daytona
  hosts are x86_64, built remotely, documented inline).
- Runner unit tests: tunnel discovery (https preference, null cases), remote-mount argv/env shape,
  non-zero exit → false.

## M10 — Injection acceptance — BUILT (API) + manual (live runner)

- `test_mounts_injection.py` (acceptance): `/sessions/mounts/sign` binds the `cwd` (name `cwd`,
  reserved `__ag__` slug, session-derived), credentials prefix-scoped to `<project_id>/<mount_id>`;
  idempotent bind (same session → same mount id + prefix); distinct sessions → distinct prefixes;
  `session_id` validation; `/mounts/{id}/sign` for an existing mount + 404; and a file written
  through the file API SURVIVES a re-bind (cross-turn persistence, store-level). Skips on 503.
- Also fixed the basics suite's stale `data.bucket/prefix` payload (removed in M1b) and replaced
  the obsolete bucket/prefix-rejection tests with the reserved-slug guard.
- MANUAL (live dev stack): a session-owned local run writes a file to cwd; a second turn (fresh
  sandbox) sees it; the inspector Mounts tab shows the `cwd` mount; teardown leaves files in the
  store. The geesefs-in-a-live-run leg needs the deployed stack (the user's redeploy).

## Notes / guardrails

- The API stays S3-generic. NOTHING SeaweedFS-specific goes in `api/` — SeaweedFS is just an
  endpoint+credentials and an STS endpoint. All provider difference lives in env values.
- Strict API layering and terse comments (repo-enforced).
- The master storage credentials live ONLY in the API; the runner/sandbox only ever receive
  signed, scoped, expiring credentials.
- Touch both OSS and EE dev compose files; keep them in sync.
