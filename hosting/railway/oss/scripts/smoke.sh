#!/usr/bin/env bash

set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"
MAX_RETRIES="${SMOKE_MAX_RETRIES:-10}"
SLEEP_SECONDS="${SMOKE_SLEEP_SECONDS:-5}"
MAX_WAIT_SECONDS="${SMOKE_MAX_WAIT_SECONDS:-$((MAX_RETRIES * SLEEP_SECONDS))}"
DOMAIN_WAIT_SECONDS="${SMOKE_DOMAIN_MAX_WAIT_SECONDS:-${MAX_WAIT_SECONDS}}"
CURL_CONNECT_TIMEOUT="${SMOKE_CURL_CONNECT_TIMEOUT:-5}"
CURL_MAX_TIME="${SMOKE_CURL_MAX_TIME:-10}"
AUTO_REPAIR="${SMOKE_AUTO_REPAIR:-false}"

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

railway link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null

resolve_domain() {
    local started now elapsed
    started="$(date +%s)"

    while true; do
        DOMAIN="$(railway variable list -k --service gateway --environment "$ENV_NAME" | grep '^RAILWAY_PUBLIC_DOMAIN=' | cut -d= -f2- || true)"
        if [ -n "$DOMAIN" ]; then
            return 0
        fi

        now="$(date +%s)"
        elapsed=$((now - started))
        if [ "$elapsed" -ge "$DOMAIN_WAIT_SECONDS" ]; then
            return 1
        fi

        printf "Waiting for gateway domain (%ds/%ds)\n" "$elapsed" "$DOMAIN_WAIT_SECONDS"
        sleep "$SLEEP_SECONDS"
    done
}

DOMAIN=""
resolve_domain || {
    printf "Could not resolve gateway domain within %ss.\n" "$DOMAIN_WAIT_SECONDS" >&2
    exit 1
}

if [ -z "$DOMAIN" ]; then
    printf "Could not resolve gateway domain. Did domain generation complete?\n" >&2
    exit 1
fi

BASE="https://${DOMAIN}"

printf "Checking %s\n" "$BASE"

check_endpoint() {
    local path="$1"
    local attempt=1
    local started now elapsed

    started="$(date +%s)"

    while true; do
        if curl -fsS --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" "${BASE}${path}" >/dev/null; then
            printf "OK: %s\n" "$path"
            return 0
        fi

        now="$(date +%s)"
        elapsed=$((now - started))
        if [ "$elapsed" -ge "$MAX_WAIT_SECONDS" ]; then
            printf "FAILED: %s after %ss\n" "$path" "$elapsed" >&2
            return 1
        fi

        printf "Retry %d (%ds/%ds) for %s\n" "$attempt" "$elapsed" "$MAX_WAIT_SECONDS" "$path"
        sleep "$SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done
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
