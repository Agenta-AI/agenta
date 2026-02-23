#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

PREVIEW_PROJECT_PREFIX="${RAILWAY_PREVIEW_PROJECT_PREFIX:-agenta-oss-pr}"
PREVIEW_KEY="${RAILWAY_PREVIEW_KEY:-${PR_NUMBER:-${GITHUB_PR_NUMBER:-}}}"

if [ -z "$PREVIEW_KEY" ]; then
    PREVIEW_KEY="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-preview}}"
fi

normalize_key() {
    local raw="$1"
    printf "%s" "$raw" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-'
}

PREVIEW_KEY="$(normalize_key "$PREVIEW_KEY")"
PREVIEW_KEY="${PREVIEW_KEY#-}"
PREVIEW_KEY="${PREVIEW_KEY%-}"

if [ -z "$PREVIEW_KEY" ]; then
    PREVIEW_KEY="preview"
fi

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-${PREVIEW_PROJECT_PREFIX}-${PREVIEW_KEY}}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-production}"
GHCR_NAMESPACE="${GHCR_NAMESPACE:-agenta-ai}"
IMAGE_TAG="${IMAGE_TAG:-}"

if [ -f "$ROOT_DIR/hosting/railway/oss/.last-images.env" ]; then
    # shellcheck source=/dev/null
    source "$ROOT_DIR/hosting/railway/oss/.last-images.env"
fi

if [ -z "${AGENTA_API_IMAGE:-}" ] && [ -n "$IMAGE_TAG" ]; then
    export AGENTA_API_IMAGE="ghcr.io/${GHCR_NAMESPACE}/agenta-api:${IMAGE_TAG}"
fi

if [ -z "${AGENTA_WEB_IMAGE:-}" ] && [ -n "$IMAGE_TAG" ]; then
    export AGENTA_WEB_IMAGE="ghcr.io/${GHCR_NAMESPACE}/agenta-web:${IMAGE_TAG}"
fi

if [ -z "${AGENTA_SERVICES_IMAGE:-}" ] && [ -n "$IMAGE_TAG" ]; then
    export AGENTA_SERVICES_IMAGE="ghcr.io/${GHCR_NAMESPACE}/agenta-services:${IMAGE_TAG}"
fi

export AGENTA_API_IMAGE="${AGENTA_API_IMAGE:-ghcr.io/${GHCR_NAMESPACE}/agenta-api:latest}"
export AGENTA_WEB_IMAGE="${AGENTA_WEB_IMAGE:-ghcr.io/${GHCR_NAMESPACE}/agenta-web:latest}"
export AGENTA_SERVICES_IMAGE="${AGENTA_SERVICES_IMAGE:-ghcr.io/${GHCR_NAMESPACE}/agenta-services:latest}"

export RAILWAY_PROJECT_NAME="$PROJECT_NAME"
export RAILWAY_ENVIRONMENT_NAME="$ENV_NAME"

# Preview projects are always fresh; skip unsetting stale variables to save
# ~73 Railway API calls per deploy and stay within rate limits.
export CONFIGURE_SKIP_UNSETS=true

"$ROOT_DIR/hosting/railway/oss/scripts/bootstrap.sh"
"$ROOT_DIR/hosting/railway/oss/scripts/deploy-from-images.sh"

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
railway_call link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null
DOMAIN="$(railway_call variable list -k --service gateway --environment "$ENV_NAME" | grep '^RAILWAY_PUBLIC_DOMAIN=' | cut -d= -f2- || true)"

printf "Preview deploy completed for '%s' (%s)\n" "$PROJECT_NAME" "$ENV_NAME"
if [ -n "$DOMAIN" ]; then
    printf "Preview URL: https://%s/w\n" "$DOMAIN"
fi
