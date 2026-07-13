# Model catalog schema

Design-only workspace. Move the harness model catalog out of hardcoded id lists in
`capabilities.py` into curated data files maintained by a skill, and publish a richer per-model
schema (clean label, description, real pricing, curated ratings) that the agent model selector
renders. No production code changes in this pass.

## The problem in one line

Agenta advertises harness models as a flat list of id strings (`CLAUDE_MODEL_ALIASES`,
`_pi_models()`). The list over-advertises ids the live Claude harness rejects, omits ids it
accepts (Fable), shows raw ids instead of labels, and drifts because it is hardcoded.

## The finding that shapes the design

The only authoritative "which model can I select" set is the one the live harness reports at
session init. The published list is a stale guess that drifts from it in both directions. So the
curated catalog must decorate, never gate. Full trace in `research.md`.

## Read in this order

- `research.md`: current state with file:line refs, the accepted-versus-advertised (Fable)
  experiment, and every reader of the field we change.
- `design.md`: the entry schema (facts versus judgments, pricing versus ratings), the layering
  (the catalog lists what the harness accepts), worked Pi and Claude examples, and the 1-5 ratings
  decision.
- `plan.md`: the curated data files, the `sync-model-catalog` skill, the additive migration, the
  work packages, and the coordination sequencing.
- `open-questions.md`: decisions for the owner and CTO.
- `pr-body.md`: the draft PR description.

## Relationship to sibling projects

- `../agent-model-picker/`: shipped the `models` field and `CLAUDE_MODEL_ALIASES`; deferred
  pricing and ratings. This project fills that deferred seam.
- `../model-config/`: Part 3 designs the runtime accepted-set inspect surface. This catalog
  becomes the decoration for that set (WP4).
- `../provider-model-auth/`: shipped the harness capability table this field lives in.
- `../custom-providers-in-pi/`: adds the vault custom-provider picker source; composes with this
  catalog, does not conflict.
