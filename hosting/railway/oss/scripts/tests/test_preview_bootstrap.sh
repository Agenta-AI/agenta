#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$TEST_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
STATE_FILE="$TMP_DIR/services"
LOG_FILE="$TMP_DIR/railway.log"
EXPECTED_SERVICES=(gateway web api services runner worker-streams worker-queues cron alembic supertokens Postgres redis seaweedfs)

command -v jq >/dev/null 2>&1 || {
    printf "Missing required command: jq\n" >&2
    exit 1
}

cleanup() {
    rm -rf "$TMP_DIR"
}

fail() {
    printf "FAIL: %s\n" "$1" >&2
    exit 1
}

assert_contains() {
    printf '%s' "$1" | grep -Fq -- "$2" || fail "Expected output to contain: $2"
}

write_services() {
    printf '%s\n' "${EXPECTED_SERVICES[@]}" | grep -Fxv -- "${1:-}" > "$STATE_FILE"
}

run_bootstrap() {
    env PATH="$FAKE_BIN:$PATH" \
        FAKE_RAILWAY_STATE="$STATE_FILE" \
        FAKE_RAILWAY_LOG="$LOG_FILE" \
        FAKE_RAILWAY_MODE="$1" \
        RAILWAY_API_TOKEN=test-token \
        RAILWAY_ENVIRONMENT_NAME=staging \
        RAILWAY_SERVICE_RESOLVE_ATTEMPTS=1 \
        RAILWAY_SERVICE_RESOLVE_DELAY=0 \
        AGENTA_WEB_IMAGE=test-web \
        AGENTA_API_IMAGE=test-api \
        AGENTA_SERVICES_IMAGE=test-services \
        AGENTA_RUNNER_IMAGE=test-runner \
        SUPERTOKENS_IMAGE=test-supertokens \
        REDIS_IMAGE=test-redis \
        POSTGRES_IMAGE=test-postgres \
        SEAWEEDFS_IMAGE=test-seaweedfs \
        bash "$SCRIPTS_DIR/bootstrap.sh"
}

mkdir -p "$FAKE_BIN"
trap cleanup EXIT

cat > "$FAKE_BIN/railway" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

service="$(printf '%s\n' "$@" | awk '$0 == "--service" {getline; print; exit}')"

case "$1" in
    whoami | init | link | domain | environment)
        printf '{}\n'
        ;;
    project)
        printf '[]\n'
        ;;
    status)
        jq -Rn --arg env staging \
            '[inputs | select(length > 0) | {node: {serviceName: .}}]
             | {environments: {edges: [{node: {name: $env, serviceInstances: {edges: .}}}]}}' \
            < "$FAKE_RAILWAY_STATE"
        ;;
    add)
        printf 'add %s\n' "$service" >> "$FAKE_RAILWAY_LOG"
        case "${FAKE_RAILWAY_MODE}:${service}" in
            fail-missing:cron)
                printf 'operation timed out\n' >&2
                exit 1
                ;;
            fail-after-create:cron)
                printf '%s\n' "$service" >> "$FAKE_RAILWAY_STATE"
                printf 'operation timed out\n' >&2
                exit 1
                ;;
        esac
        printf '%s\n' "$service" >> "$FAKE_RAILWAY_STATE"
        printf '{}\n'
        ;;
    service)
        grep -Fxq -- "$2" "$FAKE_RAILWAY_STATE"
        ;;
    volume)
        [ "$2" = "list" ] && printf '[]\n' || printf '{}\n'
        ;;
    *)
        printf 'Unexpected railway command: %s\n' "$*" >&2
        exit 1
        ;;
esac
EOF

chmod +x "$FAKE_BIN/railway"

write_services
: > "$LOG_FILE"
output="$(run_bootstrap success 2>&1)" || fail "Bootstrap should succeed when all services exist."
assert_contains "$output" "Bootstrap completed"
[ ! -s "$LOG_FILE" ] || fail "Bootstrap should not add existing services."

write_services cron
set +e
output="$(run_bootstrap fail-missing 2>&1)"
status=$?
set -e
[ "$status" -ne 0 ] || fail "Bootstrap should fail when cron remains missing."
assert_contains "$output" "Failed to create missing Railway service 'cron'"
assert_contains "$output" "missing expected service(s): cron"
if printf '%s' "$output" | grep -Fq "Bootstrap completed"; then
    fail "Bootstrap must not report success when a service is missing."
fi

write_services cron
output="$(run_bootstrap fail-after-create 2>&1)" ||
    fail "Bootstrap should accept a service visible after an ambiguous add failure."
assert_contains "$output" "Bootstrap completed"

set +e
output="$(
    (
        source "$SCRIPTS_DIR/configure.sh"
        RAILWAY_CLI_SET_ATTEMPTS=1
        railway_call() { printf "Service 'cron' not found\n" >&2; return 1; }
        _cli_set_vars cron KEY=value
    ) 2>&1
)"
status=$?
set -e
[ "$status" -ne 0 ] || fail "Variable configuration should fail for a missing service."
assert_contains "$output" "Re-run ALL jobs (not just failed jobs)"

printf "PASS: Railway preview bootstrap tests\n"
