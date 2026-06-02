#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_error_trap

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"
SKIP_UNSETS="${CONFIGURE_SKIP_UNSETS:-false}"

POSTGRES_REF_NS="${RAILWAY_POSTGRES_REF_NS:-Postgres}"
REDIS_SERVICE="${RAILWAY_REDIS_SERVICE:-redis}"
AGENTA_AUTH_KEY="${AGENTA_AUTH_KEY:-replace-me}"
AGENTA_CRYPT_KEY="${AGENTA_CRYPT_KEY:-replace-me}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

# Populated by resolve_railway_ids() after `railway link`. Used by the GraphQL
# variableCollectionUpsert path; left empty -> upsert_service_vars falls back
# to the CLI.
RAILWAY_PROJECT_ID=""
RAILWAY_ENVIRONMENT_ID=""
RAILWAY_STATUS_JSON=""

resolve_postgres_password() {
    if [ -n "$POSTGRES_PASSWORD" ]; then
        return 0
    fi

    local existing_password
    existing_password="$(railway_call variable list -k --service "$POSTGRES_REF_NS" --environment "$ENV_NAME" | grep '^POSTGRES_PASSWORD=' | cut -d= -f2- || true)"
    if [ -n "$existing_password" ]; then
        POSTGRES_PASSWORD="$existing_password"
    else
        POSTGRES_PASSWORD="$(openssl rand -hex 24)"
    fi
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf "Missing required command: %s\n" "$1" >&2
        exit 1
    fi
}

require_railway_auth() {
    if [ -n "${RAILWAY_API_TOKEN:-}" ] || [ -n "${RAILWAY_TOKEN:-}" ]; then
        return 0
    fi

    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
}

# resolve_railway_ids: cache the project/environment IDs and status JSON used by
# the GraphQL variableCollectionUpsert path. No-op (CLI fallback) when there is
# no API token or the IDs cannot be resolved.
resolve_railway_ids() {
    [ -n "${RAILWAY_API_TOKEN:-}" ] || return 0
    RAILWAY_STATUS_JSON="$(railway_call status --json 2>/dev/null || true)"
    [ -n "$RAILWAY_STATUS_JSON" ] || return 0
    RAILWAY_PROJECT_ID="$(printf '%s' "$RAILWAY_STATUS_JSON" | jq -r '.id // empty' 2>/dev/null || true)"
    RAILWAY_ENVIRONMENT_ID="$(printf '%s' "$RAILWAY_STATUS_JSON" \
        | jq -r --arg e "$ENV_NAME" '[.environments.edges[].node | select(.name==$e) | .id][0] // empty' 2>/dev/null || true)"
    if [ -z "$RAILWAY_PROJECT_ID" ] || [ -z "$RAILWAY_ENVIRONMENT_ID" ]; then
        printf "Note: could not resolve Railway project/environment IDs; using CLI variable set.\n" >&2
        RAILWAY_PROJECT_ID=""
    fi
}

# _service_id <service-name> -> serviceId, from the cached status JSON.
_service_id() {
    printf '%s' "$RAILWAY_STATUS_JSON" | jq -r --arg n "$1" --arg e "$ENV_NAME" \
        '[.environments.edges[].node | select(.name==$e)
          | .serviceInstances.edges[].node | select(.serviceName==$n) | .serviceId][0] // empty' 2>/dev/null || true
}

# _vars_to_json KEY=VALUE ... -> {"KEY":"VALUE",...}  (split on the first '=')
_vars_to_json() {
    local json='{}' kv key val
    for kv in "$@"; do
        key="${kv%%=*}"
        val="${kv#*=}"
        json="$(jq -c --arg k "$key" --arg v "$val" '. + {($k): $v}' <<<"$json")"
    done
    printf '%s' "$json"
}

