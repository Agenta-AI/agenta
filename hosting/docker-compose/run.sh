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
PULL_ENABLED=true  # Pull non-built images when not building, unless disabled
NUKE=false  # Default to not nuking volumes

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
    echo "  --no-pull               Disable pulling non-built images before up"
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
    echo "  --env-file <path>       Use explicit env file (otherwise stage default)"
    echo ""
    echo "Database:"
    echo "  --nuke                  Remove related volumes on shutdown"
    echo ""
    echo "Network:"
    echo "  --ssl                   Use SSL proxy stage (requires --image gh)"
    echo "  --nginx                 Use nginx proxy (default: traefik)"
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
        --env-file)
            if [[ -z "${2:-}" ]]; then
                error_exit "Missing value for --env-file."
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
        --no-pull)
            PULL_ENABLED=false
            ;;
        --nuke)
            NUKE=true
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

# For gh.local builds, always copy the local SDK into api/ and services/ build contexts
# so that Dockerfile.gh can COPY it (Docker BuildKit doesn't follow symlinks outside context)
# This is necessary even without --build because docker compose up will auto-build missing images
if [[ "$STAGE" == "gh.local" ]]; then
    echo "Copying local SDK into build contexts..."
    rm -rf api/sdk services/sdk
    cp -r sdk api/sdk
    cp -r sdk services/sdk
    cleanup_sdk_copies() { rm -rf api/sdk services/sdk; }
    trap cleanup_sdk_copies EXIT
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
SHUTDOWN_CMD="$COMPOSE_CMD --profile with-web --profile with-nginx --profile with-traefik down"

if $NUKE; then
    SHUTDOWN_CMD+=" --volumes"
fi

$SHUTDOWN_CMD || error_exit "Failed to stop existing containers."

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
