#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway-template}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-production}"
POSTGRES_SERVICE="${RAILWAY_POSTGRES_SERVICE:-Postgres}"
REDIS_SERVICE="${RAILWAY_REDIS_SERVICE:-redis}"
INFRA_SETTLE_SECONDS="${RAILWAY_INFRA_SETTLE_SECONDS:-40}"
APP_SETTLE_SECONDS="${RAILWAY_APP_SETTLE_SECONDS:-60}"
ALEMBIC_MAX_ATTEMPTS="${RAILWAY_ALEMBIC_MAX_ATTEMPTS:-3}"

AGENTA_API_IMAGE="${AGENTA_API_IMAGE:-}"
AGENTA_WEB_IMAGE="${AGENTA_WEB_IMAGE:-}"
AGENTA_SERVICES_IMAGE="${AGENTA_SERVICES_IMAGE:-}"

if [ -z "$AGENTA_API_IMAGE" ] || [ -z "$AGENTA_WEB_IMAGE" ] || [ -z "$AGENTA_SERVICES_IMAGE" ]; then
    printf "AGENTA_API_IMAGE, AGENTA_WEB_IMAGE, and AGENTA_SERVICES_IMAGE are required\n" >&2
    exit 1
fi

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

redeploy_service_if_exists() {
    local service="$1"

    if railway service "$service" >/dev/null 2>&1; then
        railway redeploy --yes >/dev/null
    fi
}

run_alembic_with_retries() {
    local attempt=1

    while [ "$attempt" -le "$ALEMBIC_MAX_ATTEMPTS" ]; do
        if railway up "$TMP_DIR/alembic" --path-as-root --service alembic; then
            return 0
        fi

        if [ "$attempt" -eq "$ALEMBIC_MAX_ATTEMPTS" ]; then
            printf "Alembic failed after %s attempts\n" "$ALEMBIC_MAX_ATTEMPTS" >&2
            return 1
        fi

        printf "Alembic failed on attempt %s/%s, retrying after infra redeploy\n" "$attempt" "$ALEMBIC_MAX_ATTEMPTS"
        redeploy_service_if_exists "$POSTGRES_SERVICE"
        sleep "$INFRA_SETTLE_SECONDS"
        attempt=$((attempt + 1))
    done
}

render_api_like_wrapper() {
    local service="$1"
    local command_json="$2"
    local dir="$TMP_DIR/$service"

    mkdir -p "$dir"
    cat > "$dir/Dockerfile" <<EOF
FROM ${AGENTA_API_IMAGE}

ENV AGENTA_LICENSE=oss
ENV AGENTA_API_URL=http://api.railway.internal:8000/api
ENV AGENTA_API_INTERNAL_URL=http://api.railway.internal:8000/api
ENV REDIS_URI=redis://redis.railway.internal:6379/0
ENV REDIS_URI_VOLATILE=redis://redis.railway.internal:6379/0
ENV REDIS_URI_DURABLE=redis://redis.railway.internal:6379/0
ENV SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567
ENV AGENTA_AUTH_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENV AGENTA_CRYPT_KEY=1111111111111111111111111111111111111111111111111111111111111111

CMD ${command_json}
EOF
}

render_api_wrapper() {
    local dir="$TMP_DIR/api"
    mkdir -p "$dir"
    cat > "$dir/Dockerfile" <<EOF
FROM ${AGENTA_API_IMAGE}

ENV AGENTA_LICENSE=oss
ENV PORT=8000
ENV SCRIPT_NAME=/api
ENV REDIS_URI=redis://redis.railway.internal:6379/0
ENV REDIS_URI_VOLATILE=redis://redis.railway.internal:6379/0
ENV REDIS_URI_DURABLE=redis://redis.railway.internal:6379/0
ENV SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567
ENV AGENTA_AUTH_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENV AGENTA_CRYPT_KEY=1111111111111111111111111111111111111111111111111111111111111111

CMD ["gunicorn", "entrypoints.routers:app", "--bind", "0.0.0.0:8000", "--worker-class", "uvicorn.workers.UvicornWorker", "--workers", "2", "--max-requests", "10000", "--max-requests-jitter", "1000", "--timeout", "60", "--graceful-timeout", "60", "--log-level", "info", "--access-logfile", "-", "--error-logfile", "-"]
EOF
}

