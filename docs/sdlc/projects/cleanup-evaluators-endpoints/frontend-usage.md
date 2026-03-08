# Frontend Evaluator Endpoint Usage Analysis

## Summary of API Calls

### Legacy Endpoints

| Endpoint | Service Function | Status |
|----------|------------------|--------|
| `GET /evaluators` | `fetchAllEvaluators()` | **ACTIVE** - needs migration |
| `POST /evaluators/{key}/run` | `createEvaluatorRunExecution()` | **DEAD CODE** - never imported |
| `POST /evaluators/map` | `createEvaluatorDataMapping()` | **DEAD CODE** - removed |
| `GET /evaluators/configs/` | None | **DEAD CODE** - not used |
| `POST /evaluators/configs/` | None | **DEAD CODE** - not used |
| `PUT /evaluators/configs/{id}/` | None | **DEAD CODE** - not used |
| `DELETE /evaluators/configs/{id}/` | None | **DEAD CODE** - not used |

### New Endpoints (In Use)

| Endpoint | Service Function | Status |
|----------|------------------|--------|
| `POST /preview/simple/evaluators/query` | `fetchAllEvaluatorConfigs()` | **ACTIVE** |
| `POST /preview/simple/evaluators/` | `createEvaluatorConfig()` | **ACTIVE** |
| `PUT /preview/simple/evaluators/{id}` | `updateEvaluatorConfig()` | **ACTIVE** |
| `GET /preview/simple/evaluators/{id}` | `fetchEvaluatorById()` | **ACTIVE** |
| `POST /preview/simple/evaluators/{id}/archive` | `deleteEvaluatorConfig()` | **ACTIVE** |
| `POST /preview/workflows/invoke` | `invokeEvaluator()` | **ACTIVE** |

### Verification

```bash
# Legacy configs endpoints - NOT USED
$ grep -rn "evaluators/configs" web/ --include="*.ts" --include="*.tsx"
# (no results)
```

---

## Detailed Call Chains

