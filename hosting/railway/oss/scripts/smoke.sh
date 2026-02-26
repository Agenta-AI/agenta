#!/usr/bin/env bash

set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"
MAX_RETRIES="${SMOKE_MAX_RETRIES:-10}"
SLEEP_SECONDS="${SMOKE_SLEEP_SECONDS:-5}"
AUTO_REPAIR="${SMOKE_AUTO_REPAIR:-false}"

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

railway link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null

DOMAIN="$(railway variable list -k --service gateway --environment "$ENV_NAME" | grep '^RAILWAY_PUBLIC_DOMAIN=' | cut -d= -f2-)"

if [ -z "$DOMAIN" ]; then
    printf "Could not resolve gateway domain. Did domain generation complete?\n" >&2
    exit 1
fi

BASE="https://${DOMAIN}"

printf "Checking %s\n" "$BASE"

check_endpoint() {
    local path="$1"
    local attempt=1

    while [ "$attempt" -le "$MAX_RETRIES" ]; do
        if curl -fsS "${BASE}${path}" >/dev/null; then
            printf "OK: %s\n" "$path"
            return 0
        fi

        printf "Retry %d/%d for %s\n" "$attempt" "$MAX_RETRIES" "$path"
        sleep "$SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done

    printf "FAILED: %s\n" "$path" >&2
    return 1
}

repair_path() {
    local path="$1"

    if [ "$AUTO_REPAIR" != "true" ]; then
        return 1
    fi

    case "$path" in
        "/w")
            railway service web >/dev/null && railway redeploy --yes >/dev/null
            railway service gateway >/dev/null && railway redeploy --yes >/dev/null
            ;;
        "/api/health")
            railway service api >/dev/null && railway redeploy --yes >/dev/null
            railway service gateway >/dev/null && railway redeploy --yes >/dev/null
            ;;
        "/services/health")
            railway service services >/dev/null && railway redeploy --yes >/dev/null
            railway service gateway >/dev/null && railway redeploy --yes >/dev/null
            ;;
        *)
            return 1
            ;;
    esac

    sleep 20
    return 0
}

check_with_repair() {
    local path="$1"
    if check_endpoint "$path"; then
        return 0
    fi

    if repair_path "$path"; then
        printf "Retesting after repair: %s\n" "$path"
        check_endpoint "$path"
        return $?
    fi

    return 1
}

check_with_repair "/w"
check_with_repair "/api/health"
check_with_repair "/services/health"

printf "Smoke checks passed for %s\n" "$BASE"
