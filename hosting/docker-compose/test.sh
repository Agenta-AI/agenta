#!/usr/bin/env bash

# Run host-side tests against the Compose environment selected with run.sh flags.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

usage() {
    cat <<'EOF'
Usage: hosting/docker-compose/test.sh [target options] [test options] [-- test-runner options]

Target options match run.sh and choose the env file to load:
  --oss, --ee, --license oss|ee        Edition (default: oss)
  --gh, --dev, --image gh|dev          Image/environment mode (default: gh)
  --local, --ssl                       Select gh.local or gh.ssl
  -e, --env, --env-file FILE           Explicit environment file

Test selection:
  --sdk, --services, --api, --runner, --web
                                      Run selected suite(s); default: all.
  -u, --unit                           Unit layer
  -i, --integration                    Integration layer
  -a, --acceptance                     Acceptance layer
                                      Omit layer flags for all layers. Web defaults
                                      to unit + integration when it is part of the
                                      default all-suite run.
  --time-profile                       Show slow-test timing information.
  --time-profile-min MS                Vitest slow-test threshold (default: 1).
  --logs[=FILE]                        Tee suite output to a log. With no FILE,
                                      writes tests.<suite>.logs beside each suite.
  --                                    Pass remaining options to every test runner.
EOF
}

error() { echo "Error: $*" >&2; exit 1; }
require_value() { [[ -n "${2:-}" ]] || error "Missing value for $1."; }

declare -a env_args=() components=() layers=() forwarded=()
license_set=false image_set=false
selected_layer=false time_profile=false slow_ms=1 want_logs=false logfile=""

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --oss|--ee|--gh|--dev|--local|--ssl)
            env_args+=("$1")
            [[ "$1" == "--oss" || "$1" == "--ee" ]] && license_set=true
            [[ "$1" == "--gh" || "$1" == "--dev" ]] && image_set=true
            ;;
        --license|--image|--dockerfile|-e|--env|--env-file)
            require_value "$1" "${2:-}"
            env_args+=("$1" "$2")
            [[ "$1" == "--license" ]] && license_set=true
            [[ "$1" == "--image" || "$1" == "--dockerfile" ]] && image_set=true
            shift
            ;;
        --sdk|--services|--api|--runner|--web) components+=("${1#--}") ;;
        -u|--unit) layers+=(unit); selected_layer=true ;;
        -i|--integration) layers+=(integration); selected_layer=true ;;
        -a|--acceptance) layers+=(acceptance); selected_layer=true ;;
        -[uia]*)
            for letter in $(printf '%s' "${1#-}" | fold -w1); do
                case "$letter" in
                    u) layers+=(unit) ;;
                    i) layers+=(integration) ;;
                    a) layers+=(acceptance) ;;
                    *) error "Unknown layer flag: $1" ;;
                esac
            done
            selected_layer=true
            ;;
        --time-profile) time_profile=true ;;
        --time-profile-min) require_value "$1" "${2:-}"; slow_ms="$2"; shift ;;
        --time-profile-min=*) slow_ms="${1#*=}" ;;
        --logs) want_logs=true ;;
        --logs=*) want_logs=true; logfile="${1#*=}" ;;
        --) shift; forwarded+=("$@"); break ;;
        -h|--help) usage; exit 0 ;;
        *) forwarded+=("$1") ;;
    esac
    shift
done

[[ "$slow_ms" =~ ^[0-9]+$ ]] || error "--time-profile-min must be a non-negative integer."

