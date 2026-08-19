#!/usr/bin/env bash

# Byte-faithfulness guard for the prebuilt Railway wrapper images.
#
# The directories beside this script (gateway/, redis/, seaweedfs/) are the
# sources for the `agenta-preview-*` images CI pushes to GHCR. Their content
# must stay byte-faithful to what the legacy deploy path ships per PR today:
#
#   - gateway:   deploy-gateway.sh runs `railway up hosting/railway/oss/gateway`,
#     so the image Dockerfile (minus its leading comment header) and nginx.conf
#     must match that directory.
#   - redis:     deploy-from-images.sh render_redis_wrapper() generates the
#     Dockerfile (FROM resolved from the compose gh baseline) and copies
#     hosting/railway/oss/redis/entrypoint.sh verbatim.
#   - seaweedfs: deploy-from-images.sh render_seaweedfs_wrapper() generates the
#     Dockerfile (FROM pinned to the script's SEAWEEDFS_IMAGE default) and
#     copies hosting/railway/oss/seaweedfs/entrypoint.sh verbatim.
#
# For redis and seaweedfs this script extracts the actual heredoc bodies from
# deploy-from-images.sh and expands them with the same default image
# resolution the deploy script uses, so edits to the render functions are
# caught automatically. Exits nonzero (with a unified diff) on any divergence.
#
# Covered:   Dockerfile instructions, nginx.conf, both entrypoints, and the
#            FROM pins (re-resolved from the same sources as deploy time).
# Not covered: leading comment headers on the image Dockerfiles (stripped on
#            both sides — comments never reach the built image), and env
#            overrides of REDIS_IMAGE / SEAWEEDFS_IMAGE / RAILWAY_SOURCE_COMPOSE_FILE
#            (this guard always checks against the deploy script's defaults).
#
# Usage: verify-wrappers.sh   (no arguments; run from anywhere)

set -euo pipefail

IMAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OSS_DIR="$(cd "$IMAGES_DIR/.." && pwd)"
ROOT_DIR="$(cd "$OSS_DIR/../../.." && pwd)"
DEPLOY_SCRIPT="$OSS_DIR/scripts/deploy-from-images.sh"

# shellcheck source=../scripts/lib.sh
source "$OSS_DIR/scripts/lib.sh"

TMP_DIR="$(mktemp -d)"
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

failures=0

# Drop the leading run of comment/blank lines. Only the image Dockerfiles carry
# an explanatory header; everything from the first instruction on must match.
strip_header() {
    awk 'body { print; next } !/^[[:space:]]*(#|$)/ { body = 1; print }' "$1"
}

# Print the heredoc body of `cat > ... <<EOF` inside the named function of
# deploy-from-images.sh.
extract_heredoc() {
    local func="$1"
    awk -v fn="$func" '
        $0 ~ "^"fn"\\(\\) \\{" { in_fn = 1 }
        in_fn && /<<EOF$/ { in_doc = 1; next }
        in_doc && /^EOF$/ { exit }
        in_doc { print }
    ' "$DEPLOY_SCRIPT"
}

# Expand a heredoc body with the current shell variables, mirroring the
# unquoted-EOF expansion deploy-from-images.sh performs at render time.
expand_template() {
    local body="$1"
    eval "cat <<__VERIFY_EOF__
$body
__VERIFY_EOF__
"
}

check_diff() {
    local label="$1" expected="$2" actual="$3"
    if ! diff -u --label "generated ($label)" --label "$actual" "$expected" "$actual" ; then
        printf "FAIL: %s diverges from the deploy-time content\n\n" "$label" >&2
        failures=$((failures + 1))
    fi
}

check_bytes() {
    local label="$1" expected="$2" actual="$3"
    if ! diff -u --label "$expected" --label "$actual" "$expected" "$actual"; then
        printf "FAIL: %s is not a verbatim copy of %s\n\n" "$actual" "$expected" >&2
        failures=$((failures + 1))
    fi
}

# --- Resolve the FROM pins exactly like deploy-from-images.sh defaults do ---

SOURCE_COMPOSE_FILE="$(railway_source_compose_file "$ROOT_DIR")"
REDIS_IMAGE="$(require_compose_redis_image "$SOURCE_COMPOSE_FILE")"
# shellcheck disable=SC2016  # the pattern matches a literal ${...} in the deploy script
SEAWEEDFS_IMAGE="$(sed -n 's/^SEAWEEDFS_IMAGE="\${SEAWEEDFS_IMAGE:-\(.*\)}"$/\1/p' "$DEPLOY_SCRIPT")"

if [ -z "$SEAWEEDFS_IMAGE" ]; then
    printf "Could not extract the SEAWEEDFS_IMAGE default from %s\n" "$DEPLOY_SCRIPT" >&2
    exit 1
fi

export REDIS_IMAGE SEAWEEDFS_IMAGE

# --- gateway: railway up ships hosting/railway/oss/gateway as-is ------------

strip_header "$OSS_DIR/gateway/Dockerfile" > "$TMP_DIR/gateway.expected"
strip_header "$IMAGES_DIR/gateway/Dockerfile" > "$TMP_DIR/gateway.actual"
check_diff "gateway Dockerfile" "$TMP_DIR/gateway.expected" "$TMP_DIR/gateway.actual"
check_bytes "gateway nginx.conf" "$OSS_DIR/gateway/nginx.conf" "$IMAGES_DIR/gateway/nginx.conf"

# --- redis: render_redis_wrapper() + verbatim entrypoint --------------------

redis_body="$(extract_heredoc render_redis_wrapper)"
if [ -z "$redis_body" ]; then
    printf "Could not extract the render_redis_wrapper heredoc from %s\n" "$DEPLOY_SCRIPT" >&2
    exit 1
fi
expand_template "$redis_body" > "$TMP_DIR/redis.expected"
strip_header "$IMAGES_DIR/redis/Dockerfile" > "$TMP_DIR/redis.actual"
check_diff "redis Dockerfile" "$TMP_DIR/redis.expected" "$TMP_DIR/redis.actual"
check_bytes "redis entrypoint" "$OSS_DIR/redis/entrypoint.sh" "$IMAGES_DIR/redis/entrypoint.sh"

# --- seaweedfs: render_seaweedfs_wrapper() + verbatim entrypoint ------------

seaweedfs_body="$(extract_heredoc render_seaweedfs_wrapper)"
if [ -z "$seaweedfs_body" ]; then
    printf "Could not extract the render_seaweedfs_wrapper heredoc from %s\n" "$DEPLOY_SCRIPT" >&2
    exit 1
fi
expand_template "$seaweedfs_body" > "$TMP_DIR/seaweedfs.expected"
strip_header "$IMAGES_DIR/seaweedfs/Dockerfile" > "$TMP_DIR/seaweedfs.actual"
check_diff "seaweedfs Dockerfile" "$TMP_DIR/seaweedfs.expected" "$TMP_DIR/seaweedfs.actual"
check_bytes "seaweedfs entrypoint" "$OSS_DIR/seaweedfs/entrypoint.sh" "$IMAGES_DIR/seaweedfs/entrypoint.sh"

# ----------------------------------------------------------------------------

if [ "$failures" -gt 0 ]; then
    printf "verify-wrappers: %s check(s) failed\n" "$failures" >&2
    exit 1
fi

printf "verify-wrappers: all wrapper image sources match the deploy-time content\n"
printf "  redis FROM pin:     %s\n" "$REDIS_IMAGE"
printf "  seaweedfs FROM pin: %s\n" "$SEAWEEDFS_IMAGE"
