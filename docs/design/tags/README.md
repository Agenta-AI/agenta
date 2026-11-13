# Tags Design Docs (Draft)

This folder contains draft design artifacts for a Tags feature on a legacy branch.
The docs are intentionally lightweight and use current assumptions only as placeholders.

## Documents

- `PRD.md`: product goals, user value, scope, and success criteria.
- `RFC.md`: technical approach, architecture, data model, API, and rollout plan.
- `PR.md`: pull request draft summary and reviewer checklist.

## How to use these docs

- Treat all details as a starting point for iteration.
- Prefer decisions that are easy to migrate when legacy entities are replaced.
- Capture unresolved decisions in the open-questions sections.

## Open Questions

1. Which existing "entity" types should be supported first in this old branch?
2. Should tags be globally unique, workspace-scoped, or entity-scoped?
3. Do we want free-form tag creation or constrained vocabulary in v1?
4. What migration path is acceptable if naming and IDs change later?
