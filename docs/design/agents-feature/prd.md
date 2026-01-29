# PRD: Agents & Tools Feature

> **Status:** Ready for Review  
> **Last Updated:** 2026-01-29

## Executive Summary

Enable Agenta users to create AI agents with tool-calling capabilities directly in the Playground. Users can connect external services (Gmail, GitHub, Slack, etc.) via OAuth and use those tools in their prompts. This positions Agenta as a complete platform for building, testing, and evaluating agentic AI applications.

---

## Problem Statement

### Current State
- Agenta's Playground supports prompt engineering with various LLM providers
- Users can test prompts with different models and parameters
- **No support for tool-calling or agentic workflows**
- Users building agents must use external frameworks and lose Agenta's evaluation capabilities

### Pain Points
1. **Fragmented workflow**: Users prototype in Agenta but implement agents elsewhere
2. **No tool testing**: Can't test how prompts behave with real tools
3. **Evaluation gap**: Can't evaluate agent behavior (tool selection, execution quality)
4. **Integration complexity**: Setting up OAuth for tools is complex

### Opportunity
- Growing demand for agentic AI applications
- Competitors adding agent support
- Agenta's evaluation strength can differentiate in agent quality testing

---

## Goals

### Primary Goals
1. Enable tool-calling in the Playground with real external services
2. Provide seamless OAuth connection for 100+ integrations
3. Maintain Agenta's evaluation capabilities for agentic workflows
4. Keep the experience simple (no complex workflow builders)

### Non-Goals (Out of Scope for MVP)
- Visual workflow/graph builders (like Competitor A)
- Custom MCP server hosting
- Multi-agent orchestration
- Autonomous background agents
- Per-user tool connections (start with per-project)

---

## User Personas

### 1. Prompt Engineer (Primary)
**Profile:** Technical user who designs and iterates on prompts  
**Goals:** Test how prompts behave when given access to real tools  
**Pain:** Currently can't test tool-calling without building full applications

### 2. AI Developer (Secondary)
**Profile:** Developer building AI-powered applications  
**Goals:** Prototype agent behavior before implementing in code  
**Pain:** No way to quickly test different tool configurations

### 3. QA/Evaluation Lead (Secondary)
**Profile:** Responsible for AI quality and safety  
**Goals:** Evaluate agent behavior systematically  
**Pain:** No tooling to test agent decision-making at scale

---

## User Stories

### P0 - Must Have (MVP)

#### US-1: Browse Available Tools
> As a prompt engineer, I want to browse available tool integrations so that I can see what's possible to connect.

**Acceptance Criteria:**
- [ ] Tool browser modal shows all available integrations (90+)
- [ ] Integrations are categorized (Communication, Development, Productivity, etc.)
- [ ] Search/filter functionality works
- [ ] Each integration shows name, description, logo, and connection status
- [ ] Clear indication of which integrations require OAuth vs API key

#### US-2: Connect an Integration (OAuth)
> As a prompt engineer, I want to connect my Gmail account so that I can use email tools in my prompts.

**Acceptance Criteria:**
- [ ] "Connect" button opens OAuth flow in popup
- [ ] OAuth completes without leaving Agenta
- [ ] Connection status updates to "Connected" after OAuth success
- [ ] Error handling for OAuth failures (user denied, timeout)
- [ ] Connected integrations persist across sessions

#### US-3: Connect an Integration (API Key)
> As a prompt engineer, I want to connect Stripe using my API key so that I can use payment tools.

**Acceptance Criteria:**
- [ ] API key input form appears for API-key-based integrations
- [ ] API key is validated before saving
- [ ] Clear error messages for invalid keys
- [ ] API keys are stored securely (encrypted)

#### US-4: Add Tools to Playground
> As a prompt engineer, I want to add Gmail tools to my playground session so that the LLM can send emails.

