# LLM Judge and Chat/Completion Runtime Unification

Planning workspace for unifying the runtime pieces used by LLM-as-a-judge and chat/completion while preserving existing evaluator contracts. The immediate goal is to let LLM-as-a-judge use every configured model, including custom/self-hosted models added through the UI, without changing its flat config shape or result shape.

## Files

- `context.md` - Background, goals, non-goals, and scope clarification.
- `research.md` - Codebase findings, relevant files, and current flow differences.
- `plan.md` - Phased implementation plan.
- `implementation-notes.md` - Concrete backend/frontend changes and compatibility notes.
- `qa.md` - Validation scenarios and test coverage.
- `status.md` - Current progress, decisions, blockers, and next steps.
