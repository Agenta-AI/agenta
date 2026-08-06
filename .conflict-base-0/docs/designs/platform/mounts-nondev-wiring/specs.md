# Mounts — non-dev surface wiring — specs

> Status: **draft**. Scoped to W4 (`feat/mounts-nondev-wiring`). Injection is already
> merged (#4938); this worktree only brings the object store to non-dev surfaces.
> Nothing is deployed — no backward-compat required.

## Problem

The mounts store + injection was merged in PR #4938: API domain, STS signing, LOCAL +
REMOTE injection, FUSE caps, and a dev compose (`docker-compose.dev.yml` for oss + ee)
with a `seaweedfs` service and an ngrok service behind a `remote` profile. The Helm chart
also ships a `seaweedfs` statefulset behind a `seaweedfs.enabled` toggle.

Three non-dev surfaces have no store wiring:
- `hosting/docker-compose/{oss,ee}/docker-compose.gh.yml` — no seaweedfs or ngrok.
- `hosting/railway/oss/scripts/bootstrap.sh` + `configure.sh` — no seaweedfs service,
  volume, or store env vars.
- Private `platform/` repo (`hosting/docker-compose/docker-compose.application.yml` +
  `.env.template`) — no store service, no store env vars.

Additionally the Helm example values (`hosting/kubernetes/{oss,ee}/values.*.example.yaml`)
already contain the mounts block in commented-out form; they need to be verified and
confirmed correct.

## Store env naming

Store env vars are being renamed `AGENTA_MOUNTS_STORAGE_*` → `AGENTA_STORE_*` by W6
(`chore/store-generalization`). This worktree uses the final `AGENTA_STORE_*` names
throughout. **W6 is a coordination seam**: the local integration PR stitches the rename
so both worktrees land on consistent names before merging to `big-agents`. If W4 merges
before W6, an interim pass in the integration PR renames the W4 additions to the final
form.

## Credential model (all surfaces)

Master store keys live only in the API container. The API signs short-lived,
prefix-scoped STS credentials (`<bucket>/<project_id>/<mount_id>/*`, minutes TTL) and
ships them to the runner via `AgentRunRequest.secrets`. The runner never holds master
keys. `weed s3 -iam=true` / AWS S3 / R2 all expose STS on the same endpoint — one code
path regardless of which backend is in use.

## Decision framework (A/B/C)

Three questions determine the per-tier store choice:

- **A — in-stack or external?** Follows "does this env run its own stateful infra?"
  Compose-local and Railway already run Postgres + Redis as in-stack volumed services
  (confirmed in `bootstrap.sh`). SeaweedFS follows the same pattern: container + volume
  where the env owns its infra; external S3 where a managed service is available.
- **B — store publicly reachable or private-only?** Decides ngrok. A Railway-issued
  public domain or a public S3 URL is reachable by remote sandboxes directly — no ngrok.
  A bare `seaweedfs:8333` on a compose network is private-only — ngrok is needed for
  remote sandboxes.
- **C — sandbox local or remote?** Local sandboxes use on-host geesefs; they never need
  a tunnel. Remote sandboxes (Daytona) need a cloud-reachable store URL, satisfied by
  public URL (B) or the compose-local ngrok shim.

Rule: **`ngrok = (sandbox is remote) AND (store is private-only)`** → dev compose-local
only. Never on Railway or live (both have a public store URL).

## Settled per-tier store decision (locked)

| Surface | Store | Container | Tunnel |
|---|---|---|---|
| dev compose (oss + ee) | SeaweedFS bundled | yes (merged) | ngrok `remote` profile (merged) |
| **gh/prod compose (oss + ee)** | SeaweedFS optional | add service + FUSE | no ngrok (publicly addressable or user-supplied endpoint) |
| **Railway** | SeaweedFS container + volume | add to `bootstrap.sh` | no ngrok (Railway public domain) |
| **preview + live (private `platform/`)** | external AWS S3 | none | none |
| k8s (Helm) | operator's `seaweedfs.enabled` choice | bundled or external | no ngrok |

## Surface-by-surface decisions

### gh/prod compose (oss + ee)

`hosting/docker-compose/{oss,ee}/docker-compose.gh.yml` currently has no seaweedfs or
ngrok (confirmed empty grep). The gh compose is the self-hosted production image for
community users — it must work with both an external store (e.g. AWS S3 / R2) and an
operator-supplied SeaweedFS sidecar.

Decision: **do not bundle a SeaweedFS container in gh.yml**. The gh compose is a
production self-host image, not a managed PaaS. Bundling SeaweedFS adds a stateful
service that operators may not want. Instead:

1. Add the `AGENTA_STORE_*` env var block (from the outer shell environment) to every
   service in `docker-compose.gh.yml` that already receives it in `docker-compose.dev.yml`
   (api, services, sandbox-agent). Values are passed straight from the host env with no
   compose-managed defaults — the operator configures the env file.
2. Add FUSE caps (`SYS_ADMIN` + `/dev/fuse` + apparmor `unconfined`) to the
   `sandbox-agent` service, mirroring `docker-compose.dev.yml`. FUSE is needed for
   geesefs regardless of whether the store is SeaweedFS or S3.
3. No ngrok, no seaweedfs service in gh.yml.
4. Update `env.oss.gh.example` and `env.ee.gh.example` — the `AGENTA_MOUNTS_STORAGE_*`
   block already exists in commented form (lines 292–304 of `env.oss.gh.example`);
   rename the keys to `AGENTA_STORE_*` (W6 dependency) and uncomment/document the empty
   `ENDPOINT_URL` = real AWS S3 convention.

### Railway

Railway already runs Postgres and Redis as services with volumes (`add_service_image` +
`ensure_volume` in `bootstrap.sh`). SeaweedFS follows the same pattern:
- `bootstrap.sh`: `add_service_image seaweedfs <SEAWEEDFS_IMAGE>` + `ensure_volume
  seaweedfs /data`.
- `configure.sh`: add a `seaweedfs_host_ref` using Railway's private-domain reference
  convention (`${{seaweedfs.RAILWAY_PRIVATE_DOMAIN}}`), then set the store env vars on
  `api`, `services`, and `sandbox-agent` pointing at
  `http://${seaweedfs_host_ref}:8333`. No ngrok: the store is on the Railway private
  network and local sandbox geesefs mounts directly; Daytona remote sandboxes on Railway
  would use the Railway public gateway (store accessible via the public domain).

The `AGENTA_STORE_*` block needs to be set on the same services that receive the runner
env vars today (`api`, `services`, `sandbox-agent`). `AGENTA_STORE_SIGNING_KEY` should
be an operator-supplied var (auto-generate a random value in `configure.sh` if not
already set, analogous to how `AGENTA_AUTH_KEY` is handled today — check `configure.sh`
for that pattern and mirror it).

### Preview + live (private `platform/`)

Decided: **external AWS S3**. No SeaweedFS container. `seaweedfs.enabled=false` in
Helm context. For compose context (private `platform/hosting/docker-compose/`):
- `docker-compose.application.yml`: add FUSE caps to the `sandbox-agent` service; add
  the `AGENTA_STORE_*` block (empty `ENDPOINT_URL` = real AWS S3). No seaweedfs service.
- `.env.template` (+ `.env.csv`): add commented `AGENTA_STORE_*` rows with the AWS S3
  contract (empty endpoint, real bucket + credentials). This seam overlaps W3
  (`feat/private-cloud-env`) — W3 owns the env-file rows; W4 documents the store block
  decision and the compose-side FUSE addition. **The store env rows are the W3/W4 seam.**
  In the local integration PR, one of the two worktrees lands the rows; the other
  deduplicates.

### Helm example values

`hosting/kubernetes/{oss,ee}/values.*.example.yaml` already have the `mounts:` block in
commented-out form (lines 529–546 of `values.oss.example.yaml`). The env var names
referenced inside use `AGENTA_MOUNTS_STORAGE_*` — these become `AGENTA_STORE_*` with
W6. Beyond the rename, the block already covers both the bundled-SeaweedFS and external-
S3 cases correctly. No structural change needed; the W6 rename is the only edit.

## What is already built (out of scope — do not re-spec)

- API domain + STS signing (`core/mounts/storage.py`, `POST /sessions/mounts/sign`).
- Injection LOCAL + REMOTE (`services/agent/src/engines/sandbox_agent/mount.ts`).
- Dev compose seaweedfs + ngrok (`hosting/docker-compose/{oss,ee}/docker-compose.dev.yml`).
- Helm seaweedfs statefulset + `seaweedfs.enabled` toggle.

## Decided

- **gh compose**: env-var passthrough + FUSE caps; no bundled SeaweedFS container.
- **Railway**: SeaweedFS as a Railway service + volume, private-domain endpoint; no ngrok.
- **Preview + live**: external AWS S3; FUSE caps in compose; no SeaweedFS container.
- **ngrok**: dev compose-local only; never on Railway or live.
- **AGENTA_STORE_*** final names — W6 dependency; local integration PR stitches.
- **W3/W4 seam**: W3 owns `.env.template`/`.env.csv` rows; W4 owns the compose-side
  FUSE addition and the store decision documentation.

## Out of scope

- Injection (merged #4938).
- Store adapter, STS signing, API domain (merged #4938).
- Dev compose seaweedfs/ngrok (merged #4938).
- `AGENTA_STORE_*` rename itself — owned by W6.
- `.env.template`/`.env.csv` row authoring — owned by W3.
- E2B/Modal remote-mount injection (rides on E2B landing).
- External mount support (user-supplied bucket/credentials) — follow-up.
