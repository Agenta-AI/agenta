# Status: Agents Feature

> Last updated: 2026-01-29

## Current Phase

**Research Complete → Ready for Design**

## What's Done

- [x] Created planning workspace scaffold
- [x] Defined initial research areas
- [x] **Scope & competitive analysis** - Orq.ai, Vellum, Humanloop, LangSmith, Langfuse, Portkey
- [x] **API documentation** - Detailed API analysis for Orq.ai, Vellum, Humanloop
- [x] **Tools integration research** - Composio (recommended), Arcade, ACI.dev evaluated
- [x] **Composio OAuth deep dive** - Data model, API, OAuth flow, frontend patterns
- [x] **Playground analysis** - Tool support already exists, identified gaps
- [x] **Agent frameworks** - LiteLLM + custom loop recommended (~200 LOC)

## Key Decisions Made

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-29 | Start with research phase | Feature scope unclear, need exploration |
| 2026-01-29 | Recommend Composio for tool integrations | 800+ tools, MIT license, managed OAuth, meta-tool pattern |
| 2026-01-29 | Build minimal agent loop on LiteLLM | Full control, zero new deps, perfect observability |
| 2026-01-29 | Tools scoped per organization | Simpler than per-user, can extend later |

## Research Summary

### Tool Integration
- **Winner: Composio** - MIT license, 26.5k stars, 800+ tools, handles OAuth
- Alternatives: Arcade (MCP-focused), ACI.dev (fully OSS)
- Custom MCPs not supported by Composio (one-way provider)

### Agent Framework  
- **Winner: Build custom on LiteLLM** (~200 lines)
- Alternative: Pydantic AI if need more features later
- Avoid: LangChain (competitor), heavy frameworks

### Playground
- Tool support already exists (PlaygroundTool, tools.specs.json)
- Missing: External tool browser, multi-turn execution, OAuth flow UI

### Competitive Landscape
- Vellum: Visual workflow builder (complex)
- Orq.ai: API-first, A2A protocol
- Humanloop: Evaluation-focused
- **Agenta opportunity**: Simple UI + strong evaluation

## Next Steps

1. **Design API** - Tools management, connections, agent execution
2. **Design UI** - Tool browser modal, connection management
3. **Write PRD** - User stories based on research
4. **Architecture** - Data models, backend endpoints

## Open Questions (Resolved)

| Question | Answer |
|----------|--------|
| What's the minimum viable agent? | Prompt + tools + execution loop + tracing |
| Build vs. integrate tools? | Integrate (Composio), build agent loop |
| Framework needed? | No, build minimal on LiteLLM |
| Tool calling UX? | Extend existing dropdown + add browser modal |

## Blockers

None currently.
