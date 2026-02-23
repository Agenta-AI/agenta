#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"

WEB_IMAGE="${AGENTA_WEB_IMAGE:-ghcr.io/agenta-ai/agenta-web:latest}"
API_IMAGE="${AGENTA_API_IMAGE:-ghcr.io/agenta-ai/agenta-api:latest}"
SERVICES_IMAGE="${AGENTA_SERVICES_IMAGE:-ghcr.io/agenta-ai/agenta-services:latest}"
SUPERTOKENS_IMAGE="${SUPERTOKENS_IMAGE:-supertokens/supertokens-postgresql}"
REDIS_IMAGE="${REDIS_IMAGE:-redis:8.2.1}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-ghcr.io/railwayapp-templates/postgres-ssl:17}"
GATEWAY_IMAGE="${AGENTA_GATEWAY_IMAGE:-}"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf "Missing required command: %s\n" "$1" >&2
        exit 1
    fi
}

require_railway_auth() {
    if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
        railway whoami >/dev/null 2>&1 || {
            printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run 'railway login'.\n" >&2
            exit 1
        }
        return 0
    fi

    # Verify the token actually works. A revoked or invalid token will cause
    # every subsequent call to fail with a confusing "Unauthorized" error.
    local whoami_output
    whoami_output="$(railway_call whoami 2>&1)" || {
        printf "Railway authentication failed. The token appears to be invalid or revoked.\n" >&2
        printf "Output: %s\n" "$whoami_output" >&2
        exit 1
    }
}

ensure_project_linked() {
    local project_json existing_project

    # Fetch the project list. If the command fails, project_json will be empty
    # and we fall through to the "init" branch.
    project_json="$(railway_call project list --json 2>/dev/null || true)"

    existing_project=""
    if [ -n "$project_json" ]; then
        existing_project="$(printf "%s" "$project_json" \
            | jq -r --arg name "$PROJECT_NAME" \
                '.[] | select(.name == $name) | .name' 2>/dev/null \
            | head -n 1 || true)"
    fi

    if [ -n "$existing_project" ]; then
        railway_call link --project "$PROJECT_NAME" --json >/dev/null
    else
        railway_call init --name "$PROJECT_NAME" --json >/dev/null
    fi
}

create_env_if_missing() {
    railway_call environment new "$ENV_NAME" --json >/dev/null 2>&1 || true
    railway_call link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null
}

add_service() {
    local name="$1"
    railway_call add --service "$name" --json >/dev/null 2>&1 || true
}

add_service_image() {
    local name="$1"
    local image="$2"
    railway_call add --service "$name" --image "$image" --json >/dev/null 2>&1 || true
}

ensure_volume() {
    local service="$1"
    local mount_path="$2"

    railway_call service "$service" >/dev/null 2>&1 || return 0

    # Check if a volume already exists for this service before adding.
    # Adding a duplicate volume on the same mount path causes the container to
    # fail with "Failed to create deployment".
    local existing
    existing="$(railway_call volume list --json 2>/dev/null | jq -r --arg mp "$mount_path" '.[] | select(.mountPath == $mp) | .id' 2>/dev/null || true)"
    if [ -n "$existing" ]; then
        return 0
    fi

    railway_call volume add --mount-path "$mount_path" --json >/dev/null 2>&1 || true
}

main() {
    require_cmd railway
    require_cmd jq

    require_railway_auth

    ensure_project_linked
    create_env_if_missing

    if [ -n "$GATEWAY_IMAGE" ]; then
        add_service_image gateway "$GATEWAY_IMAGE"
    else
        add_service gateway
    fi

    add_service_image web "$WEB_IMAGE"
    add_service_image api "$API_IMAGE"
    add_service_image services "$SERVICES_IMAGE"
    add_service_image worker-evaluations "$API_IMAGE"
    add_service_image worker-tracing "$API_IMAGE"
    add_service_image cron "$API_IMAGE"
    add_service_image alembic "$API_IMAGE"
    add_service_image supertokens "$SUPERTOKENS_IMAGE"

    add_service_image Postgres "$POSTGRES_IMAGE"
    ensure_volume Postgres /var/lib/postgresql/data

    add_service_image redis "$REDIS_IMAGE"
    ensure_volume redis /data

    railway_call domain --service gateway --json >/dev/null 2>&1 || true

    printf "Bootstrap completed for project '%s' environment '%s'\n" "$PROJECT_NAME" "$ENV_NAME"
}

main "$@"
