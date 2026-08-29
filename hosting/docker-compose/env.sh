#!/usr/bin/env bash

# Worktree-local Compose environment setup. Allocation files contain no secrets;
# `prepare` copies a source env and merges the allocation into it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EE_DIR="${SCRIPT_DIR}/ee"

error() { echo "Error: $*" >&2; exit 1; }
require_value() { [[ -n "${2:-}" ]] || error "Missing value for $1."; }
absolute_path() { local dir; dir="$(cd "$(dirname "$1")" && pwd)"; printf '%s/%s\n' "$dir" "$(basename "$1")"; }
display_path() {
    local path="$1"
    if [[ "$path" == "${SCRIPT_DIR}/"* ]]; then
        printf '%s\n' "${path#"${SCRIPT_DIR}/"}"
    else
        printf '%s\n' "$path"
    fi
}
is_port() { [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 )); }

read_env_value() {
    local value
    value="$(awk -v key="$2" '$0 ~ "^[[:space:]]*" key "=" { sub("^[[:space:]]*" key "=", ""); value = $0 } END { print value }' "$1")"
    printf '%s\n' "${value:-$3}"
}

check_port_available() {
    command -v lsof >/dev/null 2>&1 || error "--check-ports requires lsof."
    ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 || error "Host port $1 is already listening."
}

infer_worktree_name() {
    local worktree_root
    worktree_root="$(git rev-parse --show-toplevel 2>/dev/null)" || error "--worktree is required outside a Git worktree."
    [[ -f "${worktree_root}/.git" ]] || error "--worktree is required from the primary checkout; run this from a linked worktree or pass it explicitly."
    basename "$worktree_root"
}

