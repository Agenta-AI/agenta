# Railway OSS Deployment Notes

## What we deployed

We deployed Agenta OSS on Railway with one public gateway and private internal services.

- Public entrypoint: single Railway-generated domain on the `gateway` service.
- Path routing:
  - `/` to web
  - `/api/` to api (prefix stripped by Nginx rewrite)
  - `/services/` to services (prefix stripped by Nginx rewrite)

Services deployed (11 total):

- `gateway` - Nginx reverse proxy, only public-facing service
- `web` - Next.js frontend
- `api` - FastAPI backend (gunicorn + uvicorn workers)
- `services` - internal services API
- `worker-evaluations` - Taskiq evaluation worker
- `worker-tracing` - Redis stream consumer for OTLP span ingestion
- `cron` - scheduled jobs
- `alembic` - one-shot migration runner (STOPPED after success)
- `supertokens` - auth provider
- `Postgres` - single instance, three logical databases
- `redis` - single instance for volatile and durable queues

## What changed from `docker-compose.gh.yml`

The Docker Compose baseline runs many containers at once. Railway needs each service to be deployed separately.

1) We added wrapper Dockerfiles for some services.

- `hosting/railway/oss/web/Dockerfile`
- `hosting/railway/oss/api/Dockerfile`
- `hosting/railway/oss/services/Dockerfile`
- `hosting/railway/oss/gateway/Dockerfile`
- `hosting/railway/oss/worker-tracing/Dockerfile`

Why: the GHCR images rely on Compose `command` fields. Railway does not apply Compose commands. We therefore set explicit runtime commands in Dockerfiles.

2) We added a dedicated gateway Nginx config.

- `hosting/railway/oss/gateway/nginx.conf`

Why: we keep one public domain and preserve Agenta path semantics.

3) We run tracing ingestion as a dedicated worker service.

- `worker-tracing` runs `python -m entrypoints.worker_tracing`

Why: OTLP requests enqueue spans in Redis. The worker drains the stream and writes spans to Postgres.

4) We moved from one shared Postgres database to three logical databases.

- `agenta_oss_core`
- `agenta_oss_tracing`
- `agenta_oss_supertokens`

Why: migration chains are independent. A shared database caused Alembic revision conflicts.

5) We updated the alembic service to create required databases before migrations.

Why: template users should not need a separate manual SQL step before first startup.

## Root cause analysis: bugs found during testing

### Bug 1: Nginx DNS caching caused 504 gateway timeouts

**Symptom**: After any upstream service redeploy, the gateway returned 504 timeouts for 30+ seconds.

**Root cause**: Standard Nginx `proxy_pass` with a literal hostname resolves DNS once at config load and caches the IP forever. Railway assigns new internal IPs on each redeploy. Nginx kept connecting to the dead old IP.

**Fix**: Three changes in `hosting/railway/oss/gateway/nginx.conf`:
- Use Railway IPv6 DNS resolver: `resolver [fd12::10] valid=5s ipv6=off;`
- Use variable-based proxy_pass for all routes: `set $upstream "service.railway.internal:PORT"; proxy_pass http://$upstream;`
- Add `rewrite` rules to strip `/api/` and `/services/` prefixes. Variable-based proxy_pass does not do automatic URI replacement like literal proxy_pass with a trailing slash.

**Why autorepair masked this**: The smoke script's autorepair triggered `railway redeploy` on the gateway after timeout failures. This restarted Nginx, which re-resolved DNS and got the correct new IP. This made the issue appear transient rather than systematic.

### Bug 2: Duplicate volumes crashed Postgres and Redis

**Symptom**: Postgres and Redis showed "Failed to create deployment" with no useful error in logs.

**Root cause**: `railway volume add` succeeds unconditionally. If `bootstrap.sh` ran twice (or a volume already existed from a previous run), it created a second volume at the same mount path. Railway cannot start a container with two volumes mounted at the same path.

**Fix**: `ensure_volume` in `bootstrap.sh` now checks `railway volume list --json` for an existing volume at the target mount path before calling `volume add`.

### Bug 3: Alembic migration runner used wrong python

**Symptom**: Alembic service crashed immediately with `ModuleNotFoundError: No module named 'sqlalchemy'`.

**Root cause**: The Dockerfile CMD used `python` (via `sh -lc`). In the container, this resolved to `/usr/local/bin/python` (bare system python). The venv with all installed packages (sqlalchemy, alembic, etc.) lives at `/opt/venv/bin/python`. The image's default `ENTRYPOINT` activates the venv via `PATH`, but the wrapper Dockerfile overrode the entrypoint.

**Fix**: Use `/opt/venv/bin/python` explicitly in the alembic CMD in `deploy-from-images.sh`.

### Bug 4: Workers could not connect to Redis

**Symptom**: `worker-tracing` crashed with `Error -2 connecting to redis-durable:6381. Name or service not known.`

**Root cause**: The `render_api_like_wrapper` function in `deploy-from-images.sh` did not set `REDIS_URI`, `REDIS_URI_VOLATILE`, `REDIS_URI_DURABLE`, or `SUPERTOKENS_CONNECTION_URI`. The image defaults come from docker-compose, which uses hostnames like `redis-durable:6381` that do not exist on Railway.

**Fix**: Added all required env vars to the api-like wrapper template in `deploy-from-images.sh`, pointing to `redis://redis.railway.internal:6379/0`.

## Environment variables that differ from local compose defaults

The values below are the meaningful deltas. We do not list secrets here.

Global URLs (all app services):

- `AGENTA_WEB_URL=https://<gateway-domain>`
- `AGENTA_API_URL=https://<gateway-domain>/api`
- `AGENTA_SERVICES_URL=https://<gateway-domain>/services`

API specific:

