#!/usr/bin/env bash

# preview-clone-destroy.sh — delete a clone-mode PR preview environment
# (issue #5650, WP3), or sweep stale ones.
#
# Clone-mode previews are ENVIRONMENTS inside the shared template project
# (created by preview-clone-create.sh), so destroying one is a single
# environmentDelete — never a project delete. Idempotent: an absent
# environment is a success.
#
# Usage:
#   preview-clone-destroy.sh                 # delete pr-<PR_NUMBER> (or
#                                            # $RAILWAY_PREVIEW_ENV_NAME)
#   preview-clone-destroy.sh --stale-hours N # delete preview environments in
#                                            # the template project older than
#                                            # N hours (cron equivalent of
#                                            # scripts/preview-cleanup-stale.sh
#                                            # for clone mode)
#
# The stale sweep matches only preview-shaped names: pr-<digits>, pr-clone-*,
# and wp3-* (the test-cycle prefixes). The template environment and
# 'production' are always excluded, twice over: they do not match the
# patterns, and they are rejected by name before any delete.
#
# Environment variables:
#   PR_NUMBER                 PR number; default environment name pr-<PR_NUMBER>.
#   RAILWAY_PREVIEW_ENV_NAME  Override the environment name.
#   RAILWAY_TEMPLATE_PROJECT  Template project name.
#                             TODO(cutover): default becomes the production
#                             preview project at rollout; until then it is the
#                             proven test bed.
#   RAILWAY_TEMPLATE_ENV      Template environment name (default pr-template).
#   RAILWAY_PREVIEW_DRY_RUN   'true' with --stale-hours: report, delete nothing.
#   RAILWAY_API_TOKEN         Account token (auto-sourced from
#                             ~/.agenta-railway.env locally; in CI exported
#                             from secrets.RAILWAY_TOKEN — never named
#                             RAILWAY_TOKEN).

# GraphQL documents use $var for GraphQL variables, not shell expansion.
# shellcheck disable=SC2016

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Single shared GraphQL client (WP2); do not fork another copy.
# shellcheck source=../template/lib-graphql.sh
source "$SCRIPT_DIR/../template/lib-graphql.sh"

die() {
    printf 'preview-clone-destroy.sh: %s\n' "$*" >&2
    exit 1
}

STALE_HOURS=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --stale-hours) [ "$#" -ge 2 ] || die "--stale-hours needs a value"; STALE_HOURS="$2"; shift 2 ;;
        --stale-hours=*) STALE_HOURS="${1#*=}"; shift ;;
        *) die "unknown argument: $1" ;;
    esac
done
if [ -n "$STALE_HOURS" ]; then
    printf '%s' "$STALE_HOURS" | grep -qE '^[0-9]+$' || die "--stale-hours must be a whole number of hours"
fi

# TODO(cutover): default becomes the production preview template project at
# rollout (also re-point ../template/template.json's "project").
PROJECT_NAME="${RAILWAY_TEMPLATE_PROJECT:-agenta-oss-clone-spike}"
TEMPLATE_ENV_NAME="${RAILWAY_TEMPLATE_ENV:-pr-template}"
DRY_RUN="${RAILWAY_PREVIEW_DRY_RUN:-false}"

case "$PROJECT_NAME" in
    agenta-oss-pr-*) die "refusing to target legacy per-PR project '$PROJECT_NAME'" ;;
esac

Q_ENVS='query($p: String!) { environments(projectId: $p, first: 100) { edges { node { id name createdAt } } } }'
M_ENV_DELETE='mutation($id: String!) { environmentDelete(id: $id) }'

# is_protected_env <name>: the template environment and production must never
# be deleted, whatever the caller or the name patterns say.
is_protected_env() {
    [ "$1" = "$TEMPLATE_ENV_NAME" ] || [ "$1" = "production" ]
}

delete_env() {
    local env_id="$1" env_name="$2"
    is_protected_env "$env_name" && die "refusing to delete protected environment '$env_name'"
    rw_graphql "$M_ENV_DELETE" "$(jq -nc --arg id "$env_id" '{id: $id}')" >/dev/null
    printf "Deleted preview environment '%s'\n" "$env_name"
}

