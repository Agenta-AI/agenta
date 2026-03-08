# Internal Agent Surface

`application/.agents/` is the primary shared internal-agent surface for this repo.

Use it for shared agent-facing material such as:

- shared operating guidance
- shared policies
- shared registries
- shared skill and agent source docs
- mappings from agent tasks to canonical internal docs

## Load order

Read in this order:

1. `policies/global.md`
2. `registry/knowledge.md`
3. `registry/skills.md`
4. `registry/agents.md`
5. `platforms/codex.md` when working through `AGENTS.md` / Codex
6. `platforms/claude.md` when working through Claude-native projections

## Boundary

`.agents/` is not the canonical home for process, system, or product truth.

Those remain in `application/docs/`.

`.agents/` should prefer pointers and projections over duplicating canonical docs.
