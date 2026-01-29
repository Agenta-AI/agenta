# Agents Feature in Agenta

Research and planning workspace for adding agent capabilities to Agenta - enabling users to create, configure, and use AI agents with external tools through the UI.

## Quick Links

| Document | Description |
|----------|-------------|
| [PRD](./prd.md) | User stories and requirements |
| [API Design](./api-design.md) | Backend endpoint specifications |
| [Data Model](./data-model.md) | Database schema and DTOs |
| [UI Flow](./ui-flow.md) | UI components and interactions |
| [Status](./status.md) | Current progress |
| [Plan](./plan.md) | Execution timeline |

## Status

**Phase:** Design Complete → Ready for Implementation

## Files

### Core Planning
- **[context.md](./context.md)** - Background, motivation, problem statement, goals, and non-goals
- **[prd.md](./prd.md)** - Product requirements, user stories, acceptance criteria
- **[plan.md](./plan.md)** - High-level execution plan and milestones
- **[status.md](./status.md)** - Current progress, blockers, and decisions

### Design Documents
- **[api-design.md](./api-design.md)** - REST API specification with 8 endpoints
- **[data-model.md](./data-model.md)** - Database schema, SQLAlchemy models, DTOs
- **[ui-flow.md](./ui-flow.md)** - Tool browser modal, OAuth flow, Playground integration

### Pre-Research (Completed)
Located in `pre-research/`:
- **[research-scope.md](./pre-research/research-scope.md)** - Feature scope, competitive analysis, API documentation
- **[research-tools.md](./pre-research/research-tools.md)** - Tool integration platforms (Composio, Arcade, ACI.dev)
- **[research-playground.md](./pre-research/research-playground.md)** - Current playground architecture, tool data model
- **[research-frameworks.md](./pre-research/research-frameworks.md)** - Agent frameworks evaluation (LiteLLM, Pydantic AI, etc.)
- **[research-composio-oauth.md](./pre-research/research-composio-oauth.md)** - Deep dive on Composio OAuth flow and connection management
- **[research-competitor-a-composio-api.md](./pre-research/research-competitor-a-composio-api.md)** - Reverse-engineered Competitor A's Composio API integration

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Use **Composio** for tool integrations | 800+ tools, MIT license, managed OAuth |
| Build **custom agent loop on LiteLLM** | Full control, zero new deps, ~200 lines |
| Tools scoped **per project** | Simpler than per-user, can extend later |
| **OAuth popup flow** | Standard pattern, Composio provides hosted page |

## Summary

Enable Agenta users to connect external services (Gmail, GitHub, Slack, etc.) and use those tools in Playground prompts. The MVP includes:

1. **Tool Browser** - Browse 90+ integrations, connect via OAuth or API key
2. **Playground Integration** - Select tools, execute tool calls, visualize results
3. **Settings Management** - View and manage project connections
4. **Observability** - Tool calls captured as spans in traces

Estimated timeline: 8-10 weeks to GA.
