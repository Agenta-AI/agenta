# AI Services (Tool Calls)

This workspace specifies a REST API for "tool call"-shaped AI services.

Chapter 1 implements a single tool:

- Refine Prompt (`tools.agenta.api.refine_prompt`)

The backend calls a deployed prompt in an internal Agenta org (Bedrock credentials live in the Agenta app config, not backend env vars).

## Files

- `docs/design/ai-actions/context.md` - Problem statement, goals/non-goals, constraints
- `docs/design/ai-actions/spec.md` - API + tool contract (request/response schemas)
- `docs/design/ai-actions/plan.md` - Implementation plan (Chapter 1)
- `docs/design/ai-actions/research.md` - Codebase findings and relevant reference points
- `docs/design/ai-actions/status.md` - Living decisions, open questions, and progress log
- `docs/design/ai-actions/frontend-spec.md` - Frontend implementation specification (UI, components, state, flows)
