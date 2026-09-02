#!/usr/bin/env bash

# Minimal GraphQL client for Railway's backboard API, used by the preview
# template tooling (apply.sh, workflow 47). Source this file; do not execute
# it directly. This is the productionized copy of the client proven live in
# docs/design/railway-preview-clone-spike/spike/lib-graphql.sh; keeping a copy
# here keeps the template tooling decoupled from the spike workspace and from
# the per-PR scripts in ../scripts/ (WP3 territory).
#
# Follows the idioms of hosting/railway/oss/scripts/lib.sh:
#   - failure output is redacted (rw_redact mirrors _railway_redact),
#   - retries are bounded and classified (429 always retried, transient network
#     errors retried ONLY when the caller says the call is idempotent — a timed
#     out mutation may have succeeded server-side),
#   - every curl has explicit connect + total timeouts.
#
# Every HTTP request sent increments RW_CALLS_FILE so callers can report how
# many API calls a run cost against Railway's per-token hourly budget
# (Hobby tier: 1000 requests/hour, shared with the preview workflows).
#
# Environment variables:
#   RAILWAY_API_TOKEN     Account token. Auto-sourced from ~/.agenta-railway.env
#                         (format: RAILWAY_API_TOKEN=...) when unset.
#   RW_TOKEN_FILE         Override the token file path.
#   RW_GRAPHQL_URL        Endpoint (default: backboard.railway.com/graphql/v2).
#   RW_GRAPHQL_TIMEOUT    Per-attempt total timeout in seconds (default: 60).
#   RW_RETRY_MAX          Max attempts per call (default: 5).
#   RW_RETRY_DELAY        Initial backoff in seconds (default: 5, doubles).
#   RW_NO_TRANSIENT_RETRY Set to 1 around a NON-idempotent mutation (e.g.
#                         serviceCreate, volumeCreate) so an ambiguous timeout
#                         is not blind-retried; the caller must reconcile by
#                         querying (check-then-act). A 429 and a workspace
#                         rate-limit rejection are still retried under it:
#                         both reject the request before any work happens.
#   RW_RATE_LIMIT_WAIT    Seconds to wait after a workspace rate-limit
#                         rejection (default: 35, past Railway's 30s window).

# Call counter. A file, not a shell variable: callers invoke rw_graphql inside
# command substitutions (subshells), where a variable increment would be lost.
RW_CALLS_FILE="${RW_CALLS_FILE:-$(mktemp "${TMPDIR:-/tmp}/rw-calls.XXXXXX")}"
export RW_CALLS_FILE
# Caller-visible diagnostic state (last HTTP status); not read by this file.
export RW_LAST_HTTP=""
RW_LAST_HEADERS_FILE="${RW_LAST_HEADERS_FILE:-$(mktemp "${TMPDIR:-/tmp}/rw-headers.XXXXXX")}"
export RW_LAST_HEADERS_FILE

# rw_redact: mask KEY=VALUE secrets and URL passwords before logging.
# Same sed as _railway_redact in hosting/railway/oss/scripts/lib.sh.
rw_redact() {
    sed -E \
        -e 's/([A-Z0-9_]*(PASSWORD|TOKEN|SECRET|KEY)[A-Z0-9_]*[[:space:]]*=[[:space:]]*)[^[:space:]]+/\1***REDACTED***/g' \
        -e 's#(://[A-Za-z0-9._~-]+:)[^@[:space:]/]+@#\1***REDACTED***@#g'
}

