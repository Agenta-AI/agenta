#!/bin/bash
#
# Regenerate src/.generated/schemas.ts from the backend OpenAPI spec.
#
# What this does:
#   1. Fetch the OpenAPI spec from the backend (env: AGENTA_OPENAPI_URL).
#   2. Run openapi-zod-client to produce Zod schemas + Zodios endpoints.
#   3. Post-process: strip Zodios runtime, rewrite z.record() for Zod 4 arity.
#   4. Write the result to src/.generated/schemas.ts.
#
# Usage:
#   pnpm generate:schemas
#   AGENTA_OPENAPI_URL=https://staging.agenta.ai/api/openapi.json pnpm generate:schemas
#

set -euo pipefail

OPENAPI_URL="${AGENTA_OPENAPI_URL:-https://cloud.agenta.ai/api/openapi.json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
TMP_DIR="$(mktemp -d -t agenta-sdk-schemas-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[1/4] Fetching $OPENAPI_URL"
curl -sfSL "$OPENAPI_URL" -o "$TMP_DIR/openapi.json"
echo "      → $(wc -c < "$TMP_DIR/openapi.json") bytes"

echo "[2/4] Running openapi-zod-client"
pnpm dlx openapi-zod-client@1.18.3 "$TMP_DIR/openapi.json" -o "$TMP_DIR/raw.ts" >/dev/null 2>&1

echo "[3/4] Post-processing (strip Zodios, fix Zod 4 z.record arity)"
node "$SCRIPT_DIR/postprocess-schemas.mjs" "$TMP_DIR/raw.ts" "$PKG_DIR/src/.generated/schemas.ts"

echo "[4/4] Type-checking generated schemas"
(cd "$PKG_DIR" && pnpm types:check >/dev/null)

echo
echo "Done. $(wc -l < "$PKG_DIR/src/.generated/schemas.ts") lines written to src/.generated/schemas.ts"
