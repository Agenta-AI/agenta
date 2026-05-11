# Internal Agent Surface

`.agents/` is the primary shared internal-agent surface for this repo.

It is the canonical home for shared agent-facing material:

- shared operating guidance (`policies/`)
- shared registries (`registry/`)
- shared skill source docs (`skills/<name>/SKILL.md`)
- shared agent source docs (`agents/<name>.md`, if any)
- shared references used across skills (`skills/shared/`)
- per-platform projection notes (`platforms/`)

Platform-specific surfaces project from here:

- `.claude/skills/` — relative symlinks into `.agents/skills/` for Claude discovery
- `.codex/skills/` — relative symlinks into `.agents/skills/` for Codex discovery
- `.copilot/skills/` — relative symlinks into `.agents/skills/` for GitHub Copilot discovery

## Load order

Read in this order:

1. `policies/global.md`
2. `registry/knowledge.md`
3. `registry/skills.md`
4. `registry/agents.md`
5. `platforms/codex.md` when working through `AGENTS.md` / Codex
6. `platforms/claude.md` when working through Claude-native projections
7. `platforms/copilot.md` when working through GitHub Copilot

## Skills

See `skills/README.md` for the full skill list, invocation syntax for each platform, and the findings-driven review workflow.

## Boundary

`.agents/` is not the canonical home for process, system, or product truth. Those remain in `docs/` and `.knowledge/`.

`.agents/` should prefer pointers and projections over duplicating canonical docs.