destroy_one() {
    local env_name="${RAILWAY_PREVIEW_ENV_NAME:-${PR_NUMBER:+pr-${PR_NUMBER}}}"
    [ -n "$env_name" ] || die "set PR_NUMBER or RAILWAY_PREVIEW_ENV_NAME"
    is_protected_env "$env_name" && die "refusing to delete protected environment '$env_name'"

    local env_id
    env_id="$(rw_graphql "$Q_ENVS" "$(jq -nc --arg p "$PROJECT_ID" '{p: $p}')" \
        | jq -r --arg n "$env_name" '.data.environments.edges[].node | select(.name == $n) | .id' | head -n1)"
    if [ -z "$env_id" ]; then
        printf "Environment '%s' does not exist in project '%s'. Nothing to delete.\n" "$env_name" "$PROJECT_NAME"
        return 0
    fi
    delete_env "$env_id" "$env_name"
}

destroy_stale() {
    local now_epoch max_age_seconds deleted=0 kept=0
    now_epoch="$(date +%s)"
    max_age_seconds=$((STALE_HOURS * 3600))

    local envs_json
    envs_json="$(rw_graphql "$Q_ENVS" "$(jq -nc --arg p "$PROJECT_ID" '{p: $p}')")"

    local env_id env_name created_at created_epoch age_seconds age_hours
    while IFS=$'\t' read -r env_id env_name created_at; do
        # Preview-shaped names only; everything else (production, pr-template,
        # operator scratch envs) is left alone.
        case "$env_name" in
            pr-clone-* | wp3-*) : ;;
            pr-*)
                printf '%s' "${env_name#pr-}" | grep -qE '^[0-9]+$' || continue ;;
            *) continue ;;
        esac
        is_protected_env "$env_name" && continue

        created_epoch="$(date -d "$created_at" +%s 2>/dev/null || echo 0)"
        if [ "$created_epoch" -eq 0 ]; then
            printf "SKIP: %s (could not parse createdAt: %s)\n" "$env_name" "$created_at"
            kept=$((kept + 1))
            continue
        fi
        age_seconds=$((now_epoch - created_epoch))
        age_hours=$((age_seconds / 3600))
        if [ "$age_seconds" -gt "$max_age_seconds" ]; then
            if [ "$DRY_RUN" = "true" ]; then
                printf "DRY-RUN: would delete '%s' (age: %dh)\n" "$env_name" "$age_hours"
            else
                printf "DELETE: '%s' (age: %dh)\n" "$env_name" "$age_hours"
                delete_env "$env_id" "$env_name"
            fi
            deleted=$((deleted + 1))
        else
            printf "KEEP: '%s' (age: %dh, max: %dh)\n" "$env_name" "$age_hours" "$STALE_HOURS"
            kept=$((kept + 1))
        fi
    done < <(jq -r '.data.environments.edges[].node | [.id, .name, .createdAt] | @tsv' <<<"$envs_json")

    if [ "$DRY_RUN" = "true" ]; then
        printf 'Stale sweep complete (dry-run). Would delete: %d, kept: %d (max age: %sh)\n' \
            "$deleted" "$kept" "$STALE_HOURS"
    else
        printf 'Stale sweep complete. Deleted: %d, kept: %d (max age: %sh)\n' \
            "$deleted" "$kept" "$STALE_HOURS"
    fi
}

main() {
    command -v jq >/dev/null 2>&1 || die "missing required command: jq"
    command -v curl >/dev/null 2>&1 || die "missing required command: curl"
    rw_require_token

    PROJECT_ID="${RAILWAY_TEMPLATE_PROJECT_ID:-}"
    if [ -z "$PROJECT_ID" ]; then
        PROJECT_ID="$(rw_find_project_id "$PROJECT_NAME" || true)"
    fi
    [ -n "$PROJECT_ID" ] || die "project '$PROJECT_NAME' not found for this token"

    if [ -n "$STALE_HOURS" ]; then
        destroy_stale
    else
        destroy_one
    fi
    rw_report_calls "preview-clone-destroy"
}

main
