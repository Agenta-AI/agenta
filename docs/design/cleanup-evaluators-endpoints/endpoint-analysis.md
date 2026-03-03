# Endpoint-by-Endpoint Analysis

## 1. `GET /evaluators/` - Evaluator Templates List

### What It Does

Returns **static built-in evaluator templates** (not user-created configs). These are the evaluator type definitions like "LLM-as-a-judge", "Code Evaluation", "Exact Match", etc.

### Backend Implementation

```python
# api/oss/src/routers/evaluators_router.py:115-117

# Load builtin evaluators once at module load
BUILTIN_EVALUATORS: List[LegacyEvaluator] = [
    LegacyEvaluator(**evaluator_dict) for evaluator_dict in get_all_evaluators()
]

@router.get("/", response_model=List[LegacyEvaluator])
async def get_evaluators_endpoint():
    return BUILTIN_EVALUATORS
```

The data comes from `api/oss/src/resources/evaluators/evaluators.py` which is a static Python list of evaluator definitions.

### Frontend Usage

**Service function:**
```typescript
// web/oss/src/services/evaluators/index.ts:95-116

export const fetchAllEvaluators = async (includeArchived = false) => {
    const response = await axios.get(`/evaluators?project_id=${projectId}`)
    // ... filtering and decoration
    return evaluators
}
```

**Atom usage:**
```typescript
// web/oss/src/state/evaluators/atoms.ts:311
const data = await fetchAllEvaluators()

// web/oss/src/state/evaluators/atoms.ts:355
const all = await fetchAllEvaluators(true)
```

**Where it's consumed (via `useFetchEvaluatorsData` hook with `preview=false`):**

| Component | File | Purpose |
|-----------|------|---------|
| EvaluatorsRegistry | `components/Evaluators/hooks/useEvaluatorsRegistryData.ts:22` | Main evaluators list page |
| ConfigureEvaluator | `components/Evaluators/components/ConfigureEvaluator/index.tsx:51` | Evaluator configuration page |
| SelectEvaluatorModalContent | `components/Evaluators/components/SelectEvaluatorModal/.../index.tsx:27` | Evaluator template selector |
| NewEvaluationModalInner | `components/pages/evaluations/NewEvaluation/.../NewEvaluationModalInner.tsx:85` | New evaluation wizard |
| SelectEvaluatorSection | `components/pages/evaluations/NewEvaluation/.../SelectEvaluatorSection.tsx:62` | Evaluator selection in evaluation flow |
| EvaluatorTemplateDropdown | `components/pages/evaluations/NewEvaluation/.../EvaluatorTemplateDropdown.tsx:41` | Evaluator template dropdown |
| OnlineEvaluationDrawer | `components/pages/evaluations/onlineEvaluation/OnlineEvaluationDrawer.tsx:59` | Online evaluation drawer |
| EvaluatorsModal | `components/pages/evaluations/autoEvaluation/EvaluatorsModal/EvaluatorsModal.tsx:39` | Evaluators modal |

### Status: ACTIVE - Needs Migration

### Proposal: Move to `/preview/simple/evaluators/templates`

See [migration-plan.md](./migration-plan.md) for details.

---

## 2. `POST /evaluators/{evaluator_key}/run` - Execute Evaluator

### What It Does

Executes an evaluator by key directly. This was the old way to run evaluators in the playground.

### Backend Implementation

```python
# api/oss/src/routers/evaluators_router.py:154-196

@router.post("/{evaluator_key}/run", response_model=EvaluatorOutputInterface)
async def evaluator_run(
    request: Request, evaluator_key: str, payload: EvaluatorInputInterface
):
    # ... sets up tracing context
    result = await _run_evaluator(evaluator_key, payload)
    return result
```

### Frontend Usage

