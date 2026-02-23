#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-staging}"
SKIP_UNSETS="${CONFIGURE_SKIP_UNSETS:-false}"

POSTGRES_REF_NS="${RAILWAY_POSTGRES_REF_NS:-Postgres}"
AGENTA_AUTH_KEY="${AGENTA_AUTH_KEY:-0000000000000000000000000000000000000000000000000000000000000000}"
AGENTA_CRYPT_KEY="${AGENTA_CRYPT_KEY:-1111111111111111111111111111111111111111111111111111111111111111}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

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

set_vars() {
    local service="$1"
    shift
    railway_call variable set --service "$service" --environment "$ENV_NAME" --skip-deploys "$@" >/dev/null
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
        railway_call variable set --service "$service" --environment "$ENV_NAME" --skip-deploys "${args[@]}" >/dev/null
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

    if [ "$AGENTA_AUTH_KEY" = "0000000000000000000000000000000000000000000000000000000000000000" ] || \
       [ "$AGENTA_CRYPT_KEY" = "1111111111111111111111111111111111111111111111111111111111111111" ]; then
        printf "WARNING: Using default placeholder auth/crypt keys. Set AGENTA_AUTH_KEY and AGENTA_CRYPT_KEY for production deployments.\n" >&2
    fi

    railway_call link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null

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

    if [ -z "$POSTGRES_PASSWORD" ]; then
        local existing_postgres_password
        existing_postgres_password="$(railway_call variable list -k --service "$POSTGRES_REF_NS" --environment "$ENV_NAME" | grep '^POSTGRES_PASSWORD=' | cut -d= -f2- || true)"
        if [ -n "$existing_postgres_password" ]; then
            POSTGRES_PASSWORD="$existing_postgres_password"
        else
            POSTGRES_PASSWORD="$(openssl rand -hex 24)"
        fi
    fi

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
