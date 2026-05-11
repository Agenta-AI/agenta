# Claude Platform Projection

`.claude/` is the Claude-native projection layer.

It should contain only what Claude tooling still expects natively:

- bootstrap entry files
- project-local skill discovery links
- wrapper agent files, if needed later
- other Claude-specific assets if needed later

## Current Mapping

### Root Bootstrap

- `CLAUDE.md` -> bootstrap wrapper into `.agents/`
- `.claude/README.md` -> Claude projection overview

### Agent Wrappers

No Claude-native agent wrappers are currently defined.

### Skill Discovery

Claude discovers project skills via `.claude/skills/<name>` symlinks pointing at `../../.agents/skills/<name>`. The links are relative, so they stay valid across worktrees and clones.

Current skills:

- `.claude/skills/add-announcement` -> `.agents/skills/add-announcement`
- `.claude/skills/changelog-editor` -> `.agents/skills/changelog-editor`
- `.claude/skills/create-changelog-announcement` -> `.agents/skills/create-changelog-announcement`
- `.claude/skills/update-api-docs` -> `.agents/skills/update-api-docs`
- `.claude/skills/update-llm-model-list` -> `.agents/skills/update-llm-model-list`
- `.claude/skills/write-social-announcement` -> `.agents/skills/write-social-announcement`
- `.claude/skills/scan-codebase` -> `.agents/skills/scan-codebase`
- `.claude/skills/test-codebase` -> `.agents/skills/test-codebase`
- `.claude/skills/sync-findings` -> `.agents/skills/sync-findings`
- `.claude/skills/triage-findings` -> `.agents/skills/triage-findings`
- `.claude/skills/resolve-findings` -> `.agents/skills/resolve-findings`

The shared source should evolve in `.agents/`.
