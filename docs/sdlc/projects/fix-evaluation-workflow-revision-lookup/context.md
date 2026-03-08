# Context: Evaluation Workflow Revision Lookup Bug

## Problem Statement

After v0.84.0, clicking **Run Evaluation** on newly created applications succeeds but returns `count: 0` with an empty `runs` array. No evaluation jobs are started and no results are generated.

**Affected endpoints:**
- `POST /api/evaluations/preview/start` (batch evaluations)
- `POST /api/preview/simple/evaluations/` (online evaluations)

**Error from logs:**
```
ValueError: App revision with id 019c3de2-85c1-7002-a498-95d0d6693711 not found!
```

## Root Cause

v0.84.0 introduced a migration from legacy application storage to a new workflow-based system. The migration created `LegacyApplicationsAdapter` for API routers but missed updating the evaluation code, which still called `db_manager` functions that only query legacy tables.

For apps created after v0.84.0, data only exists in the new workflow tables, so the legacy lookup fails.

## Fix Applied

Both affected code paths now use `get_legacy_adapter()` — the same pattern as all migrated routers (`app_router.py`, `variants_router.py`):

### 1. Batch Evaluations (`core/evaluations/tasks/legacy.py`)
- Added `_resolve_app_info()` helper using adapter
- Updated `setup_evaluation()` and `evaluate_batch_testset()`

### 2. Online Evaluations (`core/evaluations/service.py`)
- Updated `SimpleEvaluationsService._make_evaluation_run_data()` to use adapter

### Deprecated Paths (Not Fixed)

The following also use legacy `db_manager` calls but are deprecated and not actively used:
- `services/evaluation_service.py` — only serves deprecated endpoints
- `routers/evaluation_router.py` — all operation_ids are `fetch_legacy_*`
- `routers/human_evaluation_router.py` — deprecated feature

## Impact

- All newly created applications can now run batch and online evaluations
- Old (pre-migration) applications continue to work (migration copied data to new tables)
