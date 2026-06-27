#!/bin/bash
set -euo pipefail

# Default values
LICENSE="oss"
LICENSE_SOURCE="default"
IMAGE_MODE="gh"  # gh|dev
IMAGE_MODE_SOURCE="default"
SOURCE_LOCAL=false
SSL_ENABLED=false
STAGE="gh"  # Derived from image/network/source flags after parsing
WEB_MODE="docker"  # docker|local|none
WEB_MODE_SOURCE="default"
WITH_NGINX=false  # Default to traefik
AGENTA_WEB_URL=  # Use env var if available, otherwise default
ENV_FILE=""  # Default to no env file
BUILD=false  # Default to no forced build
NO_CACHE=false  # Default to using cache
PULL_ENABLED=  # Stage-dependent default applied after parsing: gh→true, dev→false
NUKE=false  # Default to not nuking volumes
DOWN=false  # Default to up; --down only stops containers
WITH_TUNNEL=true  # Composio trigger-event tunnel; disable with --no-tunnel

show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "License:"
    echo "  --oss                   Alias for --license oss"
    echo "  --ee                    Alias for --license ee"
    echo "  --license <oss|ee>      Set license (default: oss)"
    echo ""
    echo "Image:"
    echo "  --image <gh|dev>        Set image mode (default: gh)"
    echo "  --gh                    Alias for --image gh"
    echo "  --dev                   Alias for --image dev"
    echo ""
    echo "Source:"
    echo "  --pull                  Pull non-built images before up (default for --gh)"
    echo "  --no-pull               Skip pulling non-built images (default for --dev)"
    echo "  --local                 Use local gh source (requires --image gh)"
    echo "  --build                 Build images before up"
    echo "  --no-cache              Build with --no-cache (requires --build)"
    echo ""
    echo "Web:"
    echo "  --no-web                Alias for --web-mode none"
    echo "  --web-local             Alias for --web-mode local"
    echo "  --web-mode <mode>       Web mode: docker|local|none (default: docker)"
    echo "  --web-url <URL>         Override AGENTA_WEB_URL"
    echo ""
    echo "Environment:"
    echo "  -e, --env <path>        Use explicit env file (otherwise stage default)"
    echo "  --env-file <path>       Alias for --env"
    echo ""
    echo "Database:"
    echo "  --nuke                  Remove related volumes on shutdown"
    echo "  --down                  Stop containers and exit (no up); keeps volumes unless --nuke"
    echo ""
    echo "Network:"
    echo "  --ssl                   Use SSL proxy stage (requires --image gh)"
    echo "  --nginx                 Use nginx proxy (default: traefik)"
    echo ""
    echo "Triggers:"
    echo "  --no-tunnel             Disable the Composio trigger-event tunnel"
    echo "                          (use when the host has a public ingress URL)"
    echo "                          The tunnel only starts when COMPOSIO_API_KEY is set;"
    echo "                          without a key it is skipped automatically."
    echo ""
    echo "Miscellaneous:"
    echo "  --help                  Show this help message and exit"
    exit 0
}

# Error handling function
error_exit() {
    echo "Error: $1" >&2
    exit 1
}

# Returns 0 when COMPOSIO_API_KEY is available — checked in the shell environment first
# (e.g. exported via `load-env`), then in the resolved env file, where it normally lives.
# Used to gate the Composio trigger tunnel so it never starts (and crash-loops) without a key.
composio_key_set() {
    if [[ -n "${COMPOSIO_API_KEY:-}" ]]; then
        return 0
    fi
    if [[ -n "${ENV_FILE_PATH:-}" && -f "$ENV_FILE_PATH" ]]; then
        # An uncommented assignment with a non-empty, non-comment value after `=`.
        if grep -Eq '^[[:space:]]*COMPOSIO_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]#]' "$ENV_FILE_PATH"; then
            return 0
        fi
    fi
    return 1
}

set_image_mode() {
    local new_mode="$1"
    local source_flag="$2"

    if [[ "$IMAGE_MODE_SOURCE" != "default" && "$IMAGE_MODE" != "$new_mode" ]]; then
        error_exit "Conflicting image flags: '$IMAGE_MODE_SOURCE' sets '$IMAGE_MODE' but '$source_flag' sets '$new_mode'."
    fi

    IMAGE_MODE="$new_mode"
    IMAGE_MODE_SOURCE="$source_flag"
}

set_web_mode() {
    local new_mode="$1"
    local source_flag="$2"

    if [[ "$WEB_MODE_SOURCE" != "default" && "$WEB_MODE" != "$new_mode" ]]; then
        error_exit "Conflicting web mode flags: '$WEB_MODE_SOURCE' sets '$WEB_MODE' but '$source_flag' sets '$new_mode'."
    fi

    WEB_MODE="$new_mode"
    WEB_MODE_SOURCE="$source_flag"
}

