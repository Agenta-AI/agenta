# Wrapper Dockerfile for Railway deployment.
# Adds the runtime port to the GHCR image and keeps the runner service image-backed.

FROM ghcr.io/agenta-ai/agenta-agent-runner:latest

ENV AGENTA_AGENT_RUNNER_PORT=8765

CMD ["node_modules/.bin/tsx", "src/server.ts"]
