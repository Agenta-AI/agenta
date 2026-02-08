# Status: Fix Evaluation Workflow Revision Lookup

## Current State: PR Created - Awaiting Review

### Completed

- [x] Root cause identified: `fetch_app_variant_revision_by_id()` only queries legacy tables
- [x] Implemented `_resolve_app_info()` helper with fallback to workflow tables
- [x] Updated `setup_evaluation()` to use new helper
- [x] Updated `evaluate_batch_testset()` to use new helper
- [x] Lint check passed (no new errors)
- [x] Design documentation created
- [x] PR created: https://github.com/Agenta-AI/agenta/pull/3662

### Pending

- [ ] Testing on cloud environment
- [ ] Review and merge

## Changes Made

**File:** `api/oss/src/core/evaluations/tasks/legacy.py`

1. Added `_AppInfo` class to bundle application data needed by evaluation functions
2. Added `_resolve_app_info()` function that:
   - First tries legacy lookup (`fetch_app_variant_revision_by_id` -> `fetch_app_variant_by_id` -> etc.)
   - Falls back to workflow tables via `ApplicationsService` if legacy fails
   - Returns all data needed: revision_id, variant_id, app_id, app_name, uri, config_parameters
3. Updated `setup_evaluation()` (line ~401) to use `_resolve_app_info()`
4. Updated `evaluate_batch_testset()` (line ~812) to use `_resolve_app_info()`

## Known Limitations

1. `EvaluationsService.make_run()` at `api/oss/src/core/evaluations/service.py:2233` has the same issue but is in a different code path (newer evaluations API). Not fixed in this PR.

## Testing Notes

To verify the fix:
1. Create a new application (will only exist in workflow tables)
2. Create a variant and commit a revision
3. Create a testset
4. Run an evaluation via "Run Evaluation" button
5. Should succeed with `count: 1` instead of `count: 0`
