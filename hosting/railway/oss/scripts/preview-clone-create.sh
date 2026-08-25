#!/usr/bin/env bash

# preview-clone-create.sh — create or update a clone-mode PR preview
# environment (issue #5650, WP3).
#
# Clone mode replaces the legacy one-project-per-PR bootstrap: per-PR previews
# are ENVIRONMENTS cloned from a template environment inside one shared
# project. The template is defined in git (../template/template.json,
# converged by ../template/apply.sh). This script drives Railway's GraphQL API
# through the template tooling's client (../template/lib-graphql.sh) and:
#
#   1. Ensures environment $ENV_NAME exists: environmentCreate from the
#      template with skipInitialDeploys. environmentCreate can 504 while the
#      environment is still created in the background, so an ambiguous failure
#      is reconciled by polling environments-by-name, never by re-creating.
#   2. Patches the nine app-service images to the run's pinned tag with ONE
#      environmentPatchCommit; Railway auto-deploys every service whose config
#      actually CHANGED. Services whose image already equals the target are
#      deployed explicitly instead, because environmentPatchCommit silently
#      NO-OPS on an unchanged config — the trap that strands clones on
#      template images (spike findings, deploy-mode section).
#   3. Deploys the remaining services in the proven order: infra first, then
#      alembic (creates the databases and runs migrations), then everything
#      else — supertokens MUST NOT deploy before alembic. Polling is bounded.
#      A single Postgres first-deploy timeout is retried once (proven
#      transient for volume-backed services in a fresh clone); a second
#      timeout is fatal.
#   4. Smoke-checks /w, /api/health and /services/health through the clone's
#      own gateway domain (same endpoints as scripts/smoke.sh, without the
#      Railway CLI dependency).
#
# Idempotent: re-running for the same PR converges. An existing environment is
# patched, not re-created, and already-successful services are left alone.
#
# Usage:
#   preview-clone-create.sh [--verify-only]
#
#   --verify-only  Mutation-free: resolve the existing environment, read the
#                  gateway domain, smoke-check it, and emit the same outputs.
#                  Fails if the environment does not exist. Used by workflow
#                  43's clone-mode verify step.
#
# Environment variables:
#   PR_NUMBER                 PR number; default environment name is
#                             pr-<PR_NUMBER>.
#   RAILWAY_PREVIEW_ENV_NAME  Override the environment name (test cycles use
#                             pr-clone-* names). One of PR_NUMBER or this
#                             variable is required.
#   IMAGE_TAG                 Pinned app-image tag (pr-<n>-<sha>). Required
#                             unless --verify-only. 'latest' is refused.
#   RAILWAY_TEMPLATE_PROJECT  Template project name (default
#                             agenta-oss-clone-spike). CI passes the repo
#                             variables RAILWAY_TEMPLATE_PROJECT /
#                             RAILWAY_TEMPLATE_ENV, so a template project move
#                             needs no code change (see ../README.md).
#   RAILWAY_TEMPLATE_ENV      Template environment name (default pr-template).
#   RAILWAY_TEMPLATE_PROJECT_ID / RAILWAY_TEMPLATE_ENV_ID
#                             Skip name resolution entirely (saves reads).
#   RAILWAY_API_TOKEN         Account token (auto-sourced from
#                             ~/.agenta-railway.env locally; in CI exported
#                             from secrets.RAILWAY_TOKEN — never named
#                             RAILWAY_TOKEN, the CLI treats that name as
#                             project-scoped).
#   AGENTA_API_IMAGE_REPO / AGENTA_WEB_IMAGE_REPO /
#   AGENTA_WEB_MOBILE_IMAGE_REPO / AGENTA_SERVICES_IMAGE_REPO /
#   AGENTA_RUNNER_IMAGE_REPO  Image repository overrides.
#   RW_INFRA_WAIT_SECONDS     Postgres wait per attempt (default 420).
#   RW_ALEMBIC_WAIT_SECONDS   Alembic wait (default 420).
#   RW_DEPLOY_WAIT_SECONDS    Late-services wait (default 900).
#   RW_POLL_INTERVAL          Status poll interval (default 15).
#   SMOKE_MAX_WAIT_SECONDS / SMOKE_SLEEP_SECONDS
#                             Smoke bounds (defaults 300 / 5; same knobs as
#                             scripts/smoke.sh).