# upsert_service_vars <service> KEY=VALUE ...
# Sets all given variables for a service in ONE variableCollectionUpsert
# (skipDeploys) via the GraphQL API — Railway's recommended path, which avoids
# the CLI fanning out to one slow variableUpsert per key. Falls back to the CLI
# when no API token / IDs are available. Reference values like
# ${{Postgres.POSTGRES_PASSWORD}} are stored verbatim and resolved by Railway at
# render time, exactly as with the CLI.
upsert_service_vars() {
    local service="$1"
    shift
    [ "$#" -gt 0 ] || return 0

    if [ -z "${RAILWAY_API_TOKEN:-}" ] || [ -z "$RAILWAY_PROJECT_ID" ]; then
        railway_call variable set --service "$service" --environment "$ENV_NAME" --skip-deploys "$@" >/dev/null
        return 0
    fi

    local svc_id
    svc_id="$(_service_id "$service")"
    if [ -z "$svc_id" ]; then
        # Name didn't match the cached status JSON (e.g. unexpected casing). Don't
        # hard-fail the deploy where the CLI's --service would have worked; fall
        # back to it.
        printf "Could not resolve service id for '%s'; falling back to CLI variable set.\n" "$service" >&2
        railway_call variable set --service "$service" --environment "$ENV_NAME" --skip-deploys "$@" >/dev/null
        return 0
    fi

    # replace:false makes the merge intent explicit: configure.sh calls set_vars
    # then set_optional_vars for the same service and relies on accumulation.
    # (Verified the API already defaults to merge, but pinning it avoids any
    # future default change silently wiping earlier variables.)
    local vars_json payload
    vars_json="$(_vars_to_json "$@")"
    payload="$(jq -nc \
        --arg p "$RAILWAY_PROJECT_ID" \
        --arg e "$RAILWAY_ENVIRONMENT_ID" \
        --arg s "$svc_id" \
        --argjson vars "$vars_json" \
        '{query: "mutation($input: VariableCollectionUpsertInput!){ variableCollectionUpsert(input: $input) }",
          variables: {input: {projectId: $p, environmentId: $e, serviceId: $s, skipDeploys: true, replace: false, variables: $vars}}}')"

    _railway_graphql "$payload" >/dev/null
}

set_vars() {
    local service="$1"
    shift
    upsert_service_vars "$service" "$@"
}

set_optional_vars() {
    local service="$1"
    shift

    local args=()
    local kv
    for kv in "$@"; do
        if [ -n "${kv#*=}" ]; then
            args+=("$kv")
        fi
    done

    if [ "${#args[@]}" -gt 0 ]; then
        upsert_service_vars "$service" "${args[@]}"
    fi
}

unset_vars() {
    if [ "$SKIP_UNSETS" = "true" ]; then
        return 0
    fi

    local service="$1"
    shift

    local key
    for key in "$@"; do
        railway_call variable delete "$key" --service "$service" --environment "$ENV_NAME" >/dev/null 2>&1 || true
    done
}

set_healthcheck() {
    local service="$1"
    local path="$2"
    railway_call environment edit --environment "$ENV_NAME" --service-config "$service" healthcheckPath "$path" --message "set healthcheck for ${service}" --json >/dev/null
}