render_services_wrapper() {
    local dir="$TMP_DIR/services"
    mkdir -p "$dir"
    cat > "$dir/Dockerfile" <<EOF
FROM ${AGENTA_SERVICES_IMAGE}

ENV AGENTA_LICENSE=oss
ENV PORT=80
ENV SCRIPT_NAME=/services
ENV AGENTA_API_INTERNAL_URL=http://api.railway.internal:8000/api
ENV REDIS_URI=redis://redis.railway.internal:6379/0
ENV REDIS_URI_VOLATILE=redis://redis.railway.internal:6379/0
ENV REDIS_URI_DURABLE=redis://redis.railway.internal:6379/0
ENV AGENTA_AUTH_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENV AGENTA_CRYPT_KEY=1111111111111111111111111111111111111111111111111111111111111111

CMD ["gunicorn", "entrypoints.main:app", "--bind", "0.0.0.0:80", "--worker-class", "uvicorn.workers.UvicornWorker", "--workers", "2", "--max-requests", "10000", "--max-requests-jitter", "1000", "--timeout", "60", "--graceful-timeout", "60", "--log-level", "info", "--access-logfile", "-", "--error-logfile", "-"]
EOF
}

render_web_wrapper() {
    local dir="$TMP_DIR/web"
    mkdir -p "$dir"
    cat > "$dir/Dockerfile" <<EOF
FROM ${AGENTA_WEB_IMAGE}

ENV HOSTNAME=0.0.0.0
ENV AGENTA_LICENSE=oss
ENV AGENTA_AUTH_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENV AGENTA_CRYPT_KEY=1111111111111111111111111111111111111111111111111111111111111111

CMD ["sh", "-lc", "/app/entrypoint.sh node /app/oss/server.js"]
EOF
}

render_alembic_wrapper() {
    local dir="$TMP_DIR/alembic"
    mkdir -p "$dir"
    cp "$ROOT_DIR/hosting/railway/oss/alembic/create_databases.py" "$dir/create_databases.py"
    cat > "$dir/Dockerfile" <<EOF
FROM ${AGENTA_API_IMAGE}

ENV AGENTA_LICENSE=oss
ENV AGENTA_AUTH_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENV AGENTA_CRYPT_KEY=1111111111111111111111111111111111111111111111111111111111111111
ENV ALEMBIC_CFG_PATH_CORE=/app/oss/databases/postgres/migrations/core/alembic.ini
ENV ALEMBIC_CFG_PATH_TRACING=/app/oss/databases/postgres/migrations/tracing/alembic.ini

COPY create_databases.py /tmp/create_databases.py
CMD ["sh", "-c", "/opt/venv/bin/python /tmp/create_databases.py && /opt/venv/bin/python -m oss.databases.postgres.migrations.runner"]
EOF
}

render_api_wrapper
render_services_wrapper
render_web_wrapper
render_alembic_wrapper
render_api_like_wrapper worker-tracing '["python", "-m", "entrypoints.worker_tracing"]'
render_api_like_wrapper worker-evaluations '["python", "-m", "entrypoints.worker_evaluations"]'
render_api_like_wrapper cron '["cron", "-f"]'

export RAILWAY_PROJECT_NAME="$PROJECT_NAME"
export RAILWAY_ENVIRONMENT_NAME="$ENV_NAME"

# Brief pause to avoid hitting Railway's API rate limit immediately after
# the bootstrap phase, which fires many API calls in quick succession.
sleep "${RAILWAY_POST_BOOTSTRAP_SLEEP:-5}"

"$ROOT_DIR/hosting/railway/oss/scripts/configure.sh"

# Ensure infra picks up freshly configured credentials before migrations.
railway link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null
redeploy_service_if_exists "$POSTGRES_SERVICE"
redeploy_service_if_exists "$REDIS_SERVICE"
sleep "$INFRA_SETTLE_SECONDS"

# Alembic first. This also creates required databases.
run_alembic_with_retries

railway up "$TMP_DIR/api" --path-as-root --service api --detach
railway up "$TMP_DIR/worker-tracing" --path-as-root --service worker-tracing --detach
railway up "$TMP_DIR/worker-evaluations" --path-as-root --service worker-evaluations --detach
railway up "$TMP_DIR/services" --path-as-root --service services --detach
railway up "$TMP_DIR/cron" --path-as-root --service cron --detach
railway up "$TMP_DIR/web" --path-as-root --service web --detach

sleep "$APP_SETTLE_SECONDS"
"$ROOT_DIR/hosting/railway/oss/scripts/deploy-gateway.sh"
"$ROOT_DIR/hosting/railway/oss/scripts/smoke.sh"

printf "Deploy from images completed for '%s' (%s)\n" "$PROJECT_NAME" "$ENV_NAME"