# GraphQL documents use $var for GraphQL variables, not shell expansion.
# shellcheck disable=SC2016

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Single shared GraphQL client (WP2); do not fork another copy.
# shellcheck source=../template/lib-graphql.sh
source "$SCRIPT_DIR/../template/lib-graphql.sh"

VERIFY_ONLY=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --verify-only) VERIFY_ONLY=true; shift ;;
        *) printf 'preview-clone-create.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
    esac
done

# Defaults match ../template/template.json's "project"/"templateEnvironment"
# and the CI fallbacks for the RAILWAY_TEMPLATE_PROJECT/ENV repo variables;
# a template project move updates all of them together (see ../README.md).
PROJECT_NAME="${RAILWAY_TEMPLATE_PROJECT:-agenta-oss-clone-spike}"
TEMPLATE_ENV_NAME="${RAILWAY_TEMPLATE_ENV:-pr-template}"
PR_NUMBER="${PR_NUMBER:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
ENV_NAME="${RAILWAY_PREVIEW_ENV_NAME:-${PR_NUMBER:+pr-${PR_NUMBER}}}"

die() {
    printf 'preview-clone-create.sh: %s\n' "$*" >&2
    exit 1
}

[ -n "$ENV_NAME" ] || die "set PR_NUMBER or RAILWAY_PREVIEW_ENV_NAME"
[ "$ENV_NAME" != "$TEMPLATE_ENV_NAME" ] || die "refusing to target the template environment '$TEMPLATE_ENV_NAME'"
[ "$ENV_NAME" != "production" ] || die "refusing to target the 'production' environment"
case "$PROJECT_NAME" in
    agenta-oss-pr-*) die "refusing to target legacy per-PR project '$PROJECT_NAME'" ;;
esac
if [ "$VERIFY_ONLY" = false ]; then
    [ -n "$IMAGE_TAG" ] || die "IMAGE_TAG is required"
    [ "$IMAGE_TAG" != "latest" ] || die "IMAGE_TAG must be a pinned tag, never 'latest'"
fi

API_REPO="${AGENTA_API_IMAGE_REPO:-ghcr.io/agenta-ai/agenta-api}"
WEB_REPO="${AGENTA_WEB_IMAGE_REPO:-ghcr.io/agenta-ai/agenta-web}"
WEB_MOBILE_REPO="${AGENTA_WEB_MOBILE_IMAGE_REPO:-ghcr.io/agenta-ai/agenta-web-mobile}"
SERVICES_REPO="${AGENTA_SERVICES_IMAGE_REPO:-ghcr.io/agenta-ai/agenta-services}"
RUNNER_REPO="${AGENTA_RUNNER_IMAGE_REPO:-ghcr.io/agenta-ai/agenta-runner}"

# The nine image-patched app services; the api image backs five of them.
APP_SERVICES=(api worker-streams worker-queues cron alembic web web-mobile services runner)
# supertokens must deploy AFTER alembic: it needs the agenta_oss_supertokens
# database that alembic's startCommand creates (spike finding Q12).
INFRA_SERVICES=(Postgres redis seaweedfs)
LATE_SERVICES=(supertokens api worker-streams worker-queues runner services cron web web-mobile gateway)
ALL_SERVICES=("${INFRA_SERVICES[@]}" alembic "${LATE_SERVICES[@]}")

# Services a clone may legitimately not have yet. Adding a service to the
# template only reaches clones once apply.sh has converged the template
# environment (template/README.md step 4, "Apply on merge"), so during that
# window a clone of the OLD template has no such service. A preview must
# deploy anyway instead of dying on a missing serviceId; every other service
# staying absent is still fatal.
OPTIONAL_SERVICES=(web-mobile)
# Filled in by patch_commit_images / deploy_all for the run summary.
MISSING_SERVICES=""

