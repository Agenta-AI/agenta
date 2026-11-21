# Extend mounts: make the object-store backing functional (SeaweedFS dev, S3 remote)

## Problem

The mounts domain is fully built at the code layer but has no storage behind it, so
every file op is dead on arrival. `MountStorage` (`api/oss/src/core/mounts/storage.py`)
is a thin S3 adapter (miniopy-async); it is wired in `api/entrypoints/routers.py` (~821) from
`env.mounts.*`; the router/service/DAO/migration all exist. But:

- The env vars `AGENTA_MOUNTS_STORAGE_ENDPOINT_URL` / `_ACCESS_KEY` / `_SECRET_KEY` / `_REGION`
  exist in `api/oss/src/utils/env.py` (`MountsConfig`) but are set in NO env file, so
  `MountsConfig.enabled` is always False and the adapter raises `MountStorageUnavailable`.
- There is no object store in the dev docker-compose stack (no SeaweedFS, no MinIO). The
  PoC ran SeaweedFS in its own compose (`vibes.worktrees/poc-persistent-sessions/sessions/
  demo/docker-compose.yml`); the platform stack never got it.

So "make mounts functional" = stand up the storage (SeaweedFS in dev, S3-compatible in
remote/prod), wire the env, and confirm the existing endpoints actually read/write objects.

## Goal

1. Dev: a SeaweedFS service in the docker-compose dev stacks exposing an S3 endpoint, with
   a bucket auto-created, and the API pointed at it via env.
2. Remote/prod: the SAME code path against any S3-compatible store (real AWS S3, Cloudflare
   R2, MinIO, SeaweedFS) configured purely by env. No SeaweedFS-specific code in the API.
3. The existing mounts endpoints (list/get/put/delete files + folders) work end to end
   against the dev store, proven by the existing acceptance tests now that storage is live.

This is infra + config + wiring, plus one domain change: mounts get a derived, slug-based
identity and `mount_id`-keyed storage (the caller stops supplying a bucket/prefix). See
"Identity, slug, and storage key" below. Sandbox injection (geesefs-mounting the bucket into
the runner cwd) is a SEPARATE follow-up and is out of scope here (see "Out of scope").

## The S3 abstraction (already correct)

`MountStorage` takes `endpoint_url`, `access_key`, `secret_key`, `region` and uses the
standard boto3 S3 client. SeaweedFS, MinIO, R2, and AWS S3 are all addressed identically:

- AWS S3: `endpoint_url=None` (boto3 default), real IAM access/secret keys, real region.
- Any S3-compatible store (SeaweedFS / MinIO / R2): `endpoint_url` set to the store's
  S3 endpoint, store-local access/secret keys, region usually `us-east-1` (ignored by most
  but required by the SDK signature).

So the generic credential model is exactly the S3 trio: endpoint + access key + secret key
(+ region). That is what the `AGENTA_MOUNTS_STORAGE_*` vars already express. Nothing
SeaweedFS-specific belongs in the API env; SeaweedFS is just one concrete endpoint+creds.

## Environment variables

Keep the generic `AGENTA_MOUNTS_STORAGE_*` namespace (already in `MountsConfig`). It applies in
ALL environments; only the values differ.

| Var | Dev (SeaweedFS) | Remote/prod (S3-compatible) | Meaning |
| --- | --- | --- | --- |
| `AGENTA_MOUNTS_STORAGE_ENDPOINT_URL` | `http://seaweedfs:8333` | the store's S3 endpoint (empty for real AWS S3) | S3 API endpoint; empty = AWS default |
| `AGENTA_MOUNTS_STORAGE_ACCESS_KEY` | dev key (matches s3.json) | the store's access key | S3 access key id |
| `AGENTA_MOUNTS_STORAGE_SECRET_KEY` | dev secret (matches s3.json) | the store's secret key | S3 secret access key |
| `AGENTA_MOUNTS_STORAGE_REGION` | `us-east-1` | the store's region | S3 region (SDK-required) |
| `AGENTA_MOUNTS_STORAGE_BUCKET` | `agenta-mounts` | the provisioned bucket | default bucket (NEW — see below) |

