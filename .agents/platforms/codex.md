# Codex Platform Projection

For Codex, the native repo entrypoint is:

- `AGENTS.md`

That file should remain a thin bootstrap wrapper.

The shared source lives in:

- `.agents/README.md`
- `.agents/policies/global.md`
- `.agents/registry/knowledge.md`
- `.agents/registry/skills.md`
- `.agents/registry/agents.md`

## Current shape

- `AGENTS.md` = Codex/native bootstrap wrapper
- `.agents/` = shared internal-agent surface
- `.codex/skills/` = project-local Codex skill discovery (relative symlinks into `.agents/skills/`)
- `.claude/` = Claude-native projection layer

Codex should use `AGENTS.md` only as the entrypoint and then continue into `.agents/`.

## Skill discovery

Codex discovers skills via `.codex/skills/<name>` symlinks pointing at `../../.agents/skills/<name>`. The links are relative, so they stay valid across worktrees and clones. Do not install these skills into `~/.codex/skills/` — keep discovery project-local.
