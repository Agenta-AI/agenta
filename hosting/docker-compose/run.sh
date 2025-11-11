#!/bin/bash
set -euo pipefail

# Default values
LICENSE="oss"
STAGE="gh"
WITH_WEB=true  # Default to web enabled
WITH_NGINX=false  # Default to traefik
AGENTA_WEB_URL=  # Use env var if available, otherwise default
ENV_FILE=""  # Default to no env file
BUILD=false  # Default to no forced build
NO_CACHE=false  # Default to using cache

show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --license <oss|ee>      Specify the license type (default: oss)"
    echo "  --dev                   Set the stage to 'dev' or 'gh.ssl' for https (default: gh)"
    echo "  --no-web                Run web with no container (default: web in container)"
    echo "  --nginx                 Run with nginx as the proxy service (default: traefik)"
    echo "  --web-domain <URL>      Set the web domain (default: from env var or http://localhost:3000)"
    echo "  --env-file <path>       Specify an environment file to load variables (default: built-in)"
    echo "  --build                 Force a fresh build of containers (default: false)"
    echo "  --no-cache              Build without using cache [implies --build] (default: false)"
    echo "  --help                  Show this help message and exit"
    exit 0
}

# Error handling function
error_exit() {
    echo "Error: $1" >&2
    exit 1
}

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --license)
            if [[ -z "$2" || ( "$2" != "ee" && "$2" != "oss" ) ]]; then
                error_exit "Invalid value for --license. Allowed: 'ee' or 'oss'."
            fi
            LICENSE="$2"
            shift
            ;;
        --dev)
            STAGE="dev"
            ;;
        --gh)
            STAGE="gh"
            ;;
        --ssl)
            STAGE="gh.ssl"
            ;;
        --no-web)
            WITH_WEB=false
            ;;
        --nginx)
            WITH_NGINX=true
            ;;
        --web-domain)
            if [[ -z "$2" ]]; then
                error_exit "Missing value for --web-domain."
            fi
            AGENTA_WEB_URL="$2"
            shift
            ;;
        --env-file)
            if [[ -z "$2" ]]; then
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
            BUILD=true  # --no-cache implies --build
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

# Set AGENTA_WEB_URL based on WITH_WEB if not already set
if [[ -z "$AGENTA_WEB_URL" ]]; then
    if [[ "$WITH_WEB" == "false" ]]; then
        AGENTA_WEB_URL="http://localhost:3000"
    else
        AGENTA_WEB_URL="http://localhost"
    fi
fi

# Ensure required files exist
COMPOSE_FILE="./hosting/docker-compose/${LICENSE}/docker-compose.${STAGE}.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
    error_exit "Docker Compose file not found: $COMPOSE_FILE"
fi

# Construct Docker Compose command
COMPOSE_CMD="docker compose -f $COMPOSE_FILE"

# If ENV_FILE is not provided, set it explicitly
if [[ -z "$ENV_FILE" ]]; then
    ENV_FILE=".env.$LICENSE.$STAGE"
fi

# Export the ENV_FILE to the environment
export ENV_FILE="$ENV_FILE"
#export ENV_FILE="$ENV_FILE"

# Always append --env-file flag to COMPOSE_CMD
COMPOSE_CMD+=" --env-file ./hosting/docker-compose/$LICENSE/$ENV_FILE"

if $WITH_WEB; then
    COMPOSE_CMD+=" --profile with-web"
fi

if $WITH_NGINX; then
    COMPOSE_CMD+=" --profile with-nginx"
else
    COMPOSE_CMD+=" --profile with-traefik"
fi

# Handle build options
BUILD_CMD="up -d"
if $BUILD; then
    BUILD_CMD+=" --build"
fi

if $NO_CACHE; then
    BUILD_CMD+=" --no-cache"
fi

# Restart Docker Compose safely
echo "Stopping existing Docker containers..."

# Include all profiles to ensure clean shutdown
SHUTDOWN_CMD="$COMPOSE_CMD --profile with-web --profile with-nginx --profile with-traefik down"
$SHUTDOWN_CMD || error_exit "Failed to stop existing containers."

echo "Starting Docker containers with domain: $AGENTA_WEB_URL ..."
AGENTA_WEB_URL="$AGENTA_WEB_URL" $COMPOSE_CMD $BUILD_CMD || error_exit "Failed to start Docker containers."

echo "✅ Setup complete!"

# Start the web development environment unless --no-web is provided
if ! $WITH_WEB ; then
    echo "Setting up web environment..."
    
    if [[ ! -d "web" ]]; then
        error_exit "Web directory not found!"
    fi

    cd web
    pnpm install || error_exit "Failed to install dependencies in web."

    if [[ ! -d "$LICENSE" ]]; then
        error_exit "$LICENSE directory not found inside web!"
    fi

    echo "Starting development server for $LICENSE..."

    sh -c "AGENTA_LICENSE=${LICENSE} ENTRYPOINT_DIR=. sh ./entrypoint.sh"
    
    cd $LICENSE
    pnpm dev || error_exit "Failed to start development server."
fi
