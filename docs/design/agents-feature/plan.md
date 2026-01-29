# Execution Plan: Agents Feature

## Phase Summary

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Research | 2 days | ✅ Complete |
| Phase 2: Design | 1 day | ✅ Complete |
| Phase 3: Implementation | 6-8 weeks | 🔜 Ready to Start |
| Phase 4: Testing & Launch | 2 weeks | Pending |

---

## Phase 1: Research (Complete)

### 1.1 Scope Definition ✅
- [x] Define MVP boundaries
- [x] Identify what "agent" means in Agenta context
- [x] Document use cases and anti-use-cases
- [x] Competitive analysis (Competitors A, B, C - see research-scope.md)

### 1.2 Technology Research ✅
- [x] Research tools integration options (Composio, Arcade, ACI.dev)
- [x] Analyze playground requirements
- [x] Evaluate agent frameworks (LiteLLM recommended)
- [x] Deep dive on Composio OAuth flow
- [x] Reverse-engineer Competitor A's API patterns

### 1.3 PRD Completion ✅
- [x] Write user stories
- [x] Define acceptance criteria
- [x] Document functional requirements

**Deliverables:**
- `pre-research/research-scope.md`
- `pre-research/research-tools.md`
- `pre-research/research-playground.md`
- `pre-research/research-frameworks.md`
- `pre-research/research-composio-oauth.md`
- `pre-research/research-vellum-composio-api.md`

---

## Phase 2: Design (Complete)

### 2.1 API Design ✅
- [x] Define all endpoints
- [x] Design request/response schemas
- [x] Document OAuth flow sequence
- [x] Define error codes and responses
- [x] Plan caching strategy

### 2.2 Data Model Design ✅
- [x] Design database schema
- [x] Define SQLAlchemy models
- [x] Create DTOs and enums
- [x] Plan DAO interface
- [x] Write migration scripts

### 2.3 UI/UX Design ✅
- [x] Tool Browser Modal wireframes
- [x] OAuth flow UI states
- [x] API key connection form
- [x] Playground tool selector
- [x] Tool execution visualization
- [x] Settings page integrations

**Deliverables:**
- `api-design.md`
- `data-model.md`
- `ui-flow.md`
- `prd.md` (updated)

---

## Phase 3: Implementation (Ready to Start)

### 3.1 Backend Foundation (Week 1-2)

#### Week 1: Core Backend
- [ ] Create `tool_connections` table migration
- [ ] Implement `ToolConnectionDB` model
- [ ] Create enums: `ConnectionStatus`, `AuthType`
- [ ] Implement Composio client wrapper
  - [ ] `list_toolkits()` with caching
  - [ ] `get_toolkit(slug)` with caching
  - [ ] `list_tools(integration_slug)` with caching
  - [ ] `get_tool_schema(integration_slug, tool_slug)`
  - [ ] `initiate_connection(user_id, toolkit_slug, callback_url)`
  - [ ] `create_api_key_connection(user_id, toolkit_slug, api_key)`
  - [ ] `get_connection_status(connection_id)`
  - [ ] `delete_connection(connection_id)`

#### Week 2: API Layer
- [ ] Implement `ToolConnectionsDAO`
- [ ] Implement `ToolsService`
- [ ] Create `ToolsRouter` with endpoints:
  - [ ] `GET /api/tools/integrations`
  - [ ] `GET /api/tools/integrations/{slug}`
  - [ ] `GET /api/tools/integrations/{slug}/tools`
  - [ ] `GET /api/tools/integrations/{slug}/tools/{tool}`
  - [ ] `GET /api/tools/connections`
  - [ ] `POST /api/tools/connections`
  - [ ] `GET /api/tools/connections/{id}`
  - [ ] `DELETE /api/tools/connections/{id}`
- [ ] Add permission checks (EDIT_TOOLS permission)
- [ ] Write unit tests for all services

### 3.2 Frontend - Connection Management (Week 3-4)

#### Week 3: Tool Browser
- [ ] Create `IntegrationCard` component
- [ ] Create `ToolBrowser` modal component
- [ ] Implement integration catalog query atom
- [ ] Implement category filtering
- [ ] Implement search functionality
- [ ] Create integration detail view

#### Week 4: Connection Flow
- [ ] Implement OAuth popup hook (`useOAuthPopup`)
- [ ] Implement OAuth completion polling
- [ ] Create API key connection form
- [ ] Create connection success/error states
- [ ] Implement disconnect confirmation
- [ ] Add Settings page integrations tab
- [ ] Write integration tests

### 3.3 Playground Integration (Week 5-6)

#### Week 5: Tool Selection
- [ ] Add tools section to Playground UI
- [ ] Create `ToolSelector` component
- [ ] Implement `selectedToolsAtom`
- [ ] Show tool schemas in UI
- [ ] Convert tool schemas to OpenAI function format

#### Week 6: Tool Execution
- [ ] Implement tool execution in chat flow
- [ ] Handle tool call requests from LLM
- [ ] Execute tools via Composio
- [ ] Return tool results to LLM
- [ ] Support multi-turn tool conversations
- [ ] Create `ToolCallCard` component for visualization
- [ ] Handle tool execution errors gracefully

### 3.4 Observability & Polish (Week 7-8)

#### Week 7: Observability
- [ ] Add tool call spans to traces
- [ ] Include tool inputs in spans
- [ ] Include tool outputs in spans
- [ ] Track tool execution duration
- [ ] Show tool errors in spans
- [ ] Verify traces display correctly

#### Week 8: Polish
- [ ] Error handling improvements
- [ ] Loading state optimizations
- [ ] Cache warming strategies
- [ ] Performance testing
- [ ] Accessibility audit
- [ ] Documentation updates
- [ ] E2E tests

---

## Phase 4: Testing & Launch (Week 9-10)

### 4.1 Testing
- [ ] Unit test coverage > 80%
- [ ] Integration tests for all flows
- [ ] E2E tests for critical paths
- [ ] Load testing for concurrent tool executions
- [ ] Security review

### 4.2 Beta Release
- [ ] Feature flag implementation
- [ ] Beta user selection
- [ ] Collect feedback
- [ ] Bug fixes

### 4.3 GA Release
- [ ] Remove feature flag
- [ ] Announcement preparation
- [ ] Documentation finalization
- [ ] Support team training

---

## Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| Research complete | 2026-01-29 | ✅ Done |
| Design complete | 2026-01-29 | ✅ Done |
| Backend foundation | Week 2 | Pending |
| Frontend connections | Week 4 | Pending |
| Playground integration | Week 6 | Pending |
| MVP ready | Week 8 | Pending |
| Beta release | Week 9 | Pending |
| GA release | Week 10 | Pending |

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Composio API key | Needed | Required for all Composio API calls |
| Composio SDK | Available | Python package: `composio` |
| LiteLLM | Exists | Already used in Agenta |
| Database migration | Ready | Schema designed |

---

## Risk Mitigation

| Risk | Mitigation | Owner |
|------|------------|-------|
| Composio API changes | Pin SDK version, monitor changelog | Backend |
| OAuth popup blocked | Fallback redirect flow | Frontend |
| Rate limits | Queue tool executions, show user feedback | Backend |
| Token expiration | Composio auto-refresh, re-auth UI | Both |

---

## Related Documents

- [PRD](./prd.md) - Product requirements
- [API Design](./api-design.md) - Endpoint specifications
- [Data Model](./data-model.md) - Database schema
- [UI Flow](./ui-flow.md) - UI components
- [Status](./status.md) - Current progress
