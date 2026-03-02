# Plan: Fix Evaluation Workflow Revision Lookup

## Approach

Use the existing `LegacyApplicationsAdapter` (via `get_legacy_adapter()`) to replace legacy `db_manager` calls in evaluation code. This is the same pattern used by all migrated routers.

### Why This Approach

1. **Consistent** — Same pattern as `app_router.py`, `variants_router.py`, `configs_router.py`
2. **No duplicate wiring** — Reuses the adapter singleton instead of constructing new service instances
3. **Clean** — No legacy-first fallback needed; all data is in workflow tables (migration copied it)

## Implementation

### File 1: `api/oss/src/core/evaluations/tasks/legacy.py`

**Import changes:**
- Remove: `fetch_app_by_id`, `fetch_app_variant_by_id`, `fetch_app_variant_revision_by_id`, `get_deployment_by_id` from `db_manager`
- Remove: `WorkflowArtifactDBE`, `WorkflowVariantDBE`, `WorkflowRevisionDBE`, `GitDAO`
- Add: `get_legacy_adapter` from `legacy_adapter`

**Code changes:**
- Add `_AppInfo` class to bundle application data
- Add `_resolve_app_info()` helper using adapter
- Update `setup_evaluation()` and `evaluate_batch_testset()` to use the helper

### File 2: `api/oss/src/core/evaluations/service.py`

**Import changes:**
- Remove: `fetch_app_by_id`, `fetch_app_variant_by_id`, `fetch_app_variant_revision_by_id` from `db_manager`
- Remove: `AppVariantRevisionsDB` from `db_models`
- Add: `get_legacy_adapter` from `legacy_adapter`

**Code changes:**
- Update `SimpleEvaluationsService._make_evaluation_run_data()` to use adapter
- Update field names to match new DTOs (`application_variant_id`, `slug`, `version`)

## Testing

1. Create a new application (post-v0.84.0)
2. Run batch evaluation via "Run Evaluation" button — should succeed
3. Create online evaluation — should succeed
4. Verify old apps still work (data was migrated to workflow tables)
