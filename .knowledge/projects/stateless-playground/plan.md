# Execution Plan: Stateless Playground

## Overview

This plan implements a project level stateless playground by reusing the existing Playground UI and swapping bindings via a small adapter layer.

---

## Phase 0: Create A Binding Seam (Week 1)

Goal: make the existing Playground UI consume an explicit "bindings" object so we can plug in either (a) the app scoped bindings that exist today or (b) a stateless draft bindings.

Tasks:
- [ ] Identify the minimal set of atoms and actions the UI needs (inputs: schema, uri, prompt config, testcases; outputs: generations)
- [ ] Introduce a bindings provider (React context or a top level atom) that the UI reads from
- [ ] Implement the existing app scoped bindings as the default adapter so current route stays working

Notes:
- Do not change user facing behavior for the existing app playground.
- Do not mount URL sync for stateless mode (see Phase 2).

---

## Phase 1: Project Level Route (Week 1)

### 1.1 Create Page and Routing

**Goal**: New page accessible at project level

**Tasks**:
- [ ] Create page at `web/oss/src/pages/w/[workspace_id]/p/[project_id]/playground/index.tsx`
- [ ] Add sidebar navigation entry in `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx` (project section)
- [ ] Set up basic page structure with layout

**Files to create/modify**:
```
web/oss/src/pages/w/[workspace_id]/p/[project_id]/playground/index.tsx  (NEW)
web/oss/src/components/Sidebar/components/ListOfApps.tsx  (MODIFY - add entry)
```

### 1.2 Stateless Session State

**Goal**: Ephemeral draft state with no persistence

**Tasks**:
- [ ] Implement a stateless bindings adapter backed by in-memory atoms
- [ ] Store prompt messages and model config as draft only
- [ ] Use loadable bridge in local mode for testcases
- [ ] No server sync and no URL snapshot (pure in-memory)

Implementation note:
- Prefer placing stateless bindings near existing Playground state (so the adapter can reuse helpers and types).

State shape (conceptual):
- `mode`: completion (v1), later chat
- `draftPrompt`: messages + llm config + template format
- `loadableId`: fixed local loadable id for testcase rows
- `uriInfo`: fixed to service routes (`/services/completion`)
- `schema`: service OpenAPI spec (fetched via service schema atoms)

---

## Phase 2: Wire Existing Playground UI (Week 1-2)

### 2.1 Stateless Page Uses Playground UI

Goal: render the existing Playground UI with stateless bindings.

**Tasks**:
- [ ] Reuse `web/oss/src/components/Playground/Playground.tsx` as much as possible
- [ ] Ensure stateless mode does not show variant selection, commit, or save actions
- [ ] Ensure stateless mode does not mount `playgroundSyncAtom` or any URL synchronization

### 2.2 Implement Test Case Management

Goal: add/edit testcases using loadable bridge local mode.

**Tasks**:
- [ ] Set up loadable in local mode
- [ ] Create test case table/grid UI
- [ ] Implement add row, edit row, delete row
- [ ] Derive columns from prompt variables

**Reuse**:
- `loadableBridge` from `@agenta/entities/loadable`
- Existing test case cell renderers

### 2.3 Implement Output Display

**Goal**: Show execution results

**Tasks**:
- [ ] Reuse `GenerationCompletion` or `GenerationChat` components
- [ ] Adapt to stateless state structure
- [ ] Display latency, tokens, cost from response

---

## Phase 3: Execution (Week 2)

### 3.1 Adapt Web Worker Integration

Goal: execute prompts against the shared completion service.

**Tasks**:
- [ ] Ensure request uses service uri and service schema (not app variant uri)
- [ ] Ensure the worker does not append `application_id` for stateless runs
- [ ] Always include `project_id` query param (required for vault)
- [ ] Build request payload from draft prompt state and the selected testcase row
- [ ] Store results back into the same state used by existing generation components

**Key Changes**:
```typescript
// Instead of URI from variant:
const uri = {
  runtimePrefix: getCompletionServiceUrl(),  // e.g., /services/completion
  routePath: 'completion'  // or 'chat'
}

// Request body:
{
  ag_config: {
    prompt: {
      messages: [...],
      llm_config: {...},
      template_format: 'fstring'
    }
  },
  inputs: { /* from test case */ }
}
```

### 3.2 Handle Response

**Goal**: Parse and display results

**Tasks**:
- [ ] Extract output data from response
- [ ] Extract metrics (duration, tokens, cost)
- [ ] Store results in loadable bridge execution results
- [ ] Handle streaming responses (if supported)

---

## Phase 4: Polish (Week 3)

### 4.1 Mode Toggle

Goal: support both completion and chat modes.

**Tasks**:
- [ ] Add mode toggle in header (completion/chat)
- [ ] Adjust UI based on mode (chat history vs single turn)
- [ ] Use appropriate service endpoint based on mode

### 4.2 Error Handling

**Goal**: Graceful error states

**Tasks**:
- [ ] Handle network errors
- [ ] Handle LLM API errors
- [ ] Handle missing vault secrets
- [ ] Display helpful error messages

### 4.3 UX Polish

**Goal**: Production-ready experience

**Tasks**:
- [ ] Loading states
- [ ] Empty states
- [ ] Keyboard shortcuts (Cmd+Enter to run)
- [ ] Mobile responsiveness (if applicable)

### 4.4 Documentation

**Goal**: User-facing documentation

**Tasks**:
- [ ] Update docs site with playground page
- [ ] Add tooltips/help text in UI
- [ ] Add onboarding hints for new users

---

## Future Enhancements (Out of Scope)

These are explicitly out of scope for initial implementation:

1. **Import from Trace**: Load prompt from a trace span
2. **Export to App**: "Save as App" functionality  
3. **Share Link**: URL-based state sharing
4. **Variant Comparison**: Side-by-side comparison mode
5. **Evaluation**: Run evaluations on test cases

---

## Dependencies

### Backend Dependencies
- Completion service must support `/test` endpoint with inline config ✅ (already exists)
- Vault must allow project-level access without app ✅ (already works)

### Frontend Dependencies
- Loadable bridge must support local mode ✅ (already exists)
- Completion service URL must be configurable ⚠️ (need to verify)

---

## Testing Strategy

### Unit Tests
- State atom behavior
- Request payload transformation
- Response parsing

### Integration Tests
- Full execution flow (UI → Worker → Service → Response → UI)
- Error scenarios

### Manual Testing
- Various prompt configurations
- Multiple test cases
- Different model providers
- Network error simulation

---

## Rollout Plan

1. **Alpha**: Behind feature flag, internal testing
2. **Beta**: Enabled for select users/workspaces
3. **GA**: Full rollout with documentation

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Page load time | < 1s |
| Execution latency overhead | < 100ms |
| Error rate | < 1% |
| User adoption | Track via analytics |