default_source_env() {
    local license="$1" env_name="$2" fallback_env_name="$3" candidate primary_root
    primary_root="$(git worktree list --porcelain 2>/dev/null | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')"
    [[ -n "$primary_root" ]] || error "No source env file was provided and the primary worktree could not be found."
    for candidate in \
        "${primary_root}/hosting/docker-compose/${license}/${env_name}" \
        "${primary_root}/hosting/docker-compose/${license}/${fallback_env_name}" \
        "${SCRIPT_DIR}/${license}/${env_name}" \
        "${SCRIPT_DIR}/${license}/${fallback_env_name}"; do
        if [[ -f "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return
        fi
    done
    error "Source environment file not found for ${license}/${env_name} (pass --source to choose one)."
}

find_available_port() {
    local start="$1" end="$2" port excluded_port used
    shift 2
    command -v lsof >/dev/null 2>&1 || error "Automatic port allocation requires lsof."
    for ((port = start; port <= end; port++)); do
        used=false
        for excluded_port in "$@"; do
            [[ "$port" == "$excluded_port" ]] && used=true
        done
        [[ "$used" == true ]] && continue
        if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            printf '%s\n' "$port"
            return
        fi
    done
    error "No free TCP port found in ${start}:${end}."
}

usage() {
    cat <<EOF
Usage:
  $(basename "$0") --worktree NAME [options]
  $(basename "$0") prepare --worktree NAME [options]
  $(basename "$0") allocate --worktree NAME --base-env FILE [options]
  $(basename "$0") merge --base FILE --overrides FILE --output FILE [--force]

Commands:
  prepare   Allocate a project/ports, then copy and merge an environment file.
  allocate  Write only the small non-secret worktree allocation dotenv file.
  merge     Copy a base dotenv file and apply active KEY=value allocation entries.

Omitting a command runs `prepare`.

Target flags match `run.sh`: `--ee|--oss` selects the license (default: `oss`) and
`--dev|--gh` selects the image/environment mode (default: `gh`). From a linked
worktree, the source defaults to the selected env file in the primary checkout.

prepare options:
  -w, --worktree NAME          Worktree name (default: current linked Git worktree).
      --license oss|ee         Select license, as in run.sh (default: oss).
      --oss, --ee              License aliases, as in run.sh.
      --image gh|dev           Select image/environment mode (default: gh).
      --gh, --dev              Image mode aliases, as in run.sh.
      --local, --ssl           Select run.sh's gh.local or gh.ssl stage.
  -s, --source FILE            Source env (default: AGENTA_EE_DEV_ENV_SOURCE,
                               then hosting/docker-compose/ee/.env.ee.dev).
  -o, --output FILE            Merged env output (default: ee/.env.ee.dev).
      --overrides-file FILE    Allocation output (default: ee/.env.ee.worktree).
      --project-name NAME      Override the generated agenta-NAME project name.
      --public-host HOST       Public host for generated URLs (default: source
                               TRAEFIK_DOMAIN or localhost).
      --public-scheme SCHEME   Public URL scheme (default: source
                               TRAEFIK_PROTOCOL or http).
      --port-offset OFFSET     Add OFFSET to the source's effective bound ports.
      --port-range START:END   Auto-allocation range (default: 10000:19999).
      --postgres-port PORT     Explicit Postgres host port.
      --http-port PORT         Explicit Traefik HTTP host port.
      --traefik-ui-port PORT   Explicit Traefik dashboard host port.
      --store-port PORT        Explicit host port for the bundled object store.
      --check-ports            Fail if a selected host port already listens.
      --dry-run                Print the allocation without writing files.
  -f, --force                  Replace existing output and allocation files.
  -h, --help                   Show this help.
EOF
}

allocate() {
    local base_env="" env_file="${EE_DIR}/.env.ee.dev" output_file="${EE_DIR}/.env.ee.worktree"
    local name="" project_name="" public_host="" public_scheme="" port_offset="" port_range="10000:19999" postgres_port="" http_port="" traefik_ui_port="" store_port=""
    local with_store_port=false
    local force=false dry_run=false check_ports=false
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            -w|--worktree) require_value "$1" "${2:-}"; name="$2"; shift ;;
            --base-env) require_value "$1" "${2:-}"; base_env="$2"; shift ;;
            --env-file) require_value "$1" "${2:-}"; env_file="$2"; shift ;;
            -o|--output|--overrides-file) require_value "$1" "${2:-}"; output_file="$2"; shift ;;
            --project-name) require_value "$1" "${2:-}"; project_name="$2"; shift ;;
            --public-host) require_value "$1" "${2:-}"; public_host="$2"; shift ;;
            --public-scheme) require_value "$1" "${2:-}"; public_scheme="$2"; shift ;;
            --port-offset) require_value "$1" "${2:-}"; port_offset="$2"; shift ;;
            --port-range) require_value "$1" "${2:-}"; port_range="$2"; shift ;;
            --postgres-port) require_value "$1" "${2:-}"; postgres_port="$2"; shift ;;
            --http-port) require_value "$1" "${2:-}"; http_port="$2"; shift ;;
            --traefik-ui-port) require_value "$1" "${2:-}"; traefik_ui_port="$2"; shift ;;
            --store-port) require_value "$1" "${2:-}"; store_port="$2"; shift ;;
            --with-store-port) with_store_port=true ;;
            --check-ports) check_ports=true ;;
            --dry-run) dry_run=true ;;
            -f|--force) force=true ;;
            -h|--help) usage; exit 0 ;;
            *) error "Unknown option: $1. Run $(basename "$0") --help." ;;
        esac
        shift
    done
    [[ -n "$base_env" ]] || error "allocate requires --base-env."
    name="${name:-$(infer_worktree_name)}"
    [[ "$name" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || error "--worktree must use lowercase letters, numbers, hyphens, or underscores."
    [[ -f "$base_env" ]] || error "Base environment file not found: $base_env"
    [[ -z "$port_offset" || "$port_offset" =~ ^[0-9]+$ ]] || error "--port-offset must be a non-negative integer."
    [[ "$port_range" =~ ^([0-9]+):([0-9]+)$ ]] || error "--port-range must have the form START:END."
    local range_start="${BASH_REMATCH[1]}" range_end="${BASH_REMATCH[2]}"
    is_port "$range_start" && is_port "$range_end" && (( range_start <= range_end )) || error "Invalid --port-range: $port_range"
    base_env="$(absolute_path "$base_env")"; output_file="$(absolute_path "$output_file")"; env_file="$(absolute_path "$env_file")"
    if [[ -e "$output_file" && "$force" != true ]]; then
        if [[ "$with_store_port" == true && -z "$(read_env_value "$output_file" AGENTA_STORE_PORT "")" ]]; then
            postgres_port="$(read_env_value "$output_file" POSTGRES_PORT 5432)"
            http_port="$(read_env_value "$output_file" TRAEFIK_PORT 80)"
            traefik_ui_port="$(read_env_value "$output_file" TRAEFIK_UI_PORT 8080)"
            store_port="${store_port:-$(find_available_port "$range_start" "$range_end" "$postgres_port" "$http_port" "$traefik_ui_port")}"
            is_port "$store_port" || error "Invalid store port: $store_port"
            if [[ "$dry_run" == true ]]; then
                printf 'Would add AGENTA_STORE_PORT=%s to allocation: %s\n' "$store_port" "$(display_path "$output_file")"
            else
                printf 'AGENTA_STORE_PORT=%s\n' "$store_port" >> "$output_file"
                chmod 600 "$output_file"
                printf 'Added AGENTA_STORE_PORT=%s to allocation: %s\n' "$store_port" "$(display_path "$output_file")"
            fi
        fi
        if [[ "$dry_run" == true ]]; then
            printf 'Would reuse allocation: %s\n' "$(display_path "$output_file")"
        else
            printf 'Using allocation: %s\n' "$(display_path "$output_file")"
        fi
        return
    fi
    if [[ -n "$port_offset" ]]; then
        postgres_port="${postgres_port:-$(( $(read_env_value "$base_env" POSTGRES_PORT 5432) + port_offset ))}"
        http_port="${http_port:-$(( $(read_env_value "$base_env" TRAEFIK_PORT 80) + port_offset ))}"
        traefik_ui_port="${traefik_ui_port:-$(( $(read_env_value "$base_env" TRAEFIK_UI_PORT 8080) + port_offset ))}"
        if [[ "$with_store_port" == true ]]; then store_port="${store_port:-$(( $(read_env_value "$base_env" AGENTA_STORE_PORT 8333) + port_offset ))}"; fi
    else
        postgres_port="${postgres_port:-$(find_available_port "$range_start" "$range_end" "$http_port" "$traefik_ui_port")}"
        http_port="${http_port:-$(find_available_port "$range_start" "$range_end" "$postgres_port" "$traefik_ui_port")}"
        traefik_ui_port="${traefik_ui_port:-$(find_available_port "$range_start" "$range_end" "$postgres_port" "$http_port")}"
        if [[ "$with_store_port" == true ]]; then store_port="${store_port:-$(find_available_port "$range_start" "$range_end" "$postgres_port" "$http_port" "$traefik_ui_port")}"; fi
    fi
    for port in "$postgres_port" "$http_port" "$traefik_ui_port"; do is_port "$port" || error "Invalid port: $port"; done
    [[ "$with_store_port" != true ]] || is_port "$store_port" || error "Invalid store port: $store_port"
    [[ "$postgres_port" != "$http_port" && "$postgres_port" != "$traefik_ui_port" && "$http_port" != "$traefik_ui_port" ]] || error "Selected ports must be different."
    [[ "$with_store_port" != true || ( "$store_port" != "$postgres_port" && "$store_port" != "$http_port" && "$store_port" != "$traefik_ui_port" ) ]] || error "Store port must be different from the other selected ports."
    project_name="${project_name:-agenta-${name}}"
    [[ "$project_name" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || error "--project-name must use lowercase letters, numbers, hyphens, or underscores."
    public_host="${public_host:-$(read_env_value "$base_env" TRAEFIK_DOMAIN localhost)}"
    public_scheme="${public_scheme:-$(read_env_value "$base_env" TRAEFIK_PROTOCOL http)}"
    [[ "$public_host" =~ ^[A-Za-z0-9._-]+$ ]] || error "--public-host must be a hostname without a scheme or port."
    [[ "$public_scheme" =~ ^https?$ ]] || error "--public-scheme must be http or https."
    if [[ "$check_ports" == true ]]; then
        check_port_available "$postgres_port"
        check_port_available "$http_port"
        check_port_available "$traefik_ui_port"
        [[ "$with_store_port" != true ]] || check_port_available "$store_port"
    fi
    if [[ "$dry_run" == true ]]; then
        printf 'Would create allocation: %s\n' "$(display_path "$output_file")"
    else
        mkdir -p "$(dirname "$output_file")"
        umask 077
        {
            printf '# Generated by %s; contains no application secrets.\n' "$(basename "$0")"
            printf 'COMPOSE_PROJECT_NAME=%s\nPOSTGRES_PORT=%s\nTRAEFIK_PORT=%s\nTRAEFIK_UI_PORT=%s\n' "$project_name" "$postgres_port" "$http_port" "$traefik_ui_port"
            [[ "$with_store_port" != true ]] || printf 'AGENTA_STORE_PORT=%s\n' "$store_port"
            printf 'AGENTA_WEB_URL=%s://%s:%s\nAGENTA_API_URL=%s://%s:%s/api\nAGENTA_SERVICES_URL=%s://%s:%s/services\nENV_FILE=%s\n' "$public_scheme" "$public_host" "$http_port" "$public_scheme" "$public_host" "$http_port" "$public_scheme" "$public_host" "$http_port" "$env_file"
        } > "$output_file"
        chmod 600 "$output_file"
        printf 'Created allocation: %s\n' "$(display_path "$output_file")"
    fi
    printf '  COMPOSE_PROJECT_NAME=%s\n  POSTGRES_PORT=%s\n  TRAEFIK_PORT=%s\n  TRAEFIK_UI_PORT=%s\n  AGENTA_WEB_URL=%s://%s:%s\n  AGENTA_API_URL=%s://%s:%s/api\n  AGENTA_SERVICES_URL=%s://%s:%s/services\n' "$project_name" "$postgres_port" "$http_port" "$traefik_ui_port" "$public_scheme" "$public_host" "$http_port" "$public_scheme" "$public_host" "$http_port" "$public_scheme" "$public_host" "$http_port"
    [[ "$with_store_port" != true ]] || printf '  AGENTA_STORE_PORT=%s\n' "$store_port"
}

merge() {
    local base_file="" overrides_file="" output_file="" force=false
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --base) require_value "$1" "${2:-}"; base_file="$2"; shift ;;
            --overrides) require_value "$1" "${2:-}"; overrides_file="$2"; shift ;;
            --output) require_value "$1" "${2:-}"; output_file="$2"; shift ;;
            -f|--force) force=true ;;
            -h|--help) usage; exit 0 ;;
            *) error "Unknown option: $1. Run $(basename "$0") --help." ;;
        esac
        shift
    done
    [[ -f "$base_file" && -f "$overrides_file" && -n "$output_file" ]] || error "merge requires --base, --overrides, and --output."
    base_file="$(absolute_path "$base_file")"; overrides_file="$(absolute_path "$overrides_file")"; output_file="$(absolute_path "$output_file")"
    [[ "$base_file" != "$output_file" && "$overrides_file" != "$output_file" ]] || error "The output must be different from both input files."
    if [[ -e "$output_file" && "$force" != true ]]; then error "Output already exists: $output_file (pass --force to replace it)."; fi
    declare -a keys=() values=()
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" =~ ^[[:space:]]*# || -z "$line" ]] && continue
        [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || error "Invalid override line: $line"
        keys+=("${BASH_REMATCH[1]}"); values+=("${BASH_REMATCH[2]}")
    done < "$overrides_file"
    [[ "${#keys[@]}" -gt 0 ]] || error "Override file has no active KEY=value settings: $overrides_file"
    mkdir -p "$(dirname "$output_file")"; cp "$base_file" "$output_file"; chmod 600 "$output_file"
    for index in "${!keys[@]}"; do
        temporary_file="$(mktemp "${output_file}.tmp.XXXXXX")"
        awk -v key="${keys[$index]}" -v value="${values[$index]}" '
            BEGIN { replaced = 0 }
            $0 ~ "^[[:space:]]*#?[[:space:]]*" key "=" { if (!replaced) { print key "=" value; replaced = 1 }; next }
            { print }
            END { if (!replaced) print key "=" value }
        ' "$output_file" > "$temporary_file"
        mv "$temporary_file" "$output_file"
    done
    printf 'Created environment: %s\n' "$(display_path "$output_file")"
}

