#!/usr/bin/env bash

set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-agenta-oss-railway}"
ENV_NAME="${RAILWAY_ENVIRONMENT_NAME:-production}"

if [ -z "${RAILWAY_API_TOKEN:-}" ] && [ -z "${RAILWAY_TOKEN:-}" ]; then
    railway whoami >/dev/null 2>&1 || {
        printf "Railway authentication is required. Set RAILWAY_API_TOKEN or run railway login.\n" >&2
        exit 1
    }
fi

if ! command -v jq >/dev/null 2>&1; then
    printf "Missing required command: jq\n" >&2
    exit 1
fi

railway link --project "$PROJECT_NAME" --environment "$ENV_NAME" --json >/dev/null

cfg="$(railway environment config --environment "$ENV_NAME" --json)"
status_json="$(railway status --json)"

missing="$(printf '%s' "$cfg" | jq -r '
  .services
  | to_entries[]
  | select((.value.source.image // "") == "" and (.value.source.repo // "") == "")
  | .key
')"

if [ -z "$missing" ]; then
    printf "All services have source metadata. This project is template-export friendly.\n"
    exit 0
fi

printf "Services missing source metadata:\n" >&2
printf '%s\n' "$missing" | while IFS= read -r id; do
    name="$(printf '%s' "$status_json" | jq -r --arg id "$id" '.environments.edges[]?.node.serviceInstances.edges[]?.node | select(.serviceId == $id) | .serviceName' | head -n 1)"
    if [ -n "$name" ]; then
        printf -- "- %s (%s)\n" "$name" "$id" >&2
    else
        printf -- "- %s\n" "$id" >&2
    fi
done

printf "\nTo export as a template in Railway UI, each service needs source.image or source.repo.\n" >&2
printf "Use image-backed services in bootstrap, and set AGENTA_GATEWAY_IMAGE for gateway.\n" >&2
exit 1
