# Claude Projection Layer

`.claude/` is the Claude-native projection layer for this repo. It exists to make shared skills discoverable by Claude while keeping `.agents/` as the canonical source.

The canonical source for every skill here lives under `.agents/skills/`.

## Shape

```text
.claude/
  README.md
  skills/
    <name>   # relative symlink -> ../../.agents/skills/<name>
```

Symlinks are relative so they stay valid across worktrees and clones.

## Pointers

Authoritative entry points (read these instead of duplicating them here):

- Repo bootstrap: `CLAUDE.md` (project root)
- Shared agent surface: `.agents/README.md`
- Shared policies: `.agents/policies/global.md`
- Skill registry: `.agents/registry/skills.md`
- Agent registry: `.agents/registry/agents.md`
- Claude projection mapping: `.agents/platforms/claude.md`

## Adding a Claude Skill

1. Add the canonical source at `.agents/skills/<name>/SKILL.md`.
2. Create the symlink:

    ```bash
    ln -sf ../../.agents/skills/<name> .claude/skills/<name>
    ```

3. Add the corresponding Codex symlink under `.codex/skills/<name>`.
4. Register the skill in `.agents/registry/skills.md`, `.agents/platforms/claude.md`, and `.agents/skills/README.md`.
