#!/usr/bin/env bash

# Converge a live Railway environment to the committed template definition
# (template.json). This is the change-management tool for the preview TEMPLATE
# environment (issue #5650): the definition in git is the source of truth, this
# script makes reality match it, and workflow 47 runs `--dry-run` on a schedule
# to catch hand-edits.
#
# Usage:
#   apply.sh [--dry-run] [--env-name NAME] [--project NAME]
#            [--app-tag TAG] [--wrapper-tag TAG] [--definition FILE]
#
#   --dry-run      Print a structured diff (missing services, image mismatches,
#                  variable NAME diffs — never values —, volume diffs,
#                  startCommand violations). Exit 0 when clean, 2 when drift
#                  exists, 1 on errors.
#   (default)      Apply the delta: create missing services, fix images /
#                  startCommands / restart policies, upsert missing variables
#                  (variableCollectionUpsert, skipDeploys), delete undeclared
#                  variables, create missing volumes. Extra SERVICES and extra
#                  VOLUMES are reported but never deleted (destructive; removing
#                  them is a manual, PR-documented operation), so apply exits
#                  nonzero while they remain.
#   --env-name     Target environment (default: templateEnvironment from the
#                  definition, i.e. pr-template). Point it at a scratch clone to
#                  test a definition change before touching the template.
#   --app-tag /    Override the image tag parameters (defaults from the
#   --wrapper-tag  definition). Guarded: never 'latest', never pr-* (the
#                  environmentPatchCommit no-op trap; see template.json notes).
#
# Env vars: RAILWAY_API_TOKEN (account token; auto-sourced from
# ~/.agenta-railway.env), RAILWAY_PROJECT_NAME / RAILWAY_ENVIRONMENT_NAME /
# AGENTA_TEMPLATE_APP_TAG / AGENTA_PREVIEW_WRAPPER_TAG as flag fallbacks.
#
# Secrets discipline: this file and template.json contain NO secret values.
# Secret variables are declared by NAME with a resolution spec (from_env /
# reuse-live / generate); values are resolved only when a variable is missing
# live, are reused from a sibling service when possible so shared secrets stay
# consistent, and are NEVER printed (diff lines carry names only; failure
# output goes through rw_redact).
#
# Proven API facts this script relies on (docs/design/railway-preview-clone-spike/
# findings.md): workspace-scoped project lookup; serviceInstanceUpdate applies
# immediately and does NOT deploy; startCommand null is a no-op while ""
# clears; creates (serviceCreate/volumeCreate) are not idempotent, so they are
# check-then-act with RW_NO_TRANSIENT_RETRY and a verify read.

set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib-graphql.sh
source "$TEMPLATE_DIR/lib-graphql.sh"

DEFINITION="$TEMPLATE_DIR/template.json"
DRY_RUN=false
ENV_NAME_ARG=""
PROJECT_ARG=""
APP_TAG_ARG=""
WRAPPER_TAG_ARG=""

die() {
    printf 'apply.sh: %s\n' "$*" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=true ;;
        --env-name) [ $# -ge 2 ] || die "--env-name needs a value"; ENV_NAME_ARG="$2"; shift ;;
        --env-name=*) ENV_NAME_ARG="${1#*=}" ;;
        --project) [ $# -ge 2 ] || die "--project needs a value"; PROJECT_ARG="$2"; shift ;;
        --project=*) PROJECT_ARG="${1#*=}" ;;
        --app-tag) [ $# -ge 2 ] || die "--app-tag needs a value"; APP_TAG_ARG="$2"; shift ;;
        --app-tag=*) APP_TAG_ARG="${1#*=}" ;;
        --wrapper-tag) [ $# -ge 2 ] || die "--wrapper-tag needs a value"; WRAPPER_TAG_ARG="$2"; shift ;;
        --wrapper-tag=*) WRAPPER_TAG_ARG="${1#*=}" ;;
        --definition) [ $# -ge 2 ] || die "--definition needs a value"; DEFINITION="$2"; shift ;;
        --definition=*) DEFINITION="${1#*=}" ;;
        -h|--help) sed -n '3,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
    shift
