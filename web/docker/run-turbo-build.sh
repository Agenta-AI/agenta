#!/bin/sh

set -eu

TARGET_FILTER="$1"

if [ -s /run/secrets/turbo_team ] && [ -s /run/secrets/turbo_token ]; then
    export TURBO_TEAM="$(cat /run/secrets/turbo_team)"
    export TURBO_TOKEN="$(cat /run/secrets/turbo_token)"
    echo "Turbo remote cache enabled for ${TARGET_FILTER}"
else
    echo "Turbo remote cache not configured. Using local Turbo cache only."
fi

pnpm turbo run build --filter="${TARGET_FILTER}"