Q_ENV_SERVICES='query($id: String!) { environment(id: $id) { serviceInstances { edges { node { serviceId serviceName source { image } latestDeployment { status } domains { serviceDomains { domain } } } } } } }'
Q_ENVS='query($p: String!) { environments(projectId: $p, first: 100) { edges { node { id name } } } }'
M_ENV_CREATE='mutation($in: EnvironmentCreateInput!) { environmentCreate(input: $in) { id name } }'
M_DEPLOY='mutation($e: String!, $s: String!) { serviceInstanceDeployV2(environmentId: $e, serviceId: $s) }'
M_PATCH_COMMIT='mutation($e: String!, $p: EnvironmentConfig) { environmentPatchCommit(environmentId: $e, patch: $p, commitMessage: "preview image patch") }'
M_DOMAIN_CREATE='mutation($in: ServiceDomainCreateInput!) { serviceDomainCreate(input: $in) { domain } }'

now() { date +%s; }

emit_output() {
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
    fi
}

image_for() {
    case "$1" in
        api | worker-streams | worker-queues | cron | alembic) printf '%s:%s' "$API_REPO" "$IMAGE_TAG" ;;
        web) printf '%s:%s' "$WEB_REPO" "$IMAGE_TAG" ;;
        web-mobile) printf '%s:%s' "$WEB_MOBILE_REPO" "$IMAGE_TAG" ;;
        services) printf '%s:%s' "$SERVICES_REPO" "$IMAGE_TAG" ;;
        runner) printf '%s:%s' "$RUNNER_REPO" "$IMAGE_TAG" ;;
        *) return 1 ;;
    esac
}

PROJECT_ID="${RAILWAY_TEMPLATE_PROJECT_ID:-}"
TEMPLATE_ENV_ID="${RAILWAY_TEMPLATE_ENV_ID:-}"
CLONE_ENV_ID=""
CLONE_SERVICES_JSON=""
GATEWAY_DOMAIN=""

resolve_template_ids() {
    if [ -z "$PROJECT_ID" ]; then
        PROJECT_ID="$(rw_find_project_id "$PROJECT_NAME" || true)"
    fi
    [ -n "$PROJECT_ID" ] || die "project '$PROJECT_NAME' not found for this token"
    if [ -z "$TEMPLATE_ENV_ID" ]; then
        TEMPLATE_ENV_ID="$(rw_graphql "$Q_ENVS" "$(jq -nc --arg p "$PROJECT_ID" '{p: $p}')" \
            | jq -r --arg n "$TEMPLATE_ENV_NAME" '.data.environments.edges[].node | select(.name == $n) | .id' | head -n1)"
    fi
    [ -n "$TEMPLATE_ENV_ID" ] || die "template environment '$TEMPLATE_ENV_NAME' not found in project '$PROJECT_NAME'"
}

find_env_id_by_name() {
    rw_graphql "$Q_ENVS" "$(jq -nc --arg p "$PROJECT_ID" '{p: $p}')" \
        | jq -r --arg n "$1" '.data.environments.edges[].node | select(.name == $n) | .id' | head -n1
}

clone_environment() {
    local resp rc
    RW_NO_TRANSIENT_RETRY=1
    resp="$(rw_graphql "$M_ENV_CREATE" \
        "$(jq -nc --arg p "$PROJECT_ID" --arg n "$ENV_NAME" --arg src "$TEMPLATE_ENV_ID" \
            '{in: {projectId: $p, name: $n, sourceEnvironmentId: $src, skipInitialDeploys: true}}')")" && rc=0 || rc=$?
    RW_NO_TRANSIENT_RETRY=0
    if [ "$rc" -eq 0 ]; then
        CLONE_ENV_ID="$(jq -r '.data.environmentCreate.id // empty' <<<"$resp")"
        [ -n "$CLONE_ENV_ID" ] && return 0
    fi

    # environmentCreate can 504 while the environment is still created in the
    # background; reconcile by polling for the name instead of re-creating.
    printf "environmentCreate did not return cleanly; polling for env '%s' by name.\n" "$ENV_NAME" >&2
    local waited=0 interval="${RW_ENV_CREATE_POLL_INTERVAL:-10}" max="${RW_ENV_CREATE_POLL_SECONDS:-180}"
    while [ "$waited" -lt "$max" ]; do
        sleep "$interval"
        waited=$((waited + interval))
        CLONE_ENV_ID="$(find_env_id_by_name "$ENV_NAME" || true)"
        [ -n "$CLONE_ENV_ID" ] && return 0
    done
    printf "Environment '%s' never appeared within %ss.\n" "$ENV_NAME" "$max" >&2
    return 1
}

