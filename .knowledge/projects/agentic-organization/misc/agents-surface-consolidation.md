# Proposal: Consolidate Internal Agent Docs Under `.agents/`

## Why this note exists

The repo currently has multiple agent-facing surfaces:

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/`
- `.agents/`

At the moment:

- `AGENTS.md` is the heavy, general entry surface
- `CLAUDE.md` is already a thin pointer
- `.claude/` holds Claude-specific agents and skills
- `.agents/` is now empty and available

This note proposes using `.agents/` as the main internal-agent surface.

## Recommendation

Use `.agents/` as the **primary shared internal-agent surface** for shared agent-facing material.

Then narrow the other surfaces:

- `AGENTS.md` -> thin bootstrap / compatibility wrapper
- `CLAUDE.md` -> thin Claude bootstrap / pointer
- `.claude/` -> Claude-specific projections, adapters, and native assets only

In other words:

- `.agents/` should be the shared internal agent home
- `AGENTS.md`, `CLAUDE.md`, and `.claude/` should adapt to it, not compete with it

## Why this is a better shape

It aligns with the current agent-doc taxonomy:

- internal agent docs should be thin and derivative
- platform-specific surfaces should not be the only home of important agent-operational knowledge
- canonical process/system/product truth should still live outside the platform wrappers

This also matches the current repo state better:

- `CLAUDE.md` is already effectively a wrapper
- `.claude/` is clearly platform-specific
- `.agents/` is available for the shared layer

## Proposed boundary

### `.agents/`

Use for shared internal agent material such as:

- shared agent operating guidance
- shared policies
- shared registries / indexes
- shared skills or skill metadata
- mappings from agent tasks to canonical internal docs

Prefer pointers, projections, and thin wrappers over duplicating canonical process/system/product docs inside `.agents/`.

### `AGENTS.md`

Keep only what must exist at the repo root for tool compatibility, for example:

- a short bootstrap
- where canonical internal agent docs live
- a minimal load order
- links into `.agents/`

`AGENTS.md` should stop being the long-term home for general agent-operational content.

### `CLAUDE.md`

Keep as a Claude-native entrypoint only.

It should be a thin wrapper that points Claude toward:

- `.agents/` for shared agent guidance
- `.claude/` for Claude-native projections when needed

### `.claude/`

Keep only Claude-specific assets, for example:

- Claude-native skill packaging
- Claude-native agent definitions
- Claude-specific wrappers around shared knowledge

It should not become the canonical home for shared internal agent docs.

## Suggested target shape

```text
application/
  .agents/
    README.md
    policies/
    registry/
    skills/
    agents/
    platforms/
      claude/
      codex/
  AGENTS.md
  CLAUDE.md
  .claude/
```

Possible responsibilities:

- `.agents/README.md` -> top-level entry for shared agent docs
- `.agents/policies/` -> reusable agent operating rules
- `.agents/registry/` -> indexes to canonical docs, skills, tools, and agents
- `.agents/skills/` -> shared skill definitions or shared skill source docs
- `.agents/platforms/claude/` -> Claude-facing projection notes if we want platform views inside `.agents/`
- `.claude/` -> only what Claude tooling still requires natively

## Migration direction

### Phase 1

Create the shared structure under `.agents/`.

Move shared agent-facing guidance out of `AGENTS.md` into `.agents/`.

### Phase 2

Reduce `AGENTS.md` to a thin compatibility wrapper.

Reduce `CLAUDE.md` to a thin Claude wrapper.

### Phase 3

Review `.claude/` and keep only genuinely Claude-native assets there.

Anything shared should either:

- move into `.agents/`, or
- become a thin projection of content that is canonical in `.agents/`

## Important caution

This does **not** mean `.agents/` becomes the canonical home for process, system, or product truth.

`.agents/` should remain an internal-agent surface.

So the preferred layering is:

- `docs/sdlc/process|system|product` = best-effort canonical truth
- `docs/sdlc/projects/*` = project working memory
- `.agents/` = shared internal agent operating layer
- `AGENTS.md`, `CLAUDE.md`, `.claude/` = bootstrap/projection surfaces

## Bottom line

The repo should move from:

- `AGENTS.md` as the de facto shared agent surface
- `.claude/` as a mixed platform-plus-shared surface

to:

- `.agents/` as the shared internal agent layer
- `AGENTS.md` and `CLAUDE.md` as thin entrypoints
- `.claude/` as Claude-specific projection only
