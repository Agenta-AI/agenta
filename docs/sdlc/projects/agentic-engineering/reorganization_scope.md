# Reorganization Scope

## Current sources that need reorganization

The following sources currently contain information that should be reorganized into the agreed documentation classes:

- `application/docs/packs`
- `application/.agents/docs`
- `application/AGENTS.md`

The former contents of:

- `application/docs/design`
- `application/docs/designs`

have now been merged into:

- `application/docs/sdlc/projects/`

## Current target scaffold

The new scaffold created under `application/docs` is:

- `application/docs/sdlc/projects/`
- `application/docs/sdlc/process/`
- `application/docs/sdlc/system/`
- `application/docs/sdlc/product/`

## Intent

This scaffold now contains the merged project-content inputs from `docs/design` and `docs/designs`.

It establishes the target homes for:

- internal project docs
- internal process docs
- internal system docs
- internal product docs

These target homes are canonical destinations for invariant truth, not immediate destinations for any doc that happens to discuss process, system, or product.

They should also be treated as best-effort documentation of that invariant truth, not as a replacement for the codebase or real execution.

The immediate next step is therefore not bulk movement out of `projects`.

It is a path-by-path matrix that identifies:

- what should remain in `projects`
- what may later yield extractable invariant residue
- what validation/distillation would be required before any move