load_environment() {
    local license="oss" license_source="default" image="gh" image_source="default"
    local source_local=false ssl_enabled=false env_file=""
    local stage env_name env_path

    set_license() {
        [[ "$1" == "oss" || "$1" == "ee" ]] || error "Invalid value for $2. Allowed: 'oss' or 'ee'."
        if [[ "$license_source" != "default" && "$license" != "$1" ]]; then
            error "Conflicting license flags: '$license_source' sets '$license' but '$2' sets '$1'."
        fi
        license="$1"; license_source="$2"
    }
    set_image() {
        [[ "$1" == "gh" || "$1" == "dev" ]] || error "Invalid value for $2. Allowed: 'gh' or 'dev'."
        if [[ "$image_source" != "default" && "$image" != "$1" ]]; then
            error "Conflicting image flags: '$image_source' sets '$image' but '$2' sets '$1'."
        fi
        image="$1"; image_source="$2"
    }

    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --oss) set_license oss --oss ;;
            --ee) set_license ee --ee ;;
            --license) set_license "$2" --license; shift ;;
            --gh) set_image gh --gh ;;
            --dev) set_image dev --dev ;;
            --image|--dockerfile) set_image "$2" "$1"; shift ;;
            --local) source_local=true ;;
            --ssl) ssl_enabled=true ;;
            -e|--env|--env-file) env_file="$2"; shift ;;
            *) error "Internal error: unsupported environment option $1" ;;
        esac
        shift
    done

    [[ "$image" == "gh" || "$source_local" == false ]] || error "--local requires --image gh."
    [[ "$image" == "gh" || "$ssl_enabled" == false ]] || error "--ssl requires --image gh."
    [[ "$source_local" == false || "$ssl_enabled" == false ]] || error "--local and --ssl cannot be combined."

    if [[ "$image" == "dev" ]]; then
        stage=dev
    elif [[ "$source_local" == true ]]; then
        stage=gh.local
    elif [[ "$ssl_enabled" == true ]]; then
        stage=gh.ssl
    else
        stage=gh
    fi

    if [[ -z "$env_file" ]]; then
        [[ "$stage" == gh.local ]] && env_name=".env.${license}.gh" || env_name=".env.${license}.${stage}"
        env_path="${SCRIPT_DIR}/${license}/${env_name}"
    elif [[ "$env_file" = /* || "$env_file" == ./* || "$env_file" == ../* || "$env_file" == */* ]]; then
        env_path="$env_file"
    else
        env_path="${SCRIPT_DIR}/${license}/${env_file}"
    fi

    [[ -f "$env_path" ]] || error "Env file not found: $env_path. Run env.sh first."
    set -a
    # shellcheck disable=SC1090
    . "$env_path"
    set +a
    export POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
    echo "Loaded ${env_path} (stage: ${stage})."
}

if [[ "$license_set" == false ]]; then env_args=(--oss "${env_args[@]+"${env_args[@]}"}"); fi
if [[ "$image_set" == false ]]; then env_args=(--gh "${env_args[@]+"${env_args[@]}"}"); fi
load_environment "${env_args[@]}"

