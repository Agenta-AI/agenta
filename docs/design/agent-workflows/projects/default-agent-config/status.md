# Status: default agent config (playground build kit)

## Where we are

Model pivoted to inject-not-commit and the design is rewritten in `design.md`. The platform
tools and the Agenta authoring skill are a Playground build kit: injected for the playground
session, shown read-only, toggled as a whole, and never committed to the published agent.
The descriptor contract for the drawer project is fixed. Two open questions remain for
Mahmoud.

## The pivot

The earlier approach (materialize the defaults into the catalog template so a new agent
commits them) was reviewed by Mahmoud and dropped. Defaults are not committed. They are a
playground overlay. The designer handoff (`design_handoff_advanced_build_kit`) names the
same thing: a "Playground build kit", "Removed on commit", "None of this is part of the
published agent". `research.md` still holds the code trace; the code facts there are valid,
only the approach changed.

## The model

- Build kit = backend-defined set of platform tools (`PLATFORM_OPS`) + the authoring skill +
  build permissions (write files, execute code).
- Inject for display and for the run. Strip on commit (it was never in the config).
- The published-config default stays bare. The kit is a separate backend concept.

## Contract fixed for the drawer project

- Read-only `build_kit` descriptor in the `/inspect` response at `revision.data.build_kit`,
  a sibling of `schemas`. Grouped by kind (`skills`, `tools`, `permissions`). Each row:
  `key`, `name`, `description`; permission rows also `status`. Platform-owned, never echoed
  back.
- One per-run flag `flags.inject_build_kit` (boolean), set by the drawer toggle, default off
  server-side. Kit off skips injection.

## Open questions for Mahmoud

1. Toggle persistence: ephemeral per session (lean) or a stored playground preference.
2. Confirm the published default goes fully bare (drop the skill embed and the sandbox
   boundary from the `/inspect` schema default into the kit). Touches the skills project.

## Coordination

- Drawer UX: advanced-build-kit project + the designer handoff. We feed it the descriptor.
- Authoring skill content and naming: skills project (`#4918`). We reference the slug only.
- Builder tools (`#4919`) add more platform ops; the kit reads `PLATFORM_OPS` at call time,
  so new ops join automatically.

## Out of scope

- Per-item edit or delete of kit items (kit is whole-toggle, read-only in v1).
- A picker to add platform tools to the published agent.
- Disable-but-keep for the user's own config.
