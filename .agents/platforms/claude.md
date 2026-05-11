# Claude Platform Projection

`.claude/` is the Claude-native projection layer.

It should contain only what Claude tooling still expects natively:

- wrapper entry files
- wrapper skill files
- wrapper agent files
- other Claude-specific assets if needed later

## Current mapping

### Root wrappers

- `CLAUDE.md` -> bootstrap wrapper into `.agents/`
- `.claude/README.md` -> Claude projection overview

### Agent wrappers

- `.claude/agents/changelog-editor.md` -> `.agents/agents/changelog-editor.md`

### Skill wrappers

- `.claude/skills/add-announcement/SKILL.md` -> `.agents/skills/add-announcement/SKILL.md`
- `.claude/skills/create-changelog-announcement/SKILL.md` -> `.agents/skills/create-changelog-announcement/SKILL.md`
- `.claude/skills/update-api-docs/SKILL.md` -> `.agents/skills/update-api-docs/SKILL.md`
- `.claude/skills/update-llm-model-list/SKILL.md` -> `.agents/skills/update-llm-model-list/SKILL.md`
- `.claude/skills/write-social-announcement/SKILL.md` -> `.agents/skills/write-social-announcement/SKILL.md`

The findings-driven skills (`scan-codebase`, `test-codebase`, `sync-findings`, `triage-findings`, `resolve-findings`) live in `.agents/skills/<name>/SKILL.md` and do not currently have Claude-native wrappers — they can be invoked directly from the shared source.

The shared source should evolve in `.agents/`.

The Claude files should adapt to it rather than becoming the primary source.