done

for cmd in jq curl openssl; do
    command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd"
done
[ -f "$DEFINITION" ] || die "definition not found: $DEFINITION"
jq -e . <"$DEFINITION" >/dev/null || die "definition is not valid JSON: $DEFINITION"

PROJECT_NAME="${PROJECT_ARG:-${RAILWAY_PROJECT_NAME:-$(jq -r '.project' "$DEFINITION")}}"
ENV_NAME="${ENV_NAME_ARG:-${RAILWAY_ENVIRONMENT_NAME:-$(jq -r '.templateEnvironment' "$DEFINITION")}}"
APP_TAG="${APP_TAG_ARG:-${AGENTA_TEMPLATE_APP_TAG:-$(jq -r '.parameters.app_tag.default' "$DEFINITION")}}"
WRAPPER_TAG="${WRAPPER_TAG_ARG:-${AGENTA_PREVIEW_WRAPPER_TAG:-$(jq -r '.parameters.wrapper_tag.default' "$DEFINITION")}}"

# Per-PR preview projects (legacy path) are owned by workflows 41/43/45 and
# must never be converged by this tool.
case "$PROJECT_NAME" in
    agenta-oss-pr-*) die "refusing to target per-PR preview project '$PROJECT_NAME'" ;;
esac

# Template tags must never be 'latest' and never collide with PR tags
# (pr-<n>-<sha>): environmentPatchCommit silently no-ops when the patched tag
# equals the template's, stranding clones on template images.
validate_tag() {
    local label="$1" tag="$2"
    [ -n "$tag" ] && [ "$tag" != "null" ] || die "$label is empty"
    [ "$tag" != "latest" ] || die "$label must never be 'latest' (patchCommit no-op trap; template.json notes.tag-policy)"
    case "$tag" in
        pr-*) die "$label must never use a pr-* tag (collides with PR image tags; patchCommit no-op trap)" ;;
    esac
}
validate_tag "app_tag" "$APP_TAG"
validate_tag "wrapper_tag" "$WRAPPER_TAG"

# Desired state with image tag parameters substituted.
DESIRED="$(jq -c --arg app "$APP_TAG" --arg wrap "$WRAPPER_TAG" \
    '.services | with_entries(.value.image |= (gsub("\\{app_tag\\}"; $app) | gsub("\\{wrapper_tag\\}"; $wrap)))' \
    "$DEFINITION")"

rw_require_token

PROJECT_ID="$(rw_find_project_id "$PROJECT_NAME" || true)"
[ -n "$PROJECT_ID" ] || die "project '$PROJECT_NAME' not found for this token"

ENV_QUERY='query($p: String!) { environments(projectId: $p, first: 50) { edges { node { id name } } } }'
ENV_ID="$(rw_graphql "$ENV_QUERY" "$(jq -nc --arg p "$PROJECT_ID" '{p: $p}')" \
    | jq -r --arg n "$ENV_NAME" '.data.environments.edges[].node | select(.name == $n) | .id' | head -n1)"
[ -n "$ENV_ID" ] || die "environment '$ENV_NAME' not found in project '$PROJECT_NAME'"

printf 'Target: project=%s environment=%s app_tag=%s wrapper_tag=%s mode=%s\n' \
    "$PROJECT_NAME" "$ENV_NAME" "$APP_TAG" "$WRAPPER_TAG" \
    "$([ "$DRY_RUN" = true ] && printf 'dry-run' || printf 'apply')"

# ---------------------------------------------------------------------------
# Live-state snapshot
# ---------------------------------------------------------------------------

LIVE_ENV_JSON=""
declare -A LIVE_SID=()  # serviceName -> serviceId
declare -A LIVE_VARS=() # serviceName -> space-separated variable names

