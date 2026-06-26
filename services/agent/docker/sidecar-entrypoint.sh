#!/bin/sh
# Entrypoint for the all-harness self-host sidecar (services/agent/docker/Dockerfile.sidecar).
#
# Reproduces the Pi provisioning the dev compose CMD does inline, but baked into the image
# so no compose CMD override is needed:
#   - ensure PI_CODING_AGENT_DIR exists and is writable (the image pre-creates /pi-agent
#     owned by the runtime user; this is the idempotent belt-and-suspenders that also
#     covers a custom PI_CODING_AGENT_DIR),
#   - optionally seed a Pi login mounted read-only at /pi-agent-ro into it, exactly like
#     the compose `cp -a /pi-agent-ro/.` (so Pi subscription auth + sessions stay writable
#     in-container rather than failing against a read-only mount),
#   - then exec the server (the image CMD).
#
# The Agenta Pi extension bundle is already built into dist/ at image build
# (`pnpm run build:extension` in the runner image), so — unlike the dev compose CMD —
# there is no runtime rebuild: the baked bundle matches the baked src.
set -eu

PI_DIR="${PI_CODING_AGENT_DIR:-/pi-agent}"

# Idempotent: /pi-agent is pre-created and owned by the runtime user at image build. This
# only matters if PI_CODING_AGENT_DIR was overridden to a fresh, writable path.
mkdir -p "$PI_DIR" 2>/dev/null || true

# Optional Pi login seed. A read-only mount of a host Pi agent dir (~/.pi/agent) at
# /pi-agent-ro is copied into the writable PI_CODING_AGENT_DIR so Pi can both read its
# login and write its extensions/sessions. Best-effort: API-key Pi runs need no login.
if [ -d /pi-agent-ro ]; then
    cp -a /pi-agent-ro/. "$PI_DIR"/ 2>/dev/null || true
fi

exec "$@"
