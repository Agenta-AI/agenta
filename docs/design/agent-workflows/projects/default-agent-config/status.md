# Status: default agent config (playground build kit)

## Where we are

Second rewrite. The first rewrite's core model was rejected and the design is rewritten in
`design.md`. The corrected model: the frontend owns the injection, the backend only informs,
and the agent service stays dumb. The advanced-drawer UI is folded into this design (Mahmoud
asked for one document covering both the inspect information and the UI). Five open questions
remain for Mahmoud.

## The pivot

The first rewrite put the injection in the backend agent service: a run-prep merge gated by a
`flags.inject_build_kit` run flag. Mahmoud rejected it on the PR. His direction: the frontend
injects the kit into `parameters.agent` in the playground; the service must not know the kit
exists; the backend's only job is to expose the kit's information through `/inspect` so the
frontend can act on it.

So the model flipped:

- The agent service stays dumb. No run-prep injection. No `inject_build_kit` flag. It runs the
  agent template it receives.
- The backend informs. It assembles a read-only `build_kit` descriptor and serves it on
  `/inspect`. Nothing more.
- The frontend owns the logic. It reads the descriptor, shows the drawer and toggle, injects the
  kit into the run payload when on, and excludes it on commit.

`research.md` still holds the code trace; the code facts there are valid, only the approach
changed.

## The contract for the frontend

- Read-only `build_kit` descriptor in the `/inspect` response at `revision.data.build_kit`, a
  sibling of `schemas`. Grouped by kind (`skills`, `tools`, `permissions`). Each row: `key`,
  `name`, `description`, and `config` (the exact `parameters.agent` entry the frontend injects);
  permission rows also `status` (the green pill). Platform-owned, read-only end to end.
- The new bit versus the prior shape: each row now carries `config`, because the frontend, not
  the backend, injects. The frontend does a pure structural merge and owns no wire shapes.
- No run flag. The toggle is client session state, default on. A kit-on run is just a run whose
  `parameters.agent` already carries the extra items. The run wire is unchanged.

## Open questions for Mahmoud

1. Toggle persistence: ephemeral per session (lean) or a stored playground preference.
2. Confirm the published default goes fully bare (drop the authoring skill and the sandbox
   boundary from the schema default into the kit; set `AGENTA_FORCED_SKILLS = []`). Touches the
   skills project.
3. Kit PERMISSIONS group: read-only under the single toggle (lean) or independently flippable.
4. Carry `config` per row (lean) or derive each injected entry from `key` plus kind.
5. Ship Change 1 (collapsible sections) with the kit, or separately (lean separate).

## Coordination

- Advanced-drawer UI is folded into this design, not a separate PR (Mahmoud's instruction).
- Authoring skill content and naming: skills project (`#4918`). We reference the slug only.
- Builder tools (`#4919`) add more platform ops; the builder reads `PLATFORM_OPS` at assembly
  time, so new ops join automatically.
- The model change ripples to `#4918`, `#4919`, `#4920`, which still reference the rejected
  backend-injection model. Do not edit them here; the orchestrator propagates the fix after
  Mahmoud approves this model.

## Out of scope

- Per-item edit or delete of kit items (kit is whole-toggle, read-only in v1).
- A picker to add platform tools to the published agent.
- Disable-but-keep for the user's own config.
