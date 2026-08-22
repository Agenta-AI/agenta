#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_error_trap

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"
SOURCE_COMPOSE_FILE="${RAILWAY_SOURCE_COMPOSE_FILE:-$(railway_source_compose_file "$ROOT_DIR")}"

WEB_IMAGE="${AGENTA_WEB_IMAGE:-ghcr.io/agenta-ai/agenta-web:latest}"
WEB_MOBILE_IMAGE="${AGENTA_WEB_MOBILE_IMAGE:-ghcr.io/agenta-ai/agenta-web-mobile:latest}"
# The mobile app (/m) is opt-in while it is pre-GA, mirroring the compose
# `with-web-mobile` profile (run.sh --with-mobile). Everything downstream
# (configure.sh, deploy-from-images.sh) keys off whether the service exists,
# so this flag is the single switch.
WITH_MOBILE="${AGENTA_RAILWAY_WITH_MOBILE:-false}"
API_IMAGE="${AGENTA_API_IMAGE:-ghcr.io/agenta-ai/agenta-api:latest}"
SERVICES_IMAGE="${AGENTA_SERVICES_IMAGE:-ghcr.io/agenta-ai/agenta-services:latest}"
RUNNER_IMAGE="${AGENTA_RUNNER_IMAGE:-ghcr.io/agenta-ai/agenta-runner:latest}"
SUPERTOKENS_IMAGE="${SUPERTOKENS_IMAGE:-$(require_compose_service_image "$SOURCE_COMPOSE_FILE" "supertokens")}"
REDIS_IMAGE="${REDIS_IMAGE:-$(require_compose_redis_image "$SOURCE_COMPOSE_FILE")}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-$(require_compose_service_image "$SOURCE_COMPOSE_FILE" "postgres")}"
GATEWAY_IMAGE="${AGENTA_GATEWAY_IMAGE:-}"
# Pin a 4.37-era SeaweedFS: its advanced IAM (the STS path mounts need) regressed in other releases.
SEAWEEDFS_IMAGE="${SEAWEEDFS_IMAGE:-chrislusf/seaweedfs:4.37}"

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
    # Distinguish a genuine auth failure from rate-limiting / transient network
    # errors (where the token is fine) so the log points at the real cause.
    local whoami_output
    whoami_output="$(railway_call whoami 2>&1)" || {
        if printf "%s" "$whoami_output" | grep -qiE "rate.?limit"; then
            printf "Railway auth check could not complete: the API is rate-limiting requests (retries exhausted).\n" >&2
            printf "This is throttling, not a bad token. Re-run once the rate-limit window clears.\n" >&2
        elif printf "%s" "$whoami_output" | grep -qiE "timed out|error sending request|failed to fetch|connection (reset|refused|closed)|temporarily unavailable|service unavailable|bad gateway|gateway time-?out"; then
            printf "Railway auth check could not complete: transient network error reaching the Railway API.\n" >&2
            printf "The token is likely fine; this is usually temporary. Re-run.\n" >&2
        else
            printf "Railway authentication failed. The token appears to be invalid or revoked.\n" >&2
        fi
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

    if [ -z "$existing_project" ]; then
        railway_call init --name "$PROJECT_NAME" --json >/dev/null
        return
    fi

    # `project list` and `link --project` can disagree. `project list`
    # enumerates projects across every workspace the token can see and can lag
    # behind a just-deleted project, while `link --project` only resolves
    # within the single workspace it selects. So a project the list still
    # reports as existing may not actually be linkable — most visibly right
    # after a preview is destroyed (PR converted to draft) and then rebuilt (PR
    # marked ready for review). Treat a link failure as "needs to be
    # (re)created" and fall back to init, instead of aborting the whole setup.
    local link_status=0
    railway_call link --project "$PROJECT_NAME" --json >/dev/null || link_status=$?
    if [ "$link_status" -ne 0 ]; then
        printf "railway link could not resolve existing project '%s'; recreating it.\n" \
            "$PROJECT_NAME" >&2
        railway_call init --name "$PROJECT_NAME" --json >/dev/null
    fi
}

create_env_if_missing() {
    railway_call environment new "$ENV_NAME" --json >/dev/null 2>&1 || true
    railway_call link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null
}

# Services the bootstrap must end up with, recorded as "name=image" ("name="
# when Railway picks the source). Populated by add_service/add_service_image
# and re-checked by verify_services_exist.
EXPECTED_SERVICES=()

_attempt_add_service() {
    local name="$1"
    local image="${2:-}"

    local args=(add --service "$name")
    if [ -n "$image" ]; then
        args+=(--image "$image")
    fi

    # A failure here is tolerated because re-bootstrapping an existing project
    # makes `railway add` fail on every service that already exists. It is NOT
    # silently swallowed: verify_services_exist re-checks that every expected
    # service actually exists and fails the bootstrap if one is missing.
    if ! railway_call "${args[@]}" --json >/dev/null; then
        printf "railway add --service %s did not succeed (expected if the service already exists; verified after creation).\n" \
            "$name" >&2
    fi
}

add_service() {
    local name="$1"
    EXPECTED_SERVICES+=("${name}=")
    _attempt_add_service "$name"
}

add_service_image() {
    local name="$1"
    local image="$2"
    EXPECTED_SERVICES+=("${name}=${image}")
    _attempt_add_service "$name" "$image"
}

# List the service names present in the target environment, one per line.
list_environment_services() {
    railway_call status --json 2>/dev/null \
        | jq -r --arg e "$ENV_NAME" \
            '.environments.edges[].node | select(.name == $e)
             | .serviceInstances.edges[].node.serviceName' 2>/dev/null \
        || true
}

