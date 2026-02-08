# Missed Migration Paths: v0.84.0 Application/Evaluator/Environment Migration

This document catalogs all code paths that were missed during the v0.84.0 migration PRs (#3527, #3534, #3627) and still use legacy `db_manager` functions instead of the new adapters/services.

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

## Summary of Missed Paths

| Category | Files Affected | Severity |
|----------|----------------|----------|
| Application lookups in evaluations | 4 files | **Critical** - evaluations fail |
| Human evaluation endpoints | 2 files | **High** - human evals fail |
| Legacy evaluation service | 1 file | **High** - evaluation creation fails |
| Unused imports (dead code) | 2 files | Low - cleanup only |

---

## Critical: Application Lookups in Evaluation Code

These paths query application revisions during evaluation execution. They fail for any app created after v0.84.0.

### 1. `api/oss/src/core/evaluations/tasks/legacy.py`

**Functions affected:**
- `setup_evaluation()` (line ~444)
- `evaluate_batch_testset()` (line ~930)

**Legacy calls:**
```python
from oss.src.services.db_manager import (
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,
    get_deployment_by_id,
)
```

**What fails:**
- Running any evaluation on an app created after v0.84.0
- Error: `ValueError: App revision with id X not found!`

**QA test:**
1. Create a new application via SDK or UI
2. Add a variant and commit a revision
3. Create a testset
4. Run an evaluation via "Run Evaluation" button
5. **Expected failure:** Evaluation returns `count: 0` with empty `runs` array

---

### 2. `api/oss/src/core/evaluations/service.py`

**Function affected:**
- `_make_run_from_application_steps()` (lines 2233-2270)

**Legacy calls:**
```python
fetch_app_variant_revision_by_id(revision_id)  # line 2233
fetch_app_variant_by_id(variant_id)            # line 2248
fetch_app_by_id(app_id)                        # line 2261
```

**What fails:**
- New evaluations API (`/evaluations/runs/create`) for apps created after v0.84.0
- This is the newer evaluation path, separate from `legacy.py`

**QA test:**
1. Create a new application after v0.84.0
2. Use the new evaluations API to create a run
3. **Expected failure:** Run creation fails with revision not found

---

### 3. `api/oss/src/services/evaluation_service.py`

**Functions affected:**
- `create_new_evaluation()` (lines 397-403)
- `create_new_human_evaluation()` (line 349)

**Legacy calls:**
```python
fetch_app_by_id(app_id)                        # line 349, 397
fetch_app_variant_revision_by_id(revision_id)  # line 403
```

**What fails:**
- Legacy evaluation creation endpoint
- Human evaluation creation

**QA test:**
1. Create a new application after v0.84.0
2. Use legacy `/evaluations/` endpoint to create an evaluation
3. **Expected failure:** Evaluation creation fails

---

### 4. `api/oss/src/core/evaluations/tasks/batch.py`

**Status:** Imports only, functions are stubs (`pass`)

```python
from oss.src.services.db_manager import (
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,
    get_deployment_by_id,
)
```

**What fails:** Nothing currently - the functions are not implemented yet. But when they are implemented, they should use the adapter pattern.

---

## High: Human Evaluation Endpoints

### 5. `api/oss/src/routers/human_evaluation_router.py`

**Functions affected:**
- `create_human_evaluation()` (line 55)
- `fetch_list_human_evaluations()` (line 99)

**Legacy calls:**
```python
fetch_app_by_id(app_id)  # lines 55, 99
```

**What fails:**
- Creating human evaluations for apps created after v0.84.0
- Listing human evaluations (may show incomplete data)

**QA test:**
1. Create a new application after v0.84.0
2. Attempt to create a human evaluation
3. **Expected failure:** Human evaluation creation fails

---

### 6. `api/oss/src/routers/evaluation_router.py`

**Function affected:**
- `fetch_list_evaluations()` (line 385)

**Legacy calls:**
```python
fetch_app_by_id(app_id)  # line 385
```

**What fails:**
- Listing evaluations may fail or show incomplete data for new apps

---

## Medium: Config Router Fallbacks

### 7. `api/oss/src/routers/configs_router.py`

**Functions affected:**
- `get_config()` (line 172)
- `revert_deployment_revision()` (line 277)

**Legacy calls:**
```python
fetch_app_variant_revision_by_id(revision_id)  # lines 172, 277
```

**Status:** These appear to be intentional fallback paths after the adapter returns None. However, they may mask issues where the adapter should find data but doesn't.

---

## Low: Dead Code (Unused Imports)

### 8. `api/oss/src/core/evaluations/tasks/live.py`

```python
from oss.src.services.db_manager import get_project_by_id  # unused
```

### 9. `api/oss/src/core/evaluations/tasks/batch.py`

All 5 `db_manager` imports are unused - the functions are stubs.

---

## Environment Migration Status

The environment migration (#3627) was more complete. Remaining usages are:

| Location | Status |
|----------|--------|
| `legacy_adapter.py:900` | Internal adapter bridge (acceptable) |
| `configs_router.py:164,248` | Intentional fallback for old data |
| `converters.py` | Potentially dead code |

**No critical failures expected** for environments.

---

## Recommended Fix Priority

| Priority | File | Fix |
|----------|------|-----|
| **P0** | `core/evaluations/tasks/legacy.py` | Use `get_legacy_adapter()` |
| **P0** | `core/evaluations/service.py` | Use `get_legacy_adapter()` |
| **P1** | `services/evaluation_service.py` | Use `get_legacy_adapter()` |
| **P1** | `routers/human_evaluation_router.py` | Use `get_legacy_adapter()` |
| **P1** | `routers/evaluation_router.py` | Use `get_legacy_adapter()` |
| **P2** | `core/evaluations/tasks/batch.py` | Remove unused imports |
| **P2** | `core/evaluations/tasks/live.py` | Remove unused import |

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