Credentials are defined exactly like any S3 client: an access-key/secret-key pair scoped to
the endpoint. For SeaweedFS the pair is declared in its `s3.json` identities file; for R2 /
MinIO / AWS it is whatever that provider issues. The API does not care which — it forwards
the trio to boto3.

### Bucket: add `AGENTA_MOUNTS_STORAGE_BUCKET`

One provisioned bucket per environment holds every mount. Add `AGENTA_MOUNTS_STORAGE_BUCKET`
to `MountsConfig`; the service stamps it on every mount. The bucket is never a caller input.

## Identity, slug, and storage key (the domain model)

This supersedes the old free-form `MountData.{bucket, prefix}` caller fields. The caller never
names a bucket or a prefix. A mount is described by a **slug** (its handle) plus, for
session-bound mounts, a `session_id`. Storage location is derived server-side.

### Slug — one uniform rule, `unique(project_id, slug)` unchanged

Every mount has a slug, and the existing `uq_mounts_project_id_slug` constraint stays exactly
as is. The slug is how any mount is identified within a project.

- **Non-session mount**: the caller's slug, verbatim (e.g. `datasets`). The caller owns
  per-project uniqueness, as today.
- **Session mount**: the caller supplies a short `name` (e.g. `cwd`, `home`) plus a
  `session_id`. The service mints the stored slug as
  `__ag__<uuid5(_MOUNTS_NAMESPACE, session_id)>__<name>`
  (the uuid5 in full canonical dashed form), e.g.
  `__ag__a1b2c3d4-e5f6-5789-9abc-def012345678__cwd`.

The session-hash segment disambiguates two sessions that both want `cwd`, so a single flat
per-project slug namespace holds both hand-named and session mounts with no scope-aware
constraint and no partial indexes. Within one session the `name` is the disambiguator: a second
mount named `cwd` for the same session collides on the same minted slug (one `cwd` per session,
by construction).

`uuid5` is deterministic, so the same `(session_id, name)` always re-derives the same slug ->
the same row -> the same files, across turns and sandbox teardown. The full (untruncated) uuid5
is used so mass session creation never risks a truncation collision.

`_MOUNTS_NAMESPACE = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "mounts")` — the codebase's derived
project-root namespace style (the same one `static_catalog.py` uses under `"catalog"`).

### Reserved-slug guard

Mirror `_reject_static_slug` (workflows): reject any **caller-supplied** slug that starts with
`__ag__` (HTTP 400). Only the service may mint slugs in that namespace, so a user can never
squat or shadow a session mount's slug.

### Storage key — `mount_id`, slug-independent

The S3 object-key prefix (the "bucket key") is `<project_id>/<mount_id>/`. It is derived, not a
stored column, and does NOT use the slug. Keying on the mount's own id (its UUID primary key)
makes storage collision-proof by construction and decouples it from the slug: renaming a slug
never relocates bytes. Tenant isolation is the `project_id` segment; the path guards
(`validate_file_path`) still apply to caller-supplied file paths under the prefix.

`MountData.{bucket, prefix}` are removed as caller inputs. The bucket comes from env; the key
is derived from `project_id` + `mount_id`. The `session_id` column is kept (indexed) so the
inspector can list "mounts for this session" without reverse-parsing slugs.

## Infrastructure changes

### docker-compose (dev stacks) — as built

A single `seaweedfs` service in BOTH dev files
(`hosting/docker-compose/oss/docker-compose.dev.yml`, `.../ee/docker-compose.dev.yml`):

- `image: chrislusf/seaweedfs:latest`. Its entrypoint GENERATES `/etc/seaweedfs/s3.json` from
  the env credentials (so there is NO committed s3.json — the env is the single source of truth),
  then `exec weed server -dir=/data -ip=seaweedfs -s3 -s3.port=8333
  -s3.config=/etc/seaweedfs/s3.json`. Named volume `seaweed-data:/data`, `agenta-network`,
  healthcheck `curl -sf http://localhost:9333/cluster/healthz`. Repo block style (IMAGE /
  EXECUTION / STORAGE / NETWORK / LIFECYCLE banners).
- NO `seaweedfs-init`: the bucket is created lazily on first write (Option A). SeaweedFS
  auto-creates a bucket on first put; our object-only usage never needs a pre-configured bucket.
