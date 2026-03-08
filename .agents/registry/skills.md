# Skills Registry

Canonical shared skill source files now live in `application/.agents/skills/`.

Current shared skills:

- `application/.agents/skills/add-announcement.md`
- `application/.agents/skills/create-changelog-announcement.md`
- `application/.agents/skills/update-api-docs.md`
- `application/.agents/skills/update-llm-model-list.md`
- `application/.agents/skills/write-social-announcement.md`

Claude-native wrappers remain under `application/.claude/skills/*/SKILL.md`.

Those wrappers should stay thin and point back to these shared source files.