refresh_clone_services() {
    CLONE_SERVICES_JSON="$(rw_graphql "$Q_ENV_SERVICES" "$(jq -nc --arg id "$CLONE_ENV_ID" '{id: $id}')")"
}

# Legacy previews wrote the CI test credentials into every environment at
# configure time; clones inherit the template's own generated key instead, so
# the acceptance suites' admin calls fail with 401 (#5650 soak finding). When
# CI provides AGENTA_AUTH_KEY, upsert it onto the services that consume it
# BEFORE anything deploys, so freshly deployed containers pick it up. Without
# the variable (local runs), the clone keeps the template's self-contained key.
apply_ci_auth_key() {
    [ -n "${AGENTA_AUTH_KEY:-}" ] || return 0
    local svc svc_id
    # Every service legacy configure.sh gave the key to: the workers use it for
    # internal calls while processing evaluation runs, so partial coverage
    # split-brains auth and evaluations finish with status "errors". web-mobile
    # carries AGENTA_AUTH_KEY for the same reason web does (same image
    # entrypoint, same runtime config), so it needs the CI key too.
    for svc in web web-mobile api services worker-queues worker-streams cron alembic; do
        svc_id="$(clone_service_id "$svc")"
        if [ -z "$svc_id" ]; then
            # A service the clone does not have yet (see OPTIONAL_SERVICES) is
            # skipped here too; anything else missing is still fatal.
            skip_absent_service "$svc" || return 1
            continue
        fi
        rw_graphql \
            'mutation($in: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $in) }' \
            "$(jq -nc --arg p "$PROJECT_ID" --arg e "$CLONE_ENV_ID" --arg s "$svc_id" --arg v "$AGENTA_AUTH_KEY" \
                '{in: {projectId: $p, environmentId: $e, serviceId: $s, skipDeploys: true, replace: false, variables: {AGENTA_AUTH_KEY: $v}}}')" \
            >/dev/null || return 1
    done
    printf "CI auth key applied to every service that consumes it.\n"
}

# A write-only vault connection can be resolved only by the trusted platform
# runtime. Give API and Services one ephemeral shared proof before deploy; do
# not reuse the admin key and do not expose this proof to any other service.
# Disposable previews need no stored secret, so always generate a fresh proof.
apply_ci_runtime_key() {
    command -v openssl >/dev/null 2>&1 || {
        printf "missing required command: openssl\n" >&2
        return 1
    }
    local runtime_key
    runtime_key="$(openssl rand -hex 32)" || return 1

    local svc svc_id
    for svc in api services; do
        svc_id="$(clone_service_id "$svc")"
        [ -n "$svc_id" ] || return 1
        rw_graphql \
            'mutation($in: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $in) }' \
            "$(jq -nc --arg p "$PROJECT_ID" --arg e "$CLONE_ENV_ID" --arg s "$svc_id" --arg v "$runtime_key" \
                '{in: {projectId: $p, environmentId: $e, serviceId: $s, skipDeploys: true, replace: false, variables: {AGENTA_SERVICES_INTERNAL_KEY: $v}}}')" \
            >/dev/null || return 1
    done
    printf "CI runtime key applied to API and Services.\n"
}

clone_service_id() {
    jq -r --arg n "$1" \
        '.data.environment.serviceInstances.edges[].node | select(.serviceName == $n) | .serviceId' \
        <<<"$CLONE_SERVICES_JSON" | head -n1
}

