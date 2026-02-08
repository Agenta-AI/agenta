# Research: Adapter Pattern Analysis

## Question

The migration PR (`chore/migrate-applications`) created adapters for old endpoints to use new tables. Did it miss adding adapters for this service, or were adapters put in the wrong place?

## Answer

**Yes, the migration PR missed adapting the evaluation service.** The `LegacyApplicationsAdapter` was correctly applied to API routers, but the internal evaluation task code was **not updated** to use the adapter pattern. This is a systemic issue that affects multiple code paths, not just isolated to one file.

## Findings

### What the Migration PR Did

The migration introduced `LegacyApplicationsAdapter` (`api/oss/src/services/legacy_adapter.py`) which:

1. Adapts legacy API routers (`app_router.py`, `variants_router.py`, `configs_router.py`) to use the new workflow tables
2. Provides methods like `list_variant_revisions()`, `fetch_variant()`, `update_variant_parameters()` that internally use `ApplicationsService` (which queries workflow tables)
3. Converts between new DTOs (`ApplicationRevision`, `ApplicationVariant`) and legacy response models (`AppVariantRevision`, `AppVariantResponse`)

### Where Adapters Were Applied

| Router/Code | Adapted? | Notes |
|-------------|----------|-------|
| `variants_router.py` | Yes | Uses `get_legacy_adapter()` |
| `app_router.py` | Yes | Uses `get_legacy_adapter()` |
| `configs_router.py` | Yes | Uses `get_legacy_adapter()` |
| `environment_router.py` | Yes | Uses `LegacyEnvironmentsAdapter` |
| `variants_manager.py` | Yes | Uses adapter for lookups |
| `evaluation_router.py` | **No** | Calls `setup_evaluation()` directly |
| `legacy.py` (eval tasks) | **No** | Uses old `db_manager` functions |
| `service.py` (eval service) | **No** | Uses old `db_manager` functions |
| `evaluation_service.py` | **No** | Uses old `db_manager` functions |
| `human_evaluation_router.py` | **No** | Uses old `db_manager` functions |

### Full Scope of Affected Code

#### `fetch_app_variant_revision_by_id()` - 10 Call Sites

| Location | File | Status |
|----------|------|--------|
| `setup_evaluation()` | `legacy.py` | **FIXED** - Now uses `_resolve_app_info()` fallback |
| `evaluate_batch_testset()` | `legacy.py` | **FIXED** - Now uses `_resolve_app_info()` fallback |
| `EvaluationsService.make_run()` | `service.py:2233` | **NOT FIXED** |
| `create_new_evaluation_v2()` | `evaluation_service.py:403` | **NOT FIXED** |
| `get_config()` | `configs_router.py:172` | Partial - old path only |
| `revert_deployment_revision()` | `configs_router.py:277` | Partial - old path only |

#### `fetch_app_variant_by_id()` - Additional Call Sites

| Location | File | Status |
|----------|------|--------|
| `EvaluationsService.make_run()` | `service.py:2248` | **NOT FIXED** |
| `get_appdb_str_by_id()` | `app_manager.py:38` | **NOT FIXED** |
| `terminate_and_remove_app_variant()` | `app_manager.py:144` | **NOT FIXED** |

#### `fetch_app_by_id()` - Additional Call Sites

| Location | File | Status |
|----------|------|--------|
| `EvaluationsService.make_run()` | `service.py:2261` | **NOT FIXED** |
| `create_new_evaluation_v2()` | `evaluation_service.py:349,397` | **NOT FIXED** |
| `fetch_list_evaluations()` | `evaluation_router.py:385` | **NOT FIXED** |
| Human eval endpoints | `human_evaluation_router.py:55,99` | **NOT FIXED** |

### The Gap

The evaluation code was **not updated** to use the adapter pattern. It still directly imports and calls:

```python
from oss.src.services.db_manager import (
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,  # <-- Only queries old table
    get_deployment_by_id,
)
```

These `db_manager` functions query the old tables (`AppVariantRevisionsDB`, etc.) and were not updated to fall back to workflow tables.

### Why This Was Missed

1. **Layer Separation**: The adapter was applied at the **router layer** (HTTP endpoints), not at the **core service layer** where evaluations fetch application data directly

2. **Different Code Paths**: 
   - Router path: `variants_router.py` → `LegacyApplicationsAdapter` → `ApplicationsService` → Workflow tables ✅
   - Eval path: `evaluation_router.py` → `setup_evaluation()` → `db_manager.fetch_*` → Legacy tables ❌

3. **No Fallback Strategy**: The adapter doesn't wrap `db_manager` functions - it's a separate parallel implementation. Code must explicitly choose to use the adapter.

4. **Migration PR scope**: The only change to `legacy.py` in the migration PR was a minor schema access fix (`.get("outputs")` → `.outputs`), not adapter integration.

### Data Flow Comparison

**Working path (variants router):**
```
GET /variants/{id}/revisions/
  -> variants_router.get_variant_revisions()
  -> adapter.list_variant_revisions()
  -> ApplicationsService.log_application_revisions()
  -> WorkflowsService.log_workflow_revisions()
  -> SELECT FROM workflow_revisions  // New table
```

**Broken path (evaluation):**
```
POST /evaluations/preview/start
  -> evaluation_router.start_evaluation()
  -> setup_evaluation()
  -> fetch_app_variant_revision_by_id()
  -> SELECT FROM app_variant_revisions  // Old table - ID not found!
```

## Systemic Issue Assessment

**This is a systemic issue.** The problem extends beyond just `legacy.py`:

| Code Path | Status | Impact |
|-----------|--------|--------|
| `setup_evaluation()` in `legacy.py` | **Fixed** | Batch evaluations via `/evaluations/preview/start` |
| `evaluate_batch_testset()` in `legacy.py` | **Fixed** | Background worker processing |
| `make_run()` in `service.py` | Broken | New evaluations API |
| `create_new_evaluation_v2()` | Broken | Legacy evaluation creation |
| Human evaluation endpoints | Broken | A/B testing, manual evaluation |
| Evaluation list/fetch | Broken | Viewing evaluations for new apps |

## Recommendations

### Current Fix (This PR)

Applied `_resolve_app_info()` fallback pattern to `setup_evaluation()` and `evaluate_batch_testset()`:
- Tries legacy lookup first (backward compatible with old apps)
- Falls back to workflow tables via `ApplicationsService` for new apps

### Future Work

Apply the same fallback pattern to remaining affected locations:
- `api/oss/src/core/evaluations/service.py` - `make_run()` method
- `api/oss/src/services/evaluation_service.py` - `create_new_evaluation_v2()`
- `api/oss/src/routers/evaluation_router.py` - `fetch_list_evaluations()`
- `api/oss/src/routers/human_evaluation_router.py` - All endpoints

Alternatively, refactor all evaluation code to use `ApplicationsService` directly (cleaner long-term but more extensive changes).

## Conclusion

The migration PR correctly created adapters for the API routers but **missed adapting the internal evaluation task code and services**. The adapter pattern was applied at the router level, not at the core service level where evaluations fetch application data directly.

We implemented a fallback helper (`_resolve_app_info()`) that tries legacy first, then falls back to workflow tables. This fixes the immediate issue (`/evaluations/preview/start`) while remaining backward compatible with pre-migration apps.