set_license() {
    local new_license="$1"
    local source_flag="$2"

    if [[ "$LICENSE_SOURCE" != "default" && "$LICENSE" != "$new_license" ]]; then
        error_exit "Conflicting license flags: '$LICENSE_SOURCE' sets '$LICENSE' but '$source_flag' sets '$new_license'."
    fi

    LICENSE="$new_license"
    LICENSE_SOURCE="$source_flag"
}

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --license)
            if [[ -z "${2:-}" ]]; then
                error_exit "Missing value for --license."
            fi
            if [[ "$2" != "ee" && "$2" != "oss" ]]; then
                error_exit "Invalid value for --license. Allowed: 'ee' or 'oss'."
            fi
            set_license "$2" "--license"
            shift
            ;;
        --oss)
            set_license "oss" "--oss"
            ;;
        --ee)
            set_license "ee" "--ee"
            ;;
        --dev)
            set_image_mode "dev" "--dev"
            ;;
        --gh)
            set_image_mode "gh" "--gh"
            ;;
        --local)
            SOURCE_LOCAL=true
            ;;
        --image)
            if [[ -z "${2:-}" ]]; then
                error_exit "Missing value for --image."
            fi
            case "$2" in
                dev)
                    set_image_mode "dev" "--image"
                    ;;
                gh)
                    set_image_mode "gh" "--image"
                    ;;
                *)
                    error_exit "Invalid value for --image. Allowed: 'dev' or 'gh'."
                    ;;
            esac
            shift
            ;;
        --dockerfile)
            if [[ -z "${2:-}" ]]; then
                error_exit "Missing value for --dockerfile."
            fi
            case "$2" in
                dev)
                    set_image_mode "dev" "--dockerfile"
                    ;;
                gh)
                    set_image_mode "gh" "--dockerfile"
                    ;;
                *)
                    error_exit "Invalid value for --dockerfile. Allowed: 'dev' or 'gh'."
                    ;;
            esac
            shift
            ;;
        --ssl)
            SSL_ENABLED=true
            ;;
        --no-web)
            set_web_mode "none" "--no-web"
            ;;
        --web-local)
            set_web_mode "local" "--web-local"
            ;;
        --web-mode)
            if [[ -z "${2:-}" ]]; then
                error_exit "Missing value for --web-mode."
            fi
            case "$2" in
                none|docker|local)
                    set_web_mode "$2" "--web-mode"
                    ;;
                *)
                    error_exit "Invalid value for --web-mode. Allowed: 'none', 'docker', or 'local'."
                    ;;
            esac
            shift
            ;;
        --nginx)
            WITH_NGINX=true
            ;;
        --web-url)
            if [[ -z "${2:-}" ]]; then
                error_exit "Missing value for --web-url."
            fi
            AGENTA_WEB_URL="$2"
            shift
            ;;
        -e|--env|--env-file)
            if [[ -z "${2:-}" ]]; then
                error_exit "Missing value for $1."
            fi
            ENV_FILE="$2"
            shift
            ;;
        --build)
            BUILD=true
            ;;
        --no-cache)
            NO_CACHE=true
            ;;
        --pull)
            if [[ "$PULL_ENABLED" == "false" ]]; then
                error_exit "Conflicting flags: --pull and --no-pull cannot be combined."
            fi
            PULL_ENABLED=true
            ;;
        --no-pull)
            if [[ "$PULL_ENABLED" == "true" ]]; then
                error_exit "Conflicting flags: --pull and --no-pull cannot be combined."
            fi
            PULL_ENABLED=false
            ;;
        --nuke)
            NUKE=true
            ;;
        --no-tunnel)
            WITH_TUNNEL=false
            ;;
        --down)
            DOWN=true
            ;;
        --help)
            show_usage
            ;;
        *)
            error_exit "Unknown parameter: $1. Use --help for usage."
            ;;
    esac
    shift
done

if $NO_CACHE && ! $BUILD; then
    error_exit "--no-cache requires --build."
fi

if [[ "$IMAGE_MODE" != "gh" && "$SOURCE_LOCAL" == "true" ]]; then
    error_exit "--local requires --image gh."
fi

if [[ "$IMAGE_MODE" != "gh" && "$SSL_ENABLED" == "true" ]]; then
    error_exit "--ssl requires --image gh."
fi

if [[ "$SOURCE_LOCAL" == "true" && "$SSL_ENABLED" == "true" ]]; then
    error_exit "--local and --ssl cannot be combined."
fi

if [[ "$IMAGE_MODE" == "dev" ]]; then
    STAGE="dev"
elif [[ "$SOURCE_LOCAL" == "true" ]]; then
    STAGE="gh.local"
elif [[ "$SSL_ENABLED" == "true" ]]; then
    STAGE="gh.ssl"
else
    STAGE="gh"
fi

# Stage-aware default for pull when the user did not pass --pull/--no-pull.
# - gh stages use prebuilt registry images: default to pull (catch latest pushes).
# - dev stage uses locally-built images: default to no-pull (registry has no dev tag).
if [[ -z "$PULL_ENABLED" ]]; then
    if [[ "$IMAGE_MODE" == "dev" ]]; then
        PULL_ENABLED=false
    else
        PULL_ENABLED=true
    fi
fi

