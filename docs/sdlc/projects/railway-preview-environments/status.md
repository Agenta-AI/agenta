# Status: Railway OSS -> Preview Environments

## Current Phase: Phase 2 (CI Integration) -- Workflows Created

**Last Updated**: 2026-02-19

---

## Progress Summary

| Workstream | Status | Notes |
|---|---|---|
| Feasibility check | Done | Railway supports required primitives |
| Architecture direction | Done | Gateway-first path routing selected |
| Planning docs | Done | Context/research/plan/status/qa created |
| Implementation (Phase 1) | Done | CLI-only deploy from scratch verified on clean project |
| Preview lifecycle scripts | Done | `preview-create-or-update.sh` and `preview-destroy.sh` ready |
| CI workflow wiring | Done | 3 workflows created (build, deploy, cleanup) |

---

## Decisions Made

1. Start with OSS programmatic deployment before preview environments.
2. Use a single public gateway service to preserve `/`, `/api`, `/services` routing.
3. Keep the workflow CLI-first and CI-friendly.
4. Split Postgres into three logical databases for core, tracing, and supertokens.
5. Run tracing persistence through a dedicated `worker-tracing` service.
6. Run evaluation jobs through dedicated `worker-evaluations` service for Compose parity.
7. Preview deployments will use CI-built, PR-tagged images for `api`, `web`, and `services`.
8. Migrations run as a dedicated job step (`alembic`) before app service rollout.
9. Use Railway internal DNS resolver `[fd12::10]` with variable-based proxy_pass in Nginx.
10. Use a single Redis instance for both volatile and durable queues.

## Decisions Pending

1. Final template UX strategy for managed Postgres variables in Railway UI.

---

## Blockers

No critical blocker. The deploy-from-images flow passes all smoke checks from scratch on a fresh project with no manual steps.

---

## Next Actions

1. Add `RAILWAY_TOKEN` as GitHub Actions secret.
2. Test workflows end-to-end on a real PR.
3. Confirm GHCR image visibility (public or token-gated for Railway pull).
4. Phase 2.4: add structured logging and dry-run mode to scripts.
5. Phase 3: stale cleanup cost tracking, OTLP/eval e2e checks.

---

## Bugs Found and Fixed (2026-02-19)

### Bug 1: Nginx cached upstream IPs forever (504 gateway timeouts)

Nginx `proxy_pass` with a literal hostname resolves DNS once at config load and never re-resolves. When any Railway service redeploys and gets a new internal IP, Nginx keeps connecting to the dead old IP.

Fix: use Railway DNS resolver `[fd12::10]` with `valid=5s`, variable-based `proxy_pass`, and explicit `rewrite` rules to strip path prefixes. See `hosting/railway/oss/gateway/nginx.conf`.

### Bug 2: Duplicate volumes crashed Postgres and Redis

`bootstrap.sh` called `railway volume add` unconditionally. Running bootstrap twice created two volumes on the same mount path. Railway cannot start a container with duplicate volumes on the same path ("Failed to create deployment").

Fix: check `railway volume list --json` before adding. See `hosting/railway/oss/scripts/bootstrap.sh`.

### Bug 3: Alembic used wrong python (no sqlalchemy)

The Dockerfile CMD used `python` which resolved to `/usr/local/bin/python` (bare system python). The venv with sqlalchemy is at `/opt/venv/bin/python`.

Fix: use explicit `/opt/venv/bin/python` in alembic CMD. See `hosting/railway/oss/scripts/deploy-from-images.sh`.

### Bug 4: Workers missing Redis environment variables

The `render_api_like_wrapper` function did not set `REDIS_URI*` or `SUPERTOKENS_CONNECTION_URI`. The image defaults to docker-compose hostnames (`redis-durable:6381`) which do not exist on Railway.

Fix: added Railway-specific Redis and SuperTokens env vars to the wrapper. See `hosting/railway/oss/scripts/deploy-from-images.sh`.

---

## Recent Updates

### 2026-02-18

- Added Railway OSS deployment scaffolding in `hosting/railway/oss/`.
- Added gateway Dockerfile and Nginx config for path-based routing.
- Added scripts:
  - `hosting/railway/oss/scripts/bootstrap.sh`
  - `hosting/railway/oss/scripts/configure.sh`
  - `hosting/railway/oss/scripts/deploy-gateway.sh`
  - `hosting/railway/oss/scripts/smoke.sh`
