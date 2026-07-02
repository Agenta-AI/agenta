#!/bin/bash
set -euo pipefail

# Recreate ONLY the `web` container, always with the correct env file.
#
# F-037: `web` runs `next dev` and reads its env at container-create time, so a code/env change
# needs a recreate (a `restart` is not enough). The recurring footgun is recreating it by hand:
#
#   docker compose -p <project> -f <file> up -d --no-deps --force-recreate web
#
# Without `ENV_FILE=...` AND `--env-file <path>`, Compose falls back to the committed default
# `${ENV_FILE:-./.env.<license>.dev}` (port-80 / no-port URLs), so the recreated web container
# 404s every `/api` call (same class as F-020) with no obvious cause. This script always passes
# the env file on BOTH planes (the shell var that drives the in-file `${ENV_FILE}` default, and
# the `--env-file` CLI flag that drives variable substitution), so the trap cannot recur.
#
# Usage:
#   hosting/docker-compose/recreate-web.sh                      # ee / dev / .env.ee.dev.local
#   LICENSE=ee STAGE=dev ENV_FILE=.env.ee.dev.local \
#     PROJECT=agenta-ee-dev-wp-b2-rendering hosting/docker-compose/recreate-web.sh
#
# Env knobs (all optional; defaults match the documented dev stack):
#   LICENSE  oss|ee                  (default: ee)
#   STAGE    dev|gh|gh.local|...     (default: dev)
#   ENV_FILE env file name or path   (default: .env.<license>.<stage>.local)
#   PROJECT  compose project name    (default: agenta-<license>-<stage>)
#   DOCKER_NETWORK_MODE              (default: bridge)

LICENSE="${LICENSE:-ee}"
STAGE="${STAGE:-dev}"
ENV_FILE="${ENV_FILE:-.env.${LICENSE}.${STAGE}.local}"
PROJECT="${PROJECT:-agenta-${LICENSE}-${STAGE}}"
DOCKER_NETWORK_MODE="${DOCKER_NETWORK_MODE:-bridge}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/${LICENSE}/docker-compose.${STAGE}.yml"

# Resolve ENV_FILE to a path the same way run.sh does: an explicit path is used as-is, a bare
# name is taken relative to the license dir.
if [[ "$ENV_FILE" = /* || "$ENV_FILE" == ./* || "$ENV_FILE" == ../* || "$ENV_FILE" == */* ]]; then
    ENV_FILE_PATH="$ENV_FILE"
else
    ENV_FILE_PATH="${SCRIPT_DIR}/${LICENSE}/${ENV_FILE}"
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "Error: compose file not found: $COMPOSE_FILE" >&2
    exit 1
fi
if [[ ! -f "$ENV_FILE_PATH" ]]; then
    echo "Error: env file not found: $ENV_FILE_PATH" >&2
    echo "Refusing to recreate web: Compose would fall back to the port-80 default and the" >&2
    echo "web container would 404 every '/api' call. Set ENV_FILE to an existing file." >&2
    exit 1
fi

echo "Recreating 'web' for project '$PROJECT' with env file '$ENV_FILE_PATH'..."
ENV_FILE="$ENV_FILE" DOCKER_NETWORK_MODE="$DOCKER_NETWORK_MODE" \
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" \
    --profile with-web up -d --no-deps --force-recreate web
echo "✅ web recreated."