clone_service_status() {
    jq -r --arg n "$1" \
        '.data.environment.serviceInstances.edges[].node | select(.serviceName == $n) | .latestDeployment.status // "NONE"' \
        <<<"$CLONE_SERVICES_JSON" | head -n1
}

clone_service_image() {
    jq -r --arg n "$1" \
        '.data.environment.serviceInstances.edges[].node | select(.serviceName == $n) | .source.image // ""' \
        <<<"$CLONE_SERVICES_JSON" | head -n1
}

clone_has_service() {
    [ -n "$(clone_service_id "$1")" ]
}

# skip_absent_service <service>: 0 when the service may be missing (recorded
# and skipped), 1 when its absence is fatal.
skip_absent_service() {
    local svc="$1"
    if contains_word "${OPTIONAL_SERVICES[*]}" "$svc"; then
        contains_word "$MISSING_SERVICES" "$svc" || {
            MISSING_SERVICES="$MISSING_SERVICES $svc"
            printf "Service '%s' is not in this clone; skipping it. The template environment has not been converged yet (template/README.md 'Apply on merge').\n" "$svc" >&2
        }
        return 0
    fi
    printf "No serviceId for '%s'.\n" "$svc" >&2
    return 1
}

# required_missing_services: the required services absent from the clone, as a
# leading-space-separated list. Empty means the clone is fully materialized.
required_missing_services() {
    local svc out=""
    for svc in "${ALL_SERVICES[@]}"; do
        if contains_word "${OPTIONAL_SERVICES[*]}" "$svc"; then
            continue
        fi
        if ! clone_has_service "$svc"; then
            out="$out $svc"
        fi
    done
    printf '%s' "$out"
}

# Wait until the clone's serviceInstances are fully materialized (reads can
# lag writes right after environmentCreate).
#
# Checks every REQUIRED service by name rather than counting instances. A count
# is unsound once the set has an optional member: a converged clone that has
# web-mobile plus 12 of its 13 required services also totals 13, so a count
# check would return while a required service was still missing and the deploy
# loop would fail instead of waiting.
wait_clone_populated() {
    local waited=0 interval=5 max="${RW_CLONE_POPULATE_SECONDS:-120}" missing
    while :; do
        refresh_clone_services || return 1
        missing="$(required_missing_services)"
        [ -z "$missing" ] && return 0
        waited=$((waited + interval))
        if [ "$waited" -ge "$max" ]; then
            printf 'Environment is still missing required service(s) after %ss:%s\n' "$max" "$missing" >&2
            return 1
        fi
        sleep "$interval"
    done
}

deploy_service() {
    local svc="$1" svc_id
    svc_id="$(clone_service_id "$svc")"
    [ -n "$svc_id" ] || { printf "No serviceId for '%s'.\n" "$svc" >&2; return 1; }
    rw_graphql "$M_DEPLOY" "$(jq -nc --arg e "$CLONE_ENV_ID" --arg s "$svc_id" '{e: $e, s: $s}')" >/dev/null
}

# dump_failed_service_logs <service>: best-effort diagnostics (redacted) so a
# failed run leaves evidence in the workflow log.
dump_failed_service_logs() {
    local svc="$1" svc_id dep_id
    svc_id="$(clone_service_id "$svc")"
    [ -n "$svc_id" ] || return 0
    dep_id="$(rw_graphql \
        'query($in: DeploymentListInput!) { deployments(input: $in, first: 1) { edges { node { id } } } }' \
        "$(jq -nc --arg e "$CLONE_ENV_ID" --arg s "$svc_id" '{in: {environmentId: $e, serviceId: $s}}')" \
        | jq -r '.data.deployments.edges[0].node.id // empty' || true)"
    [ -n "$dep_id" ] || return 0
    printf -- '--- %s build logs (last 20, redacted) ---\n' "$svc" >&2
    rw_graphql 'query($id: String!) { buildLogs(deploymentId: $id, limit: 20) { message } }' \
        "$(jq -nc --arg id "$dep_id" '{id: $id}')" \
        | jq -r '(.data.buildLogs // [])[].message' | rw_redact >&2 || true
    printf -- '--- %s deploy logs (last 20, redacted) ---\n' "$svc" >&2
    rw_graphql 'query($id: String!) { deploymentLogs(deploymentId: $id, limit: 20) { message } }' \
        "$(jq -nc --arg id "$dep_id" '{id: $id}')" \
        | jq -r '(.data.deploymentLogs // [])[].message' | rw_redact >&2 || true
    return 0
}

