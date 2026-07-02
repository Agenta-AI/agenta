# Tasks — Mounts non-dev wiring

> Ordered by surface. Design-first; see [specs.md](./specs.md). `[ ]` = not started.
> W6 (`chore/store-generalization`) renames `AGENTA_MOUNTS_STORAGE_*` → `AGENTA_STORE_*`;
> use `AGENTA_STORE_*` throughout and let the local integration PR stitch the seam.

## 0. Decided / blockers

- [x] Injection merged (#4938) — out of scope.
- [x] gh compose: env-var passthrough + FUSE caps; no bundled SeaweedFS.
- [x] Railway: SeaweedFS as a Railway service + volume via `bootstrap.sh`/`configure.sh`;
      Railway public domain → no ngrok.
- [x] Preview + live: external AWS S3; FUSE caps in `docker-compose.application.yml`; no
      SeaweedFS container; store env rows owned by W3.
- [x] `ngrok` = dev compose-local only; never Railway/live.
- [x] `AGENTA_STORE_*` final names — W6 coordination seam; integration PR reconciles.
- [x] `.env.template`/`.env.csv` store rows — W3 seam; W4 owns compose-side FUSE only.

## 1. gh/prod compose (oss + ee)

Files: `hosting/docker-compose/{oss,ee}/docker-compose.gh.yml`,
`hosting/docker-compose/{oss,ee}/env.{oss,ee}.gh.example`.

- [ ] Add `AGENTA_STORE_ENDPOINT_URL`, `AGENTA_STORE_ACCESS_KEY`,
      `AGENTA_STORE_SECRET_KEY`, `AGENTA_STORE_REGION`, `AGENTA_STORE_BUCKET`,
      `AGENTA_STORE_SIGNING_KEY` env var passthrough to the `api`, `services`, and
      `sandbox-agent` services in `docker-compose.gh.yml` (oss + ee). No compose
      defaults — operator supplies values via env file. Mirror the layout used for these
      services in `docker-compose.dev.yml`.
- [ ] Add FUSE caps to the `sandbox-agent` service in both `docker-compose.gh.yml`:
      `cap_add: [SYS_ADMIN]`, `devices: [/dev/fuse]`,
      `security_opt: [apparmor:unconfined]`. Mirror `docker-compose.dev.yml` lines
      669–674.
- [ ] Update `env.oss.gh.example` and `env.ee.gh.example`: rename the existing
      `AGENTA_MOUNTS_STORAGE_*` commented block (lines 292–304 of the oss example) to
      `AGENTA_STORE_*`; keep empty `ENDPOINT_URL` = real AWS S3 convention; document
      `SIGNING_KEY` as required for STS on self-hosted stores.

## 2. Railway

Files: `hosting/railway/oss/scripts/bootstrap.sh`,
`hosting/railway/oss/scripts/configure.sh`.

- [ ] `bootstrap.sh`: add `add_service_image seaweedfs "$SEAWEEDFS_IMAGE"` (default
      `chrislusf/seaweedfs:latest`, mirroring the dev compose image) after the redis
      block; add `ensure_volume seaweedfs /data` immediately after.
- [ ] `configure.sh`: derive `seaweedfs_host_ref` as
      `'${{seaweedfs.RAILWAY_PRIVATE_DOMAIN}}'` (same pattern as `pg_host_ref` and
      `agent_runner_host_ref`). Build `seaweedfs_endpoint_url` =
      `"http://${seaweedfs_host_ref}:8333"`.
- [ ] `configure.sh`: set `AGENTA_STORE_ENDPOINT_URL`, `AGENTA_STORE_ACCESS_KEY`,
      `AGENTA_STORE_SECRET_KEY`, `AGENTA_STORE_BUCKET`, `AGENTA_STORE_SIGNING_KEY` on
      `api`, `services`, and `sandbox-agent` via `set_vars`. `AGENTA_STORE_ACCESS_KEY` +
      `AGENTA_STORE_SECRET_KEY` are operator-supplied (passed through from the calling
      shell, analogous to `AGENTA_AUTH_KEY`). `AGENTA_STORE_SIGNING_KEY` auto-generated
      if not set (mirror the `AGENTA_AUTH_KEY` / `AGENTA_CRYPT_KEY` generation pattern
      in `configure.sh` if one exists, otherwise document as an operator-required var).
- [ ] `configure.sh`: add FUSE caps to the `sandbox-agent` Railway service config if
      the Railway CLI / API supports it; document any Railway-side UI step needed for
      FUSE if the CLI does not expose it (Railway service → Settings → Linux Capabilities).
- [ ] Confirm no ngrok wiring needed (Railway-issued domain is public; Daytona sandboxes
      reach the store directly).

## 3. Preview + live (private `platform/`)

Files: `platform/hosting/docker-compose/docker-compose.application.yml`,
`platform/.env.template`, `platform/.env.csv`.

- [ ] `docker-compose.application.yml`: add `AGENTA_STORE_*` env var passthrough to
      `api`, `services`, and `sandbox-agent` (no defaults — values come from secrets).
      No SeaweedFS service.
- [ ] `docker-compose.application.yml`: add FUSE caps (`cap_add: [SYS_ADMIN]`,
      `devices: [/dev/fuse]`, `security_opt: [apparmor:unconfined]`) to `sandbox-agent`.
- [ ] `.env.template` + `.env.csv`: add commented `AGENTA_STORE_*` rows with the AWS S3
      contract (`ENDPOINT_URL` empty = real S3, `REGION`, `BUCKET`, `ACCESS_KEY`,
      `SECRET_KEY`, `SIGNING_KEY`). **W3 seam** — coordinate with W3 so rows are added
      once; W4 owns the compose-side FUSE addition regardless.

## 4. Helm example values

Files: `hosting/kubernetes/oss/values.oss.example.yaml`,
`hosting/kubernetes/ee/values.ee.example.yaml`.

- [ ] Rename env-var references inside the `mounts:` commented block from
      `AGENTA_MOUNTS_STORAGE_*` → `AGENTA_STORE_*`. Structural content is already
      correct; this is a mechanical rename (W6 coordination — may land in W6 directly;
      verify at integration time and deduplicate).
- [ ] Confirm the block covers both the bundled-SeaweedFS path (`seaweedfs.enabled:
      true`) and the external-S3 path (`seaweedfs.enabled: false`, empty `endpointUrl`
      = real AWS S3). No structural change expected.

## 5. Smoke check

- [ ] gh compose + external S3 endpoint: `docker-compose.gh.yml` (oss) with
      `AGENTA_STORE_*` vars pointing at a real or mock S3; start the stack; confirm
      `sandbox-agent` container starts (FUSE caps); confirm the API can sign a mount
      credential via `POST /sessions/mounts/sign`.
- [ ] Railway: run `bootstrap.sh` against a Railway project; confirm `seaweedfs` service
      appears with a `/data` volume; run `configure.sh`; confirm store vars are set on
      `api`/`services`/`sandbox-agent`.

## Out of scope

- Injection (merged #4938).
- `AGENTA_MOUNTS_STORAGE_*` → `AGENTA_STORE_*` rename in non-example files (W6).
- `platform/.env.template`/`.env.csv` row authoring (W3).
- E2B/Modal remote-mount injection.
- External (user-supplied) bucket support.
- Helm `values.yaml` structural changes (already correct).
