# Context

## Problem

We want to ship a simple, non-agentic AI enhancement for prompt authoring.

Chapter 1 ships a single AI "tool":

1. Refine Prompt (`tools.agenta.api.refine_prompt`)

They must be:

- non-agentic
- single-step
- no orchestration

This must also serve as a foundation for future tools (first-party and third-party).

## Architecture Constraint

The backend does **not** call the LLM provider directly.

Instead, the backend calls a **deployed prompt** in an **internal Agenta org** via the Agenta API / completion service.

- Bedrock credentials live in the Agenta app config (internal org)
- Backend needs only an Agenta API key to call the deployed prompt

## Goals

- Add backend endpoints in the **new FastAPI stack** (`api/oss/src/apis/fastapi/*` + `api/oss/src/core/*`).
- Use a stable tool-call contract: `name` + `arguments` in, `content` + `structuredContent` out.
- Feature-flag by env vars; when not configured, UI hides/disables the tool.
- Non-agentic and single-step; no streaming.

## Non-goals (Chapter 1)

- Multi-step agents and orchestration
- User consent UX (modal/toggles)
- Per-user billing / metering
- User-provided model credentials

## Resolved Questions

- **Cloud invocation contract**: `POST {API_URL}/services/completion/run` with `{"inputs": {...}, "environment": "...", "app": "..."}` and `Authorization: ApiKey ...` header. Response is `{"data": "<json-string>", "trace_id": "..."}`.
- **Rate limit policy**: Composite key per user + per org, 10 burst / 30 per minute refill.
