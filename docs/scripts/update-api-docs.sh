#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SPEC_PATH="${DOCS_ROOT}/docs/reference/openapi.json"

LIVE_URL="https://cloud.agenta.ai/api/openapi.json"
LOCAL_URL="http://localhost/api/openapi.json"

OPENAPI_URL="${LIVE_URL}"
OPENAPI_FILE=""

log() {
  echo "[update-api-docs] $*"
}

usage() {
  cat <<'EOF'
Usage:
  update-api-docs.sh [--live] [--local] [--file FILE]

Modes (pick one):
  (default)  Fetch from https://cloud.agenta.ai/api/openapi.json
  --live     Fetch from https://cloud.agenta.ai/api/openapi.json
  --local    Fetch from http://localhost/api/openapi.json
  --file     Use an explicit local file path

Examples:
  ./docs/scripts/update-api-docs.sh
  ./docs/scripts/update-api-docs.sh --live
  ./docs/scripts/update-api-docs.sh --local
  ./docs/scripts/update-api-docs.sh --file /path/to/openapi.json
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --live)
      OPENAPI_URL="${LIVE_URL}"
      OPENAPI_FILE=""
      shift
      ;;
    --local)
      OPENAPI_URL="${LOCAL_URL}"
      OPENAPI_FILE=""
      shift
      ;;
    --file)
      OPENAPI_FILE="${2:-}"
      OPENAPI_URL=""
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${OPENAPI_FILE}" && -z "${OPENAPI_URL}" ]]; then
  echo "Provide --live, --local, or --file." >&2
  exit 1
fi

if [[ -n "${OPENAPI_FILE}" && ! -f "${OPENAPI_FILE}" ]]; then
  echo "OpenAPI file not found: ${OPENAPI_FILE}" >&2
  exit 1
fi

if [[ -n "${OPENAPI_FILE}" ]]; then
  log "copying OpenAPI spec from ${OPENAPI_FILE} to ${SPEC_PATH}"
  cp "${OPENAPI_FILE}" "${SPEC_PATH}"
else
  log "downloading OpenAPI spec from ${OPENAPI_URL} to ${SPEC_PATH}"
  if ! curl \
    --fail \
    --show-error \
    --silent \
    --location \
    --connect-timeout 5 \
    --max-time 30 \
    "${OPENAPI_URL}" \
    -o "${SPEC_PATH}"; then
    echo "Failed to download OpenAPI spec from ${OPENAPI_URL}." >&2
    exit 1
  fi
fi

if [[ ! -s "${SPEC_PATH}" ]]; then
  echo "Failed to load OpenAPI spec at ${SPEC_PATH}." >&2
  exit 1
fi

log "regenerating Docusaurus API docs"
cd "${DOCS_ROOT}"
npm run clean-api-docs -- agenta
npm run gen-api-docs -- agenta

log "done"