prepare() {
    local license="oss" license_source="default" image_mode="gh" image_mode_source="default"
    local source_local=false ssl_enabled=false stage="gh" env_name=""
    local source_file="${AGENTA_WORKTREE_ENV_SOURCE:-${AGENTA_EE_DEV_ENV_SOURCE:-}}"
    local output_file="" overrides_file=""
    local force=false dry_run=false
    declare -a allocation_args=()
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --license)
                require_value "$1" "${2:-}"
                [[ "$2" == "ee" || "$2" == "oss" ]] || error "Invalid value for --license. Allowed: ee or oss."
                if [[ "$license_source" != "default" && "$license" != "$2" ]]; then error "Conflicting license flags: $license_source and --license."; fi
                license="$2"; license_source="--license"; shift ;;
            --oss|--ee)
                local requested_license="${1#--}"
                if [[ "$license_source" != "default" && "$license" != "$requested_license" ]]; then error "Conflicting license flags: $license_source and $1."; fi
                license="$requested_license"; license_source="$1" ;;
            --image|--dockerfile)
                require_value "$1" "${2:-}"
                [[ "$2" == "dev" || "$2" == "gh" ]] || error "Invalid value for $1. Allowed: dev or gh."
                if [[ "$image_mode_source" != "default" && "$image_mode" != "$2" ]]; then error "Conflicting image flags: $image_mode_source and $1."; fi
                image_mode="$2"; image_mode_source="$1"; shift ;;
            --dev|--gh)
                local requested_image="${1#--}"
                if [[ "$image_mode_source" != "default" && "$image_mode" != "$requested_image" ]]; then error "Conflicting image flags: $image_mode_source and $1."; fi
                image_mode="$requested_image"; image_mode_source="$1" ;;
            --local) source_local=true ;;
            --ssl) ssl_enabled=true ;;
            -e|--env|--env-file) require_value "$1" "${2:-}"; output_file="$2"; shift ;;
            -s|--source) require_value "$1" "${2:-}"; source_file="$2"; shift ;;
            -o|--output) require_value "$1" "${2:-}"; output_file="$2"; shift ;;
            --overrides-file) require_value "$1" "${2:-}"; overrides_file="$2"; shift ;;
            --dry-run) dry_run=true ;;
            -f|--force) force=true ;;
            *) allocation_args+=("$1") ;;
        esac
        shift
    done
    [[ "$image_mode" == "gh" || "$source_local" != true ]] || error "--local requires --image gh."
    [[ "$image_mode" == "gh" || "$ssl_enabled" != true ]] || error "--ssl requires --image gh."
    [[ "$source_local" != true || "$ssl_enabled" != true ]] || error "--local and --ssl cannot be combined."
    if [[ "$image_mode" == "dev" ]]; then
        stage="dev"
    elif [[ "$source_local" == true ]]; then
        stage="gh.local"
    elif [[ "$ssl_enabled" == true ]]; then
        stage="gh.ssl"
    fi
    env_name=".env.${license}.${stage}"
    [[ "$stage" != "gh.local" ]] || env_name=".env.${license}.gh"
    output_file="${output_file:-${SCRIPT_DIR}/${license}/${env_name}}"
    overrides_file="${overrides_file:-${SCRIPT_DIR}/${license}/${env_name}.worktree}"
    source_file="${source_file:-$(default_source_env "$license" "$env_name" ".env.${license}.gh")}"
    [[ -f "$source_file" ]] || error "Source environment file not found: $source_file"
    allocation_args+=(--base-env "$source_file" --env-file "$output_file" --output "$overrides_file")
    allocation_args+=(--with-store-port)
    [[ "$dry_run" == true ]] && allocation_args+=(--dry-run)
    [[ "$force" == true ]] && allocation_args+=(--force)
    allocate "${allocation_args[@]}"
    if [[ "$dry_run" == true ]]; then
        printf 'Would merge %s and %s into %s\n' "$(display_path "$source_file")" "$(display_path "$overrides_file")" "$(display_path "$output_file")"
        return
    fi
    local -a merge_args=(--base "$source_file" --overrides "$overrides_file" --output "$output_file" --force)
    merge "${merge_args[@]}"
    printf '\nStart it with:\n  bash hosting/docker-compose/run.sh --%s --%s\n' "$license" "$image_mode"
}

command="prepare"
case "${1:-}" in
    prepare|allocate|merge) command="$1"; shift ;;
    -h|--help) usage; exit 0 ;;
esac
case "$command" in
    prepare) prepare "$@" ;;
    allocate) allocate "$@" ;;
    merge) merge "$@" ;;
esac