**Acceptance Criteria:**
- [ ] Tool selector shows tools from connected integrations
- [ ] Can select multiple tools for a session
- [ ] Selected tools appear in the playground UI
- [ ] Tool schemas are shown (what inputs/outputs)
- [ ] Can remove tools from session

#### US-5: Execute Prompts with Tools
> As a prompt engineer, I want to run a prompt that uses tools so that I can see how the agent behaves.

**Acceptance Criteria:**
- [ ] LLM can request tool calls based on prompt
- [ ] Tool calls are executed against real services
- [ ] Tool call requests and responses are visible in UI
- [ ] Multi-turn conversations work (tool result → LLM → another tool)
- [ ] Errors from tool execution are handled gracefully

#### US-6: View Tool Execution in Traces
> As a prompt engineer, I want to see tool calls in the trace view so that I can debug agent behavior.

**Acceptance Criteria:**
- [ ] Tool calls appear as spans in traces
- [ ] Tool input parameters are visible
- [ ] Tool output/response is visible
- [ ] Tool execution time is tracked
- [ ] Failed tool calls show error details

#### US-7: Disconnect an Integration
> As a prompt engineer, I want to disconnect Gmail so that it's no longer available in my project.

**Acceptance Criteria:**
- [ ] "Disconnect" button available for connected integrations
- [ ] Confirmation dialog before disconnecting
- [ ] OAuth tokens are revoked on disconnect
- [ ] Tools from disconnected integration are removed from sessions

### P1 - Should Have

#### US-8: View Tool Documentation
> As a prompt engineer, I want to see detailed documentation for a tool so that I understand how to use it.

**Acceptance Criteria:**
- [ ] Tool detail view shows full description
- [ ] Input parameters are documented with types and descriptions
- [ ] Output format is documented
- [ ] Example usage is shown where available

#### US-9: Test Tool in Isolation
> As a prompt engineer, I want to test a tool directly (without LLM) so that I can verify it works.

**Acceptance Criteria:**
- [ ] "Test" button on each tool
- [ ] Form to input tool parameters
- [ ] Execute tool and see response
- [ ] Helpful for debugging connection issues

#### US-10: Manage Connections in Settings
> As a project admin, I want to manage all tool connections in project settings.

**Acceptance Criteria:**
- [ ] Settings page shows all connections
- [ ] Can see who created each connection and when
- [ ] Can disconnect from settings page
- [ ] Connection health status visible

### P2 - Nice to Have

#### US-11: Favorite/Pin Integrations
> As a prompt engineer, I want to pin frequently used integrations for quick access.

#### US-12: Connection Health Monitoring
> As a project admin, I want to be alerted when a connection expires or fails.

#### US-13: Tool Usage Analytics
> As a project admin, I want to see which tools are used most frequently.

#### US-14: Custom Tool Definitions
> As a developer, I want to define custom tools (without Composio) for internal APIs.

---

## Functional Requirements

### FR-1: Integration Catalog
- System shall maintain a catalog of available integrations from Composio
- Catalog shall be cached and refreshed periodically (1 hour TTL)
- Catalog shall include: name, slug, description, logo, categories, auth type

### FR-2: Connection Management
- System shall support OAuth 2.0 connections via Composio
- System shall support API key connections
- Connections shall be scoped to projects
- System shall store Composio account references (not raw tokens)
- System shall track connection status (PENDING, ACTIVE, FAILED, EXPIRED)

### FR-3: Tool Discovery
- System shall list available tools per integration
- System shall provide JSON Schema for tool inputs/outputs
- Tool schemas shall be compatible with OpenAI function calling format

### FR-4: Tool Execution
- System shall execute tools via Composio on behalf of connected accounts
- System shall handle tool execution errors gracefully
- System shall log all tool executions for observability

### FR-5: Playground Integration
- Playground shall allow selecting tools for a session
- Playground shall pass tool schemas to LLM
- Playground shall execute tool calls and return results to LLM
- Playground shall support multi-turn tool interactions