### 1. `GET /evaluators` - Evaluator Templates

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Service: fetchAllEvaluators()                                               │
│  File: web/oss/src/services/evaluators/index.ts:95-116                      │
│  Endpoint: GET /evaluators?project_id={projectId}                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Atom: evaluatorsQueryAtomFamily (when preview=false)                        │
│  File: web/oss/src/state/evaluators/atoms.ts:132-321                        │
│  Query Key: ["evaluators", projectKey]                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Hook: useEvaluators({ preview: false })                                     │
│  File: web/oss/src/lib/hooks/useEvaluators/index.ts:23-84                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Hook: useFetchEvaluatorsData()                                              │
│  File: web/oss/src/lib/hooks/useFetchEvaluatorsData/index.tsx               │
│  Sets: evaluatorsAtom (global state)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  COMPONENTS CONSUMING evaluatorsAtom:                                        │
│                                                                              │
│  1. EvaluatorsRegistry                                                       │
│     └─ useEvaluatorsRegistryData.ts                                         │
│                                                                              │
│  2. ConfigureEvaluator                                                       │
│     └─ components/Evaluators/components/ConfigureEvaluator/index.tsx        │
│                                                                              │
│  3. SelectEvaluatorModalContent                                              │
│     └─ SelectEvaluatorModal/assets/SelectEvaluatorModalContent/index.tsx    │
│                                                                              │
│  4. NewEvaluationModalInner                                                  │
│     └─ pages/evaluations/NewEvaluation/.../NewEvaluationModalInner.tsx      │
│                                                                              │
│  5. SelectEvaluatorSection                                                   │
│     └─ pages/evaluations/NewEvaluation/.../SelectEvaluatorSection.tsx       │
│                                                                              │
│  6. EvaluatorTemplateDropdown                                                │
│     └─ pages/evaluations/NewEvaluation/.../EvaluatorTemplateDropdown.tsx    │
│                                                                              │
│  7. OnlineEvaluationDrawer                                                   │
│     └─ pages/evaluations/onlineEvaluation/OnlineEvaluationDrawer.tsx        │
│                                                                              │
│  8. EvaluatorsModal                                                          │
│     └─ pages/evaluations/autoEvaluation/EvaluatorsModal/EvaluatorsModal.tsx │
│                                                                              │
│  9. EvaluatorCard                                                            │
│     └─ pages/evaluations/autoEvaluation/EvaluatorsModal/.../EvaluatorCard   │
│                                                                              │
│  10. EvaluatorList                                                           │
│      └─ pages/evaluations/autoEvaluation/EvaluatorsModal/.../EvaluatorList  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. `POST /evaluators/{key}/run` - DEAD CODE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Service: createEvaluatorRunExecution()                                      │
│  File: web/oss/src/services/evaluations/api_ee/index.ts:21-40               │
│  Endpoint: POST /evaluators/${evaluatorKey}/run?project_id={projectId}      │
│                                                                              │
│  STATUS: ❌ NEVER IMPORTED OR USED                                          │
│                                                                              │
│  Replaced by: invokeEvaluator() in web/oss/src/services/workflows/invoke.ts │
│  Migration commit: 9b9435ae5 (feat(frontend): invoke evaluators via workflows)│
└─────────────────────────────────────────────────────────────────────────────┘
```

**Verification:**
```bash
$ grep -rn "createEvaluatorRunExecution" web/ --include="*.ts" --include="*.tsx"
oss/src/services/evaluations/api_ee/index.ts:21:export const createEvaluatorRunExecution = async (
# Only the definition, no imports
```

---

### 3. `POST /evaluators/map` - REMOVED

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Service: createEvaluatorDataMapping() [REMOVED]                             │
│  Removed in commit: 09dba15d9                                                │
│  Previous file: web/oss/src/services/evaluations/api_ee/index.ts            │
│                                                                              │
│  STATUS: ❌ ALREADY REMOVED FROM FRONTEND                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 4. New Evaluator Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Service: invokeEvaluator()                                                  │
│  File: web/oss/src/services/workflows/invoke.ts:41-86                       │
│  Endpoint: POST /preview/workflows/invoke?project_id={projectId}            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Used by: DebugSection (Evaluator Playground)                                │
│  File: components/pages/evaluations/autoEvaluation/EvaluatorsModal/         │
│        ConfigureEvaluator/DebugSection.tsx                                   │
│                                                                              │
│  Purpose: Test evaluator execution in the playground                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Types

### Evaluator (Template)

```typescript
// web/oss/src/lib/Types.ts

export interface Evaluator {
    name: string                                    // "LLM-as-a-judge"
    key: string                                     // "auto_ai_critique"
    settings_presets?: SettingsPreset[]             // Pre-configured options
    settings_template: Record<string, EvaluationSettingsTemplate>  // Form schema
    outputs_schema?: Record<string, any>            // Expected output format
    icon_url?: string | StaticImageData
    color?: string
    direct_use?: boolean
    description: string
    oss?: boolean
    requires_llm_api_keys?: boolean
    tags: string[]
    archived?: boolean
}
```

### SimpleEvaluator (User-Created Config)

```typescript
// web/oss/src/lib/Types.ts

export interface SimpleEvaluator {
    id: string
    slug: string
    name?: string
    description?: string
    tags?: string[]
    flags?: SimpleEvaluatorFlags
    data?: SimpleEvaluatorData      // Contains uri, parameters, schemas
    created_at: string
    updated_at: string
    deleted_at?: string
}

export interface SimpleEvaluatorData {
    version?: string
    uri?: string                     // "agenta:builtin:auto_exact_match:v0"
    url?: string                     // For webhook evaluators
    headers?: Record<string, string>
    schemas?: Record<string, any>    // { outputs: {...} }
    script?: { content?: string; runtime?: string }
    parameters?: Record<string, any> // User-configured values
    service?: Record<string, any>
    configuration?: Record<string, any>
}
```

---

## Files to Modify/Delete

### DELETE

1. `web/oss/src/services/evaluations/api_ee/index.ts` - Contains only dead code

### MODIFY (Future Migration)

1. `web/oss/src/services/evaluators/index.ts`
   - Change `fetchAllEvaluators()` to call new endpoint

2. `web/oss/src/state/evaluators/atoms.ts`
   - Update `evaluatorsQueryAtomFamily` for `preview=false` case

3. Multiple components that consume `evaluatorsAtom`
   - No changes needed if atom is updated correctly
