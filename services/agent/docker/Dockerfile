# Agent runner sidecar (sandbox-agent server), production image.
#
# Runs the TypeScript runner (src/server.ts) as a long-lived HTTP server on :8765.
# The Python agent service calls it in-network. Unlike Dockerfile.dev there is no
# `tsx watch` and no bind mount: the source is baked in.
#
# Licensing posture (see docker/README.md):
#   - Pi (@earendil-works/pi-coding-agent, MIT) is baked via the npm dependencies.
#   - Claude Code is proprietary (Anthropic Commercial Terms). It is NEVER baked into
#     this image. The sandbox-agent daemon installs it at runtime from Anthropic over
#     HTTPS (the reason ca-certificates is installed). That keeps Anthropic as the
#     distributor, the only compliant path for an image we build and ship.
#   - No credential is baked: no API key, no OAuth login. Auth is injected at runtime
#     (ANTHROPIC_API_KEY / request secrets; OAuth self-host is a mounted opt-in only).

FROM node:24-slim

WORKDIR /app

# CA certificates: the sandbox-agent daemon (Rust) downloads harness CLIs (e.g. Claude
# Code) over HTTPS using the system trust store, which node:*-slim omits — without this
# the daemon's `install-agent claude` fails TLS verification. git lets npm/installers
# fetch git deps. python3 runs `code` tools whose runtime is "python": the runner relays
# the call and spawns `python3` (src/tools/code.ts), so without it those tools fail with
# `spawn python3 ENOENT`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Install deps as a cached layer (manifest + lockfile only). The full dependency set is
# installed (not --prod): the runtime uses `tsx` and the extension build uses `esbuild`,
# both devDependencies.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Bake the source (no bind mount in production).
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY config ./config
COPY skills ./skills

# Bundle the Agenta Pi extension (tracing + tools) into dist/. runSandboxAgent installs
# this baked copy into Pi's agent dir on every run. Rebuild the image after editing
# src/extensions/agenta.ts or the tracer.
RUN pnpm run build:extension

ENV NODE_ENV=production \
    PORT=8765

EXPOSE 8765

# Call the local tsx binary directly to avoid pnpm/corepack HOME writes when the
# container runs as a non-root host uid.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
