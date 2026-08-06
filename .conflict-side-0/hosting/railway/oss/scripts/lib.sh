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

# _railway_redact: Mask secret values before they are logged. Reads stdin and
# writes redacted text to stdout. Masks the value of any KEY=VALUE token whose
# (uppercase) key contains PASSWORD/TOKEN/SECRET/KEY, plus the password segment
# of any scheme://user:password@host URL. Keeps diagnostic output safe to print
# and to upload as a CI artifact even when a failing command echoes its args.
#
# Applied only to failure/diagnostic output, never to the success path that
# callers parse (e.g. `variable list -k` results).
_railway_redact() {
    sed -E \
        -e 's/([A-Z0-9_]*(PASSWORD|TOKEN|SECRET|KEY)[A-Z0-9_]*[[:space:]]*=[[:space:]]*)[^[:space:]]+/\1***REDACTED***/g' \
        -e 's#(://[A-Za-z0-9._~-]+:)[^@[:space:]/]+@#\1***REDACTED***@#g'
}

# railway_call: Run a railway CLI command with smart, context-aware retries.
#
# Railway's GraphQL API (backboard.railway.com) intermittently rate-limits
# (HTTP 429) and, far more often for us, times out write mutations such as
# `variable set` ("operation timed out" / "error sending request"). This
# wrapper retries the cases that are safe + useful to retry, and fails fast on
# the rest:
#
#   - rate-limit          -> always retried. A 429 is a clean rejection: the
#                            request was not processed, so a retry cannot
#                            duplicate work.
#   - transient network   -> retried ONLY for idempotent commands. A timed-out
#     (timeout/5xx/reset)    mutation may have already succeeded server-side, so
#                            we do NOT blind-retry non-idempotent creates
#                            (`init`, `add`, `environment new`, `volume add`):
#                            that risks duplicate projects/services/volumes.
#                            `variable set` (our actual offender) is an
#                            idempotent upsert, so it is retried.
#   - anything else       -> not retried. Deterministic errors ("not found",
#                            "unauthorized", "No service linked") fail fast
#                            instead of burning the backoff budget.
#
# Backoff is exponential. Failure output is redacted (see _railway_redact).
#
# Environment variables:
#   RAILWAY_RETRY_MAX     Max attempts (default: 5)
#   RAILWAY_RETRY_DELAY   Initial backoff delay in seconds (default: 10)
railway_call() {
    local max_attempts="${RAILWAY_RETRY_MAX:-5}"
    [ "$max_attempts" -ge 1 ] 2>/dev/null || max_attempts=1
    local delay="${RAILWAY_RETRY_DELAY:-10}"
    local attempt=1
    local output
    local exit_code

    # Is this a non-idempotent / side-effecting command? If so, an ambiguous
    # timeout must not be blind-retried: the server may have already accepted
    # the request, so a retry could duplicate the resource (`init`/`add`/
    # `environment new`/`volume add`) or trigger a second deployment (`up`/
    # `redeploy`). Rate-limit retries stay safe for all commands because a 429
    # is rejected before any work is done.
    local idempotent=1
    case "$1" in
        init | add | up | redeploy) idempotent=0 ;;
        environment) [ "${2:-}" = "new" ] && idempotent=0 ;;
        volume) [ "${2:-}" = "add" ] && idempotent=0 ;;
    esac

    while [ "$attempt" -le "$max_attempts" ]; do
        # `set +Ee` inside the subshell so a non-zero exit from `railway`
        # neither trips errexit nor fires an inherited ERR trap. This wrapper
        # handles retries and reports failures itself.
        output="$(set +Ee; railway "$@" 2>&1)" && exit_code=0 || exit_code=$?

        # Success: emit on stdout so callers can capture the output.
        if [ "$exit_code" -eq 0 ]; then
            printf "%s\n" "$output"
            return 0
        fi

        # Classify the failure to decide whether a retry is safe + useful.
        local kind="error"
        if printf "%s" "$output" | grep -qiE "ratelimit|rate.?limit"; then
            kind="rate-limit"
        elif printf "%s" "$output" | grep -qiE "timed out|error sending request|failed to fetch|error trying to connect|connection (reset|refused|closed|error)|temporarily unavailable|service unavailable|bad gateway|gateway time-?out|broken pipe|unexpected eof|tls handshake"; then
            kind="transient"
        fi

        local retryable=0
        case "$kind" in
            rate-limit) retryable=1 ;;
            transient) [ "$idempotent" -eq 1 ] && retryable=1 ;;
        esac

        if [ "$retryable" -eq 1 ] && [ "$attempt" -lt "$max_attempts" ]; then
            printf "railway %s: %s, retrying in %ds (attempt %d/%d)\n" \
                "$1" "$kind" "$delay" "$attempt" "$max_attempts" >&2
            sleep "$delay"
            delay=$((delay * 2))
            attempt=$((attempt + 1))
            continue
        fi

        # Give up: not retryable, attempts exhausted, or an ambiguous timeout
        # on a non-idempotent create. Surface the (redacted) railway error.
        if [ "$retryable" -eq 1 ]; then
            printf "railway %s: %s — giving up after %d attempts\n" \
                "$1" "$kind" "$attempt" >&2
        elif [ "$kind" = "transient" ] && [ "$idempotent" -eq 0 ]; then
            printf "railway %s: %s on non-idempotent command — not retrying (may have partially succeeded)\n" \
                "$1" "$kind" >&2
        fi
        [ -n "$output" ] && printf "%s\n" "$output" | _railway_redact >&2
        return "$exit_code"
    done
}

