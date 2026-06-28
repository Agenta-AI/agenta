# Default agent config (playground build kit)

The platform tools and the Agenta authoring skill are a Playground build kit. The backend
injects them into the playground session so the agent can build and improve itself. They are
shown read-only, toggled as a whole, and never committed to the published agent. The user's
agent ships with only the user's own config.

## Files

- `design.md` — the design. The inject-not-commit model, the three questions answered, the
  `build_kit` descriptor contract the drawer reads, the per-run flag, and the change set.
- `research.md` — the code trace behind the design. Where the default comes from, how
  platform tools and skills are shaped, and the run-prep path. Code facts still valid; the
  approach pivoted (see status).
- `status.md` — the pivot, the fixed contract, open questions, and coordination.

## In one line

Inject the build kit (platform tools, authoring skill, build permissions) into the
playground session for display and for the run, strip it on commit, keep the published
default bare. The drawer reads a read-only `build_kit` descriptor from `/inspect` and toggles
it with one per-run flag.
