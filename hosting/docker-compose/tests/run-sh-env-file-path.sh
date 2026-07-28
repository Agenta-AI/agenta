#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUN_SH="$ROOT/hosting/docker-compose/run.sh"
ENV_FILE_REL="hosting/docker-compose/ee/.env.ee.dev.sessions"
ENV_FILE_ABS="$ROOT/$ENV_FILE_REL"

cleanup() {
    rm -f "$ENV_FILE_ABS"
    if [[ -n "${TMPDIR_RUN_SH_ENV_FILE_TEST:-}" ]]; then
        rm -rf "$TMPDIR_RUN_SH_ENV_FILE_TEST"
    fi
}
trap cleanup EXIT

TMPDIR_RUN_SH_ENV_FILE_TEST="$(mktemp -d)"
mkdir -p "$TMPDIR_RUN_SH_ENV_FILE_TEST/bin"

# The helper only needs the file to exist; the fake docker command below avoids
# touching a real Docker daemon while still verifying what run.sh exports to
# Compose's env_file interpolation.
touch "$ENV_FILE_ABS"

cat >"$TMPDIR_RUN_SH_ENV_FILE_TEST/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
: "${RUN_SH_TEST_LOG:?RUN_SH_TEST_LOG must be set}"
printf 'ENV_FILE=%s\n' "${ENV_FILE:-}" >>"$RUN_SH_TEST_LOG"
printf 'ARGS=%s\n' "$*" >>"$RUN_SH_TEST_LOG"

case "$*" in
    *" config --format json"*)
        case "${ENV_FILE:-}" in
            /*)
                printf '{"services":{"api":{"build":null}}}'
                ;;
            *[!/]*/*)
                printf 'relative slash-containing ENV_FILE would be resolved relative to the compose file\n' >&2
                exit 17
                ;;
            *)
                printf '{"services":{"api":{"build":null}}}'
                ;;
        esac
        ;;
    *" up -d --no-deps --force-recreate api"*)
        exit 0
        ;;
    *)
        printf 'unexpected fake docker invocation: %s\n' "$*" >&2
        exit 18
        ;;
esac
FAKE_DOCKER
chmod +x "$TMPDIR_RUN_SH_ENV_FILE_TEST/bin/docker"

export PATH="$TMPDIR_RUN_SH_ENV_FILE_TEST/bin:$PATH"
export RUN_SH_TEST_LOG="$TMPDIR_RUN_SH_ENV_FILE_TEST/docker.log"
RUN_SH_TEST_OUT="$TMPDIR_RUN_SH_ENV_FILE_TEST/run-sh.out"

(
    cd "$ROOT"
    bash "$RUN_SH" --ee --dev --env-file "$ENV_FILE_REL" --recreate api >"$RUN_SH_TEST_OUT"
)

grep -F "ENV_FILE=$ENV_FILE_ABS" "$RUN_SH_TEST_LOG" >/dev/null
grep -F -- "--env-file $ENV_FILE_ABS" "$RUN_SH_TEST_LOG" >/dev/null
grep -F "Surgical service operation complete" "$RUN_SH_TEST_OUT" >/dev/null

echo "run.sh accepts slash-containing --env-file paths by normalizing them for Compose"