# rw_require_token: ensure RAILWAY_API_TOKEN is set, sourcing the local env
# file when needed. Never prints the token.
rw_require_token() {
    local token_file="${RW_TOKEN_FILE:-$HOME/.agenta-railway.env}"
    if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -f "$token_file" ]; then
        # shellcheck source=/dev/null
        . "$token_file"
    fi
    if [ -z "${RAILWAY_API_TOKEN:-}" ]; then
        printf "RAILWAY_API_TOKEN is not set and %s does not provide it.\n" "$token_file" >&2
        printf "Create an ACCOUNT token at railway.com/account/tokens and store it as\n" >&2
        printf "  RAILWAY_API_TOKEN=... in %s (chmod 600), or export it (CI).\n" "$token_file" >&2
        printf "Do NOT name it RAILWAY_TOKEN: the CLI treats that name as project-scoped\n" >&2
        printf "and account-level calls fail Unauthorized.\n" >&2
        return 1
    fi
    export RAILWAY_API_TOKEN
}

# _rw_retry_after <headers-file> <fallback-seconds>: honor Retry-After when the
# server sends one (capped at 120s), else use the caller's backoff value.
_rw_retry_after() {
    local hdr_file="$1" fallback="$2" ra
    ra="$(grep -i '^retry-after:' "$hdr_file" 2>/dev/null | head -n1 | awk '{print $2}' | tr -d '\r')"
    if printf '%s' "$ra" | grep -qE '^[0-9]+$'; then
        [ "$ra" -gt 120 ] && ra=120
        printf '%s' "$ra"
    else
        printf '%s' "$fallback"
    fi
}

# rw_graphql <query> [variables-json]: POST one GraphQL operation. On success
# prints the full response body (with .data) to stdout and returns 0. On
# failure prints a redacted diagnostic to stderr and returns 1. GraphQL-level
# errors (HTTP 200 + "errors") are deterministic and never retried.
rw_graphql() {
    local query="$1"
    local variables="${2:-}"
    [ -n "$variables" ] || variables='{}'

    local endpoint="${RW_GRAPHQL_URL:-https://backboard.railway.com/graphql/v2}"
    local timeout_s="${RW_GRAPHQL_TIMEOUT:-60}"
    local max_attempts="${RW_RETRY_MAX:-5}"
    [ "$max_attempts" -ge 1 ] 2>/dev/null || max_attempts=1
    local delay="${RW_RETRY_DELAY:-5}"
    local RW_RATE_LIMIT_WAIT="${RW_RATE_LIMIT_WAIT:-35}"
    local attempt=1

    local payload
    payload="$(jq -nc --arg q "$query" --argjson v "$variables" '{query: $q, variables: $v}')" || {
        printf "rw_graphql: could not build payload (bad variables JSON?)\n" >&2
        return 1
    }

    while [ "$attempt" -le "$max_attempts" ]; do
        local body_file http curl_rc
        body_file="$(mktemp "${TMPDIR:-/tmp}/rw-body.XXXXXX")"
        printf '\n' >>"$RW_CALLS_FILE"
        # `set +Ee` so a curl failure neither trips errexit nor an inherited
        # ERR trap; classification happens here (same pattern as lib.sh).
        http="$(set +Ee; curl -sS --connect-timeout 10 --max-time "$timeout_s" \
            -D "$RW_LAST_HEADERS_FILE" -o "$body_file" -w '%{http_code}' \
            -X POST "$endpoint" \
            -H "Authorization: Bearer ${RAILWAY_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "$payload" 2>/dev/null)" && curl_rc=0 || curl_rc=$?
        RW_LAST_HTTP="$http"

        if [ "$curl_rc" -eq 0 ] && [ "$http" = "200" ] \
            && ! jq -e '.errors' "$body_file" >/dev/null 2>&1; then
            cat "$body_file"
            rm -f "$body_file"
            return 0
        fi

        local retryable=0 wait_s="$delay"
        if [ "$curl_rc" -ne 0 ]; then
            # Network error / timeout: possibly ambiguous for mutations.
            [ "${RW_NO_TRANSIENT_RETRY:-0}" = "1" ] || retryable=1
        elif [ "$http" = "429" ]; then
            # Clean rejection: always safe to retry; honor Retry-After.
            retryable=1
            wait_s="$(_rw_retry_after "$RW_LAST_HEADERS_FILE" "$delay")"
        elif printf '%s' "$http" | grep -qE '^5[0-9][0-9]$'; then
            [ "${RW_NO_TRANSIENT_RETRY:-0}" = "1" ] || retryable=1
        elif [ "$http" = "200" ] \
            && grep -qiE 'too quickly|allows [0-9]+ [a-z]+ per [0-9]+ seconds' "$body_file"; then
            # A workspace rate limit comes back as HTTP 200 with a GraphQL
            # error, not as a 429: "You are creating environments too quickly.
            # This workspace allows 1 environment per 30 seconds." Nothing was
            # created, so this is a clean rejection and is safe to retry even
            # for a non-idempotent mutation. The windows are 30s
            # (projectCreate, environmentCreate, volumeCreate), so wait past
            # the window instead of using the short default backoff.
            retryable=1
            wait_s=$(( delay > RW_RATE_LIMIT_WAIT ? delay : RW_RATE_LIMIT_WAIT ))
            printf 'rw_graphql: workspace rate limit hit; nothing was created.\n' >&2
        fi

        if [ "$retryable" -eq 1 ] && [ "$attempt" -lt "$max_attempts" ]; then
            printf "rw_graphql: transient (http=%s curl=%s), retrying in %ss (attempt %d/%d)\n" \
                "$http" "$curl_rc" "$wait_s" "$attempt" "$max_attempts" >&2
            rm -f "$body_file"
            sleep "$wait_s"
            delay=$((delay * 2))
            attempt=$((attempt + 1))
            continue
        fi

        printf "rw_graphql: request failed (http=%s curl=%s)\n" "$http" "$curl_rc" >&2
        [ -s "$body_file" ] && rw_redact <"$body_file" >&2 && printf '\n' >&2
        rm -f "$body_file"
        return 1
    done
}