**Service function:**
```typescript
// web/oss/src/services/evaluations/api_ee/index.ts:21-40

export const createEvaluatorRunExecution = async (
    evaluatorKey: string,
    config: EvaluatorInputInterface,
    options?: EvaluatorRunOptions,
): Promise<EvaluatorOutputInterface> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluators/${evaluatorKey}/run?project_id=${projectId}`,
        {...config},
        {signal: options?.signal, timeout},
    )
    return response.data
}
```

**Import search result:**
```
$ grep -rn "createEvaluatorRunExecution" web/
oss/src/services/evaluations/api_ee/index.ts:21:export const createEvaluatorRunExecution = async (
# ^^^ ONLY DEFINITION, NO IMPORTS
```

### Status: DEAD CODE ❌

The function `createEvaluatorRunExecution` is **defined but never imported or used anywhere** in the codebase.

**Evidence:**
1. grep search shows only the definition, no imports
2. PR #3572 (commit `9b9435ae5`) migrated the frontend to use `invokeEvaluator()` via `/preview/workflows/invoke`

**Migration that made it obsolete:**
```diff
# Commit 9b9435ae5 - feat(frontend): invoke evaluators via workflows

-import {
-    createEvaluatorDataMapping,
-    createEvaluatorRunExecution,
-} from "@/oss/services/evaluations/api_ee"
+import {createEvaluatorDataMapping} from "@/oss/services/evaluations/api_ee"
+import {
+    invokeEvaluator,
+    mapWorkflowResponseToEvaluatorOutput,
+} from "@/oss/services/workflows/invoke"
```

### Action: REMOVE

Safe to remove both:
- Frontend: `web/oss/src/services/evaluations/api_ee/index.ts` (entire file can be deleted)
- Backend: The `evaluator_run` endpoint in `evaluators_router.py`

---

## 3. `POST /evaluators/map` - Data Mapping Helper

### What It Does

Maps experiment data tree to evaluator interface format. Was used to transform trace data for evaluator inputs.

### Backend Implementation

```python
# api/oss/src/routers/evaluators_router.py:120-151

@router.post("/map", response_model=EvaluatorMappingOutputInterface)
async def evaluator_data_map(request: Request, payload: EvaluatorMappingInputInterface):
    # ... processes trace tree and maps fields
    return {"outputs": mapping_outputs}
```

### Frontend Usage

**Already removed** in commit `09dba15d9` (Feb 13, 2026):

```diff
# Commit 09dba15d9 - fix(evaluators): persist template-driven output schemas

-export const createEvaluatorDataMapping = async (
-    config: EvaluatorMappingInput,
-): Promise<EvaluatorMappingOutput> => {
-    const {projectId} = getProjectValues()
-
-    const response = await axios.post(
-        `${getAgentaApiUrl()}/evaluators/map?project_id=${projectId}`,
-        {...config},
-    )
-    return response.data
-}
```

### Status: DEAD CODE ❌

### Action: REMOVE

Safe to remove the backend endpoint.

---

## 4. Legacy Evaluator Configs Endpoints

### Endpoints

- `GET /evaluators/configs/` - List configs
- `GET /evaluators/configs/{id}/` - Get config by ID
- `POST /evaluators/configs/` - Create config
- `PUT /evaluators/configs/{id}/` - Update config
- `DELETE /evaluators/configs/{id}/` - Delete config

### Status: DEAD CODE ❌

### Frontend Usage

**Verification:**
```bash
$ grep -rn "evaluators/configs" web/ --include="*.ts" --include="*.tsx"
# NO RESULTS
```

The frontend does **NOT** use these endpoints. It uses only:
- `POST /preview/simple/evaluators/query`
- `POST /preview/simple/evaluators/`
- `PUT /preview/simple/evaluators/{id}`
- `POST /preview/simple/evaluators/{id}/archive`

### SDK Usage

**Verification:**
```bash
$ grep -rn "evaluators/configs" sdk/ --include="*.py" | grep -v raw_client
# NO RESULTS
```

Only the auto-generated `raw_client.py` contains these endpoints (generated from OpenAPI spec).

### Backend Usage

Only found in:
- Legacy test file: `test_variant_evaluators_router.py`
- Analytics service (tracking events)
- The router definition itself

### Action: REMOVE

Safe to remove all these endpoints. The backend internally uses `SimpleEvaluatorsService` which the new endpoints also use.

---

## SDK Impact

The autogenerated SDK client (`sdk/agenta/client/backend/evaluators/raw_client.py`) includes the `/evaluators/{key}/run` endpoint, but:

1. The SDK managers (`sdk/agenta/sdk/managers/evaluators.py`) only use the new APIs
2. The raw client is auto-generated from OpenAPI - removing the endpoint will auto-remove the client method

**No SDK code actively uses the legacy endpoints.**
