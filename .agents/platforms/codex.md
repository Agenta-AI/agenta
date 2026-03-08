# Codex Platform Projection

For Codex, the native repo entrypoint is:

- `application/AGENTS.md`

That file should remain a thin bootstrap wrapper.

The shared source lives in:

- `application/.agents/README.md`
- `application/.agents/policies/global.md`
- `application/.agents/registry/knowledge.md`
- `application/.agents/registry/skills.md`
- `application/.agents/registry/agents.md`

## Current shape

- `AGENTS.md` = Codex/native bootstrap wrapper
- `.agents/` = shared internal-agent surface
- `.claude/` = Claude-native projection layer

Codex should use `AGENTS.md` only as the entrypoint and then continue into `.agents/`.
