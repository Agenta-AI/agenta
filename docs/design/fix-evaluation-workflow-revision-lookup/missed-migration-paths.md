# Missed Migration Paths: v0.84.0 Application/Evaluator/Environment Migration

This document catalogs code paths that were missed during the v0.84.0 migration PRs (#3527, #3534, #3627) and still use legacy `db_manager` functions instead of the new adapters/services.

## Background

The v0.84.0 migration moved storage from legacy tables to new workflow-based tables:

| Entity | Legacy Table | New Table | Adapter |
|--------|--------------|-----------|---------|
| Applications | `AppVariantRevisionsDB` | `WorkflowRevisionDBE` | `LegacyApplicationsAdapter` |
| Evaluators | `EvaluatorConfigDB` | `WorkflowRevisionDBE` | (none - uses `EvaluatorsService` directly) |
| Environments | `AppEnvironmentDB` | `EnvironmentRevisionDBE` | `LegacyEnvironmentsAdapter` |

**Key behavior:**
- Apps/evaluators created **before** v0.84.0: data exists in both old and new tables (migration copied it)
- Apps/evaluators created **after** v0.84.0: data **only** exists in new workflow tables
- Code still using `db_manager` will fail for post-v0.84.0 entities

---

## Summary

| Category | File | Severity | Status |
|----------|------|----------|--------|
| Batch Evaluations ("Run Evaluation" button) | `core/evaluations/tasks/legacy.py` | **Critical** | **Fixed in this PR** |
| Online/Simple Evaluations | `core/evaluations/service.py` | **Critical** | Needs fix |
| Dead code (unused imports) | `core/evaluations/tasks/batch.py`, `live.py` | Low | Cleanup only |

**Deprecated paths (not fixing):**
- `routers/human_evaluation_router.py` - Deprecated feature
- `routers/evaluation_router.py` - Deprecated, replaced by new evaluations API
- `services/evaluation_service.py` - Supports deprecated endpoints only

---

## Critical: Batch Evaluations - `core/evaluations/tasks/legacy.py`

**Status: FIXED in this PR**

**Functions affected:**
- `setup_evaluation()` (line ~444)
- `evaluate_batch_testset()` (line ~930)

**What was broken:**
- Running any evaluation on an app created after v0.84.0
- Error: `ValueError: App revision with id X not found!`

**Fix applied:**
- Added `_resolve_app_info()` helper using `get_legacy_adapter()`
- Removed legacy `db_manager` imports

---

## Critical: Online/Simple Evaluations - `core/evaluations/service.py`

**Status: NEEDS FIX**

**Function affected:**
- `SimpleEvaluationsService._make_evaluation_run_data()` (lines 2233-2270)

**Legacy calls:**
```python
fetch_app_variant_revision_by_id(revision_id)  # line 2233
fetch_app_variant_by_id(variant_id)            # line 2248
fetch_app_by_id(app_id)                        # line 2261
```

**Who uses this:**
- `SimpleEvaluationsRouter` mounted at `/preview/simple/evaluations/`
- Frontend: `web/oss/src/services/onlineEvaluations/api.ts`
- This is the "Online Evaluations" feature (live evaluations on traces)

**What fails:**
- Creating online evaluations for apps created after v0.84.0
- Error: revision not found, returns `None`

**QA test:**
1. Create a new application after v0.84.0
2. Go to Online Evaluations and try to create one
3. **Expected failure:** Evaluation creation fails silently

**Recommended fix:**
```python
from oss.src.services.legacy_adapter import get_legacy_adapter

adapter = get_legacy_adapter()
application_revision = await adapter.fetch_revision_by_id(
    project_id=project_id,
    revision_id=application_revision_ref.id,
)
```

---

## Low: Dead Code (Unused Imports)

### `api/oss/src/core/evaluations/tasks/live.py`

```python
from oss.src.services.db_manager import get_project_by_id  # unused
```

### `api/oss/src/core/evaluations/tasks/batch.py`

All 5 `db_manager` imports are unused - the functions are stubs (`pass`).

---

## Fix Pattern

All fixes should follow the established adapter pattern used in `app_router.py` and `variants_router.py`:

```python
from oss.src.services.legacy_adapter import get_legacy_adapter

# Instead of:
revision = await fetch_app_variant_revision_by_id(revision_id)
variant = await fetch_app_variant_by_id(variant.id)
app = await fetch_app_by_id(app.id)

# Use:
adapter = get_legacy_adapter()
revision = await adapter.fetch_revision_by_id(
    project_id=project_id,
    revision_id=UUID(revision_id),
)
variant = await adapter.fetch_variant_by_id(
    project_id=project_id,
    variant_id=revision.application_variant_id,
)
app = await adapter.fetch_app_by_id(
    project_id=project_id,
    app_id=variant.application_id,
)
```

The adapter methods go through `ApplicationsService` which queries the new workflow tables. The data migration ensured all pre-v0.84.0 data was copied to these tables, so there's no need for a legacy-first fallback.
