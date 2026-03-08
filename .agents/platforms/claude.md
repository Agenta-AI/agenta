# Claude Platform Projection

`application/.claude/` is the Claude-native projection layer.

It should contain only what Claude tooling still expects natively:

- wrapper entry files
- wrapper skill files
- wrapper agent files
- other Claude-specific assets if needed later

## Current mapping

### Root wrappers

- `application/CLAUDE.md` -> bootstrap wrapper into `.agents/`
- `application/.claude/README.md` -> Claude projection overview

### Agent wrappers

- `application/.claude/agents/changelog-editor.md` -> `application/.agents/agents/changelog-editor.md`

### Skill wrappers

- `application/.claude/skills/add-announcement/SKILL.md` -> `application/.agents/skills/add-announcement.md`
- `application/.claude/skills/create-changelog-announcement/SKILL.md` -> `application/.agents/skills/create-changelog-announcement.md`
- `application/.claude/skills/update-api-docs/SKILL.md` -> `application/.agents/skills/update-api-docs.md`
- `application/.claude/skills/update-llm-model-list/SKILL.md` -> `application/.agents/skills/update-llm-model-list.md`
- `application/.claude/skills/write-social-announcement/SKILL.md` -> `application/.agents/skills/write-social-announcement.md`

The shared source should evolve in `.agents/`.

The Claude files should adapt to it rather than becoming the primary source.
