# Codex Projection Layer

`.codex/` is the Codex-native projection layer for this repo. It exists to make shared skills discoverable by Codex without polluting `~/.codex/skills/` with worktree-specific absolute paths.

The canonical source for every skill here lives under `.agents/skills/`.

## Shape

```text
.codex/
  README.md
  skills/
    <name>   # relative symlink -> ../../.agents/skills/<name>
```

Symlinks are relative so they stay valid across worktrees and clones. Do not install these skills into `~/.codex/skills/` — keep discovery project-local.

## Pointers

Authoritative entry points (read these instead of duplicating them here):

- Repo bootstrap: `AGENTS.md` (project root)
- Shared agent surface: `.agents/README.md`
- Shared policies: `.agents/policies/global.md`
- Skill registry: `.agents/registry/skills.md`
- Codex projection notes: `.agents/platforms/codex.md`

## Adding a Codex skill

1. Add the canonical source at `.agents/skills/<name>/SKILL.md` (and optional `<name>/agents/openai.yaml` for Codex interface metadata).
2. Create the symlink:

    ```bash
    ln -sf ../../.agents/skills/<name> .codex/skills/<name>
    ```

3. Add the corresponding Claude symlink under `.claude/skills/<name>`.
4. Register the skill in `.agents/registry/skills.md`, `.agents/platforms/codex.md`, and `.agents/skills/README.md`.

## Troubleshooting

If a skill does not appear under `$skill-name` in Codex:

- Check that `.codex/skills/<name>` exists and resolves to a real folder containing `SKILL.md`.
- Reload Codex.
- Confirm the symlink target uses a **relative** path (`../../.agents/skills/<name>`), not an absolute one.
