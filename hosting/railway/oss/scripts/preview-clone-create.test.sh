#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/preview-clone-create.sh"

export RAILWAY_PREVIEW_ENV_NAME=pr-test-6861
export IMAGE_TAG=pr-test-6861

# Load the production functions without running main. The test only exercises
# the image patch payload, keeping Railway itself out of the regression proof.
source "$SCRIPT"

IMAGE_TAG="pr-test-6861"
POSTGRES_IMAGE="postgres:17"
REDIS_REPO="ghcr.io/agenta-ai/agenta-preview-redis"
SEAWEEDFS_REPO="ghcr.io/agenta-ai/agenta-preview-seaweedfs"
CLONE_SERVICES_JSON='{"data":{"environment":{"serviceInstances":{"edges":[
  {"node":{"serviceId":"Postgres-id","serviceName":"Postgres","source":{"image":"postgres:16"}}},
  {"node":{"serviceId":"redis-id","serviceName":"redis","source":{"image":"ghcr.io/agenta-ai/agenta-preview-redis:old"}}},
  {"node":{"serviceId":"seaweed-id","serviceName":"seaweedfs","source":{"image":"ghcr.io/agenta-ai/agenta-preview-seaweedfs:old"}}},
  {"node":{"serviceId":"api-id","serviceName":"api","source":{"image":"ghcr.io/agenta-ai/agenta-api:old"}}}
]}}}}'

clone_service_id() { printf '%s-id' "$1"; }

captured_patch=""
rw_graphql() {
    captured_patch="$2"
}

patch_commit_images Postgres redis seaweedfs

test "$PATCHED_SERVICES" = " Postgres redis seaweedfs"
test "$(jq -r '.p.services."Postgres-id".source.image' <<<"$captured_patch")" = "postgres:17"
test "$(jq -r '.p.services."redis-id".source.image' <<<"$captured_patch")" = "ghcr.io/agenta-ai/agenta-preview-redis:pr-test-6861"
test "$(jq -r '.p.services."seaweedfs-id".source.image' <<<"$captured_patch")" = "ghcr.io/agenta-ai/agenta-preview-seaweedfs:pr-test-6861"

captured_patch=""
patch_commit_images "${APP_SERVICES[@]}"
test "$PATCHED_SERVICES" = " Postgres redis seaweedfs api worker-streams worker-queues cron alembic web web-mobile services runner"
test "$(jq -r '.p.services."api-id".source.image' <<<"$captured_patch")" = "ghcr.io/agenta-ai/agenta-api:pr-test-6861"
test "$(jq -r '.p.services."Postgres-id".source.image // empty' <<<"$captured_patch")" = ""

printf 'PASS: infra and app image patches are separated and ordered\n'