- `SCRIPT_NAME=/api`
- `PORT=8000`
- `REDIS_URI=redis://redis.railway.internal:6379/0`
- `REDIS_URI_VOLATILE=redis://redis.railway.internal:6379/0`
- `REDIS_URI_DURABLE=redis://redis.railway.internal:6379/0`
- `SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567`
- `POSTGRES_URI_CORE=.../agenta_oss_core`
- `POSTGRES_URI_TRACING=.../agenta_oss_tracing`
- `POSTGRES_URI_SUPERTOKENS=.../agenta_oss_supertokens`

Services specific:

- `SCRIPT_NAME=/services`
- `PORT=80`
- `AGENTA_API_INTERNAL_URL=http://api.railway.internal:8000/api`
- `REDIS_URI=redis://redis.railway.internal:6379/0`
- `REDIS_URI_VOLATILE=redis://redis.railway.internal:6379/0`
- `REDIS_URI_DURABLE=redis://redis.railway.internal:6379/0`
- `POSTGRES_URI_CORE=.../agenta_oss_core`
- `POSTGRES_URI_TRACING=.../agenta_oss_tracing`

Workers (worker-tracing, worker-evaluations, cron):

- `REDIS_URI=redis://redis.railway.internal:6379/0`
- `REDIS_URI_VOLATILE=redis://redis.railway.internal:6379/0`
- `REDIS_URI_DURABLE=redis://redis.railway.internal:6379/0`
- `SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567`
- `POSTGRES_URI_CORE=.../agenta_oss_core`
- `POSTGRES_URI_TRACING=.../agenta_oss_tracing`
- `POSTGRES_URI_SUPERTOKENS=.../agenta_oss_supertokens`

Web specific:

- Start command runs through image entrypoint so `__env.js` is generated.
- `HOSTNAME=0.0.0.0` in web wrapper image so Next.js binds correctly on Railway.

## Verified test results

Clean end-to-end test on 2026-02-19 (project `aosstest4`):

- Flow: `bootstrap.sh` then `deploy-from-images.sh` with `SMOKE_AUTO_REPAIR=false`.
- All 11 services reached healthy state (alembic STOPPED is expected).
- Smoke checks passed on first attempt:
  - `/w` -> 200
  - `/api/health` -> 200
  - `/services/health` -> 200
- No manual Railway UI interaction at any point.

## Can we turn this into a template

Yes. We can create a practical template now.

What already exists:

- Service Dockerfiles and gateway config under `hosting/railway/oss/`
- Bootstrap and configure scripts under `hosting/railway/oss/scripts/`
- A known good variable matrix and service topology
- Compose parity for app services, workers, and cron on Railway

What we should add before publishing a template:

1) A post-deploy check that validates OTLP end to end by writing one test span and checking `spans_count`.
2) A command that prints exact required variables with placeholders.

Important template requirement:

Railway UI template export expects each service to have source metadata (`source.image` or `source.repo`). Services created as empty and deployed only with `railway up` can fail template export with messages like "Service web does not have a source that can be used to generate a template".

Mitigation in our scripts:

- `bootstrap.sh` now creates web, api, services, workers, cron, and alembic as image-backed services.
- For gateway, set `AGENTA_GATEWAY_IMAGE` during bootstrap if you want template export support.
- Use `template-precheck.sh` before clicking template export in Railway UI.

Current template behavior:

- App-level required inputs have been reduced by moving runtime defaults to Dockerfiles.
- Railway-managed Postgres still exposes its own infrastructure variables as required template inputs.
- Those variables are not Agenta-specific. They can use standard defaults.

## Operator commands for first setup

These commands are enough for a clean deploy in a new Railway project.

```bash
export RAILWAY_PROJECT_NAME="agenta-oss-railway"
export RAILWAY_ENVIRONMENT_NAME="production"

./hosting/railway/oss/scripts/bootstrap.sh
./hosting/railway/oss/scripts/configure.sh
./hosting/railway/oss/scripts/init-databases.sh
./hosting/railway/oss/scripts/deploy-services.sh
./hosting/railway/oss/scripts/smoke.sh
```

Or using the image-based flow (recommended):

```bash
export RAILWAY_PROJECT_NAME="agenta-oss-railway"
export RAILWAY_ENVIRONMENT_NAME="production"

source ./hosting/railway/oss/.last-images.env
# or set AGENTA_API_IMAGE, AGENTA_WEB_IMAGE, AGENTA_SERVICES_IMAGE manually

./hosting/railway/oss/scripts/bootstrap.sh
./hosting/railway/oss/scripts/deploy-from-images.sh
```

## Upgrade approach on Railway

Use rolling image upgrades with a fixed order and a quick smoke test between steps.

Suggested order:

1) Deploy `alembic` and run migrations.
2) Deploy `api`.
3) Deploy `worker-tracing`.
4) Deploy `services`.
5) Deploy `web`.
6) Deploy `gateway` last.

We now provide `hosting/railway/oss/scripts/upgrade.sh` to run this sequence in one command.

Verification after each upgrade:

- `GET /api/health`
- `GET /services/health`
- `GET /w`
- Send one OTLP test span and confirm a new row in `agenta_oss_tracing.public.spans`.

Rollback strategy:

- Redeploy previous image digest for the failing service.
- Keep migrations backward compatible for at least one version step where possible.

## CI alignment note

Current OSS deployment automation in `agenta_cloud` uses source-based host deploys (`docker compose --build`) and a separate manual GHCR release workflow.

For Railway preview environments, we will split CI into:

1. Build and publish PR-tagged images (`api`, `web`, `services`).
2. Deploy Railway preview services from those tags using `preview-create-or-update.sh`.
3. Clean up on PR close using `preview-destroy.sh`.

This keeps preview behavior deterministic and close to production image rollouts.
