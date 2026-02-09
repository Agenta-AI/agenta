# Plan (Chapter 1)

Chapter 1 implements `tools.agenta.api.refine_prompt` behind a REST "tool call" API.

The contract is defined in `docs/design/ai-actions/spec.md`.

## Phase 0: Ops Setup (out of repo)

- Create internal org in cloud: `agenta-internal`.
- Create deployed prompt app: `ai-refine-prompt`.
- Configure Bedrock model + credentials inside the app.

## Phase 1: Backend (new stack)

### 1.1 Configuration

- Add env vars (presence enables AI services):
  - `AGENTA_AI_SERVICES_API_KEY`
  - `AGENTA_AI_SERVICES_API_URL`
  - `AGENTA_AI_SERVICES_ENVIRONMENT`
  - `AGENTA_AI_SERVICES_REFINE_PROMPT_APP`

### 1.2 Core

- Add `api/oss/src/core/ai_services/*`:
  - DTOs for `ToolCallRequest`, `ToolCallResponse`, and tool-specific args/results
  - `AgentaAIServicesClientInterface` (invoke deployed prompt via Agenta API)
  - `AIServicesService.refine_prompt(...)`

### 1.3 API

- Add `api/oss/src/apis/fastapi/ai_services/*`:
  - `GET /preview/ai/services/status`
  - `POST /preview/ai/services/tools/call`

### 1.4 Dependency Wiring

- Wire concrete implementations in `api/entrypoints/routers.py`.

### 1.5 Access control + rate limiting

- Reuse existing auth/session middleware (request.state user/org/project).
- In EE, require `EDIT_WORKFLOWS` for the refine prompt tool.
- Add a router-level rate limit (HTTP 429).

## Phase 2: Frontend

- Add a status query; hide/disable UI when `enabled=false`.
- Add "Refine prompt" entry point in prompt authoring UI (Playground prompt editor).
- Implement client in `web/oss/src/services/ai-services/api/index.ts`.

## Phase 3: Hardening

- Strict input validation (max prompt length; context length).
- Strict output validation (ensure `refined_prompt` present; otherwise `isError=true`).
- Add logging for tool usage; propagate optional `trace_id`.
