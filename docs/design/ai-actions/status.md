# Status

## Current State

### Completed

- **Research** — backend layering conventions, existing workflow invocation path, frontend integration surface for prompt authoring (Playground).
- **Design** — spec, plan, and context docs finalized.
- **Phase 1: Backend** — fully implemented and wired:
  - Configuration (`AIServicesConfig` in `api/oss/src/utils/env.py`) with four env vars; feature enabled only when all are present.
  - Core layer (`api/oss/src/core/ai_services/`):
    - DTOs (`dtos.py`): `ToolCallRequest`, `ToolCallResponse`, `RefinePromptArguments`, `ToolDefinition`, etc.
    - HTTP client (`client.py`): `AgentaAIServicesClient.invoke_deployed_prompt()` via httpx.
    - Service (`service.py`): `AIServicesService` with `status()`, `call_tool()`, `refine_prompt()` plus output extraction and validation.
  - API layer (`api/oss/src/apis/fastapi/ai_services/`):
    - `GET /preview/ai/services/status` — returns enabled flag + available tools.
    - `POST /preview/ai/services/tools/call` — executes a tool call.
  - Wiring in `api/entrypoints/routers.py`.
  - EE permission check (`EDIT_WORKFLOWS`) on both endpoints.
  - Rate limiting via `check_throttle` (burst 10 / refill 30 per min).
  - Input validation: max lengths on `RefinePromptArguments` fields.
  - Output validation: `_validate_refined_template` ensures valid JSON prompt template with messages array.

### In Progress

- **Phase 2: Frontend** — not started yet.

## Decisions

- REST-only implementation with an MCP-shaped tool-call contract (see `docs/design/ai-actions/spec.md`).
- Tool names are namespaced (Chapter 1 uses `tools.agenta.api.refine_prompt`).
- Env var prefix is `AGENTA_AI_SERVICES_*`.
- Rate limit is per-user + per-org composite key, 10 burst / 30 per minute.

## Open Questions

- Confirm the exact cloud invocation contract for calling the deployed prompt by slug + environment.

## Next

- Implement Phase 2: Frontend (status query, API client, "Refine prompt" button in Playground).
- Phase 3 hardening: structured logging for tool usage, trace_id propagation.
