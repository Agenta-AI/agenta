#!/usr/bin/env bash

# Shared helpers for Railway deployment scripts.
# Source this file; do not execute it directly.

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

        # Not a rate-limit error.
        # - On success: print to stdout so callers can parse JSON.
        # - On failure: print to stderr so logs are visible even when callers
        #   redirect stdout to /dev/null.
        if [ "$exit_code" -eq 0 ]; then
            printf "%s\n" "$output"
            return 0
        fi

        printf "railway %s failed with exit code %d\n" "$*" "$exit_code" >&2
        printf "%s\n" "$output" >&2
        return "$exit_code"
    done
}