# rw_find_project_id <name>: resolve a project id by name. `projects` with no
# arguments returns an EMPTY list for account tokens — the query must be
# scoped with workspaceId, so iterate the token's workspaces from `me`. First
# match wins (preview projects can carry duplicate names).
rw_find_project_id() {
    local name="$1" ws id
    local ws_ids
    ws_ids="$(rw_graphql 'query { me { workspaces { id } } }' \
        | jq -r '.data.me.workspaces[].id')" || return 1
    for ws in $ws_ids; do
        id="$(rw_graphql \
            'query($w: String!) { projects(workspaceId: $w, first: 100) { edges { node { id name } } } }' \
            "$(jq -nc --arg w "$ws" '{w: $w}')" \
            | jq -r --arg n "$name" \
                '[.data.projects.edges[].node | select(.name == $n) | .id][0] // empty')" || return 1
        if [ -n "$id" ]; then
            printf '%s' "$id"
            return 0
        fi
    done
    return 1
}

# rw_call_count: total HTTP requests recorded by this process tree.
rw_call_count() {
    if [ -f "$RW_CALLS_FILE" ]; then wc -l <"$RW_CALLS_FILE" | tr -d ' '; else printf '0'; fi
}

# rw_report_calls [label]: report how many HTTP requests this run has made.
rw_report_calls() {
    printf "%s: %s Railway API call(s) so far\n" "${1:-rw_graphql}" "$(rw_call_count)" >&2
}

# rw_rate_limit_headers: print the rate-limit headers from the last response
# (documented as X-RateLimit-* + Retry-After). No secrets appear in response
# headers, so this is safe to print in CI logs.
rw_rate_limit_headers() {
    if [ -s "$RW_LAST_HEADERS_FILE" ]; then
        grep -iE '^(x-ratelimit|retry-after)' "$RW_LAST_HEADERS_FILE" | tr -d '\r' \
            || printf "(no rate-limit headers on last response)\n"
    else
        printf "(no response captured yet)\n"
    fi
}
