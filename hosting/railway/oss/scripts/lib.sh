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
        # `set +Ee` inside the subshell so a non-zero exit from `railway`
        # neither trips errexit nor fires an inherited ERR trap. This wrapper
        # handles rate-limit retries and reports failures itself.
        output="$(set +Ee; railway "$@" 2>&1)" && exit_code=0 || exit_code=$?

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

        # Not a rate-limit error.
        if [ "$exit_code" -eq 0 ]; then
            # Success: emit on stdout so callers can capture the output.
            printf "%s\n" "$output"
        else
            # Failure: emit on stderr so callers that redirect stdout to
            # /dev/null still surface the underlying railway error.
            [ -n "$output" ] && printf "%s\n" "$output" >&2
        fi
        return "$exit_code"
    done
}

# install_error_trap: Turn a bare "exit 1" into a diagnostic that names the
# failing command and prints a short call stack. Call once near the top of a
# script, after sourcing this file. Enables errtrace (set -E) so the trap also
# fires for failures inside functions.
#
# railway_call disables errtrace inside its own command substitution, so
# tolerated failures (callers using `|| true`) do not reach this trap.
_railway_on_error() {
    # The same failure can unwind through several stack frames; report once.
    [ -n "${_RAILWAY_ERR_HANDLED:-}" ] && return 0
    _RAILWAY_ERR_HANDLED=1

    local exit_code="$1"
    local cmd="$2"

    printf '\n[railway][FAIL] command failed (exit %s): %s\n' "$exit_code" "$cmd" >&2

    local i
    for ((i = 1; i < ${#FUNCNAME[@]}; i++)); do
        printf '    at %s (%s:%s)\n' \
            "${FUNCNAME[i]}" "${BASH_SOURCE[i]}" "${BASH_LINENO[i - 1]}" >&2
    done

    # Surface a GitHub Actions annotation when running in CI.
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
        printf '::error::[railway] command failed (exit %s): %s\n' "$exit_code" "$cmd" >&2
    fi
}

install_error_trap() {
    set -E
    trap '_railway_on_error "$?" "$BASH_COMMAND"' ERR
}

# dump_railway_logs: Best-effort snapshot of Railway service logs, for CI
# debugging. Uses --lines (non-streaming) and --latest (works even when a
# deployment failed or is crash-looping), wrapped in a hard timeout so it can
# never hang or fail the caller. Requires a linked project/environment.
#
# Usage: dump_railway_logs [service ...]   (defaults to the core infra set)
#
# Environment variables:
#   RAILWAY_LOG_TAIL      Lines to fetch per service (default: 50)
#   RAILWAY_LOG_TIMEOUT   Per-service timeout in seconds (default: 30)
dump_railway_logs() {
    local services=("$@")
    if [ "${#services[@]}" -eq 0 ]; then
        services=(Postgres redis alembic api supertokens web)
    fi

    local lines="${RAILWAY_LOG_TAIL:-50}"
    local timeout_s="${RAILWAY_LOG_TIMEOUT:-30}"
    local svc

    for svc in "${services[@]}"; do
        printf '\n===== railway logs (last %s lines): %s =====\n' "$lines" "$svc" >&2
        timeout "$timeout_s" \
            railway logs --service "$svc" --lines "$lines" --latest >&2 2>&1 \
            || printf '(no logs available for service: %s)\n' "$svc" >&2
    done

    return 0
}