# wait_services_success <timeout-seconds> <service...>
# Returns 0 when every service is SUCCESS, 2 when a service ends FAILED or
# CRASHED (terminal — retrying the wait is pointless), 1 on timeout. alembic
# is a one-shot: an exited container may report SLEEPING/REMOVED, accepted for
# alembic only.
wait_services_success() {
    local timeout="$1"; shift
    local waited=0 interval="${RW_POLL_INTERVAL:-15}" svc st all_ok
    while :; do
        refresh_clone_services || return 1
        all_ok=1
        for svc in "$@"; do
            st="$(clone_service_status "$svc")"
            case "$st" in
                SUCCESS) : ;;
                SLEEPING | REMOVED) [ "$svc" = "alembic" ] || all_ok=0 ;;
                FAILED | CRASHED)
                    printf "Service '%s' deployment ended %s.\n" "$svc" "$st" >&2
                    dump_failed_service_logs "$svc"
                    return 2 ;;
                *) all_ok=0 ;;
            esac
        done
        [ "$all_ok" -eq 1 ] && return 0
        waited=$((waited + interval))
        if [ "$waited" -ge "$timeout" ]; then
            printf 'Timed out (%ss) waiting for: %s\n' "$timeout" "$*" >&2
            return 1
        fi
        sleep "$interval"
    done
}

# Clone fidelity: Railway usually regenerates a gateway service domain inside
# the clone; create one only when absent (gateway nginx listens on PORT=8080).
ensure_gateway_domain() {
    refresh_clone_services || return 1
    GATEWAY_DOMAIN="$(jq -r \
        '.data.environment.serviceInstances.edges[].node | select(.serviceName == "gateway") | .domains.serviceDomains[0].domain // empty' \
        <<<"$CLONE_SERVICES_JSON" | head -n1)"
    [ -n "$GATEWAY_DOMAIN" ] && return 0
    [ "$VERIFY_ONLY" = false ] || { printf 'No gateway domain found (verify-only never creates one).\n' >&2; return 1; }

    local gw_id resp
    gw_id="$(clone_service_id gateway)"
    [ -n "$gw_id" ] || return 1
    resp="$(rw_graphql "$M_DOMAIN_CREATE" \
        "$(jq -nc --arg e "$CLONE_ENV_ID" --arg s "$gw_id" '{in: {environmentId: $e, serviceId: $s, targetPort: 8080}}')")" \
        || return 1
    GATEWAY_DOMAIN="$(jq -r '.data.serviceDomainCreate.domain // empty' <<<"$resp")"
    [ -n "$GATEWAY_DOMAIN" ]
}

# ONE environmentPatchCommit for every app service whose live image differs
# from the target; Railway deploys each patched service immediately. Services
# already on the target image are recorded in UNCHANGED_SERVICES: patchCommit
# would silently no-op for them, so the deploy phase issues explicit deploys
# for any of them that is not already green.
PATCHED_SERVICES=""
UNCHANGED_SERVICES=""

