# Plan: Fix Evaluation Workflow Revision Lookup

## Approach

Create a compatibility helper that abstracts over both old and new storage systems, trying legacy first and falling back to workflow tables.

### Why This Approach

1. **Backward compatible** - Old apps using legacy tables continue to work
2. **Minimal changes** - Only modifies the lookup logic, not the evaluation flow
3. **Quick fix** - Can be deployed immediately without refactoring evaluation code
4. **Safe** - Fallback only triggers when legacy lookup fails

### Alternative Considered

Refactor evaluation code to use `ApplicationsService` directly. This would be cleaner long-term but requires more extensive changes and testing.

## Implementation

### Step 1: Create `_AppInfo` data class

Bundles all application data needed by evaluation functions:
- `revision_id: UUID`
- `variant_id: UUID`
- `app_id: UUID`
- `app_name: str`
- `uri: str`
- `config_parameters: dict`

### Step 2: Create `_resolve_app_info()` helper

```python
async def _resolve_app_info(revision_id: str, project_id: UUID) -> Optional[_AppInfo]:
    # 1) Try legacy lookup
    revision = await fetch_app_variant_revision_by_id(revision_id)
    if revision is not None:
        # Resolve variant, app, deployment from legacy tables
        return _AppInfo(...)
    
    # 2) Fall back to workflow tables
    app_revision = await applications_service.fetch_application_revision(...)
    if app_revision is None:
        return None
    
    # Resolve variant, app from workflow tables
    # Extract URI from revision.data.url
    return _AppInfo(...)
```

### Step 3: Update call sites

Replace direct `fetch_app_variant_revision_by_id()` calls with `_resolve_app_info()`:

1. `setup_evaluation()` at line ~401
2. `evaluate_batch_testset()` at line ~812

## Files Modified

- `api/oss/src/core/evaluations/tasks/legacy.py`

## Testing

1. Test with old app (pre-migration) - should use legacy path
2. Test with new app (post-v84.0) - should use workflow fallback
3. Verify evaluation runs complete successfully
4. Check logs for `[COMPAT]` messages indicating fallback usage
