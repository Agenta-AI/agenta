# Research: Adapter Pattern Analysis

## Question

The migration PR (`chore/migrate-applications`) created adapters for old endpoints to use new tables. Did it miss adding adapters for evaluation code?

## Answer

**Yes, the migration PR missed adapting the evaluation code.** The `LegacyApplicationsAdapter` was correctly applied to API routers, but the evaluation task and service code was **not updated** to use the adapter pattern.

## Findings

### What the Migration PR Did

The migration introduced `LegacyApplicationsAdapter` (`api/oss/src/services/legacy_adapter.py`) which:

1. Adapts legacy API routers (`app_router.py`, `variants_router.py`, `configs_router.py`) to use the new workflow tables
2. Provides methods like `fetch_revision_by_id()`, `fetch_variant_by_id()`, `fetch_app_by_id()` that internally use `ApplicationsService` (which queries workflow tables)
3. Converts between new DTOs (`ApplicationRevision`, `ApplicationVariant`) and legacy response models

### Where Adapters Were Applied

| Router/Code | Adapted? | Notes |
|-------------|----------|-------|
| `variants_router.py` | Yes | Uses `get_legacy_adapter()` |
| `app_router.py` | Yes | Uses `get_legacy_adapter()` |
| `configs_router.py` | Yes | Uses `get_legacy_adapter()` |
| `environment_router.py` | Yes | Uses `LegacyEnvironmentsAdapter` |
| `variants_manager.py` | Yes | Uses adapter for lookups |
| `legacy.py` (eval tasks) | **No** → **Fixed in this PR** | Was using `db_manager` directly |
| `service.py` (SimpleEvaluationsService) | **No** → **Fixed in this PR** | Was using `db_manager` directly |
| `evaluation_service.py` | No | Deprecated - only supports deprecated endpoints |
| `evaluation_router.py` | No | Deprecated - all operation_ids are `fetch_legacy_*` |
| `human_evaluation_router.py` | No | Deprecated feature |

### Active Code Paths Fixed in This PR

| Location | File | Status |
|----------|------|--------|
| `setup_evaluation()` | `legacy.py` | **Fixed** - Uses `get_legacy_adapter()` |
| `evaluate_batch_testset()` | `legacy.py` | **Fixed** - Uses `get_legacy_adapter()` |
| `SimpleEvaluationsService._make_evaluation_run_data()` | `service.py` | **Fixed** - Uses `get_legacy_adapter()` |

### Deprecated Code Paths (Not Fixed)

These only serve deprecated endpoints and are not actively used:

| Location | File | Why Not Fixed |
|----------|------|---------------|
| `create_new_evaluation()` | `evaluation_service.py:403` | Only used by deprecated `evaluation_router.py` (all `operation_id="fetch_legacy_*"`) |
| `create_new_human_evaluation()` | `evaluation_service.py:349` | Only used by deprecated `human_evaluation_router.py` |
| `fetch_list_evaluations()` | `evaluation_router.py:385` | Deprecated endpoint |
| Human eval endpoints | `human_evaluation_router.py` | Deprecated feature |

### The Gap

The evaluation code was not updated to use the adapter pattern because:

1. **Layer Separation**: The adapter was applied at the **router layer** (HTTP endpoints), not at the **core service layer** where evaluations fetch application data
2. **Different Code Paths**: Routers go through `LegacyApplicationsAdapter`, but eval tasks call `db_manager` directly
3. **No Fallback Strategy**: The adapter doesn't wrap `db_manager` - it's a separate implementation. Code must explicitly switch to the adapter.

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

**Broken path (evaluation, before fix):**
```
POST /evaluations/preview/start
  -> evaluation_router.start_evaluation()
  -> setup_evaluation()
  -> fetch_app_variant_revision_by_id()
  -> SELECT FROM app_variant_revisions  // Old table - ID not found!
```

**Fixed path (evaluation, after fix):**
```
POST /evaluations/preview/start
  -> evaluation_router.start_evaluation()
  -> setup_evaluation()
  -> _resolve_app_info()
  -> get_legacy_adapter().fetch_revision_by_id()
  -> ApplicationsService.fetch_application_revision()
  -> SELECT FROM workflow_revisions  // New table - works!
```