INSTANCES_QUERY='query($id: String!) { environment(id: $id) { serviceInstances { edges { node { serviceId serviceName source { image } startCommand healthcheckPath restartPolicyType restartPolicyMaxRetries } } } volumeInstances { edges { node { mountPath serviceId } } } } }'
VARIABLES_QUERY='query($p: String!, $e: String!, $s: String!) { variables(projectId: $p, environmentId: $e, serviceId: $s) }'

# contains_word <haystack-words> <needle>
contains_word() {
    case " $1 " in *" $2 "*) return 0 ;; esac
    return 1
}

load_live_state() {
    LIVE_ENV_JSON="$(rw_graphql "$INSTANCES_QUERY" "$(jq -nc --arg id "$ENV_ID" '{id: $id}')" \
        | jq -c '.data.environment')"
    [ -n "$LIVE_ENV_JSON" ] && [ "$LIVE_ENV_JSON" != "null" ] || die "could not read environment state"

    LIVE_SID=()
    LIVE_VARS=()
    local name sid
    while IFS=$'\t' read -r name sid; do
        LIVE_SID["$name"]="$sid"
    done < <(jq -r '.serviceInstances.edges[].node | [.serviceName, .serviceId] | @tsv' <<<"$LIVE_ENV_JSON")

    # Variable NAMES per managed service (values are fetched but immediately
    # reduced to keys and never printed).
    for name in $(jq -r 'keys[]' <<<"$DESIRED"); do
        sid="${LIVE_SID[$name]:-}"
        [ -n "$sid" ] || continue
        LIVE_VARS["$name"]="$(rw_graphql "$VARIABLES_QUERY" \
            "$(jq -nc --arg p "$PROJECT_ID" --arg e "$ENV_ID" --arg s "$sid" '{p: $p, e: $e, s: $s}')" \
            | jq -r '.data.variables // {} | keys | sort | join(" ")')"
    done
}

# ---------------------------------------------------------------------------
# Diff
# ---------------------------------------------------------------------------

DRIFT_FILE="$(mktemp "${TMPDIR:-/tmp}/rw-drift.XXXXXX")"
trap 'rm -f "$DRIFT_FILE"' EXIT

add_drift() {
    printf '%s\n' "$*" >>"$DRIFT_FILE"
}

