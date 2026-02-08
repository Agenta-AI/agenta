# Context: Evaluation Workflow Revision Lookup Bug

## Problem Statement

After v0.84.0, clicking **Run Evaluation** on newly created applications succeeds but returns `count: 0` with an empty `runs` array. No evaluation jobs are started and no results are generated.

**Affected endpoint:** `POST /api/evaluations/preview/start`

**Error from logs:**
```
ValueError: App revision with id 019c3de2-85c1-7002-a498-95d0d6693711 not found!
```

## Root Cause

v0.84.0 introduced a migration from the legacy application storage (`AppVariantRevisionsDB`, `AppVariantDB`, `AppDB`, `DeploymentDB`) to a new workflow-based system (`WorkflowRevisionDBE`, `WorkflowVariantDBE`, `WorkflowArtifactDBE`).

### The Problem Chain

1. **Frontend fetches revisions** via `GET /variants/{variant_id}/revisions/`
2. **Backend returns workflow revision IDs** - the `LegacyApplicationsAdapter.list_variant_revisions()` correctly returns IDs from the new workflow tables
3. **Frontend sends these IDs** in `revisions_ids` field to `POST /evaluations/preview/start`
4. **Evaluation code looks up in wrong table** - `setup_evaluation()` and `evaluate_batch_testset()` call `fetch_app_variant_revision_by_id()` which queries the **old** `AppVariantRevisionsDB` table
5. **Lookup fails** - the workflow revision ID doesn't exist in the legacy table
6. **Exception is caught silently** - the broad `except` in `setup_evaluation()` catches the error, logs it, returns `None`
7. **Run is skipped** - the caller continues without adding a run, resulting in `count: 0`

### Why Old Apps Still Work

Pre-migration applications have entries in both the old `AppVariantRevisionsDB` table and the new workflow tables (via the migration). The legacy lookup succeeds for these apps.

New applications created after v0.84.0 only exist in the workflow tables, causing the lookup to fail.

## Code Flow

```
POST /evaluations/preview/start
  |
  +-> evaluation_router.start_evaluation()
        |
        +-> setup_evaluation()  [legacy.py:125]
              |
              +-> fetch_app_variant_revision_by_id()  [db_manager.py:2860]
                    |
                    +-> SELECT FROM app_variant_revisions WHERE id = ?
                          |
                          +-> Returns NULL for new apps (ID not in this table)
              |
              +-> raises ValueError (caught by broad except)
              |
              +-> returns None
        |
        +-> run is None, continue (skipped)
  |
  +-> returns {count: 0, runs: []}
```

## Affected Functions

1. `setup_evaluation()` at `api/oss/src/core/evaluations/tasks/legacy.py:401`
2. `evaluate_batch_testset()` at `api/oss/src/core/evaluations/tasks/legacy.py:812`

Both use `fetch_app_variant_revision_by_id()` which only queries the legacy table.

## Related Code

The `LegacyApplicationsAdapter` in `api/oss/src/services/legacy_adapter.py` correctly adapts the legacy API endpoints to use the new workflow tables. However, the evaluation code in `legacy.py` was not updated to use this adapter - it still directly calls the old `db_manager` functions.

## Impact

- All newly created applications cannot run evaluations
- Initially appeared as "chat app issue" but affects all new apps
- Old (pre-migration) applications continue to work