main() {
    require_cmd railway
    require_railway_auth

    if [ "$AGENTA_AUTH_KEY" = "replace-me" ] || [ "$AGENTA_CRYPT_KEY" = "replace-me" ]; then
        printf "WARNING: Using default placeholder auth/crypt keys. Set AGENTA_AUTH_KEY and AGENTA_CRYPT_KEY for production deployments.\n" >&2
    fi

    railway_call link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null

    # Resolve IDs for the GraphQL variableCollectionUpsert path (after link, so
    # the project/environment/services exist and are linked).
    resolve_railway_ids

    railway_call domain --service gateway --json >/dev/null 2>&1 || true

    local public_domain_ref
    public_domain_ref='${{gateway.RAILWAY_PUBLIC_DOMAIN}}'

    local pg_user_ref
    pg_user_ref="\${{${POSTGRES_REF_NS}.POSTGRES_USER}}"
    local pg_password_ref
    pg_password_ref="\${{${POSTGRES_REF_NS}.POSTGRES_PASSWORD}}"
    local pg_host_ref
    pg_host_ref="\${{${POSTGRES_REF_NS}.RAILWAY_PRIVATE_DOMAIN}}"
    local pg_port_ref
    pg_port_ref="\${{${POSTGRES_REF_NS}.PGPORT}}"

    local pg_async_core
    pg_async_core="postgresql+asyncpg://${pg_user_ref}:${pg_password_ref}@${pg_host_ref}:${pg_port_ref}/agenta_oss_core"
    local pg_async_tracing
    pg_async_tracing="postgresql+asyncpg://${pg_user_ref}:${pg_password_ref}@${pg_host_ref}:${pg_port_ref}/agenta_oss_tracing"
    local pg_sync_supertokens
    pg_sync_supertokens="postgresql://${pg_user_ref}:${pg_password_ref}@${pg_host_ref}:${pg_port_ref}/agenta_oss_supertokens"

    set_vars web \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_API_URL="https://${public_domain_ref}/api" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY"

    set_optional_vars web \
        "POSTHOG_API_KEY=${POSTHOG_API_KEY:-}" \
        "SENDGRID_API_KEY=${SENDGRID_API_KEY:-}"

    set_vars api \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_API_URL="https://${public_domain_ref}/api" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY" \
        POSTGRES_URI_CORE="$pg_async_core" \
        POSTGRES_URI_TRACING="$pg_async_tracing" \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens"

    unset_vars api AGENTA_LICENSE PORT SCRIPT_NAME REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI AGENTA_API_INTERNAL_URL ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING

    set_optional_vars api \
        "COMPOSIO_API_KEY=${COMPOSIO_API_KEY:-}"

    set_vars services \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_API_URL="https://${public_domain_ref}/api" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY" \
        POSTGRES_URI_CORE="$pg_async_core" \
        POSTGRES_URI_TRACING="$pg_async_tracing" \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens"

    unset_vars services AGENTA_LICENSE PORT SCRIPT_NAME REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING AGENTA_API_INTERNAL_URL

    set_optional_vars services \
        "DAYTONA_API_KEY=${DAYTONA_API_KEY:-}"

    set_vars worker-evaluations \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY" \
        POSTGRES_URI_CORE="$pg_async_core" \
        POSTGRES_URI_TRACING="$pg_async_tracing" \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens"

    unset_vars worker-evaluations AGENTA_LICENSE REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING AGENTA_API_URL AGENTA_API_INTERNAL_URL PORT SCRIPT_NAME

    set_vars worker-tracing \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY" \
        POSTGRES_URI_CORE="$pg_async_core" \
        POSTGRES_URI_TRACING="$pg_async_tracing" \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens"

    unset_vars worker-tracing AGENTA_LICENSE REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING AGENTA_API_URL AGENTA_API_INTERNAL_URL PORT SCRIPT_NAME

    set_vars worker-webhooks \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY" \
        POSTGRES_URI_CORE="$pg_async_core" \
        POSTGRES_URI_TRACING="$pg_async_tracing" \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens"

    unset_vars worker-webhooks AGENTA_LICENSE REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING AGENTA_API_URL AGENTA_API_INTERNAL_URL PORT SCRIPT_NAME

    set_vars worker-events \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY" \
        POSTGRES_URI_CORE="$pg_async_core" \
        POSTGRES_URI_TRACING="$pg_async_tracing" \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens"

    unset_vars worker-events AGENTA_LICENSE REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING AGENTA_API_URL AGENTA_API_INTERNAL_URL PORT SCRIPT_NAME

    set_vars cron \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY" \
        POSTGRES_URI_CORE="$pg_async_core" \
        POSTGRES_URI_TRACING="$pg_async_tracing" \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens"

    unset_vars cron AGENTA_LICENSE REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING AGENTA_API_URL AGENTA_API_INTERNAL_URL PORT SCRIPT_NAME

    set_vars alembic \
        AGENTA_WEB_URL="https://${public_domain_ref}" \
        AGENTA_API_URL="https://${public_domain_ref}/api" \
        AGENTA_SERVICES_URL="https://${public_domain_ref}/services" \
        AGENTA_AUTH_KEY="$AGENTA_AUTH_KEY" \
        AGENTA_CRYPT_KEY="$AGENTA_CRYPT_KEY" \
        POSTGRES_URI_CORE="$pg_async_core" \
        POSTGRES_URI_TRACING="$pg_async_tracing" \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens"

    unset_vars alembic AGENTA_LICENSE REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING AGENTA_API_INTERNAL_URL PORT SCRIPT_NAME

    unset_vars web AGENTA_LICENSE PORT SCRIPT_NAME REDIS_URI REDIS_URI_VOLATILE REDIS_URI_DURABLE SUPERTOKENS_CONNECTION_URI AGENTA_API_INTERNAL_URL ALEMBIC_CFG_PATH_CORE ALEMBIC_CFG_PATH_TRACING

    set_vars supertokens \
        POSTGRES_URI_SUPERTOKENS="$pg_sync_supertokens" \
        POSTGRESQL_CONNECTION_URI="$pg_sync_supertokens"

    if railway service "$REDIS_SERVICE" >/dev/null 2>&1; then
        set_vars "$REDIS_SERVICE" \
            RAILWAY_RUN_UID=0 \
            RAILWAY_RUN_GID=0
    fi

    resolve_postgres_password

    set_vars "$POSTGRES_REF_NS" \
        PGDATA=/var/lib/postgresql/data/pgdata \
        PGHOST=postgres.railway.internal \
        PGDATABASE=railway \
        PGUSER=postgres \
        PGPASSWORD="$POSTGRES_PASSWORD" \
        PGPORT=5432 \
        POSTGRES_DB=railway \
        POSTGRES_USER=postgres \
        POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
        SSL_CERT_DAYS=820 \
        RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60

    set_healthcheck gateway "/"
    set_healthcheck api "/health"
    set_healthcheck services "/health"

    printf "Configuration completed for project '%s' environment '%s'\n" "$PROJECT_NAME" "$ENV_NAME"
}

main "$@"