compute_diff() {
    : >"$DRIFT_FILE"
    local svc node want live sid

    for svc in $(jq -r 'keys[]' <<<"$DESIRED"); do
        node="$(jq -c --arg n "$svc" \
            '[.serviceInstances.edges[].node | select(.serviceName == $n)][0] // empty' <<<"$LIVE_ENV_JSON")"
        if [ -z "$node" ]; then
            add_drift "DRIFT service-missing service=$svc"
            continue
        fi
        sid="${LIVE_SID[$svc]}"

        want="$(jq -r --arg n "$svc" '.[$n].image' <<<"$DESIRED")"
        live="$(jq -r '.source.image // ""' <<<"$node")"
        [ "$live" = "$want" ] \
            || add_drift "DRIFT image service=$svc live=${live:-(none)} want=$want"

        # startCommand: null and "" both mean "unset" (the API treats null as
        # no-change on write, so the clear value is "").
        want="$(jq -r --arg n "$svc" '.[$n].startCommand // ""' <<<"$DESIRED")"
        live="$(jq -r '.startCommand // ""' <<<"$node")"
        [ "$live" = "$want" ] \
            || add_drift "DRIFT start-command service=$svc live=${live:-(unset)} want=${want:-(unset)}"

        want="$(jq -r --arg n "$svc" '.[$n].healthcheckPath // ""' <<<"$DESIRED")"
        live="$(jq -r '.healthcheckPath // ""' <<<"$node")"
        [ "$live" = "$want" ] \
            || add_drift "DRIFT healthcheck service=$svc live=${live:-(unset)} want=${want:-(unset)}"

        want="$(jq -r --arg n "$svc" '.[$n].restartPolicyType // ""' <<<"$DESIRED")"
        live="$(jq -r '.restartPolicyType // ""' <<<"$node")"
        [ -z "$want" ] || [ "$live" = "$want" ] \
            || add_drift "DRIFT restart-policy service=$svc live=$live want=$want"

        want="$(jq -r --arg n "$svc" '.[$n].restartPolicyMaxRetries // ""' <<<"$DESIRED")"
        live="$(jq -r '.restartPolicyMaxRetries // ""' <<<"$node")"
        [ -z "$want" ] || [ "$live" = "$want" ] \
            || add_drift "DRIFT restart-retries service=$svc live=$live want=$want"

        # Variables: names only. Railway-injected RAILWAY_* names are ignored
        # unless the definition declares them (e.g. RAILWAY_RUN_UID).
        local declared optional live_names name
        declared="$(jq -r --arg n "$svc" '.[$n].variables // {} | keys | join(" ")' <<<"$DESIRED")"
        optional="$(jq -r --arg n "$svc" '.[$n].optionalVariables // [] | join(" ")' <<<"$DESIRED")"
        live_names="${LIVE_VARS[$svc]:-}"
        for name in $declared; do
            contains_word "$live_names" "$name" \
                || add_drift "DRIFT var-missing service=$svc name=$name"
        done
        for name in $live_names; do
            if ! contains_word "$declared" "$name"; then
                case "$name" in
                    RAILWAY_*) continue ;;
                esac
                contains_word "$optional" "$name" \
                    || add_drift "DRIFT var-extra service=$svc name=$name"
            fi
        done

        # Volumes: identity is (service, mountPath).
        local mp live_mounts want_mounts
        want_mounts="$(jq -r --arg n "$svc" '.[$n].volumes // [] | join(" ")' <<<"$DESIRED")"
        live_mounts="$(jq -r --arg s "$sid" \
            '[.volumeInstances.edges[].node | select(.serviceId == $s) | .mountPath] | join(" ")' <<<"$LIVE_ENV_JSON")"
        for mp in $want_mounts; do
            contains_word "$live_mounts" "$mp" \
                || add_drift "DRIFT volume-missing service=$svc mountPath=$mp"
        done
        for mp in $live_mounts; do
            contains_word "$want_mounts" "$mp" \
                || add_drift "DRIFT volume-extra service=$svc mountPath=$mp (never auto-deleted; remove manually if intended)"
        done
    done

    # Services present live but absent from the definition. Reported as drift;
    # apply never deletes services (destructive) — decommissioning is a manual,
    # PR-documented operation.
    local live_svc
    for live_svc in "${!LIVE_SID[@]}"; do
        jq -e --arg n "$live_svc" 'has($n)' <<<"$DESIRED" >/dev/null \
            || add_drift "DRIFT service-extra service=$live_svc (never auto-deleted; remove manually if intended)"
    done
}

print_report() {
    if [ -s "$DRIFT_FILE" ]; then
        printf -- '--- drift report (%s line(s)) ---\n' "$(wc -l <"$DRIFT_FILE" | tr -d ' ')"
        sort "$DRIFT_FILE"
        printf -- '--- end drift report ---\n'
    else
        printf 'CLEAN: live environment matches the definition.\n'
    fi
}

# ---------------------------------------------------------------------------
# Secret resolution (apply mode only; values never printed)
# ---------------------------------------------------------------------------

declare -A SECRET_CACHE=()
RESOLVED_VALUE=""