patch_commit_images() {
    local svc svc_id img live services_patch='{}' patched=0
    PATCHED_SERVICES=""
    UNCHANGED_SERVICES=""
    for svc in "${APP_SERVICES[@]}"; do
        svc_id="$(clone_service_id "$svc")"
        if [ -z "$svc_id" ]; then
            skip_absent_service "$svc" || return 1
            continue
        fi
        img="$(image_for "$svc")"
        live="$(clone_service_image "$svc")"
        if [ "$live" = "$img" ]; then
            UNCHANGED_SERVICES="$UNCHANGED_SERVICES $svc"
            continue
        fi
        services_patch="$(jq -c --arg s "$svc_id" --arg img "$img" \
            '. + {($s): {source: {image: $img}}}' <<<"$services_patch")"
        PATCHED_SERVICES="$PATCHED_SERVICES $svc"
        patched=$((patched + 1))
    done
    if [ "$patched" -eq 0 ]; then
        printf 'All app images already at %s; nothing to patch (explicit deploys cover the no-op trap).\n' "$IMAGE_TAG"
        return 0
    fi
    printf 'environmentPatchCommit: %d service(s) ->%s\n' "$patched" "$PATCHED_SERVICES"
    rw_graphql "$M_PATCH_COMMIT" \
        "$(jq -nc --arg e "$CLONE_ENV_ID" --argjson sp "$services_patch" '{e: $e, p: {services: $sp}}')" \
        >/dev/null
}

contains_word() {
    case " $1 " in *" $2 "*) return 0 ;; esac
    return 1
}

# needs_explicit_deploy <service>: a service needs an explicit
# serviceInstanceDeployV2 when the patchCommit did not cover it AND it is not
# already green (fresh clones start with no deployments at all).
needs_explicit_deploy() {
    local svc="$1" st
    contains_word "$PATCHED_SERVICES" "$svc" && return 1
    st="$(clone_service_status "$svc")"
    case "$st" in
        SUCCESS) return 1 ;;
        SLEEPING | REMOVED) [ "$svc" = "alembic" ] && return 1 || return 0 ;;
        *) return 0 ;;
    esac
}

deploy_all() {
    local svc rc

    # Infra first. In an existing environment green services are left alone.
    refresh_clone_services || return 1
    for svc in "${INFRA_SERVICES[@]}"; do
        clone_has_service "$svc" || { skip_absent_service "$svc" || return 1; continue; }
        if needs_explicit_deploy "$svc"; then
            deploy_service "$svc" || return 1
        fi
    done
    # A single Postgres first-deploy timeout in a fresh clone is transient
    # (volume provisioning); retry the deploy once. Terminal FAILED/CRASHED
    # (rc=2) is not retried.
    wait_services_success "${RW_INFRA_WAIT_SECONDS:-420}" Postgres && rc=0 || rc=$?
    if [ "$rc" -eq 1 ]; then
        printf 'Postgres first deploy timed out once; retrying the deploy (single retry).\n' >&2
        deploy_service Postgres || return 1
        wait_services_success "${RW_INFRA_WAIT_SECONDS:-420}" Postgres || return 1
    elif [ "$rc" -ne 0 ]; then
        return 1
    fi

    # One patchCommit for every changed app image (deploys them, alembic
    # included, in parallel — alembic's startCommand waits for Postgres and
    # the other apps ride their restart policy until migrations land).
    patch_commit_images || return 1

    # alembic must be green before supertokens deploys.
    refresh_clone_services || return 1
    clone_has_service alembic || { skip_absent_service alembic || return 1; }
    if needs_explicit_deploy alembic; then
        deploy_service alembic || return 1
    fi
    if contains_word "$PATCHED_SERVICES" alembic || [ "$(clone_service_status alembic)" != "SUCCESS" ]; then
        wait_services_success "${RW_ALEMBIC_WAIT_SECONDS:-420}" alembic || return 1
    fi

    # Everything else: services covered by the patchCommit are already
    # deploying; deploy the rest that are not green (supertokens, gateway, and
    # any app service the patch skipped because its image was unchanged).
    refresh_clone_services || return 1
    local present_late=()
    for svc in "${LATE_SERVICES[@]}"; do
        clone_has_service "$svc" || { skip_absent_service "$svc" || return 1; continue; }
        if needs_explicit_deploy "$svc"; then
            deploy_service "$svc" || return 1
        fi
        present_late+=("$svc")
    done
    wait_services_success "${RW_DEPLOY_WAIT_SECONDS:-900}" "${present_late[@]}"
}

