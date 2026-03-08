# Claude Projection Layer

`application/.claude/` is the Claude-native projection layer.

Canonical shared agent guidance now lives in:

- `application/.agents/README.md`
- `application/.agents/policies/global.md`
- `application/.agents/registry/skills.md`
- `application/.agents/registry/agents.md`

Claude-native wrappers in this directory should remain thin and point back to the shared source in `.agents/`.
