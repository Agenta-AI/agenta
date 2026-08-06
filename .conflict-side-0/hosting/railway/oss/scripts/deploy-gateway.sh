#!/usr/bin/env bash

set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"
GATEWAY_PATH="${RAILWAY_GATEWAY_PATH:-./hosting/railway/oss/gateway}"

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

railway link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null
railway up "$GATEWAY_PATH" --path-as-root --service gateway --detach

printf "Gateway deployment triggered for '%s' (%s)\n" "$PROJECT_NAME" "$ENV_NAME"
