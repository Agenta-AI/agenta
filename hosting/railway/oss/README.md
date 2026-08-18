# Railway OSS Deployment (Programmatic)

This directory serves two consumers:

1. **PR preview environments** — CI creates one Railway environment per PR by
   cloning a template environment (see
   [PR preview environments](#pr-preview-environments-ci)).
2. **Self-hosting** — a CLI-first bootstrap path for deploying Agenta OSS on
   your own Railway project with minimal manual steps (see
   [Self-hosting / standalone deployment](#self-hosting--standalone-deployment)).

By default, the Railway scripts resolve the infra image tags for `postgres`,
`redis`, and `supertokens` from
`hosting/docker-compose/oss/docker-compose.gh.yml`. Override that source with
`RAILWAY_SOURCE_COMPOSE_FILE` if Railway should follow a different compose
baseline.

## Goals

- Deploy quickly using existing public images for Agenta core services.
- Keep deployment scriptable and repeatable.
- Use a single public gateway domain with path routing:
  - `/` -> web
  - `/api/` -> api
  - `/services/` -> services

## Layout

- `gateway/` - lightweight Nginx gateway image for Railway
- `web/` - web wrapper image and runtime config
- `api/` - api wrapper image with explicit gunicorn command
- `services/` - services wrapper image with explicit gunicorn command
- `runner/` - agent runner image
- `redis/` - redis wrapper to ensure volume permissions are writable
- `worker-streams/` - list-parameterized worker image for stream consumers (tracing, events, records)
- `worker-queues/` - list-parameterized worker image for taskiq queue consumers (webhooks, triggers, interactions, evaluations)
- `cron/` - cron service image
- `alembic/` - migration runner image
- `images/` - prebuilt wrapper image sources (`gateway`, `redis`, `seaweedfs`) pushed to GHCR for preview environments
- `scripts/bootstrap.sh` - create project, environment, and services
- `scripts/configure.sh` - set variables and start commands
- `scripts/deploy-gateway.sh` - deploy gateway image from local Dockerfile
- `scripts/smoke.sh` - quick health checks
- `scripts/upgrade.sh` - run full in-place upgrade flow
- `scripts/build-and-push-images.sh` - build local `api/web/services/runner` images and push tags
- `scripts/deploy-from-images.sh` - deploy Railway services from explicit image tags
- `scripts/preview-clone-create.sh` - create or update a PR preview environment (issue #5650)
- `scripts/preview-clone-destroy.sh` - delete a PR preview environment (plus `--stale-hours` sweep)
- `template/` - the preview template environment as code (definition, converge tool, GraphQL client)

## PR preview environments (CI)

A PR preview is one Railway **environment** cloned from a pre-built template
environment inside a single shared project (~15 API calls, under a minute per
cycle; design: issue #5650). The template itself is code:
`template/template.json`, converged by `template/apply.sh` and guarded by the
daily drift workflow (47). See `template/README.md` for the template
change-management protocol.

### The flow

1. **Setup (workflow 41)** runs `scripts/preview-clone-create.sh`: ensure
   environment `pr-<PR_NUMBER>` exists (`environmentCreate` from the template
   with `skipInitialDeploys`; an ambiguous create failure is reconciled by
   polling the name, never by re-creating), then ONE `environmentPatchCommit`
   that points the eight app services at the run's image tag (Railway
   auto-deploys every service whose config changed), then deploy the rest in
   the proven order (infra, then alembic, then everything else; supertokens
   must wait for alembic), then smoke `/w`, `/api/health`,
   `/services/health` through the clone's own gateway domain. On a later push
   to the same PR the environment is patched in place, not re-created.
2. **Deploy (workflow 43)** runs `preview-clone-create.sh --verify-only`, a
   mutation-free re-check that emits the preview URL for the tests job and
   the PR comment (setup already deployed and smoked).
3. **Cleanup (workflow 45)** runs `scripts/preview-clone-destroy.sh` when the
   PR closes or converts to draft: one `environmentDelete` (idempotent — an
   absent environment is a success). A daily cron additionally sweeps stale
   `pr-*` environments older than 24h (`--stale-hours 24`) as a safety net
   for previews that outlived their PR.

Everything is pure GraphQL through `template/lib-graphql.sh`; the Railway CLI
is not involved.

Two traps the scripts are built around (proven live in
`docs/design/railway-preview-clone-spike/findings.md`): the template's app
tags must stay disjoint from PR tags because `environmentPatchCommit`
silently no-ops on an unchanged config (services whose image already matches
are deployed explicitly instead, and `latest` is refused outright), and a
single Postgres first-deploy timeout in a fresh clone is transient (the
script retries that deploy exactly once).

### Configuration

The template location is config-driven so a future template project move
needs no code change. Two GitHub repo variables, read by workflows 41/43/45
and exported to the scripts:

- `RAILWAY_TEMPLATE_PROJECT` — template project name (fallback:
  `agenta-oss-clone-spike`, which is also the scripts' own default).
- `RAILWAY_TEMPLATE_ENV` — template environment name (fallback:
  `pr-template`, also the scripts' default).

Other knobs:

- `RAILWAY_PREVIEW_ENV_NAME` — override the per-PR environment name (test
  cycles use `pr-clone-*` names).
- Auth is an **account** token exported as `RAILWAY_API_TOKEN` (never
  `RAILWAY_TOKEN` — the Railway CLI treats that name as project-scoped).

### Evidence

Workflow 48 (`48-railway-clone-preview-test.yml`) is the acceptance harness:
it runs N consecutive full cycles (create + patch + deploy + smoke, then
destroy) with the production scripts against the template project and prints
per-cycle timing and API call counts to the step summary.

## Prebuilt Wrapper Images (Preview Environments)

Preview environments consume `gateway`, `redis`, and `seaweedfs` as plain
registry images instead of `railway up` uploads, because upload-built sources
do not survive Railway environment cloning.

- Sources live in `images/{gateway,redis,seaweedfs}/` (Dockerfile plus config
  or entrypoint files). They must stay byte-faithful to what the standalone
  deploy path ships: the `render_redis_wrapper()` and
  `render_seaweedfs_wrapper()` heredocs in `scripts/deploy-from-images.sh`,
  and the `gateway/` directory that `scripts/deploy-gateway.sh` uploads.
- `images/verify-wrappers.sh` enforces that byte-faithfulness (it regenerates
  the deploy-time content from `deploy-from-images.sh` itself) and runs as the
  first step of the CI job, so drift between the two paths fails the build.
  If the compose baseline moves the Redis image, or the `SEAWEEDFS_IMAGE`
  default changes, bump the matching `FROM` pin in `images/*/Dockerfile`.
- CI (the `wrapper-images` job in `.github/workflows/42-railway-build.yml`)
  builds `ghcr.io/agenta-ai/agenta-preview-{gateway,redis,seaweedfs}` for
  `linux/amd64`.
- Tags are content-addressed, never `latest`: `images/compute-tag.sh <dir>`
  prints `content-<12 hex>` from a deterministic hash of the directory
  content. Unchanged content maps to a tag that already exists in GHCR, so CI
  skips the rebuild. Each run also aliases the content manifest with the run's
  image tag (`pr-<number>-<sha>` or `manual-<sha>`). Railway's
  `environmentPatchCommit` no-ops when a patched tag equals the template's,
  which is why unique, disjoint tags matter.
- The template pins one content tag per wrapper service
  (`gateway_tag`/`redis_tag`/`seaweedfs_tag` in `template/template.json`).
  When a wrapper source changes, regenerate and re-pin — see "Regenerating
  wrapper content tags" in `template/README.md`.

Build locally:

```bash
./hosting/railway/oss/images/verify-wrappers.sh

TAG="$(./hosting/railway/oss/images/compute-tag.sh hosting/railway/oss/images/gateway)"
docker build -t "ghcr.io/agenta-ai/agenta-preview-gateway:${TAG}" hosting/railway/oss/images/gateway
```

The first CI push creates each `agenta-preview-*` GHCR package as private;
make it public once (like the other preview packages) if clone environments
should pull without registry credentials.

## Self-hosting / standalone deployment

Everything below deploys or maintains a standalone Agenta instance in a
Railway project you own, using the Railway CLI. These scripts are independent
of the PR preview flow above (the previews reuse only their wrapper-image
content, kept in lockstep by `images/verify-wrappers.sh`).

### Prerequisites

1. Railway CLI installed (`railway --version`)
2. `jq` installed
3. Valid `RAILWAY_API_TOKEN` in your shell (account token from https://railway.com/account/tokens)
4. For Railway UI template export, set a gateway image (`AGENTA_GATEWAY_IMAGE`) so gateway has source metadata

### Security Note

The scripts default to compose-like placeholder values for `AGENTA_AUTH_KEY`,
`AGENTA_CRYPT_KEY`, `AGENTA_RUNNER_TOKEN`, and `POSTGRES_PASSWORD`. This is
acceptable for throwaway test projects, but not for persistent deployments.
For persistent deployments, set unique values:

```bash
export AGENTA_AUTH_KEY="$(openssl rand -hex 32)"
export AGENTA_CRYPT_KEY="$(openssl rand -hex 32)"
export AGENTA_RUNNER_TOKEN="$(openssl rand -hex 32)"
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
```

`configure.sh` creates the bundled mount store credentials on a fresh Railway
project and reuses them on later deployments. You can provide
`AGENTA_STORE_ACCESS_KEY`, `AGENTA_STORE_SECRET_KEY`,
`AGENTA_STORE_SIGNING_KEY`, and `AGENTA_STORE_JWT_PRIVATE_KEY` to override them.

### Quick Start

```bash
export RAILWAY_API_TOKEN="<token>"
export RAILWAY_PROJECT_NAME="agenta-oss-railway"
export RAILWAY_ENVIRONMENT_NAME="staging"
# Optional but recommended for template export support:
# export AGENTA_GATEWAY_IMAGE="ghcr.io/<org>/<repo>/agenta-gateway:<tag>"

./hosting/railway/oss/scripts/bootstrap.sh
./hosting/railway/oss/scripts/configure.sh
./hosting/railway/oss/scripts/init-databases.sh
./hosting/railway/oss/scripts/deploy-services.sh
./hosting/railway/oss/scripts/smoke.sh
```

### Upgrade Existing Deployment

```bash
export RAILWAY_PROJECT_NAME="agenta-oss-railway"
export RAILWAY_ENVIRONMENT_NAME="production"

./hosting/railway/oss/scripts/upgrade.sh
```

Optional flags:

- `UPGRADE_RUN_DB_INIT=false` skips database init.
- `UPGRADE_GATEWAY_RETRY_ON_FAIL=false` skips automatic gateway retry.

### Deploy Current Local Code (Image-Based)

This flow mirrors the `agenta_cloud` pattern where scripts are reusable locally and in CI.

```bash
# Login to GHCR first. Example:
# echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin

export GHCR_NAMESPACE="agenta-ai"
export IMAGE_TAG="local-$(git rev-parse --short HEAD)"

./hosting/railway/oss/scripts/build-and-push-images.sh
source ./hosting/railway/oss/.last-images.env

export RAILWAY_PROJECT_NAME="agenta-oss-railway-template"
export RAILWAY_ENVIRONMENT_NAME="production"

./hosting/railway/oss/scripts/deploy-from-images.sh
```

Optional reliability knobs for fresh projects:

- `RAILWAY_POSTGRES_SERVICE` (default `Postgres`)
- `RAILWAY_REDIS_SERVICE` (default `redis`)
- `RAILWAY_INFRA_SETTLE_SECONDS` (default `40`)
- `RAILWAY_APP_SETTLE_SECONDS` (default `60`)
- `RAILWAY_ALEMBIC_MAX_ATTEMPTS` (default `3`)

`deploy-from-images.sh` redeploys Postgres and Redis before running Alembic, then retries Alembic on failure to reduce first-deploy race conditions.
It also deploys `runner` before `services` and configures `AGENTA_RUNNER_INTERNAL_URL` to the runner's private Railway URL.

### Template Export Readiness

Railway template generation requires every service to have source metadata.

- `source.image` works for image-backed services.
- `source.repo` works for repo-linked services.

Run precheck before using the Railway UI template button:

```bash
./hosting/railway/oss/scripts/template-precheck.sh
```

If precheck fails, the usual reason is gateway missing source metadata. The fix is to bootstrap with `AGENTA_GATEWAY_IMAGE` set, or recreate gateway as a repo-linked service.

If services were created earlier without source metadata, Railway template export can still fail. In that case, create a fresh project with the updated bootstrap flow, or recreate affected services with image-backed or repo-backed source.

### Expected Template Inputs

After the current cleanup, app services should no longer ask for most runtime defaults (`PORT`, `SCRIPT_NAME`, Redis URIs, Alembic paths).

Railway may still ask for some Postgres template variables, for example `PGDATA`, `PGPORT`, `POSTGRES_DB`, `POSTGRES_USER`, `SSL_CERT_DAYS`, and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`.

These come from the managed Postgres service template. They are infrastructure defaults, not Agenta application settings.

Use these values when prompted:

- `PGDATA=/var/lib/postgresql/data/pgdata`
- `PGPORT=5432`
- `POSTGRES_DB=railway`
- `POSTGRES_USER=postgres`
- `SSL_CERT_DAYS=820`
- `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60`

## Railway-Specific Caveats

### Nginx DNS resolution

Railway private networking uses internal DNS (`*.railway.internal`) to route between services. When a service redeploys, it gets a new internal IP address.

Standard Nginx `proxy_pass` with a literal hostname resolves DNS once at startup and caches the result forever. This means after any upstream service redeploy, Nginx keeps connecting to the dead old IP, causing 504 gateway timeouts.

The fix (already applied in `gateway/nginx.conf`):

1. Use Railway's IPv6 DNS resolver: `resolver [fd12::10] valid=5s ipv6=off;`
2. Use variable-based proxy_pass: `set $upstream "service.railway.internal:PORT"; proxy_pass http://$upstream;`
3. Use explicit `rewrite` rules to strip path prefixes, because variable-based proxy_pass does not do automatic URI replacement like literal proxy_pass with a trailing slash.

### Duplicate volumes

`railway volume add` does not check if a volume already exists at the target mount path. Calling it twice creates duplicate volumes, which prevents the container from starting ("Failed to create deployment").

`bootstrap.sh` now checks `railway volume list --json` before adding a volume.

### API image venv path

The GHCR API image installs packages in `/opt/venv/` but the default `PATH` at build time resolves `python` to `/usr/local/bin/python` (bare system python without packages). When running custom commands (like alembic migrations), use `/opt/venv/bin/python` explicitly.

### Worker Redis defaults

The API image defaults to docker-compose hostnames for Redis (`redis-durable:6381`). On Railway, workers need explicit Redis env vars pointing to `redis://redis.railway.internal:6379/0`.

### Build times on first deploy

First deploys on Railway take longer because Docker layer caches are cold. Deploy now relies mostly on readiness polling in smoke checks instead of fixed sleeps, so slower starts are less likely to fail prematurely.

For GitHub preview builds, CI uses shared BuildKit registry cache tags (`buildcache-shared`) plus PR-scoped tags (`buildcache-pr-<number>`). It also builds API, web, services, and runner images in parallel matrix jobs. This keeps repeated PR builds fast and also improves first builds on new PRs by reusing layers from previous runs. Manual workflow dispatches without a PR number use `manual-<sha>` image tags and skip deploy.

### SDK source in preview builds

API and services Dockerfiles build from the repo root so they can install the branch-local Python SDK and generated Python client directly from `sdks/python` and `clients/python`. Railway preview CI and the local helper script use that same root build context, so no SDK/client injection step is needed.

The `hosting/docker-compose/*gh*.yml` files use the same model for Python images: API and Services build from the repo root, while Web keeps `web/` as its context.

### Smoke check options

The smoke script supports these environment variables:

- `SMOKE_MAX_RETRIES` (default `10`) - legacy retry count used to derive timeout when `SMOKE_MAX_WAIT_SECONDS` is not set
- `SMOKE_SLEEP_SECONDS` (default `5`) - poll interval between readiness checks
- `SMOKE_MAX_WAIT_SECONDS` (default `SMOKE_MAX_RETRIES * SMOKE_SLEEP_SECONDS`) - max wait time per endpoint before failing
- `SMOKE_DOMAIN_MAX_WAIT_SECONDS` (default `SMOKE_MAX_WAIT_SECONDS`) - max wait time for gateway domain resolution
- `SMOKE_CURL_CONNECT_TIMEOUT` (default `5`) - per-request TCP/TLS connect timeout in seconds
- `SMOKE_CURL_MAX_TIME` (default `10`) - max duration per health request in seconds
- `SMOKE_AUTO_REPAIR` (default `false`) - redeploy failing services automatically

For CI, consider `SMOKE_AUTO_REPAIR=false` to get clean pass/fail signals without side effects.

## Rate Limits and Token Types

Railway enforces API rate limits per token tier:

| Plan    | Requests per hour | Requests per second |
|---------|-------------------|---------------------|
| Free    | 100               | -                   |
| Hobby   | 1,000             | 10                  |
| Pro     | 10,000            | 50                  |

Railway has three token types: account (personal), workspace (team), and project.
Account tokens work with the CLI. Workspace tokens carry Pro rate limits but the
CLI rejects them with "Unauthorized" because it internally calls user-scoped
GraphQL queries (like `me { ... }`) that workspace tokens cannot resolve. This is
a known limitation with no fix planned as of February 2026.
See [railwayapp/cli#618](https://github.com/railwayapp/cli/issues/618),
[railwayapp/cli#575](https://github.com/railwayapp/cli/issues/575),
and [railwayapp/cli#789](https://github.com/railwayapp/cli/pull/789).

The standalone deploy scripts use a `railway_call` wrapper (defined in
`lib.sh`) that retries on rate-limit responses with exponential backoff, and
`CONFIGURE_SKIP_UNSETS=true` skips ~73 unnecessary variable-delete API calls
where appropriate. The PR preview flow does not use the CLI at all: it drives
the GraphQL API through `template/lib-graphql.sh` (bounded retries, call
accounting) and stays around 15 calls per preview cycle.

## Notes

- This fast-start flow keeps auth minimal (`AGENTA_LICENSE=oss`).
- CI is wired for Railway preview environments via `.github/workflows/14-check-pr-preview.yml` (PR preview automation entrypoint), `.github/workflows/41-railway-setup.yml` (reusable/manual create-or-update of the preview environment), `.github/workflows/42-railway-build.yml` (reusable/manual image build), `.github/workflows/43-railway-deploy.yml` (reusable/manual verify + PR comment), `.github/workflows/44-railway-tests.yml` (reusable/manual post-deploy tests), `.github/workflows/45-railway-cleanup.yml` (destroy on close + daily stale sweep), `.github/workflows/47-railway-template-drift.yml` (daily template drift check), and `.github/workflows/48-railway-clone-preview-test.yml` (acceptance harness).
- Postgres and Redis are provisioned as image-backed services with explicit volume mounts.
- Redis now gets a `/data` volume during bootstrap for persistence.
- `configure.sh` sets `RAILWAY_RUN_UID=0` and `RAILWAY_RUN_GID=0` on the Redis
  service (when present) so Railway does not force a non-root runtime UID.
- Redis deployments use a wrapper entrypoint to prepare `/data` before handing
  off to the official Redis entrypoint, preventing `MISCONF` from RDB write
  permission failures.
- Alembic now creates `agenta_oss_core`, `agenta_oss_tracing`, and `agenta_oss_supertokens` automatically before running migrations.
- OTLP traces and event/record processing require `worker-streams` to be deployed and healthy.
- Evaluation jobs, webhook deliveries, triggers, and interactions require `worker-queues` to be deployed and healthy.
- The scripts intentionally do not persist secrets in git-tracked files.
