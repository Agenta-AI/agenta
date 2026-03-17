#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/hosting/railway/oss/scripts/preview-resolve-env.sh"

"$ROOT_DIR/hosting/railway/oss/scripts/bootstrap.sh"
"$ROOT_DIR/hosting/railway/oss/scripts/deploy-from-images.sh"

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
railway_call link --project "$RAILWAY_PROJECT_NAME" --environment "$RAILWAY_ENVIRONMENT_NAME" --json >/dev/null
DOMAIN="$(railway_call variable list -k --service gateway --environment "$RAILWAY_ENVIRONMENT_NAME" | grep '^RAILWAY_PUBLIC_DOMAIN=' | cut -d= -f2- || true)"

printf "Preview deploy completed for '%s' (%s)\n" "$RAILWAY_PROJECT_NAME" "$RAILWAY_ENVIRONMENT_NAME"
if [ -n "$DOMAIN" ]; then
    printf "Preview URL: https://%s/w\n" "$DOMAIN"
fi