- Verified shell script syntax with `bash -n`.
- Deployed working Railway baseline with `gateway`, `web`, `api`, `services`, `supertokens`, `Postgres`, `Redis`.
- Added `worker-tracing` deployment (`python -m entrypoints.worker_tracing`).
- Added `worker-evaluations` deployment (`python -m entrypoints.worker_evaluations`).
- Added `cron` deployment (`cron -f`) and confirmed scheduled execution logs.
- Fixed `__env.js` generation by running web through `/app/entrypoint.sh`.
- Split database URIs by function (`agenta_oss_core`, `agenta_oss_tracing`, `agenta_oss_supertokens`).
- Confirmed spans now persist in `agenta_oss_tracing.public.spans`.
- Added `init-databases.sh` and `deploy-services.sh` to reduce manual setup steps.
- Added `upgrade.sh` for one-command production upgrades.
- Added `template-precheck.sh` to validate source metadata before Railway UI template export.
- Ran full scratch deployment in a separate Railway project using script commands only.
- Scratch deployment passed smoke checks for `/w`, `/api/health`, and `/services/health`.
- Rebuilt a clean `agenta-oss-railway-template` project with full source metadata coverage.
- Reduced template input noise by moving runtime defaults to service Dockerfiles.
- Remaining template prompts are Postgres infrastructure variables from Railway managed database template.
- Reviewed current OSS CI from `agenta_cloud` and confirmed it deploys from source on host (`docker compose --build`) while GHCR publishing is separate and manual.
- Added reusable local scripts for image-tagged deploy flow that CI can call directly:
  - `hosting/railway/oss/scripts/build-and-push-images.sh`
  - `hosting/railway/oss/scripts/deploy-from-images.sh`

### 2026-02-19

- Fixed four root-cause bugs (see "Bugs Found and Fixed" above).
- Rewrote `hosting/railway/oss/gateway/nginx.conf`:
  - Uses Railway IPv6 DNS resolver `[fd12::10]` with 5s TTL.
  - All three routes use variable-based `proxy_pass` for dynamic DNS re-resolution.
  - Added `rewrite` rules to strip `/api/` and `/services/` prefixes (required when using variable-based proxy_pass).
- Fixed `hosting/railway/oss/scripts/bootstrap.sh`:
  - `ensure_volume` now checks for existing volumes before adding to prevent duplicates.
- Fixed `hosting/railway/oss/scripts/deploy-from-images.sh`:
  - Alembic CMD uses `/opt/venv/bin/python` instead of bare `python`.
  - Worker wrappers now include Redis and SuperTokens env vars.
  - Added infra redeploy and Alembic retry loop for fresh projects.
- Added preview lifecycle scripts:
  - `hosting/railway/oss/scripts/preview-create-or-update.sh`
  - `hosting/railway/oss/scripts/preview-destroy.sh`
- Ran clean end-to-end test on fresh project `aosstest4`:
  - `bootstrap.sh` + `deploy-from-images.sh` with `SMOKE_AUTO_REPAIR=false`.
  - All 11 services healthy (alembic STOPPED as expected for one-shot job).
  - Smoke checks passed on first attempt: `/w` 200, `/api/health` 200, `/services/health` 200.
- Created 3 GitHub Actions workflows for Phase 2 CI integration:
  - `.github/workflows/06-railway-preview-build.yml`: builds and pushes PR-tagged images to GHCR on PR open/sync. Uses Docker Buildx with GHA cache. Chains to deploy workflow.
  - `.github/workflows/07-railway-preview-deploy.yml`: reusable workflow that installs Railway CLI, runs `preview-create-or-update.sh`, posts preview URL as PR comment (creates or updates). Shows failure status with link to logs on error.
  - `.github/workflows/08-railway-preview-cleanup.yml`: destroys preview on PR close (updates PR comment to "Destroyed"), runs daily stale cleanup cron at 06:00 UTC, supports manual dispatch with dry-run mode.
- Added stale cleanup to Phase 2 scope (previously planned for Phase 3) since `preview-cleanup-stale.sh` already exists.
