#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

REGISTRY="${GHCR_REGISTRY:-ghcr.io}"
NAMESPACE="${GHCR_NAMESPACE:-agenta-ai}"

TAG="${IMAGE_TAG:-}"
if [ -z "$TAG" ]; then
    TAG="dev-$(git -C "$ROOT_DIR" rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
fi

PUSH_IMAGES="${PUSH_IMAGES:-true}"
OUTPUT_FILE="${IMAGE_OUTPUT_FILE:-$ROOT_DIR/hosting/railway/oss/.last-images.env}"

if ! command -v docker >/dev/null 2>&1; then
    printf "Missing required command: docker\n" >&2
    exit 1
fi

API_IMAGE="${REGISTRY}/${NAMESPACE}/agenta-api:${TAG}"
WEB_IMAGE="${REGISTRY}/${NAMESPACE}/agenta-web:${TAG}"
SERVICES_IMAGE="${REGISTRY}/${NAMESPACE}/agenta-services:${TAG}"

printf "Building local images with tag '%s'\n" "$TAG"

docker build -t "$API_IMAGE" -f "$ROOT_DIR/api/oss/docker/Dockerfile.gh" "$ROOT_DIR/api"
docker build -t "$WEB_IMAGE" -f "$ROOT_DIR/web/oss/docker/Dockerfile.gh" "$ROOT_DIR/web"
docker build -t "$SERVICES_IMAGE" -f "$ROOT_DIR/services/oss/docker/Dockerfile.gh" "$ROOT_DIR/services"

if [ "$PUSH_IMAGES" = "true" ]; then
    printf "Pushing images to %s/%s\n" "$REGISTRY" "$NAMESPACE"
    docker push "$API_IMAGE"
    docker push "$WEB_IMAGE"
    docker push "$SERVICES_IMAGE"
else
    printf "Skipping push because PUSH_IMAGES=%s\n" "$PUSH_IMAGES"
fi

cat > "$OUTPUT_FILE" <<EOF
export AGENTA_API_IMAGE="$API_IMAGE"
export AGENTA_WEB_IMAGE="$WEB_IMAGE"
export AGENTA_SERVICES_IMAGE="$SERVICES_IMAGE"
EOF

printf "Wrote image exports to %s\n" "$OUTPUT_FILE"
printf "AGENTA_API_IMAGE=%s\n" "$API_IMAGE"
printf "AGENTA_WEB_IMAGE=%s\n" "$WEB_IMAGE"
printf "AGENTA_SERVICES_IMAGE=%s\n" "$SERVICES_IMAGE"
