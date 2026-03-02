#!/usr/bin/env bash

set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

railway link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null

# Bring stateful infra up first so credentials/volumes are applied.
railway service Postgres >/dev/null && railway redeploy --yes
railway service redis >/dev/null && railway redeploy --yes

# Deployment order matters. Migrations first, gateway last.
# Alembic runs as a job and should complete before API startup checks.
railway up hosting/railway/oss/alembic --path-as-root --service alembic
railway up hosting/railway/oss/api --path-as-root --service api --detach
railway up hosting/railway/oss/worker-tracing --path-as-root --service worker-tracing --detach
railway up hosting/railway/oss/worker-evaluations --path-as-root --service worker-evaluations --detach
railway up hosting/railway/oss/services --path-as-root --service services --detach
railway up hosting/railway/oss/cron --path-as-root --service cron --detach
railway up hosting/railway/oss/web --path-as-root --service web --detach

# Give private DNS records and container startups time to settle.
sleep 45

railway up hosting/railway/oss/gateway --path-as-root --service gateway --detach

printf "Deployments triggered for '%s' (%s)\n" "$PROJECT_NAME" "$ENV_NAME"
