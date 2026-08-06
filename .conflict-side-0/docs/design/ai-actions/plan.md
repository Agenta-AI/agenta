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
  - `GET /ai/services/status`
  - `POST /ai/services/tools/call`

### 1.4 Dependency Wiring

- Wire concrete implementations in `api/entrypoints/routers.py`.

### 1.5 Access control + rate limiting

- Reuse existing auth/session middleware (request.state user/org/project).
- In EE, require `EDIT_WORKFLOWS` for the refine prompt tool.
- Add a router-level rate limit (HTTP 429).

## Phase 2: Frontend

Full specification in `docs/design/ai-actions/frontend-spec.md`.

### 2.1 Foundation (API + State)

- Create `web/oss/src/services/aiServices/api.ts` - API client with `getStatus()` and `refinePrompt()`
- Create `RefinePromptModal/store/refinePromptStore.ts` - Jotai atoms for modal state
- Create `RefinePromptModal/types.ts` - TypeScript interfaces

### 2.2 Modal Shell

- Create `RefinePromptModal/index.tsx` - Modal wrapper using `EnhancedModal`
- Create `RefinePromptModalContent.tsx` - Two-column layout (like CommitModal)
- Header: title, diff toggle, close button
- Footer: Cancel and "Use refined prompt" buttons

### 2.3 Instructions Panel (Left Column)

- `InstructionsPanel/index.tsx` - Container with header + chat + input
- `ChatHistory.tsx` - Scrollable message list
- `ChatMessage.tsx` - User messages (right-aligned, gray bg) vs AI messages (left-aligned)
- `ChatInput.tsx` - Text input + send button (PaperPlaneTilt icon)

### 2.4 Preview Panel (Right Column)

- `PreviewPanel/index.tsx` - Container for preview content
- `PreviewHeader.tsx` - "Refine prompt" title + Diff toggle switch
- `EmptyState.tsx` - Initial state before first refinement
- `LoadingState.tsx` - Skeleton loading during API call
- `RefinedPromptView.tsx` - Editable messages using `MessageEditor` or `DiffView`

### 2.5 Integration

- Modify `PlaygroundVariantConfigPromptCollapseHeader.tsx` - Add magic wand icon button
- Check AI services status to conditionally show/hide icon
- Wire modal open state
- Implement "Use refined prompt" action to update playground via molecule reducers

### 2.6 Refinement Hook

- Create `useRefinePrompt.ts` - Hook for API calls + iterative refinement logic
- Manage chat history and loading states
- Handle errors gracefully

## Phase 3: Hardening

- Strict input validation (max prompt length; context length).
- Strict output validation (ensure `messages` array is well-formed; otherwise `isError=true`).
- Add logging for tool usage; propagate optional `trace_id`.