# verify_services_exist: the `railway add` calls above tolerate failure for the
# re-bootstrap path, so a transient Railway API failure during creation would
# otherwise go unnoticed until every later deploy fails with
# "Service '<name>' not found" — and the green setup job never re-runs (#5566).
# Verify that every expected service exists in the environment, re-attempt
# creation for any that are missing, and fail the bootstrap loudly if a service
# still cannot be found.
verify_services_exist() {
    local attempts="${RAILWAY_SERVICE_VERIFY_ATTEMPTS:-3}"
    local delay="${RAILWAY_SERVICE_VERIFY_DELAY:-10}"
    local attempt existing entry name image
    local missing=()

    for ((attempt = 1; attempt <= attempts; attempt++)); do
        existing="$(list_environment_services)"

        missing=()
        for entry in "${EXPECTED_SERVICES[@]}"; do
            name="${entry%%=*}"
            if ! printf '%s\n' "$existing" | grep -Fxq "$name"; then
                missing+=("$entry")
            fi
        done

        if [ "${#missing[@]}" -eq 0 ]; then
            return 0
        fi

        if [ "$attempt" -lt "$attempts" ]; then
            for entry in "${missing[@]}"; do
                name="${entry%%=*}"
                image="${entry#*=}"
                printf "Service '%s' is missing after creation; re-attempting (attempt %d/%d).\n" \
                    "$name" "$attempt" "$attempts" >&2
                _attempt_add_service "$name" "$image"
            done
            sleep "$delay"
        fi
    done

    local names=()
    for entry in "${missing[@]}"; do
        names+=("${entry%%=*}")
    done
    printf "Bootstrap failed: service(s) missing from project '%s' environment '%s' after %d attempts: %s\n" \
        "$PROJECT_NAME" "$ENV_NAME" "$attempts" "${names[*]}" >&2
    printf "Railway service creation likely hit a transient API failure. Re-run this job (for previews: 'Re-run all jobs', so the setup job runs bootstrap again).\n" >&2
    return 1
}

ensure_volume() {
    local service="$1"
    local mount_path="$2"
    local attempts="${RAILWAY_VOLUME_ADD_ATTEMPTS:-3}"
    local delay="${RAILWAY_VOLUME_ADD_DELAY:-15}"

    # Select the service so the volume commands below target it. The service's
    # existence was already checked by verify_services_exist, so a failure here
    # is a real error, not a missing service to skip.
    if ! railway_call service "$service" >/dev/null; then
        printf "Could not select service '%s' to set up its volume.\n" "$service" >&2
        return 1
    fi

    # Creating several volumes back-to-back trips Railway's volume-creation
    # throttle ("You are creating volumes too quickly"), a clean rejection that
    # railway_call's generic rate-limit matcher does not recognize — so retry
    # here. Re-checking for the volume before EVERY attempt keeps the retry
    # safe: an add that succeeded server-side despite a reported error is seen
    # by the next check, and adding a duplicate volume on the same mount path
    # would make the container fail with "Failed to create deployment".
    local attempt existing
    for ((attempt = 1; attempt <= attempts; attempt++)); do
        existing="$(railway_call volume list --json 2>/dev/null | jq -r --arg mp "$mount_path" '.[] | select(.mountPath == $mp) | .id' 2>/dev/null || true)"
        if [ -n "$existing" ]; then
            return 0
        fi

        local add_output
        if add_output="$(railway_call volume add --mount-path "$mount_path" --json 2>&1)"; then
            return 0
        fi

        # Railway refusing because a volume is already mounted IS the desired
        # end state. The volume-list pre-check above can miss existing volumes
        # on re-runs (issue #5671), so recognize the refusal directly instead
        # of misreading it as the creation throttle.
        if printf "%s" "$add_output" | grep -qi "already mounted"; then
            return 0
        fi
        printf "%s\n" "$add_output" >&2

        if [ "$attempt" -lt "$attempts" ]; then
            printf "Volume add at %s for service '%s' failed (Railway often throttles volume creation); retrying in %ds (attempt %d/%d).\n" \
                "$mount_path" "$service" "$delay" "$attempt" "$attempts" >&2
            sleep "$delay"
        fi
    done

    printf "Failed to create volume at %s for service '%s' after %d attempts.\n" \
        "$mount_path" "$service" "$attempts" >&2
    return 1
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
    if [ "$WITH_MOBILE" = "true" ]; then
        add_service_image web-mobile "$WEB_MOBILE_IMAGE"
    fi
    add_service_image api "$API_IMAGE"
    add_service_image services "$SERVICES_IMAGE"
    add_service_image runner "$RUNNER_IMAGE"
    add_service_image worker-streams "$API_IMAGE"
    add_service_image worker-queues "$API_IMAGE"
    add_service_image cron "$API_IMAGE"
    add_service_image alembic "$API_IMAGE"
    add_service_image supertokens "$SUPERTOKENS_IMAGE"

    add_service_image Postgres "$POSTGRES_IMAGE"
    add_service_image redis "$REDIS_IMAGE"
    add_service_image seaweedfs "$SEAWEEDFS_IMAGE"

    # A service that silently failed to create breaks every later deploy of
    # this environment, so confirm all of them exist before wiring volumes.
    verify_services_exist

    ensure_volume Postgres /var/lib/postgresql/data
    ensure_volume redis /data
    ensure_volume seaweedfs /data

    railway_call domain --service gateway --json >/dev/null 2>&1 || true

    printf "Bootstrap completed for project '%s' environment '%s'\n" "$PROJECT_NAME" "$ENV_NAME"
}

main "$@"
