#!/usr/bin/env bash

# Shared helpers for Railway deployment scripts.
# Source this file; do not execute it directly.

railway_repo_root() {
    cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd
}

railway_source_compose_file() {
    local root_dir="${1:-$(railway_repo_root)}"
    printf "%s/hosting/docker-compose/oss/docker-compose.gh.yml" "$root_dir"
}

compose_service_image() {
    local compose_file="$1"
    local service_name="$2"

    if [ ! -f "$compose_file" ]; then
        printf "Compose file not found: %s\n" "$compose_file" >&2
        return 1
    fi

    awk -v service="$service_name" '
        BEGIN {
            in_services = 0
            in_target = 0
        }

        /^services:[[:space:]]*$/ {
            in_services = 1
            next
        }

        in_services && /^[^[:space:]]/ {
            in_services = 0
            in_target = 0
        }

        !in_services {
            next
        }

        /^    [^[:space:]][^:]*:[[:space:]]*$/ {
            line = $0
            sub(/^    /, "", line)
            sub(/:[[:space:]]*$/, "", line)
            in_target = (line == service)
            next
        }

        in_target && /^        image:[[:space:]]*/ {
            line = $0
            sub(/^        image:[[:space:]]*/, "", line)
            sub(/[[:space:]]*$/, "", line)
            print line
            exit 0
        }
    ' "$compose_file"
}

require_compose_service_image() {
    local compose_file="$1"
    local service_name="$2"
    local image

    image="$(compose_service_image "$compose_file" "$service_name")"
    if [ -z "$image" ]; then
        printf "Unable to resolve image for service '%s' from compose file %s\n" \
            "$service_name" "$compose_file" >&2
        return 1
    fi

    printf "%s" "$image"
}

require_compose_redis_image() {
    local compose_file="$1"
    local image=""

    image="$(compose_service_image "$compose_file" "redis-durable" || true)"
    if [ -z "$image" ]; then
        image="$(compose_service_image "$compose_file" "redis-volatile" || true)"
    fi

    if [ -z "$image" ]; then
        printf "Unable to resolve a Redis image from compose file %s\n" "$compose_file" >&2
        return 1
    fi

    printf "%s" "$image"
}

# railway_call: Run a railway CLI command, retrying on rate-limit responses.
#
# Railway returns "You are being ratelimited. Please try again later" on
# HTTP 429. This wrapper detects that message and backs off with exponential
# backoff before retrying.
#
# Usage:
#   railway_call [railway args...]
#
# Environment variables:
#   RAILWAY_RETRY_MAX     Max retry attempts (default: 5)
#   RAILWAY_RETRY_DELAY   Initial delay in seconds (default: 10)
#
railway_call() {
    local max_attempts="${RAILWAY_RETRY_MAX:-5}"
    local delay="${RAILWAY_RETRY_DELAY:-10}"
    local attempt=1
    local output
    local exit_code

    while [ "$attempt" -le "$max_attempts" ]; do
        output="$(railway "$@" 2>&1)" && exit_code=0 || exit_code=$?

        if printf "%s" "$output" | grep -qi "ratelimit\|rate.limit\|rate limit"; then
            if [ "$attempt" -eq "$max_attempts" ]; then
                printf "railway %s: rate-limited after %d attempts\n" "$*" "$max_attempts" >&2
                printf "%s\n" "$output" >&2
                return 1
            fi
            printf "railway %s: rate-limited, retrying in %ds (attempt %d/%d)\n" \
                "$1" "$delay" "$attempt" "$max_attempts" >&2
            sleep "$delay"
            delay=$((delay * 2))
            attempt=$((attempt + 1))
            continue
        fi

        # Not a rate-limit error. Print output and return the original exit code.
        printf "%s\n" "$output"
        return "$exit_code"
    done
}
