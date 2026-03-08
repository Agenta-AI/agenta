# Execution Plan

## Phase 1 - API dual-mount foundation

Scope:

- For each `safe-now` family, add canonical non-preview mount in `api/entrypoints/routers.py`.
- Keep existing preview mounts active.
- Set preview mounts to `include_in_schema=False`.

Deliverables:

- Canonical routes available at runtime.
- OpenAPI shows only canonical routes for migrated families.

Exit criteria:

- API boots successfully.
- OpenAPI generation succeeds without duplicate operation warnings impacting clients.
- Existing preview callers continue to work.

## Phase 2 - Frontend migration

Scope:

- Update web callers from `/preview/*` to canonical routes for migrated families.
- Prioritize highest-usage families first: evaluations, testsets, testcases, evaluators.

Deliverables:

- No frontend production code paths depend on preview prefixes for migrated families.

Exit criteria:

- Search in `web/` shows zero matches for migrated `/preview/*` prefixes (excluding tests/fixtures where intentionally retained).

## Phase 3 - SDK migration

Scope:

- Update SDK managers and evaluation helpers from preview to canonical routes.
- Ensure generated docs and examples use canonical paths.

Deliverables:

- SDK runtime calls use canonical routes for migrated families.

Exit criteria:

- Search in `sdk/` shows zero matches for migrated `/preview/*` prefixes.

## Phase 4 - Environments decision

Scope:

- Validate compatibility strategy for environments due prefix overlap with legacy `/environments` router.
- Decide whether to:
  - dual-mount new environments on `/environments`, or
  - keep preview until legacy `/environments` is retired, then cut over.

Deliverables:

- Signed-off approach and implementation task list.

Exit criteria:

- No ambiguity on `/environments/*` behavior.
- OpenAPI and runtime behavior are both verified.

## Phase 5 - Preview removal

Scope:

- Remove preview mounts for fully migrated families.

Deliverables:

- No preview mounts remaining for completed families.

Exit criteria:

- Frontend and SDK references are gone.
- No regressions in API usage monitoring.

## Rollout order recommendation

1. tracing migration (already dual-mounted)
2. evaluations + evaluators
3. testsets + testcases
4. queries + applications + workflows
5. invocations + annotations
6. environments (after explicit decision)