# resolve_secret_into <secret-name>: sets RESOLVED_VALUE. Resolution order
# mirrors scripts/configure.sh: explicit operator value (env var) wins; else
# reuse the value already live on a sibling service that declares the same
# secret (keeps shared secrets consistent across services); else generate.
resolve_secret_into() {
    local sname="$1"
    if [ -n "${SECRET_CACHE[$sname]+x}" ]; then
        RESOLVED_VALUE="${SECRET_CACHE[$sname]}"
        return 0
    fi

    local spec from_env gen val=""
    spec="$(jq -c --arg n "$sname" '.secrets[$n] // empty' "$DEFINITION")"
    [ -n "$spec" ] || die "variable references undeclared secret '$sname'"

    from_env="$(jq -r '.from_env // empty' <<<"$spec")"
    if [ -n "$from_env" ] && [ -n "${!from_env:-}" ]; then
        val="${!from_env}"
        printf 'secret %s: resolved from environment variable %s\n' "$sname" "$from_env" >&2
    fi

    if [ -z "$val" ]; then
        # Reuse from a live sibling: find (service, variableName) pairs mapped
        # to this secret and read the first value that exists live.
        local svc varname
        while IFS=$'\t' read -r svc varname; do
            [ -n "${LIVE_SID[$svc]:-}" ] || continue
            contains_word "${LIVE_VARS[$svc]:-}" "$varname" || continue
            val="$(rw_graphql "$VARIABLES_QUERY" \
                "$(jq -nc --arg p "$PROJECT_ID" --arg e "$ENV_ID" --arg s "${LIVE_SID[$svc]}" '{p: $p, e: $e, s: $s}')" \
                | jq -r --arg k "$varname" '.data.variables[$k] // empty')"
            if [ -n "$val" ]; then
                printf 'secret %s: reusing live value from service %s\n' "$sname" "$svc" >&2
                break
            fi
        done < <(jq -r --arg s "$sname" \
            'to_entries[] | .key as $svc | (.value.variables // {}) | to_entries[]
             | select((.value | type == "object") and .value.secret == $s)
             | [$svc, .key] | @tsv' <<<"$DESIRED")
    fi

    if [ -z "$val" ]; then
        gen="$(jq -r '.generate // empty' <<<"$spec")"
        case "$gen" in
            openssl-rand-hex-*) val="$(openssl rand -hex "${gen##*-}")" ;;
            openssl-rand-base64-*) val="$(openssl rand -base64 "${gen##*-}")" ;;
            openssl-genpkey-rsa-2048) val="$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)" ;;
            "") die "secret '$sname' is not set in the environment and has no generator" ;;
            *) die "secret '$sname' has unknown generator spec '$gen'" ;;
        esac
        printf 'secret %s: generated (%s)\n' "$sname" "$gen" >&2
    fi

    SECRET_CACHE[$sname]="$val"
    RESOLVED_VALUE="$val"
}

# resolve_variable_value_into <service> <variable-name>: sets RESOLVED_VALUE.
resolve_variable_value_into() {
    local svc="$1" name="$2" spec
    spec="$(jq -c --arg n "$svc" --arg k "$name" '.[$n].variables[$k]' <<<"$DESIRED")"
    if [ "$(jq -r 'type' <<<"$spec")" = "string" ]; then
        RESOLVED_VALUE="$(jq -r '.' <<<"$spec")"
        return 0
    fi
    resolve_secret_into "$(jq -r '.secret // empty' <<<"$spec")"
}

# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------

# create_missing_service <name>: serviceCreate is NOT idempotent — the caller
# already confirmed absence from a fresh read (check), the create is guarded
# against blind transient retry (act), and the result is verified by polling
# the environment until the service appears (verify).
create_missing_service() {
    local svc="$1" img
    img="$(jq -r --arg n "$svc" '.[$n].image' <<<"$DESIRED")"
    printf 'creating service %s (image %s)\n' "$svc" "$img"
    RW_NO_TRANSIENT_RETRY=1 rw_graphql \
        'mutation($in: ServiceCreateInput!) { serviceCreate(input: $in) { id } }' \
        "$(jq -nc --arg p "$PROJECT_ID" --arg e "$ENV_ID" --arg n "$svc" --arg img "$img" \
            '{in: {projectId: $p, environmentId: $e, name: $n, source: {image: $img}}}')" \
        >/dev/null || printf 'serviceCreate for %s reported failure; verifying by polling.\n' "$svc" >&2

    local waited=0 found=""
    while [ -z "$found" ] && [ "$waited" -lt 90 ]; do
        found="$(rw_graphql "$INSTANCES_QUERY" "$(jq -nc --arg id "$ENV_ID" '{id: $id}')" \
            | jq -r --arg n "$svc" \
                '[.data.environment.serviceInstances.edges[].node | select(.serviceName == $n) | .serviceId][0] // empty')"
        if [ -z "$found" ]; then
            sleep 10
            waited=$((waited + 10))
        fi
    done
    [ -n "$found" ] || die "service '$svc' still missing after create + 90s verify"
}