- API + worker services `depends_on: seaweedfs (service_healthy)`.
- Skippable dev defaults: the seaweedfs service and every API-image service set
  `AGENTA_MOUNTS_STORAGE_*` via compose `${VAR:-default}`, so mounts work with an EMPTY env file
  and the seaweedfs identity always matches what the API presents.

The remote tunnel (`ngrok`) is for cloud sandboxes reaching the store during sandbox injection —
that is M9, behind a `remote` profile. Not added in the storage/API steps.

### Dockerfiles

No application Dockerfile change for the storage/API steps — SeaweedFS runs from its upstream
image and the API uses `miniopy-async` (swapped in from `aioboto3`; lock updated). The sandbox
image DOES change for injection (M8: FUSE caps + geesefs binary).

### Env example files — as built

The `AGENTA_MOUNTS_STORAGE_*` block (including `_BUCKET`) is in all four examples: dev files carry
the SeaweedFS dev values; gh/prod files carry commented placeholders with a note that prod points
at a real S3-compatible store (empty endpoint = AWS S3). Because of the compose `${VAR:-default}`
fallbacks, dev needs no entries at all; the examples document the knobs for prod.

## Behavior / acceptance

- With the dev stack up, `MountsConfig.enabled` is True and `MountStorage` connects to
  SeaweedFS. The existing acceptance tests (`api/oss/tests/pytest/acceptance/mounts/
  test_mounts_basics.py`) exercise create-mount + put/list/get/delete and should pass
  against the live store (they likely skip today when storage is unavailable — confirm and
  un-skip / make them run in the dev stack).
- A put then list then get round-trips bytes; a delete removes them; a folder delete
  cascades the prefix. (All already implemented in `MountStorage`; this just proves it
  against a real endpoint.)

## Sandbox injection: durable cwd via geesefs (in scope, built last)

Make the agent's sandbox working directory a durable mount of its session's storage, so a
file written in turn 1 survives sandbox teardown and reappears in turn 2. Today the cwd is an
ephemeral `mkdtemp` dir (`run-plan.ts` `defaultLocalCwd`) deleted in the runner's `finally`.

### One cwd mount per session (get-or-create via upsert)

At run start, the session gets exactly one `cwd` mount, bound by upsert — not an explicit
create/edit. The minted session slug is deterministic (`__ag__<uuid5(session)>__cwd`), so the
upsert keys on `uq_mounts_project_id_slug`: the same session always lands on the same row,
idempotently. Mirror `SessionStatesDAO.set_session_state` (`insert(...).on_conflict_do_update(
constraint="uq_mounts_project_id_slug", set_=...).returning(...)`) — a single statement, no
409 dance. The mount's storage key stays `<project_id>/<mount_id>/` (the durable prefix).

### Forge-on-mount credentials: scoped, ephemeral, signed API-side

The long-term store credentials (the master key pair) live ONLY in the API and NEVER reach the
runner or the sandbox. At bind time the API signs short-lived, prefix-scoped credentials for
exactly that mount and hands THOSE to the runner. A new service method:

```text
MountsService.sign_mount_credentials(mount) -> MountCredentials
  { endpoint, access_key, secret_key, session_token, expires_at, prefix }
```

- It calls the store's STS **`GetFederationToken`** (a signed SigV4 POST on the S3 endpoint)
  with an inline policy scoped to `<bucket>/<project_id>/<mount_id>/*` (read+write on that
  prefix only) and a short TTL (minutes). As-built note: `GetFederationToken`, NOT `AssumeRole`
  — federation federates the caller's OWN identity, so it needs no pre-defined roles/trust
  policies; `AssumeRole` requires a role+trustPolicy+roleMapping the released SeaweedFS build
  does not ship by default (it 403s). miniopy-async ships only an `AssumeRoleProvider`, so the
  call is hand-signed with `miniopy_async.signer.sign_v4_sts` and the XML response parsed.
- This is ONE path for every store: real S3, R2, and SeaweedFS all answer `GetFederationToken`
  on the same S3 endpoint. SeaweedFS serves STS **in-process** (same `weed server -s3` port) only
  once a signing key is configured — `WEED_JWT_FILER_SIGNING_KEY` (base64 32-byte) doubles as the
  STS signing key (the s3.json `sts.signingKey` block is parsed but NOT wired in 4.37). No extra
  IAM container, no per-provider fork in the API — only the endpoint differs, same as `MountStorage`.
