# Copilot Projection Layer

`.copilot/` is the GitHub Copilot projection layer for this repo. It exists to make shared skills discoverable by Copilot under its current `SKILL.md` convention without polluting `.github/` with platform-specific assets.

The canonical source for every skill here lives under `.agents/skills/`.

## Shape

```text
.copilot/
  README.md
  skills/
    <name>   # relative symlink -> ../../.agents/skills/<name>
```

Symlinks are relative so they stay valid across worktrees and clones.

## Pointers

Authoritative entry points (read these instead of duplicating them here):

- Shared agent surface: `.agents/README.md`
- Shared policies: `.agents/policies/global.md`
- Skill registry: `.agents/registry/skills.md`
- Copilot projection notes: `.agents/platforms/copilot.md`

## Adding a Copilot skill

1. Add the canonical source at `.agents/skills/<name>/SKILL.md`.
2. Create the symlink:

    ```bash
    ln -sf ../../.agents/skills/<name> .copilot/skills/<name>
    ```

3. Add the corresponding Claude symlink (`.claude/skills/<name>`) and Codex symlink (`.codex/skills/<name>`).
4. Register the skill in `.agents/registry/skills.md`, `.agents/platforms/copilot.md`, and `.agents/skills/README.md`.

## Note on discovery

Copilot's per-client discovery roots for `SKILL.md` are not yet uniform. If a skill does not appear under `/<name>` in your Copilot Chat client, check that client's docs for the expected location — a thin pointer file under `.github/` or the client's configured root may be needed.