# apply_instance_patch <service>: one serviceInstanceUpdate carrying only the
# drifted fields. startCommand is cleared with "" (null is a no-op).
apply_instance_patch() {
    local svc="$1"
    local sid="${LIVE_SID[$svc]}" input='{}'
    local changed=false line field

    while IFS= read -r line; do
        field="${line#DRIFT }"
        field="${field%% *}"
        case "$field" in
            image)
                input="$(jq -c --arg v "$(jq -r --arg n "$svc" '.[$n].image' <<<"$DESIRED")" \
                    '. + {source: {image: $v}}' <<<"$input")"
                changed=true ;;
            start-command)
                input="$(jq -c --arg v "$(jq -r --arg n "$svc" '.[$n].startCommand // ""' <<<"$DESIRED")" \
                    '. + {startCommand: $v}' <<<"$input")"
                changed=true ;;
            healthcheck)
                # Setting a path is proven; clearing with "" mirrors the
                # startCommand workaround but is best-effort (unverified).
                input="$(jq -c --arg v "$(jq -r --arg n "$svc" '.[$n].healthcheckPath // ""' <<<"$DESIRED")" \
                    '. + {healthcheckPath: $v}' <<<"$input")"
                changed=true ;;
            restart-policy)
                input="$(jq -c --arg v "$(jq -r --arg n "$svc" '.[$n].restartPolicyType' <<<"$DESIRED")" \
                    '. + {restartPolicyType: $v}' <<<"$input")"
                changed=true ;;
            restart-retries)
                input="$(jq -c --argjson v "$(jq -r --arg n "$svc" '.[$n].restartPolicyMaxRetries' <<<"$DESIRED")" \
                    '. + {restartPolicyMaxRetries: $v}' <<<"$input")"
                changed=true ;;
        esac
    done < <(grep -E "^DRIFT (image|start-command|healthcheck|restart-policy|restart-retries) service=$svc " "$DRIFT_FILE" || true)

    [ "$changed" = true ] || return 0
    printf 'patching service config: %s (%s)\n' "$svc" "$(jq -r 'keys | join(",")' <<<"$input")"
    rw_graphql \
        'mutation($s: String!, $e: String!, $in: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $in) }' \
        "$(jq -nc --arg s "$sid" --arg e "$ENV_ID" --argjson in "$input" '{s: $s, e: $e, in: $in}')" \
        >/dev/null
}

# apply_missing_vars <service>: one variableCollectionUpsert (skipDeploys,
# merge) carrying every missing variable for the service.
apply_missing_vars() {
    local svc="$1"
    local sid="${LIVE_SID[$svc]}" name vars_json='{}' count=0
    while IFS= read -r name; do
        resolve_variable_value_into "$svc" "$name"
        vars_json="$(jq -c --arg k "$name" --arg v "$RESOLVED_VALUE" '. + {($k): $v}' <<<"$vars_json")"
        count=$((count + 1))
    done < <(grep -E "^DRIFT var-missing service=$svc " "$DRIFT_FILE" | sed -E 's/.* name=//' || true)
    [ "$count" -gt 0 ] || return 0
    printf 'upserting %d variable(s) on %s\n' "$count" "$svc"
    rw_graphql \
        'mutation($in: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $in) }' \
        "$(jq -nc --arg p "$PROJECT_ID" --arg e "$ENV_ID" --arg s "$sid" --argjson vars "$vars_json" \
            '{in: {projectId: $p, environmentId: $e, serviceId: $s, skipDeploys: true, replace: false, variables: $vars}}')" \
        >/dev/null
}