- Presigned URLs are NOT usable: geesefs is a FUSE mount doing live SigV4 requests, so it needs
  a real key pair (+ session token), not a one-shot URL. STS temp credentials are exactly that.
- A leak of the signed credentials grants access to only this mount's prefix, for minutes —
  acceptable by construction. The master credentials are NEVER injected into the runner/sandbox.

### Credentials delivery: the existing run-secrets channel

The signed credentials travel to the runner on the existing channel — `AgentRunRequest.secrets`
(`protocol.ts`, consumed at `run-plan.ts`), the same path provider keys already use. No new
top-level credentials field. The API signs at invoke and the runner is a pure consumer: it never
holds the master credentials and never calls STS.

### Mount mechanism: geesefs FUSE (the PoC recipe)

```text
geesefs --endpoint <endpoint> --region <region> --no-detect [--fsync-on-close] \
  -o allow_other <bucket>:<project_id>/<mount_id> <cwd>
```

Idempotent (`if mountpoint -q <cwd>; then exit 0; fi`). The sandbox image needs FUSE:
`cap_add: SYS_ADMIN`, `devices: /dev/fuse`, `user_allow_other` in `/etc/fuse.conf`.

Runner extension points (confirmed):

- `run-plan.ts` `buildRunPlan` (~258): attach `mountConfig` (endpoint + signed credentials + the
  `<project_id>/<mount_id>` key) to the `RunPlan`, sourced from `request.secrets`.
- `sandbox_agent.ts` `runSandboxAgent` after `prepareWorkspace`, before `createSession` (~320):
  mount.
- `sandbox_agent.ts` `finally` (~643): unmount (`fusermount -u`, best-effort). Data stays in the
  store; only compute is ephemeral.

### Local vs remote (ngrok optional, remote-only)

- Local sandbox: the daemon runs on-host, so geesefs mounts on-host against the in-network
  `seaweedfs:8333`. The signed credentials stay on the host; the agent sees only the mounted
  filesystem, never the keys.
- Remote sandbox (Daytona/E2B): geesefs runs INSIDE the sandbox, so it needs the endpoint
  reachable from the cloud. Add an `ngrok` compose service behind a `remote` profile (off by
  default); the runner discovers the public URL (`http://ngrok:4040/api/tunnels`) and uses it as
  the geesefs endpoint, injecting the signed (scoped, expiring) credentials into the sandbox exec.
  ngrok is required ONLY for remote; local never tunnels. This is the one place credentials
  cross into agent-reachable space, and they are always the scoped, short-lived ones.

### Acceptance

- A session-owned local run writes a file to its cwd; a second turn (new sandbox) sees it. The
  inspector Mounts tab shows the session's `cwd` mount.
- The signed credentials are scoped (cannot read another mount's prefix) and expire.
- Kill/teardown leaves the files in the store; recreating the session re-attaches the same prefix.

## Out of scope (follow-up PRs)

- Per-provider credential management UI / external (BYO-credential) mounts.
- Lifecycle/quota/metering of mount storage (disk-seconds) — that is the metering track.
- Mounts beyond the session `cwd` (e.g. a per-harness home dir bound to other ids).

## References

- Existing adapter: `api/oss/src/core/mounts/storage.py`
- Wiring: `api/entrypoints/routers.py` (~821, `MountStorage(...)`)
- Env: `api/oss/src/utils/env.py` (`MountsConfig`)
- Mount DTOs + slug minting / validation: `api/oss/src/core/mounts/dtos.py`, `service.py`
  (`mint_session_slug`/`reject_reserved_slug`/`validate_file_path`)
- Proven geesefs mount + ngrok wiring (injection reference):
  `vibes.worktrees/poc-persistent-sessions/sessions/demo/sidecar/{server.js,sandbox-provider.js}`
- Compose service style + volumes: `hosting/docker-compose/oss/docker-compose.dev.yml`
- Follow-up context: `big-agents-audit/mounts.md`
