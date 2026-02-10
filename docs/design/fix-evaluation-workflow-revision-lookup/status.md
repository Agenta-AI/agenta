# Status: Fix Evaluation Workflow Revision Lookup

## Current State: All Critical Fixes Complete

### Completed

- [x] Root cause identified: evaluation code still uses `db_manager` instead of `LegacyApplicationsAdapter`
- [x] Documented all missed migration paths in `missed-migration-paths.md`
- [x] **Fixed `core/evaluations/tasks/legacy.py`** - Batch evaluations ("Run Evaluation" button)
- [x] **Fixed `core/evaluations/service.py`** - Online/Simple evaluations
- [x] PR created: https://github.com/Agenta-AI/agenta/pull/3662

### Pending

- [ ] Testing on cloud environment
- [ ] Review and merge

## Changes Made

### File 1: `api/oss/src/core/evaluations/tasks/legacy.py`

**Import Changes:**
- Removed: `fetch_app_by_id`, `fetch_app_variant_by_id`, `fetch_app_variant_revision_by_id`, `get_deployment_by_id` from `db_manager`
- Removed: `WorkflowArtifactDBE`, `WorkflowVariantDBE`, `WorkflowRevisionDBE`, `GitDAO`
- Added: `get_legacy_adapter` from `legacy_adapter`

**Code Changes:**
- Added `_AppInfo` class to bundle application data
- Added `_resolve_app_info()` function using `LegacyApplicationsAdapter`
- Updated `setup_evaluation()` and `evaluate_batch_testset()` to use the helper

### File 2: `api/oss/src/core/evaluations/service.py`

**Import Changes:**
- Removed: `fetch_app_by_id`, `fetch_app_variant_by_id`, `fetch_app_variant_revision_by_id` from `db_manager`
- Removed: `AppVariantRevisionsDB` from `db_models`
- Added: `get_legacy_adapter` from `legacy_adapter`

**Code Changes:**
- Updated `SimpleEvaluationsService._make_evaluation_run_data()` to use adapter
- Replaced legacy field names with new DTO field names:
  - `variant_id` → `application_variant_id`
  - `app_id` → `application_id`
  - `config_name` → `slug`
  - `revision` → `version`
  - `app_name` → `slug`

## Testing Notes

### Batch Evaluations (legacy.py fix)
1. Create a new application after v0.84.0
2. Create a variant and commit a revision
3. Create a testset
4. Run an evaluation via "Run Evaluation" button
5. Should succeed with `count: 1` instead of `count: 0`

### Online Evaluations (service.py fix)
1. Create a new application after v0.84.0
2. Go to Online Evaluations
3. Create an online evaluation
4. Should succeed instead of failing silently