# apply_extra_var_deletes <service>: delete undeclared variables (the drift
# report already named them; optionalVariables and RAILWAY_* are exempt).
apply_extra_var_deletes() {
    local svc="$1"
    local sid="${LIVE_SID[$svc]}" name
    while IFS= read -r name; do
        printf 'deleting undeclared variable %s on %s\n' "$name" "$svc"
        rw_graphql \
            'mutation($in: VariableDeleteInput!) { variableDelete(input: $in) }' \
            "$(jq -nc --arg p "$PROJECT_ID" --arg e "$ENV_ID" --arg s "$sid" --arg n "$name" \
                '{in: {projectId: $p, environmentId: $e, serviceId: $s, name: $n}}')" \
            >/dev/null
    done < <(grep -E "^DRIFT var-extra service=$svc " "$DRIFT_FILE" | sed -E 's/.* name=//' || true)
}

# apply_missing_volumes <service>: volumeCreate is NOT idempotent — re-check
# right before creating (a prior ambiguous timeout may have succeeded).
apply_missing_volumes() {
    local svc="$1"
    local sid="${LIVE_SID[$svc]}" mp existing
    while IFS= read -r mp; do
        existing="$(rw_graphql "$INSTANCES_QUERY" "$(jq -nc --arg id "$ENV_ID" '{id: $id}')" \
            | jq -r --arg s "$sid" --arg mp "$mp" \
                '[.data.environment.volumeInstances.edges[].node | select(.serviceId == $s and .mountPath == $mp)] | length')"
        if [ "$existing" != "0" ]; then
            printf 'volume %s on %s already exists; skipping create\n' "$mp" "$svc"
            continue
        fi
        printf 'creating volume %s on %s\n' "$mp" "$svc"
        RW_NO_TRANSIENT_RETRY=1 rw_graphql \
            'mutation($in: VolumeCreateInput!) { volumeCreate(input: $in) { id } }' \
            "$(jq -nc --arg p "$PROJECT_ID" --arg e "$ENV_ID" --arg s "$sid" --arg mp "$mp" \
                '{in: {projectId: $p, environmentId: $e, serviceId: $s, mountPath: $mp}}')" \
            >/dev/null || printf 'volumeCreate for %s reported failure; the final verify pass re-checks.\n' "$mp" >&2
    done < <(grep -E "^DRIFT volume-missing service=$svc " "$DRIFT_FILE" | sed -E 's/.* mountPath=//' || true)
}

apply_drift() {
    local svc

    # Pass 1: create missing services, then refresh the snapshot so the rest
    # of the converge sees them.
    if grep -q '^DRIFT service-missing ' "$DRIFT_FILE"; then
        while IFS= read -r svc; do
            create_missing_service "$svc"
        done < <(grep '^DRIFT service-missing ' "$DRIFT_FILE" | sed -E 's/.* service=//')
        load_live_state
        compute_diff
    fi

    # Pass 2: converge every managed service that exists live.
    for svc in $(jq -r 'keys[]' <<<"$DESIRED"); do
        [ -n "${LIVE_SID[$svc]:-}" ] || continue
        apply_instance_patch "$svc"
        apply_missing_vars "$svc"
        apply_extra_var_deletes "$svc"
        apply_missing_volumes "$svc"
    done

    if grep -qE '^DRIFT (service-extra|volume-extra) ' "$DRIFT_FILE"; then
        printf 'WARNING: extra services/volumes exist live; apply never deletes them (see report).\n' >&2
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

load_live_state
compute_diff

if [ "$DRY_RUN" = true ]; then
    print_report
    rw_report_calls "apply.sh --dry-run"
    [ -s "$DRIFT_FILE" ] && exit 2
    exit 0
fi

if [ ! -s "$DRIFT_FILE" ]; then
    print_report
    rw_report_calls "apply.sh"
    exit 0
fi

printf 'Drift before apply:\n'
print_report
apply_drift

# Verify: reload and re-diff. Anything left (including extra services/volumes,
# which apply refuses to delete) keeps the exit nonzero so CI stays loud.
load_live_state
compute_diff
printf 'State after apply:\n'
print_report
rw_report_calls "apply.sh"
[ -s "$DRIFT_FILE" ] && exit 2
exit 0
