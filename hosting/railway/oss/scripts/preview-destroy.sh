#!/usr/bin/env bash

set -euo pipefail

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

if ! command -v railway >/dev/null 2>&1; then
    printf "Missing required command: railway\n" >&2
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    printf "Missing required command: jq\n" >&2
    exit 1
fi

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

if ! railway project list --json | jq -e --arg name "$PROJECT_NAME" '.[] | select(.name == $name)' >/dev/null; then
    printf "Project '%s' does not exist. Nothing to delete.\n" "$PROJECT_NAME"
    exit 0
fi

railway delete --project "$PROJECT_NAME" --yes --json >/dev/null
printf "Deleted preview project '%s'\n" "$PROJECT_NAME"
