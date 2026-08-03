# Wrapper Dockerfile for Railway deployment.
# Adds the runtime port to the GHCR image and keeps the runner service image-backed.

FROM ghcr.io/agenta-ai/agenta-runner:latest

ENV AGENTA_RUNNER_HOST=0.0.0.0
ENV AGENTA_RUNNER_PORT=8765

CMD ["node_modules/.bin/tsx", "src/server.ts"]