check_endpoint() {
    local base="$1" path="$2"
    local waited=0 interval="${SMOKE_SLEEP_SECONDS:-5}" max="${SMOKE_MAX_WAIT_SECONDS:-300}"
    while :; do
        if curl -fsS --connect-timeout 5 --max-time 10 "${base}${path}" >/dev/null 2>&1; then
            printf 'OK: %s\n' "$path"
            return 0
        fi
        waited=$((waited + interval))
        if [ "$waited" -ge "$max" ]; then
            printf 'FAILED: %s after %ss\n' "$path" "$waited" >&2
            return 1
        fi
        sleep "$interval"
    done
}

smoke_check() {
    local base="https://${GATEWAY_DOMAIN}" path
    printf 'Smoke-checking %s\n' "$base"
    for path in /w /api/health /services/health; do
        check_endpoint "$base" "$path" || return 1
    done
}

main() {
    command -v jq >/dev/null 2>&1 || die "missing required command: jq"
    command -v curl >/dev/null 2>&1 || die "missing required command: curl"
    rw_require_token

    local t0 t_created=- t_deployed=- t_smoked=- clone_mode
    t0="$(now)"
    local calls_before
    calls_before="$(rw_call_count)"

    resolve_template_ids
    CLONE_ENV_ID="$(find_env_id_by_name "$ENV_NAME" || true)"

    if [ "$VERIFY_ONLY" = true ]; then
        [ -n "$CLONE_ENV_ID" ] || die "environment '$ENV_NAME' does not exist in project '$PROJECT_NAME' (setup must run first)"
        clone_mode="verify"
        ensure_gateway_domain || die "gateway domain not found in environment '$ENV_NAME'"
        smoke_check || die "smoke checks failed for environment '$ENV_NAME'"
    else
        if [ -n "$CLONE_ENV_ID" ]; then
            clone_mode="update"
            printf "Environment '%s' already exists; converging it to tag %s.\n" "$ENV_NAME" "$IMAGE_TAG"
        else
            clone_mode="create"
            printf "Cloning template '%s' into environment '%s'.\n" "$TEMPLATE_ENV_NAME" "$ENV_NAME"
            clone_environment || die "could not create environment '$ENV_NAME'"
        fi
        wait_clone_populated || die "environment '$ENV_NAME' never fully materialized"
        apply_ci_auth_key || die "could not apply the CI auth key to the clone"
        apply_ci_runtime_key || die "could not apply the CI runtime key to the clone"
        t_created=$(( $(now) - t0 ))

        # Domain BEFORE app deploys: web/api render
        # ${{gateway.RAILWAY_PUBLIC_DOMAIN}} into their env at container start.
        ensure_gateway_domain || die "could not ensure a gateway domain"
        deploy_all || die "deploy did not reach green"
        t_deployed=$(( $(now) - t0 ))

        smoke_check || die "smoke checks failed"
        t_smoked=$(( $(now) - t0 ))
    fi

    local total_s calls
    total_s=$(( $(now) - t0 ))
    calls=$(( $(rw_call_count) - calls_before ))

    local preview_url="https://${GATEWAY_DOMAIN}/w"
    local logs_url="https://railway.com/project/${PROJECT_ID}/logs?environmentId=${CLONE_ENV_ID}"
    printf 'Preview ready (%s): %s\n' "$clone_mode" "$preview_url"
    if [ -n "$MISSING_SERVICES" ]; then
        printf 'Skipped (not in this clone):%s\n' "$MISSING_SERVICES"
    fi
    printf 'Timings: created=%ss deployed=%ss smoked=%ss total=%ss api_calls=%s\n' \
        "$t_created" "$t_deployed" "$t_smoked" "$total_s" "$calls"
    rw_report_calls "preview-clone-create ($clone_mode)"

    emit_output project_name "$PROJECT_NAME"
    emit_output environment_name "$ENV_NAME"
    emit_output preview_url "$preview_url"
    emit_output railway_logs_url "$logs_url"
    emit_output clone_mode "$clone_mode"
    emit_output total_seconds "$total_s"
    emit_output api_calls "$calls"
}

main
