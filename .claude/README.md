# Claude Projection Layer

`.claude/` is the Claude-native projection layer.

Canonical shared agent guidance now lives in:

- `.agents/README.md`
- `.agents/policies/global.md`
- `.agents/registry/skills.md`
- `.agents/registry/agents.md`

Claude-native wrappers in this directory should remain thin and point back to the shared source in `.agents/`.