# Set AGENTA_WEB_URL based on web mode if not already set
if [[ -z "$AGENTA_WEB_URL" ]]; then
    case "$WEB_MODE" in
        local)
            AGENTA_WEB_URL="http://localhost:3000"
            ;;
        none|docker)
            AGENTA_WEB_URL="http://localhost"
            ;;
    esac
fi

# Ensure required files exist
COMPOSE_FILE="./hosting/docker-compose/${LICENSE}/docker-compose.${STAGE}.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
    error_exit "Docker Compose file not found: $COMPOSE_FILE"
fi

# Construct Docker Compose command
COMPOSE_CMD="docker compose -f $COMPOSE_FILE"

# If ENV_FILE is not provided, set it explicitly
# gh.local reuses the gh env file
if [[ -z "$ENV_FILE" ]]; then
    if [[ "$STAGE" == "gh.local" ]]; then
        ENV_FILE=".env.$LICENSE.gh"
    else
        ENV_FILE=".env.$LICENSE.$STAGE"
    fi
fi

if [[ "$ENV_FILE" = /* || "$ENV_FILE" == ./* || "$ENV_FILE" == ../* || "$ENV_FILE" == */* ]]; then
    ENV_FILE_PATH="$ENV_FILE"
else
    ENV_FILE_PATH="./hosting/docker-compose/$LICENSE/$ENV_FILE"
fi

# F-037 guard: fail loud when the resolved env file is missing instead of letting Compose
# silently fall back to its `${ENV_FILE:-./.env.<license>.<stage>}` default. The committed
# default holds port-80 / no-port URLs, so a typo'd or absent env file produces a stack whose
# web container 404s every `/api` call (same class as F-020) with no obvious cause. Catch it here.
if [[ ! -f "$ENV_FILE_PATH" ]]; then
    error_exit "Env file not found: $ENV_FILE_PATH
Refusing to start: Docker Compose would silently fall back to its built-in default
(port-80 / no-port URLs), which makes every web '/api' call 404 with no obvious cause.
Pass an existing --env-file (e.g. --env-file .env.$LICENSE.$STAGE.local) or create the file."
fi

# Export the ENV_FILE to the environment
export ENV_FILE="$ENV_FILE"

# Always append --env-file flag to COMPOSE_CMD
COMPOSE_CMD+=" --env-file $ENV_FILE_PATH"

if [[ "$WEB_MODE" == "docker" ]]; then
    COMPOSE_CMD+=" --profile with-web"
fi

if $WITH_NGINX; then
    COMPOSE_CMD+=" --profile with-nginx"
else
    COMPOSE_CMD+=" --profile with-traefik"
fi

# Composio trigger tunnel: only activate when a COMPOSIO_API_KEY is available. Without a key
# `dispatcher_composio.py` exits immediately, so under `restart: always` the container would
# crash-loop (start → pip install → exit → restart …). Skip the profile so it never starts.
if $WITH_TUNNEL; then
    if composio_key_set; then
        COMPOSE_CMD+=" --profile with-tunnel"
    else
        echo "Composio tunnel disabled: COMPOSIO_API_KEY not set"
    fi
fi

if $NO_CACHE; then
    echo "Building containers with no cache..."
    $COMPOSE_CMD build --parallel --no-cache || error_exit "Build failed"
elif $BUILD; then
    echo "Building containers..."
    $COMPOSE_CMD build --parallel || error_exit "Build failed"
elif $PULL_ENABLED; then
    # Pull non-built images for all stages unless disabled
    echo "Pulling latest images..."
    $COMPOSE_CMD pull --ignore-buildable || error_exit "Pull failed"
fi

# Shutdown with optional nuke
echo "Stopping existing Docker containers..."

# Include all profiles to ensure clean shutdown
SHUTDOWN_CMD="$COMPOSE_CMD --profile with-web --profile with-nginx --profile with-traefik --profile with-tunnel down"

if $NUKE; then
    SHUTDOWN_CMD+=" --volumes"
fi

$SHUTDOWN_CMD || error_exit "Failed to stop existing containers."

if $DOWN; then
    echo "✅ Containers stopped."
    exit 0
fi

echo "Starting Docker containers with domain: $AGENTA_WEB_URL ..."
AGENTA_WEB_URL="$AGENTA_WEB_URL" $COMPOSE_CMD up -d || error_exit "Failed to start Docker containers."

echo "✅ Setup complete!"

# Start local web development only when requested
if [[ "$WEB_MODE" == "local" ]]; then
    echo "Setting up web environment..."

    if [[ ! -d "web" ]]; then
        error_exit "Web directory not found!"
    fi

    if [[ -f "$ENV_FILE_PATH" ]]; then
        set -a
        . "$ENV_FILE_PATH"
        set +a
    fi

    cd web
    pnpm install || error_exit "Failed to install dependencies in web."

    if [[ ! -d "$LICENSE" ]]; then
        error_exit "$LICENSE directory not found inside web!"
    fi

    echo "Starting development server for $LICENSE..."

    export AGENTA_WEB_URL
    sh -c "AGENTA_LICENSE=${LICENSE} ENTRYPOINT_DIR=. sh ./entrypoint.sh"

    cd $LICENSE
    pnpm dev || error_exit "Failed to start development server."
fi
