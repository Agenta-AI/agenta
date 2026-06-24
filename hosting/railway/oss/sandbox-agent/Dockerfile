# Wrapper Dockerfile for Railway deployment.
# Adds the runtime port to the GHCR image and keeps the runner service image-backed.

FROM ghcr.io/agenta-ai/agenta-sandbox-agent:latest

ENV PORT=8765

CMD ["node_modules/.bin/tsx", "src/server.ts"]
