# Status: Fix Evaluation Workflow Revision Lookup

## Current State: Updated Fix - Using Adapter Pattern

### Completed

- [x] Root cause identified: evaluation code still uses `db_manager` instead of `LegacyApplicationsAdapter`
- [x] Documented all missed migration paths in `missed-migration-paths.md`
- [x] Implemented fix using proper adapter pattern (same as app_router.py, variants_router.py)
- [x] Updated `setup_evaluation()` to use `_resolve_app_info()` with adapter
- [x] Updated `evaluate_batch_testset()` to use `_resolve_app_info()` with adapter
- [x] Removed unused imports (workflow DBEs, GitDAO)
- [x] Design documentation created
- [x] PR created: https://github.com/Agenta-AI/agenta/pull/3662

### Pending

- [ ] Update PR with new commits
- [ ] Testing on cloud environment
- [ ] Review and merge

## Changes Made

**File:** `api/oss/src/core/evaluations/tasks/legacy.py`

### Import Changes
- Removed: `fetch_app_by_id`, `fetch_app_variant_by_id`, `fetch_app_variant_revision_by_id`, `get_deployment_by_id` from `db_manager`
- Removed: `WorkflowArtifactDBE`, `WorkflowVariantDBE`, `WorkflowRevisionDBE`, `GitDAO`
- Added: `get_legacy_adapter` from `legacy_adapter`

### Code Changes
1. `_AppInfo` class - bundles application data needed by evaluation functions
2. `_resolve_app_info()` function - uses `LegacyApplicationsAdapter` to fetch from workflow tables:
   - `adapter.fetch_revision_by_id()` - gets revision
   - `adapter.fetch_variant_by_id()` - gets variant
   - `adapter.fetch_app_by_id()` - gets application
   - Extracts URI from `revision.data.url`
   - Extracts parameters from `revision.data.parameters`

### Why This Approach

The v0.84.0 migration established a pattern:
- Legacy routers (app_router, variants_router) use `get_legacy_adapter()` singleton
- The adapter wraps `ApplicationsService` → `WorkflowsService` → `GitDAO`
- All application data is in workflow tables (migration copied pre-v0.84.0 data)

This fix follows that pattern exactly, ensuring:
- No duplicate wiring of services
- Consistent code paths with migrated routers
- No unnecessary legacy-first fallback (adapter handles everything)

## Known Limitations

See `missed-migration-paths.md` for full list. Key remaining issues:

| File | Priority | Status |
|------|----------|--------|
| `core/evaluations/service.py:2233` | P0 | Not fixed (newer API path) |
| `services/evaluation_service.py` | P1 | Not fixed |
| `routers/human_evaluation_router.py` | P1 | Not fixed |
| `routers/evaluation_router.py` | P1 | Not fixed |

## Testing Notes

To verify the fix:
1. Create a new application after v0.84.0 (will only exist in workflow tables)
2. Create a variant and commit a revision
3. Create a testset
4. Run an evaluation via "Run Evaluation" button
5. Should succeed with `count: 1` instead of `count: 0`
