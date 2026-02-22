# PR Draft: Tags Design Pack

## Title

`feat(docs): add initial tags PRD/RFC/design readme`

## Summary

Adds an initial design pack for Tags under `docs/designs/tags`:

- `README.md`
- `PRD.md`
- `RFC.md`
- `PR.md` (this file)

The branch is legacy and details are intentionally provisional.

## Why

- Align product and engineering on first-pass scope.
- Make assumptions explicit before implementation.
- Record open questions for iterative follow-up.

## What is included

- Product framing (problem, goals, scope, success metrics).
- Technical proposal (data model, API, migration/rollout).
- Open questions to resolve before build.

## What is not included

- Final schema migration scripts.
- Final endpoint contracts.
- UI mocks and interaction specs.

## Reviewer Checklist

- Does scope match expected v1 outcomes?
- Are non-goals clear enough to prevent overbuild?
- Is the proposed data model compatible with legacy entities?
- Are open questions complete and prioritized?

## Open Questions

1. Which open questions must be resolved before implementation starts?
2. Which questions can be deferred behind feature flags?
3. Who are owners for product, backend, and frontend decisions?
