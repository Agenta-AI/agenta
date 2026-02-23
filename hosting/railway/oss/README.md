# Railway OSS Deployment (Programmatic)

This directory contains a CLI-first bootstrap path to deploy Agenta OSS on Railway with minimal manual steps.

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
- `worker-evaluations/` - Taskiq worker image for evaluations
- `worker-tracing/` - tracing ingestion worker image
- `cron/` - cron service image
- `alembic/` - migration runner image
- `scripts/bootstrap.sh` - create project, environment, and services
- `scripts/configure.sh` - set variables and start commands
- `scripts/deploy-gateway.sh` - deploy gateway image from local Dockerfile
- `scripts/smoke.sh` - quick health checks
- `scripts/upgrade.sh` - run full in-place upgrade flow
- `scripts/build-and-push-images.sh` - build local `api/web/services` images and push tags
- `scripts/deploy-from-images.sh` - deploy Railway services from explicit image tags
- `scripts/preview-create-or-update.sh` - create or update a PR-scoped preview project
- `scripts/preview-destroy.sh` - delete a PR-scoped preview project

## Prerequisites

1. Railway CLI installed (`railway --version`)
2. `jq` installed
3. Valid `RAILWAY_API_TOKEN` in your shell (account token from https://railway.com/account/tokens)
4. For Railway UI template export, set a gateway image (`AGENTA_GATEWAY_IMAGE`) so gateway has source metadata

## Security Note

The scripts use placeholder defaults for `AGENTA_AUTH_KEY` and `AGENTA_CRYPT_KEY` (all-zeros and all-ones). This is fine for ephemeral preview environments. For persistent deployments, set unique values:

```bash
export AGENTA_AUTH_KEY="$(openssl rand -hex 32)"
export AGENTA_CRYPT_KEY="$(openssl rand -hex 32)"
```

## Quick Start

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

## Upgrade Existing Deployment

```bash
export RAILWAY_PROJECT_NAME="agenta-oss-railway"
export RAILWAY_ENVIRONMENT_NAME="production"

./hosting/railway/oss/scripts/upgrade.sh
```

Optional flags:

- `UPGRADE_RUN_DB_INIT=false` skips database init.
- `UPGRADE_GATEWAY_RETRY_ON_FAIL=false` skips automatic gateway retry.

## Deploy Current Local Code (Image-Based)

This flow mirrors the `agenta_cloud` pattern where scripts are reusable locally and in CI.

```bash
# Login to GHCR first. Example:
# echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin

export GHCR_NAMESPACE="agenta-ai"
export IMAGE_TAG="pr-123-$(git rev-parse --short HEAD)"

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

## Preview Lifecycle Scripts

Create or update a PR preview project:

```bash
export PR_NUMBER=123
export IMAGE_TAG="pr-123-$(git rev-parse --short HEAD)"

./hosting/railway/oss/scripts/preview-create-or-update.sh
```

Delete the same PR preview project:

```bash
export PR_NUMBER=123
./hosting/railway/oss/scripts/preview-destroy.sh
```

Defaults:

- Project naming uses `RAILWAY_PREVIEW_PROJECT_PREFIX` (default `agenta-oss-pr`) and a normalized preview key.
- Preview key resolution order is `RAILWAY_PREVIEW_KEY`, `PR_NUMBER`, `GITHUB_PR_NUMBER`, then GitHub branch refs.

## Template Export Readiness

Railway template generation requires every service to have source metadata.

- `source.image` works for image-backed services.
- `source.repo` works for repo-linked services.

Run precheck before using the Railway UI template button:

```bash
./hosting/railway/oss/scripts/template-precheck.sh
```

If precheck fails, the usual reason is gateway missing source metadata. The fix is to bootstrap with `AGENTA_GATEWAY_IMAGE` set, or recreate gateway as a repo-linked service.

If services were created earlier without source metadata, Railway template export can still fail. In that case, create a fresh project with the updated bootstrap flow, or recreate affected services with image-backed or repo-backed source.

## Expected Template Inputs

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

First deploys on Railway take longer because Docker layer caches are cold. The app settle window (`RAILWAY_APP_SETTLE_SECONDS`, default 60) may not be enough on very slow builds. If smoke fails because services are still DEPLOYING, wait and re-run smoke manually.

### Smoke check options

The smoke script supports these environment variables:

- `SMOKE_MAX_RETRIES` (default `30`) - retries per endpoint
- `SMOKE_SLEEP_SECONDS` (default `10`) - sleep between retries
- `SMOKE_AUTO_REPAIR` (default `true`) - redeploy failing services automatically

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

The deploy scripts use a `railway_call` wrapper (defined in `lib.sh`) that retries
on rate-limit responses with exponential backoff. Preview deploys also set
`CONFIGURE_SKIP_UNSETS=true` to skip ~73 unnecessary variable-delete API calls,
keeping total calls around 58 per deploy.

### Future: migrate high-call operations to GraphQL

Workspace tokens work with the Railway GraphQL API at
`https://backboard.railway.com/graphql/v2`. To unlock Pro rate limits (10,000 RPH)
without waiting for CLI support, the highest-call-count operations could be replaced
with direct GraphQL mutations. The best candidates are:

- `configure.sh` variable set/delete loops (currently one CLI call per variable per
  service). A single `variableCollectionUpsert` GraphQL mutation can set all
  variables for a service in one call.
- `bootstrap.sh` project listing and service creation. The `projects` and
  `serviceCreate` mutations can be batched.
- `preview-cleanup-stale.sh` project deletion loop.

This is not urgent while deploys stay under ~58 calls, but becomes necessary if
the deploy flow grows or back-to-back deploys hit the 1,000 RPH Hobby ceiling.

## Notes

- This fast-start flow keeps auth minimal (`AGENTA_LICENSE=oss`) and does not wire CI yet.
- Postgres and Redis are provisioned as image-backed services with explicit volume mounts.
- Redis now gets a `/data` volume during bootstrap for persistence.
- Alembic now creates `agenta_oss_core`, `agenta_oss_tracing`, and `agenta_oss_supertokens` automatically before running migrations.
- OTLP traces require `worker-tracing` to be deployed and healthy.
- Evaluation jobs require `worker-evaluations` to be deployed and healthy.
- The scripts intentionally do not persist secrets in git-tracked files.
