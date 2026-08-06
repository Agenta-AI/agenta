#!/usr/bin/env bash

set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-production}"
RUN_DB_INIT="${UPGRADE_RUN_DB_INIT:-true}"
RUN_GATEWAY_RETRY="${UPGRADE_GATEWAY_RETRY_ON_FAIL:-true}"

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf "Starting upgrade for project '%s' (%s)\n" "$PROJECT_NAME" "$ENV_NAME"

export RAILWAY_PROJECT_NAME="$PROJECT_NAME"
export RAILWAY_ENVIRONMENT_NAME="$ENV_NAME"

"$SCRIPT_DIR/configure.sh"

if [ "$RUN_DB_INIT" = "true" ]; then
    "$SCRIPT_DIR/init-databases.sh"
fi

"$SCRIPT_DIR/deploy-services.sh"

set +e
"$SCRIPT_DIR/smoke.sh"
smoke_code=$?
set -e

if [ "$smoke_code" -ne 0 ] && [ "$RUN_GATEWAY_RETRY" = "true" ]; then
    printf "Initial smoke failed. Redeploying gateway and retrying smoke checks.\n"
    "$SCRIPT_DIR/deploy-gateway.sh"
    "$SCRIPT_DIR/smoke.sh"
fi

printf "Upgrade completed for project '%s' (%s)\n" "$PROJECT_NAME" "$ENV_NAME"