### FR-6: Observability
- Tool calls shall be captured as spans in traces
- Tool spans shall include: name, inputs, outputs, duration, status
- Failed tool calls shall include error details

---

## Non-Functional Requirements

### NFR-1: Performance
- Integration catalog load: < 500ms (cached)
- Tool list load: < 500ms (cached)
- OAuth initiation: < 2s
- Tool execution: Depends on external service (timeout: 30s)

### NFR-2: Security
- OAuth tokens stored by Composio (not in Agenta DB)
- API keys encrypted at rest in Agenta vault
- Connections isolated per project
- Audit trail for connection create/delete

### NFR-3: Reliability
- Graceful degradation if Composio unavailable
- Retry logic for transient failures
- Clear error messages for users

### NFR-4: Scalability
- Support 100+ integrations
- Support 1000+ tools per integration
- Support concurrent tool executions

---

## Technical Constraints

1. **Composio is Optional (Open Source)**: Agenta is open source, so Composio must be optional:
   - If `COMPOSIO_API_KEY` is not set, tools/integrations UI should be hidden or show "Not configured"
   - No hard dependency on Composio for core Agenta functionality
   - Self-hosted users can run Agenta without external tool integrations
   - Cloud users get full Composio integration out of the box
2. **Composio Dependency**: When enabled, feature depends on Composio availability and API stability
3. **OAuth Popup**: OAuth flow requires popup (some browsers may block)
4. **Rate Limits**: Composio and external services have rate limits
5. **Token Refresh**: Composio handles OAuth token refresh automatically

---

## Success Metrics

### Launch Metrics (First 30 Days)
- 50+ projects connect at least one integration
- 500+ tool executions
- < 5% OAuth failure rate

### Adoption Metrics (90 Days)
- 30% of active projects use tools
- Average 3 integrations per project using tools
- Tool-enabled prompts in 20% of evaluations

### Quality Metrics
- < 1% tool execution error rate (excluding external service errors)
- < 2s average OAuth flow completion time
- 95%+ user success rate for OAuth connections

---

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Composio API changes | High | Medium | Pin SDK version, monitor changelog |
| OAuth popup blocked | Medium | Medium | Provide fallback redirect flow |
| External service downtime | Medium | High | Clear error messages, retry UI |
| Token expiration | Medium | Medium | Composio auto-refresh, re-auth UI |
| Rate limiting | Low | Medium | Queue tool executions, show limits |

---

## Timeline

### Phase 1: Foundation (Week 1-2)
- [ ] Backend API for integrations and connections
- [ ] Database schema and migrations
- [ ] Composio client wrapper with caching

### Phase 2: UI - Connection Management (Week 3-4)
- [ ] Tool browser modal
- [ ] OAuth flow implementation
- [ ] API key connection form
- [ ] Project settings page for connections

### Phase 3: Playground Integration (Week 5-6)
- [ ] Tool selector in Playground
- [ ] Tool execution in chat flow
- [ ] Multi-turn conversation support
- [ ] Tool call visualization

### Phase 4: Observability & Polish (Week 7-8)
- [ ] Tool spans in traces
- [ ] Error handling improvements
- [ ] Performance optimization
- [ ] Documentation

---

## Open Questions

| Question | Status | Answer |
|----------|--------|--------|
| Should connections be per-project or per-org? | Decided | Per-project for MVP, extend to org later |
| How to handle rate limits from external services? | Open | TBD based on Composio guidance |
| Should we show tool cost estimates? | Open | Nice-to-have, depends on Composio data |
| How to handle tools that require additional config? | Open | Start with simple tools, extend later |

---

## Related Documents

- [API Design](./api-design.md) - Endpoint specifications
- [Data Model](./data-model.md) - Database schema
- [Composio OAuth Research](./pre-research/research-composio-oauth.md)
- [Competitive Analysis](./pre-research/research-scope.md)
- [Agent Frameworks Research](./pre-research/research-frameworks.md)
