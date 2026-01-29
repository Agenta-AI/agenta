# Status: Agents Feature

> Last updated: 2026-01-29

## Current Phase

**Design Complete → Ready for Implementation**

## What's Done

### Research Phase (Complete)
- [x] Created planning workspace scaffold
- [x] Defined initial research areas
- [x] **Scope & competitive analysis** - Competitor A, B, C, D, E, F (see research-scope.md for mapping)
- [x] **API documentation** - Detailed API analysis for Competitors A, B, C
- [x] **Tools integration research** - Composio (recommended), Arcade, ACI.dev evaluated
- [x] **Composio OAuth deep dive** - Data model, API, OAuth flow, frontend patterns
- [x] **Playground analysis** - Tool support already exists, identified gaps
- [x] **Agent frameworks** - LiteLLM + custom loop recommended (~200 LOC)
- [x] **Competitor A API reverse-engineering** - Captured their Composio integration patterns

### Design Phase (Complete)
- [x] **API Design** - Full endpoint specification with request/response schemas
- [x] **Data Model** - Database schema, SQLAlchemy models, DTOs, migrations
- [x] **PRD** - User stories, functional requirements, acceptance criteria
- [x] **UI Flow** - Tool browser modal, OAuth flow, Playground integration, Settings page

## Key Decisions Made

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-29 | Start with research phase | Feature scope unclear, need exploration |
| 2026-01-29 | Recommend Composio for tool integrations | 800+ tools, MIT license, managed OAuth, meta-tool pattern |
| 2026-01-29 | Build minimal agent loop on LiteLLM | Full control, zero new deps, perfect observability |
| 2026-01-29 | Tools scoped per project | Simpler than per-user, can extend to org later |
| 2026-01-29 | OAuth popup flow | Standard pattern, Composio provides hosted OAuth page |

## Design Summary

### API Endpoints (8 total)
| Endpoint | Purpose |
|----------|---------|
| `GET /api/tools/integrations` | List integrations with connection status |
| `GET /api/tools/integrations/{slug}` | Get integration details |
| `GET /api/tools/integrations/{slug}/tools` | List tools for integration |
| `GET /api/tools/integrations/{slug}/tools/{tool}` | Get tool JSON Schema |
| `GET /api/tools/connections` | List project connections |
| `POST /api/tools/connections` | Create connection (OAuth/API key) |
| `GET /api/tools/connections/{id}` | Get connection status |
| `DELETE /api/tools/connections/{id}` | Disconnect |

### Data Model
- **ToolConnectionDB** - Links project to Composio connected account
- Fields: project_id, integration_slug, composio_account_id, status, auth_type
- Unique constraint: one connection per integration per project

### UI Components
1. **Tool Browser Modal** - Browse and connect 90+ integrations
2. **OAuth Flow** - Popup-based OAuth with completion polling
3. **Playground Tool Selector** - Select tools for session
4. **Tool Execution Cards** - Visualize tool calls in chat
5. **Settings Page** - Manage project connections

## Next Steps (Implementation)

### Phase 1: Foundation (Week 1-2)
- [ ] Create `tool_connections` table migration
- [ ] Implement Composio client wrapper with caching
- [ ] Implement ToolConnectionsDAO
- [ ] Implement ToolsService
- [ ] Create ToolsRouter with all endpoints
- [ ] Add unit tests

### Phase 2: UI - Connection Management (Week 3-4)
- [ ] Tool Browser Modal component
- [ ] OAuth flow hook and utilities
- [ ] API key connection form
- [ ] Settings page integrations tab
- [ ] Integration tests

### Phase 3: Playground Integration (Week 5-6)
- [ ] Tool selector in Playground
- [ ] Tool schema conversion for LLM
- [ ] Tool execution in chat flow
- [ ] Multi-turn tool conversations
- [ ] Tool call visualization

### Phase 4: Polish (Week 7-8)
- [ ] Tool spans in traces (observability)
- [ ] Error handling improvements
- [ ] Performance optimization
- [ ] Documentation
- [ ] E2E tests

## Blockers

None currently.

## Open Questions (Resolved)

| Question | Answer |
|----------|--------|
| What's the minimum viable agent? | Prompt + tools + execution loop + tracing |
| Build vs. integrate tools? | Integrate (Composio), build agent loop |
| Framework needed? | No, build minimal on LiteLLM |
| Tool calling UX? | Extend existing dropdown + add browser modal |
| Per-user or per-project connections? | Per-project for MVP |

## Files in This Design

```
docs/design/agents-feature/
├── README.md                 # Index
├── context.md                # Background & goals
├── prd.md                    # Product requirements (COMPLETE)
├── plan.md                   # Execution phases
├── status.md                 # This file
├── api-design.md             # API specification (NEW)
├── data-model.md             # Database schema (NEW)
├── ui-flow.md                # UI components & flows (NEW)
└── pre-research/             # Completed research
    ├── research-scope.md
    ├── research-tools.md
    ├── research-playground.md
    ├── research-frameworks.md
    ├── research-composio-oauth.md
    └── research-vellum-composio-api.md
```
