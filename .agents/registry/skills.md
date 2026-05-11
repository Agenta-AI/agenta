# Skills Registry

Canonical shared skill source files live under `.agents/skills/<name>/SKILL.md`.

## Docs and announcements

- `.agents/skills/add-announcement/SKILL.md`
- `.agents/skills/changelog-editor/SKILL.md`
- `.agents/skills/create-changelog-announcement/SKILL.md`
- `.agents/skills/update-api-docs/SKILL.md`
- `.agents/skills/update-llm-model-list/SKILL.md`
- `.agents/skills/write-social-announcement/SKILL.md`

## Findings-driven review

- `.agents/skills/scan-codebase/SKILL.md`
- `.agents/skills/test-codebase/SKILL.md`
- `.agents/skills/sync-findings/SKILL.md`
- `.agents/skills/triage-findings/SKILL.md`
- `.agents/skills/resolve-findings/SKILL.md`

Shared references for the findings workflow:

- `.agents/skills/shared/references/findings.schema.md`
- `.agents/skills/shared/references/findings.lifecycle.md`

Each skill folder may also carry platform metadata under `<name>/agents/` (e.g. Codex `openai.yaml`).

Per-platform projections:

- Claude discovery: `.claude/skills/<name>` (relative symlinks into `.agents/skills/<name>`)
- Codex discovery: `.codex/skills/<name>` (relative symlinks into `.agents/skills/<name>`)
- Copilot discovery: `.copilot/skills/<name>` (relative symlinks into `.agents/skills/<name>`)

Wrappers and symlinks should stay thin and point back to these shared source files.