if [[ ${#components[@]} -eq 0 ]]; then
    components=(sdk services api runner web)
fi

configure_host_postgres() {
    local port="${POSTGRES_PORT:-5432}" license="${AGENTA_LICENSE:-oss}"
    local prefix="${POSTGRES_DB_PREFIX:-agenta_${license}}"
    local user="${POSTGRES_USER:-username}" password="${POSTGRES_PASSWORD:-password}"
    local user_q password_q

    [[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) || error "Invalid POSTGRES_PORT: $port"
    if [[ -n "${POSTGRES_URI_CORE:-}" && -n "${POSTGRES_URI_TRACING:-}" && -n "${POSTGRES_URI_SUPERTOKENS:-}" ]]; then
        return
    fi

    user_q="$(python3 -c 'from urllib.parse import quote_plus; import sys; print(quote_plus(sys.argv[1]))' "$user")" || error "Could not URL-encode POSTGRES_USER."
    password_q="$(python3 -c 'from urllib.parse import quote_plus; import sys; print(quote_plus(sys.argv[1]))' "$password")" || error "Could not URL-encode POSTGRES_PASSWORD."
    export POSTGRES_URI_CORE="${POSTGRES_URI_CORE:-postgresql+asyncpg://${user_q}:${password_q}@127.0.0.1:${port}/${prefix}_core}"
    export POSTGRES_URI_TRACING="${POSTGRES_URI_TRACING:-postgresql+asyncpg://${user_q}:${password_q}@127.0.0.1:${port}/${prefix}_tracing}"
    export POSTGRES_URI_SUPERTOKENS="${POSTGRES_URI_SUPERTOKENS:-postgresql://${user_q}:${password_q}@127.0.0.1:${port}/${prefix}_supertokens}"
    echo "[test.sh] Host PostgreSQL: 127.0.0.1:${port}"
}

for component in "${components[@]}"; do
    case "$component" in
        sdk|services|api) configure_host_postgres; break ;;
    esac
done

run_logged() {
    local suite="$1"; shift
    if [[ "$want_logs" == false ]]; then
        "$@"
        return
    fi
    local destination="$logfile"
    if [[ -z "$destination" ]]; then
        destination="${REPO_ROOT}/tests.${suite}.logs"
    elif [[ ${#components[@]} -gt 1 ]]; then
        destination="${logfile}.${suite}"
    fi
    echo "[test.sh] logging stdout+stderr to ${destination}"
    "$@" 2>&1 | tee "$destination"
    return "${PIPESTATUS[0]}"
}

run_python() {
    local suite="$1" root="$2" layer
    local -a python_args=("${forwarded[@]+"${forwarded[@]}"}")
    if [[ "$time_profile" == true ]]; then python_args+=(--time-profile); fi
    [[ -f "${root}/run-tests.py" && -f "${root}/uv.lock" ]] || error "Expected run-tests.py and uv.lock in ${root}."
    echo "[test.sh] Installing Python packages: ${root}"
    (cd "$root" && uv sync --locked)
    if [[ "$selected_layer" == false ]]; then
        run_logged "$suite" bash -c 'cd "$1" && exec uv run --no-sync python run-tests.py "${@:2}"' _ "$root" "${python_args[@]+"${python_args[@]}"}"
        return
    fi
    for layer in "${layers[@]}"; do
        echo "[test.sh] Running ${suite} ${layer} tests"
        run_logged "$suite" bash -c 'cd "$1" && exec uv run --no-sync python run-tests.py --layer "$2" "${@:3}"' _ "$root" "$layer" "${python_args[@]+"${python_args[@]}"}"
    done
}

run_runner() {
    local root="${REPO_ROOT}/services/runner" layer
    [[ -f "${root}/pnpm-lock.yaml" && -f "${root}/vitest.config.ts" ]] || error "Expected pnpm-lock.yaml and vitest.config.ts in ${root}."
    echo "[test.sh] Installing runner packages: ${root}"
    (cd "$root" && pnpm install --frozen-lockfile)
    local -a runner_layers=("${layers[@]+"${layers[@]}"}")
    [[ "$selected_layer" == true ]] || runner_layers=(unit integration acceptance)
    for layer in "${runner_layers[@]}"; do
        echo "[test.sh] Running runner ${layer} tests"
        run_logged runner bash -c 'cd "$1" && exec pnpm run "test:$2" -- "${@:3}"' _ "$root" "$layer" "${forwarded[@]+"${forwarded[@]}"}"
    done
}

run_web() {
    local root="${REPO_ROOT}/web" layer
    [[ -f "${root}/pnpm-lock.yaml" && -f "${root}/tests/playwright/scripts/run-tests.ts" ]] || error "Expected web test files in ${root}."
    echo "[test.sh] Installing web workspace packages: ${root}"
    (cd "$root" && pnpm install --frozen-lockfile)
    local -a web_layers=("${layers[@]+"${layers[@]}"}") web_args=("${forwarded[@]+"${forwarded[@]}"}")
    [[ "$selected_layer" == true ]] || web_layers=(unit integration)
    if [[ "$time_profile" == true ]]; then web_args+=(--reporter=verbose "--slowTestThreshold=${slow_ms}"); fi
    for layer in "${web_layers[@]}"; do
        echo "[test.sh] Running web ${layer} tests"
        if [[ "$layer" == "acceptance" ]]; then
            (cd "${root}/tests" && pnpm exec playwright install chromium)
            run_logged web bash -c 'cd "$1/tests" && exec pnpm run test:acceptance -- "${@:2}"' _ "$root" "${web_args[@]}"
        else
            run_logged web bash -c 'cd "$1/tests" && exec pnpm tsx playwright/scripts/run-tests.ts --layer "$2" "${@:3}"' _ "$root" "$layer" "${web_args[@]}"
        fi
    done
}

for component in "${components[@]}"; do
    case "$component" in
        sdk) run_python sdk "${REPO_ROOT}/sdks/python" ;;
        services) run_python services "${REPO_ROOT}/services" ;;
        api) run_python api "${REPO_ROOT}/api" ;;
        runner) run_runner ;;
        web) run_web ;;
        *) error "Unknown test component: ${component}" ;;
    esac
done
