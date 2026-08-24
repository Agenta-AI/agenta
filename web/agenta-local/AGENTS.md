# Agenta Local renderer

This directory is a local-only Next.js application host, not package code. Keep all local
runtime UI and transport code here; do not move it into `web/packages`.

## Scoped transport exception

The app talks to the separate loopback-only Agenta Local FastAPI service. It must use
same-origin `fetch` with `credentials: "same-origin"` and validate every response with Zod.
This is intentionally not the platform Fern API. No package may import this app's API client.

`src/lib/api/stream.ts` is the only SSE parser. It consumes Vercel stream frames from the
local turn endpoint.

## Privacy boundary

Persist only the `agenta-theme` preference. Never persist provider credentials, runner
details, messages, composer drafts, selected agents, or selected sessions. Selection belongs
in `agent_id` and `session_id` URL query parameters.

## Commands

Run from `web/`: `pnpm --filter @agenta/local lint`, `types:check`, `test`, and `build`.
