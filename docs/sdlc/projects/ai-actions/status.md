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
    - `GET /ai/services/status` — returns enabled flag + available tools.
    - `POST /ai/services/tools/call` — executes a tool call.
  - Wiring in `api/entrypoints/routers.py`.
  - EE permission check (`EDIT_WORKFLOWS`) on both endpoints.
  - Rate limiting via `check_throttle` (burst 10 / refill 30 per min).
  - Input validation: max lengths on `RefinePromptArguments` fields.
  - Output validation: `_validate_messages` ensures well-formed messages array with role+content.
- **Phase 2: Frontend** — core implementation complete:
  - **Phase 2.1 Foundation** — completed:
    - Installed `@ant-design/x` for Bubble components
    - Created `web/oss/src/services/aiServices/api.ts` - API client
    - Created `RefinePromptModal/types.ts` - TypeScript interfaces
    - Created `RefinePromptModal/store/refinePromptStore.ts` - Jotai atoms with atomFamily
  - **Phase 2.2 Modal Shell** — completed:
    - Created `RefinePromptModal/index.tsx` - Main modal component with EnhancedModal
    - Created `RefinePromptModal/assets/RefinePromptModalContent.tsx` - Two-column layout
  - **Phase 2.3 Instructions Panel** — completed:
    - Created `RefinePromptModal/assets/InstructionsPanel.tsx` - Left panel with @ant-design/x Bubble component
    - Chat-like display for guidelines and AI explanations
    - Input area with auto-resize text area
  - **Phase 2.4 Preview Panel** — completed:
    - Created `RefinePromptModal/assets/PreviewPanel.tsx` - Right panel with editable prompt
    - MessageEditor integration for editing refined messages
    - DiffView toggle for comparing original vs refined prompt
  - **Phase 2.5 Integration** — completed:
    - Added magic wand icon (lucide-react Wand2) to PlaygroundVariantConfigPromptCollapseHeader
    - Tooltip on hover: "Refine prompt with AI"
    - Modal opens on click with current prompt context
  - **Phase 2.6 Refinement Hook** — completed:
    - Created `RefinePromptModal/hooks/useRefinePrompt.ts`
    - Extracts prompt template from enhanced prompts
    - Calls refine API and updates working prompt state
    - Manages iterations history and loading state

### In Progress

- **Phase 2.7 Polish & Edge Cases**:
  - [x] Implement "Use refined prompt" button to apply changes to playground state
  - [x] Check AI services status before showing magic wand icon
  - [x] Cmd+Enter keyboard shortcut for submitting refinement
  - [x] Replaced Input.TextArea with @ant-design/x Sender + Prompts components
  - [x] Simplified output schema: removed redundant `refined_prompt` field, added `summary` field
  - [ ] Add error handling and toast notifications
  - [ ] Handle empty prompt edge cases

## Decisions

- REST-only implementation with an MCP-shaped tool-call contract (see `docs/design/ai-actions/spec.md`).
- Tool names are namespaced (Chapter 1 uses `tools.agenta.api.refine_prompt`).
- Env var prefix is `AGENTA_AI_SERVICES_*`.
- Rate limit is per-user + per-org composite key, 10 burst / 30 per minute.
- State modeled as `RefinementIteration[]` (not chat messages) - each iteration has `guidelines` (user input) and `explanation` (AI response summary).
- Working prompt is iteratively refined - each refinement uses the previous result as starting point.
- Output schema uses `messages` + `summary` (no redundant `refined_prompt` string). The `summary` is a short human-readable description of what changed, displayed in the chat bubbles.

## Open Questions

- Confirm the exact cloud invocation contract for calling the deployed prompt by slug + environment.

## Next

- Complete Phase 2.7: Polish & edge cases.
- Phase 3 hardening: structured logging for tool usage, trace_id propagation.
- Consider adding AI services status check to conditionally show the magic wand icon.
