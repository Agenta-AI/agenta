# Migration Plan

## Phase 1: Immediate Cleanup (Safe to do now)

### 1.1 Remove Dead Code - Frontend

**File to delete:**
```
web/oss/src/services/evaluations/api_ee/index.ts
```

This file contains only `createEvaluatorRunExecution` which is never imported.

### 1.2 Remove Dead Code - Backend

**Endpoints to remove from `api/oss/src/routers/evaluators_router.py`:**

1. `POST /evaluators/{evaluator_key}/run` (lines 154-196)
   - Function: `evaluator_run()`
   - Helper: `_run_evaluator()`

2. `POST /evaluators/map` (lines 120-151)
   - Function: `evaluator_data_map()`

**Test file to remove:**
```
api/oss/tests/legacy/old_tests/variants_main_router/test_variant_evaluators_router.py
```

This test file tests the legacy `/evaluators/{key}/run` endpoint.

---

### 1.3 Remove Dead Code - Legacy Configs Endpoints

**Endpoints to remove from `api/oss/src/routers/evaluators_router.py`:**

```
GET  /evaluators/configs/
GET  /evaluators/configs/{id}/
POST /evaluators/configs/
PUT  /evaluators/configs/{id}/
DELETE /evaluators/configs/{id}/
```

**Functions to remove:**
- `get_evaluator_configs()` 
- `get_evaluator_config()`
- `create_new_evaluator_config()`
- `update_evaluator_config()`
- `delete_evaluator_config()`

**Verification:**

```bash
# Frontend - NO USAGE
$ grep -rn "evaluators/configs" web/ --include="*.ts" --include="*.tsx"
# (no results)

# SDK - NO USAGE (only auto-generated client)
$ grep -rn "evaluators/configs" sdk/ --include="*.py" | grep -v raw_client
# (no results)
```

---

## Phase 2: Migrate `GET /evaluators` Templates Endpoint (Next Sprint)

### Problem

`GET /evaluators` returns static evaluator templates. The frontend needs these templates to:
1. Display available evaluator types in selection dropdowns
2. Get `settings_template` for dynamic form rendering
3. Get `settings_presets` for preset configurations
4. Get `outputs_schema` for expected output formats

### Proposed Solution: Add Templates Endpoint to New API

**Option A: Add `/preview/simple/evaluators/templates` endpoint**

```python
# Add to api/oss/src/apis/fastapi/evaluators/router.py

@router.get("/templates", response_model=List[LegacyEvaluator])
async def list_evaluator_templates():
    """Returns the static list of built-in evaluator templates."""
    from oss.src.resources.evaluators.evaluators import get_all_evaluators
    return [LegacyEvaluator(**e) for e in get_all_evaluators()]
```

**Option B: Inline templates in frontend (No API call)**

Since the templates are static and rarely change, they could be bundled with the frontend:

```typescript
// web/oss/src/lib/evaluators/templates.ts
export const EVALUATOR_TEMPLATES: Evaluator[] = [
    {
        name: "LLM-as-a-judge",
        key: "auto_ai_critique",
        settings_template: {...},
        // ...
    },
    // ...
]
```

**Recommendation: Option A**

- Keeps templates in sync across frontend/backend
- Allows for dynamic filtering (OSS vs EE)
- No code duplication

### Frontend Migration

1. Create new service function:
```typescript
// web/oss/src/services/evaluators/index.ts

export const fetchEvaluatorTemplates = async () => {
    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/simple/evaluators/templates?project_id=${projectId}`
    )
    return response.data
}
```

2. Update `evaluatorsQueryAtomFamily` to use new endpoint when `preview=false`

3. Deprecate `fetchAllEvaluators()`

---

## Implementation Checklist

### Phase 1 (Immediate - All Dead Code Removal) ✅ COMPLETED

**Frontend:**
- [x] Delete `web/oss/src/services/evaluations/api_ee/index.ts`

**Backend - Remove from `evaluators_router.py`:**
- [x] Remove `evaluator_run()` (POST /evaluators/{key}/run)
- [x] Remove `_run_evaluator()` helper
- [x] Remove `evaluator_data_map()` (POST /evaluators/map)
- [x] Remove `get_evaluator_configs()` (GET /evaluators/configs/)
- [x] Remove `get_evaluator_config()` (GET /evaluators/configs/{id}/)
- [x] Remove `create_new_evaluator_config()` (POST /evaluators/configs/)
- [x] Remove `update_evaluator_config()` (PUT /evaluators/configs/{id}/)
- [x] Remove `delete_evaluator_config()` (DELETE /evaluators/configs/{id}/)
- [x] Remove unused imports

**Tests:**
- [x] Remove `api/oss/tests/legacy/old_tests/variants_main_router/test_variant_evaluators_router.py`

**SDK:**
- [ ] Regenerate OpenAPI spec (will auto-update on next SDK build)
- [ ] Verify SDK autogen client updates automatically

### Phase 2 (Templates Migration) ✅ COMPLETED

- [x] Add `/preview/simple/evaluators/templates` endpoint
- [x] Update `fetchAllEvaluators()` to use new endpoint
- [x] Remove `GET /evaluators/` legacy endpoint and router
- [x] Move `BUILTIN_EVALUATORS` to shared location (`get_builtin_evaluators()`)
- [x] Update migrations and services to use new function

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Remove `/evaluators/{key}/run` | None | Confirmed dead code - never imported |
| Remove `/evaluators/map` | None | Already removed from frontend |
| Remove `/evaluators/configs/*` | None | Confirmed dead code - no frontend/SDK usage |
| Migrate `GET /evaluators` | Low | Test all evaluator selection UIs |

---

## Verification Commands

```bash
# Verify no frontend usage of createEvaluatorRunExecution
cd web && grep -rn "createEvaluatorRunExecution" --include="*.ts" --include="*.tsx"

# Verify no frontend usage of /evaluators/map
cd web && grep -rn "evaluators/map" --include="*.ts" --include="*.tsx"

# Verify no SDK usage of evaluator_run
cd sdk && grep -rn "evaluator_run\|/run" --include="*.py" | grep -v raw_client

# Check if any external clients might be using these endpoints
# (Review API access logs)
```