# _railway_graphql: POST a GraphQL request to Railway's backboard API using
# RAILWAY_API_TOKEN. Used for variableCollectionUpsert, which sets all of a
# service's variables in ONE mutation — Railway's recommended path, since the
# CLI's `variable set` fans out to one (server-side expensive) variableUpsert
# per key. On success prints the response body to stdout and returns 0. Retries
# on transient network / 429 / 5xx / timeout with the same backoff as
# railway_call; failure output is redacted.
#
# Usage: _railway_graphql '<json-payload>'
#
# Environment variables:
#   RAILWAY_GRAPHQL_URL       Endpoint (default: backboard.railway.com/graphql/v2)
#   RAILWAY_GRAPHQL_TIMEOUT   Per-attempt curl timeout in seconds (default: 90)
#   RAILWAY_RETRY_MAX/DELAY   Shared with railway_call
_railway_graphql() {
    local payload="$1"
    local endpoint="${RAILWAY_GRAPHQL_URL:-https://backboard.railway.com/graphql/v2}"
    local token="${RAILWAY_API_TOKEN:-${RAILWAY_TOKEN:-}}"
    local max_attempts="${RAILWAY_RETRY_MAX:-5}"
    [ "$max_attempts" -ge 1 ] 2>/dev/null || max_attempts=1
    local delay="${RAILWAY_RETRY_DELAY:-10}"
    local timeout_s="${RAILWAY_GRAPHQL_TIMEOUT:-90}"
    local attempt=1

    while [ "$attempt" -le "$max_attempts" ]; do
        local raw http body curl_rc
        # `set +Ee` so a curl failure neither trips errexit nor fires the ERR
        # trap; we classify and retry here. -w appends the HTTP status on its
        # own line after the (single-line) JSON body.
        raw="$(set +Ee; curl -sS --max-time "$timeout_s" -w $'\n%{http_code}' \
            -X POST "$endpoint" \
            -H "Authorization: Bearer ${token}" \
            -H "Content-Type: application/json" \
            --data "$payload" 2>&1)" && curl_rc=0 || curl_rc=$?
        http="${raw##*$'\n'}"
        body="${raw%$'\n'*}"

        # Success = curl ok + HTTP 200 + no GraphQL "errors" array.
        if [ "$curl_rc" -eq 0 ] && [ "$http" = "200" ] \
            && ! printf '%s' "$body" | grep -q '"errors"'; then
            printf '%s\n' "$body"
            return 0
        fi

        local retryable=0
        if [ "$curl_rc" -ne 0 ]; then
            retryable=1                                   # network error / timeout
        elif printf '%s' "$http" | grep -qE '^(429|5[0-9][0-9])$'; then
            retryable=1                                   # rate-limit / server error
        elif printf '%s' "$body" | grep -qiE "rate.?limit|timed out|temporarily unavailable|service unavailable"; then
            retryable=1
        fi

        if [ "$retryable" -eq 1 ] && [ "$attempt" -lt "$max_attempts" ]; then
            printf "railway graphql: transient (http=%s curl=%s), retrying in %ds (attempt %d/%d)\n" \
                "$http" "$curl_rc" "$delay" "$attempt" "$max_attempts" >&2
            sleep "$delay"
            delay=$((delay * 2))
            attempt=$((attempt + 1))
            continue
        fi

        printf "railway graphql request failed (http=%s curl=%s)\n" "$http" "$curl_rc" >&2
        [ -n "$body" ] && printf "%s\n" "$body" | _railway_redact >&2
        return 1
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
    # Redact secrets: $BASH_COMMAND can contain secret-bearing args (e.g.
    # `railway variable set ... AGENTA_AUTH_KEY=...`).
    local cmd
    cmd="$(printf '%s' "$2" | _railway_redact)"

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
    local logs

    for svc in "${services[@]}"; do
        printf '\n===== railway logs (last %s lines): %s =====\n' "$lines" "$svc" >&2
        # Capture first so the exit status reflects railway/timeout (not the
        # redactor), then print redacted (service logs may embed DB URIs).
        if logs="$(timeout "$timeout_s" railway logs --service "$svc" --lines "$lines" --latest 2>&1)"; then
            printf '%s\n' "$logs" | _railway_redact >&2
        else
            printf '(no logs available for service: %s)\n' "$svc" >&2
        fi
    done

    return 0
}
