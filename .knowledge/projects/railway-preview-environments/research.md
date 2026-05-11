# Research: Railway + Agenta Feasibility

## Summary

Railway supports the core primitives needed for Agenta OSS deployment and preview environments:

- multi-service projects
- CLI project/service/environment management
- Dockerfile/image-based deploys
- private networking between services
- managed Postgres/Redis templates
- domains, healthchecks, volumes, env vars

The main architectural requirement is to preserve Agenta's path-based routing using a public gateway service.

## Agenta Findings

1. API root path is configured to `/api`:
   - `api/entrypoints/routers.py:174`
2. API CORS allowlist is static for localhost/vercel by default:
   - `api/entrypoints/routers.py:192`
3. Services component exposes `/health`:
   - `services/entrypoints/main.py:20`
4. OSS setup expects multiple databases and migration flow:
   - DB bootstrap SQL: `api/oss/databases/postgres/init-db-oss.sql`
   - migration runner: `api/oss/databases/postgres/migrations/runner.py`
5. Docker Compose baseline includes web/api/services/workers/cron/supertokens/postgres/redis:
   - `hosting/docker-compose/oss/docker-compose.gh.yml`
6. Current OSS CI in `agenta_cloud` deploys from source on target hosts (AWS SSM + docker compose build), not from PR-specific GHCR images:
   - workflow: `/home/mahmoud/code/agenta_cloud/.github/workflows/21-deploy-to-oss.yml`
   - command template: `/home/mahmoud/code/agenta_cloud/scripts/utils/commands.oss.template`
   - target script: `/home/mahmoud/code/agenta_cloud/scripts/aws/setup_oss.sh`
7. `agenta_cloud` also has a separate GHCR publishing workflow for api/web/services images, currently manual:
   - workflow: `/home/mahmoud/code/agenta_cloud/.github/workflows/43-release-to-ghcr.yml`

## Railway Findings

1. CLI supports programmatic project/service/environment orchestration.
2. CLI supports setting variables, attaching volumes, adding domains.
3. `railway environment new --duplicate` can clone environment config, useful for previews.
4. Deploy strategy can use:
   - source upload (`railway up`)
   - image-based services (`railway add --image`)
5. Config-as-code (`railway.toml`/`railway.json`) can control build/deploy behavior per service.

6. `railway up` from monorepo paths needs `--path-as-root` for reliable Dockerfile selection.

7. Internal DNS hostnames (`*.railway.internal`) are valid for private service-to-service traffic.

## Key Risks

1. Split-domain service exposure can trigger CORS/browser issues.
2. Monorepo multi-service deploy orchestration may be error-prone without strict conventions.
3. DB setup and migration ordering can cause startup failures if not serialized.
4. Preview environments can become expensive without TTL cleanup and limits.

## Implementation Caveats (Observed)

1. The web image must run through `/app/entrypoint.sh` to generate `__env.js`. If this step is skipped, the frontend loads with missing runtime config.

2. The web process must bind to `0.0.0.0` on Railway. Binding to container hostname causes public gateway failures.

3. OTLP ingestion requires both API route and background worker. The API endpoint can return success while spans still do not persist if `worker-tracing` is absent.

4. Core and tracing migration histories conflict when both point to one database. Three logical databases are required for stable migrations.

5. Gateway can show temporary 502 or 504 responses while upstream services redeploy. This is expected during rollout windows.

6. In a fresh project, gateway DNS resolution for private upstreams can fail during early startup. A second gateway deploy after other services are healthy resolves this reliably.

## Recommendations

1. Use a single public gateway service for path routing (`/`, `/api`, `/services`).
2. Start with OSS baseline deployment script and smoke checks.
3. Add preview env lifecycle only after baseline is stable in CI.
4. For Railway PR previews, prefer CI-built, PR-tagged images (api/web/services) over `railway up` source deploys.
5. Treat `worker-tracing` as a required baseline service, not an optional worker.
6. Add a post-deploy OTLP persistence check against `agenta_oss_tracing.public.spans`.
7. Keep image publishing and deployment as separate CI stages, matching the current `agenta_cloud` pattern (release workflow plus deploy workflow).
