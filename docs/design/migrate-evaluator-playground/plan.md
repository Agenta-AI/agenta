# Migration Plan: Evaluator Playground

## Overview

Full migration of the Evaluator Playground to the new workflow-based evaluator APIs. This plan follows **Plan B (Direct Migration)** - no adapters, internal shapes change to match the new `SimpleEvaluator` model.

## Migration Strategy

**Two PRs, no adapters:**

1. **PR 1:** Migrate CRUD to `SimpleEvaluator` endpoints (internal shapes change)
2. **PR 2:** Migrate run to native workflow invoke (`/preview/workflows/invoke`)

This keeps changes reviewable while avoiding tech debt from adapter layers.

```
PR 1: CRUD Migration
┌─────────────────────────────────────────────────────────────────┐
│  EvaluatorConfig → SimpleEvaluator                              │
│  /evaluators/configs/* → /preview/simple/evaluators/*           │
│  settings_values → data.parameters                              │
│  evaluator_key → data.uri                                       │
└─────────────────────────────────────────────────────────────────┘

PR 2: Run Migration  
┌─────────────────────────────────────────────────────────────────┐
│  /evaluators/{key}/run → /preview/workflows/invoke              │
│  EvaluatorInputInterface → WorkflowServiceRequest               │
└─────────────────────────────────────────────────────────────────┘
```

---

## PR 1: CRUD Migration

**Goal:** Replace legacy evaluator config endpoints with new SimpleEvaluator endpoints. Change internal data model from `EvaluatorConfig` to `SimpleEvaluator`.

### Phase 1.1: Type Definitions

**File:** `web/oss/src/lib/Types.ts` (add to existing types)

```typescript
// ============ SimpleEvaluator Types ============

export interface SimpleEvaluatorData {
    version?: string
    uri?: string                              // e.g., "agenta:builtin:auto_exact_match:v0"
    url?: string                              // for webhook evaluators
    headers?: Record<string, string>
    schemas?: { 
        outputs?: Record<string, any>
        inputs?: Record<string, any>
        parameters?: Record<string, any>
    }
    script?: { content: string; runtime: string }
    parameters?: Record<string, any>          // replaces settings_values
}

export interface SimpleEvaluatorFlags {
    is_custom?: boolean
    is_evaluator?: boolean
    is_human?: boolean
}

export interface SimpleEvaluator {
    id: string
    slug: string
    name?: string
    description?: string
    tags?: string[]
    meta?: Record<string, any>
    flags?: SimpleEvaluatorFlags
    data?: SimpleEvaluatorData
    created_at: string
    updated_at: string
}

export interface SimpleEvaluatorCreate {
    slug: string
    name?: string
    description?: string
    tags?: string[]
    flags?: SimpleEvaluatorFlags
    data?: SimpleEvaluatorData
}

export interface SimpleEvaluatorEdit {
    id: string
    name?: string
    description?: string
    tags?: string[]
    data?: SimpleEvaluatorData
}

export interface SimpleEvaluatorResponse {
    count: number
    evaluator: SimpleEvaluator | null
}

export interface SimpleEvaluatorsResponse {
    count: number
    evaluators: SimpleEvaluator[]
}
```

**Deliverables:**
- [ ] Add `SimpleEvaluator*` types to Types.ts
- [ ] Keep `EvaluatorConfig` temporarily for areas not yet migrated

---

### Phase 1.2: Service Layer Changes

**File:** `web/oss/src/services/evaluators/index.ts`

Output schema ownership for create and edit:

- If evaluator template includes `outputs_schema`, send it as `data.schemas.outputs`
- If evaluator is `auto_ai_critique`, derive from `parameters.json_schema.schema`
- If evaluator is `json_multi_field_match`, derive from `parameters.fields`
- If evaluator has no known schema, omit `data.schemas.outputs`

Replace legacy functions with new implementations:

```typescript
// ============ Helper Functions ============

/**
 * Extract evaluator_key from URI
 * URI format: "agenta:builtin:{key}:v0"
 */
export function extractEvaluatorKeyFromUri(uri: string | undefined): string {
    if (!uri) return ""
    const parts = uri.split(":")
    if (parts.length >= 3 && parts[0] === "agenta" && parts[1] === "builtin") {
        return parts[2]
    }
    return ""
}

/**
 * Build URI from evaluator key
 */
export function buildEvaluatorUri(evaluatorKey: string): string {
    return `agenta:builtin:${evaluatorKey}:v0`
}

/**
 * Generate slug from name (append suffix to avoid collisions)
 */
export function generateSlug(name: string): string {
    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")

    const suffix = Math.random().toString(36).slice(2, 8)
    const maxBaseLength = Math.max(1, 50 - suffix.length - 1)
    return `${base.slice(0, maxBaseLength)}-${suffix}`
}

// ============ CRUD Functions ============

export const fetchAllEvaluatorConfigs = async (
    _appId?: string | null,  // kept for backward compat, ignored
    projectIdOverride?: string | null,
): Promise<SimpleEvaluator[]> => {
    const {projectId: projectIdFromStore} = getProjectValues()
    const projectId = projectIdOverride ?? projectIdFromStore

    if (!projectId) return []

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/query?project_id=${projectId}`,
        {
            evaluator: { flags: { is_evaluator: true, is_human: false } },
            include_archived: false,
        }
    )
    
    return response.data?.evaluators || []
}

export const createEvaluatorConfig = async (
    evaluatorKey: string,
    name: string,
    settingsValues: Record<string, any>,
): Promise<SimpleEvaluator> => {
    const {projectId} = getProjectValues()
    
    const payload: SimpleEvaluatorCreate = {
        slug: generateSlug(name),
        name,
        flags: { is_evaluator: true, is_human: false },
        data: {
            uri: buildEvaluatorUri(evaluatorKey),
            parameters: settingsValues,
        },
    }
    
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/?project_id=${projectId}`,
        { evaluator: payload },
    )
    
    const result = response.data?.evaluator
    if (!result) throw new Error("Failed to create evaluator")
    
    return result
}

export const updateEvaluatorConfig = async (
    evaluatorId: string,
    updates: { name?: string; settingsValues?: Record<string, any> },
    existing?: SimpleEvaluator,
): Promise<SimpleEvaluator> => {
    const {projectId} = getProjectValues()

    // IMPORTANT: include existing data (uri/schemas) when editing
    const payload: SimpleEvaluatorEdit = {
        id: evaluatorId,
        name: updates.name ?? existing?.name,
        data: {
            ...(existing?.data ?? {}),
            ...(updates.settingsValues ? {parameters: updates.settingsValues} : {}),
        },
        tags: existing?.tags,
        meta: existing?.meta,
        flags: existing?.flags,
    }

    const response = await axios.put(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${evaluatorId}?project_id=${projectId}`,
        { evaluator: payload },
    )
    
    const result = response.data?.evaluator
    if (!result) throw new Error("Failed to update evaluator")
    
    return result
}

export const deleteEvaluatorConfig = async (evaluatorId: string): Promise<boolean> => {
    const {projectId} = getProjectValues()

    await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${evaluatorId}/archive?project_id=${projectId}`,
    )
    
    return true
}

export const fetchEvaluatorById = async (evaluatorId: string): Promise<SimpleEvaluator | null> => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${evaluatorId}?project_id=${projectId}`,
    )
    
    return response.data?.evaluator || null
}
```

**Deliverables:**
- [ ] Replace `fetchAllEvaluatorConfigs` implementation
- [ ] Replace `createEvaluatorConfig` implementation
- [ ] Replace `updateEvaluatorConfig` implementation
- [ ] Replace `deleteEvaluatorConfig` implementation
- [ ] Add helper functions for URI handling
- [ ] Remove legacy endpoint calls

---

### Phase 1.3: State/Atoms Changes

**File:** `web/oss/src/state/evaluators/atoms.ts`

Update query atoms to return `SimpleEvaluator[]`:

```typescript
export const evaluatorConfigsQueryAtomFamily = atomFamily((projectId: string | null) =>
    atomWithQuery(() => ({
        queryKey: ["evaluator-configs", projectId],
        queryFn: () => fetchAllEvaluatorConfigs(null, projectId),
        enabled: !!projectId,
    }))
)

// Derived atom for non-archived evaluators
export const nonArchivedEvaluatorsAtom = atom((get) => {
    const projectId = get(projectIdAtom)
    if (!projectId) return []
    
    const query = get(evaluatorConfigsQueryAtomFamily(projectId))
    const evaluators = query.data ?? []
    
    // Filter out archived (deleted_at is set)
    return evaluators.filter((e) => !e.deleted_at)
})
```

**File:** `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms.ts`

Update playground atoms to use `SimpleEvaluator`:

```typescript
// Session now stores SimpleEvaluator instead of EvaluatorConfig
export interface PlaygroundSession {
    evaluator: Evaluator              // template (unchanged)
    simpleEvaluator?: SimpleEvaluator // existing config being edited
    mode: "create" | "edit" | "clone"
}

export const playgroundSessionAtom = atom<PlaygroundSession | null>(null)

// Edit values now use SimpleEvaluator shape
export const playgroundEditValuesAtom = atom<Partial<SimpleEvaluator> | null>(null)

// Derived: get evaluator_key from URI
export const playgroundEvaluatorKeyAtom = atom((get) => {
    const session = get(playgroundSessionAtom)
    if (!session) return null
    
    // From template
    if (session.evaluator?.key) return session.evaluator.key
    
    // From existing SimpleEvaluator
    if (session.simpleEvaluator?.data?.uri) {
        return extractEvaluatorKeyFromUri(session.simpleEvaluator.data.uri)
    }
    
    return null
})
```

**Deliverables:**
- [ ] Update `evaluatorConfigsQueryAtomFamily` return type
- [ ] Update playground session atoms
- [ ] Update `playgroundEditValuesAtom` shape
- [ ] Add derived atoms for backward-compatible access (e.g., `evaluator_key`)

---

### Phase 1.4: Component Changes

#### ConfigureEvaluator/index.tsx

Key changes:
- Form fields read/write to `data.parameters` instead of `settings_values`
- On commit, build `SimpleEvaluatorCreate` or `SimpleEvaluatorEdit`
- Load existing config as `SimpleEvaluator`

```typescript
// Before
form.setFieldsValue({
    name: editEvalEditValues.name,
    settings_values: editEvalEditValues.settings_values,
})

// After (use parameters field to match SimpleEvaluator)
form.setFieldsValue({
    name: simpleEvaluator.name,
    parameters: simpleEvaluator.data?.parameters,
})
```

#### useEvaluatorsRegistryData.ts

Update to work with `SimpleEvaluator[]`:

```typescript
// Derive evaluator_key for display
const enrichedEvaluators = evaluators.map((e) => ({
    ...e,
    evaluator_key: extractEvaluatorKeyFromUri(e.data?.uri),
    parameters: e.data?.parameters,
}))
```

#### getColumns.tsx

Update column accessors:

```typescript
// Before
dataIndex: "evaluator_key"

// After  
dataIndex: ["data", "uri"],
render: (uri) => extractEvaluatorKeyFromUri(uri)
```

**Deliverables:**
- [ ] Update ConfigureEvaluator form bindings
- [ ] Update commit logic to use new service functions
- [ ] Update useEvaluatorsRegistryData hook
- [ ] Update table columns in getColumns.tsx
- [ ] Update any other components that read evaluator configs

---

### Phase 1.5: Testing

**Test Cases:**

1. **List Evaluators**
   - [ ] Registry shows all existing evaluator configs
   - [ ] Correct names, types, icons displayed
   - [ ] Filtering and search work
   - [ ] Archived evaluators hidden

2. **Create Evaluator**
   - [ ] Select template → Configure → Commit works
   - [ ] Settings (parameters) saved correctly
   - [ ] URI generated correctly from evaluator_key
   - [ ] Slug generated from name

3. **Edit Evaluator**
   - [ ] Load existing config into form
   - [ ] Form populated with current values from `data.parameters`
   - [ ] Update name and settings
   - [ ] Changes persisted

4. **Delete Evaluator**
   - [ ] Archive endpoint called
   - [ ] Evaluator removed from list
   - [ ] No errors

5. **Run Evaluator (legacy endpoint - still works)**
   - [ ] Run evaluator button works
   - [ ] Uses evaluator_key derived from URI
   - [ ] Results displayed correctly

**Deliverables:**
- [ ] Manual test all flows
- [ ] Fix any bugs found
- [ ] Document any edge cases

---

### PR 1 Summary

| Task | Files | Effort |
|------|-------|--------|
| Type definitions | `Types.ts` | 0.5 day |
| Service layer | `services/evaluators/index.ts` | 1 day |
| State/atoms | `state/evaluators/atoms.ts`, playground atoms | 1 day |
| Components | ConfigureEvaluator, Registry, columns | 1-2 days |
| Testing | Manual testing | 1 day |

**Total PR 1 Effort:** 4-5 days

---

## PR 2: Run Migration

**Goal:** Replace legacy `/evaluators/{key}/run` with native workflow invoke `/preview/workflows/invoke`.

**Prerequisite:** PR 1 merged and stable.

### Phase 2.1: WorkflowService Types

**File:** `web/oss/src/lib/Types.ts` (add)

```typescript
// ============ Workflow Service Types ============

export interface WorkflowServiceRequestData {
    revision?: Record<string, any>
    parameters?: Record<string, any>    // evaluator settings
    testcase?: Record<string, any>
    inputs?: Record<string, any>        // merged testcase data
    trace?: Record<string, any>
    outputs?: any                        // prediction/output
}

export interface WorkflowServiceInterface {
    version?: string
    uri?: string                         // e.g., "agenta:builtin:auto_exact_match:v0"
    url?: string
    headers?: Record<string, string>
    schemas?: Record<string, any>
}

export interface WorkflowServiceConfiguration {
    script?: Record<string, any>
    parameters?: Record<string, any>
}

export interface WorkflowServiceRequest {
    version?: string
    flags?: Record<string, any>
    interface?: WorkflowServiceInterface
    configuration?: WorkflowServiceConfiguration
    data?: WorkflowServiceRequestData
    references?: Record<string, any>
    links?: Record<string, any>
}

export interface WorkflowServiceStatus {
    code?: number
    message?: string
    type?: string
    stacktrace?: string | string[]
}

export interface WorkflowServiceResponseData {
    outputs?: any
}

export interface WorkflowServiceBatchResponse {
    version?: string
    trace_id?: string
    span_id?: string
    status?: WorkflowServiceStatus
    data?: WorkflowServiceResponseData
}
```

---

### Phase 2.2: Workflow Invoke Service

**File:** `web/oss/src/services/workflows/invoke.ts` (new file)

```typescript
import axios from "@/oss/lib/api/assets/axiosConfig"
import type { SimpleEvaluator } from "@/oss/lib/Types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import { getAgentaApiUrl } from "@/oss/lib/helpers/api"
import { buildEvaluatorUri, resolveEvaluatorKey } from "@/oss/lib/evaluators/utils"
import { getProjectValues } from "@/oss/state/project"

export interface WorkflowServiceBatchResponse {
    status?: { code?: number; message?: string }
    data?: { outputs?: any }
}

export interface InvokeEvaluatorParams {
    evaluator?: Partial<SimpleEvaluator> | null
    inputs?: Record<string, any>        // testcase data + any extra inputs
    outputs?: any                        // prediction/output from variant
    parameters?: Record<string, any>   // override settings (optional)
}

/**
 * Invoke an evaluator using native workflow service
 */
export const invokeEvaluator = async (
    params: InvokeEvaluatorParams
): Promise<WorkflowServiceBatchResponse> => {
    const { projectId } = getProjectValues()
    const { evaluator, inputs, outputs, parameters } = params

    const evaluatorKey = resolveEvaluatorKey(evaluator)
    const uri = evaluator?.data?.uri || (evaluatorKey ? buildEvaluatorUri(evaluatorKey) : undefined)
    if (!uri) throw new Error("Evaluator URI is missing")

    const request = {
        interface: { uri },
        configuration: {
            parameters: parameters ?? evaluator.data?.parameters,
        },
        data: {
            inputs,
            outputs,
            parameters: parameters ?? evaluator.data?.parameters,
        },
    }

    const response = await axios.post<WorkflowServiceBatchResponse>(
        `${getAgentaApiUrl()}/preview/workflows/invoke?project_id=${projectId}`,
        request,
    )

    return response.data
}

/**
 * Map workflow response to evaluator output format
 */
export function mapWorkflowResponseToEvaluatorOutput(
    response: WorkflowServiceBatchResponse
): { outputs: Record<string, any> } {
    if (response.status?.code && response.status.code >= 400) {
        throw new Error(response.status.message || "Evaluator execution failed")
    }

    return {
        outputs: response.data?.outputs ?? {},
    }
}
```

---

### Phase 2.3: Update DebugSection

**File:** `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx`

Replace `createEvaluatorRunExecution` with `invokeEvaluator`:

```typescript
// Before
const runResponse = await createEvaluatorRunExecution(
    selectedEvaluator.key,
    {
        inputs: outputs,
        settings: formValues.parameters,
    }
)

// After
import { invokeEvaluator, mapWorkflowResponseToEvaluatorOutput } from "@/oss/services/workflows/invoke"

const workflowResponse = await invokeEvaluator({
    evaluator: simpleEvaluator ?? { data: { uri: buildEvaluatorUri(selectedEvaluator.key) } },
    inputs: evaluatorInputs,
    outputs: variantOutput,
    parameters: formValues.parameters,  // current form settings
})

const runResponse = mapWorkflowResponseToEvaluatorOutput(workflowResponse)
```

**Error Handling:**

```typescript
try {
    const workflowResponse = await invokeEvaluator(...)
    
    // Check for workflow-level errors
    if (workflowResponse.status?.code && workflowResponse.status.code >= 400) {
        message.error(workflowResponse.status.message || "Evaluator failed")
        return
    }
    
    const result = mapWorkflowResponseToEvaluatorOutput(workflowResponse)
    setEvaluatorResult(result.outputs)
    
} catch (error) {
    message.error(getErrorMessage(error))
}
```

---

### Phase 2.4: Update Evaluations Service (if needed)

If other parts of the app use `createEvaluatorRunExecution`, update them too:

**File:** `web/oss/src/services/evaluations/api_ee/index.ts`

- Keep `createEvaluatorRunExecution` for now (batch evaluations may still use it via backend)
- Or deprecate and point to new invoke

---

### Phase 2.5: Testing

**Test Cases:**

1. **Run Evaluator in Playground**
   - [ ] Click "Run Evaluator" with testcase loaded
   - [ ] Native invoke endpoint called
   - [ ] Results displayed correctly
   - [ ] Errors handled gracefully

2. **Different Evaluator Types**
   - [ ] Test exact_match evaluator
   - [ ] Test regex evaluator
   - [ ] Test AI critique evaluator (LLM-based)
   - [ ] Test custom code evaluator

3. **Error Scenarios**
   - [ ] Invalid evaluator (no URI)
   - [ ] Missing inputs
   - [ ] Evaluator execution error
   - [ ] Network error

4. **Permissions**
   - [ ] User with RUN_WORKFLOWS permission can run
   - [ ] User without permission gets appropriate error

**Deliverables:**
- [ ] Manual test all evaluator types
- [ ] Fix any bugs found
- [ ] Verify error messages are user-friendly

---

### PR 2 Summary

| Task | Files | Effort |
|------|-------|--------|
| Workflow types | `Types.ts` | 0.5 day |
| Invoke service | `services/workflows/invoke.ts` | 0.5 day |
| DebugSection update | `DebugSection.tsx` | 1 day |
| Error handling | Various | 0.5 day |
| Testing | Manual testing | 1 day |

**Total PR 2 Effort:** 3-4 days

---

## Timeline Summary

| PR | Tasks | Effort | Dependencies |
|----|-------|--------|--------------|
| PR 1: CRUD Migration | Types, services, atoms, components | 4-5 days | Backend PR #3527 merged |
| PR 2: Run Migration | Workflow types, invoke service, DebugSection | 3-4 days | PR 1 merged and stable |

**Total Implementation:** 7-9 days

---

## Rollback Plan

### PR 1 Rollback
- Revert PR 1 commit
- Legacy endpoints still exist on backend for a period

### PR 2 Rollback
- Revert PR 2 commit
- Fall back to legacy `/evaluators/{key}/run` (still supported)

---

## Open Questions

1. **Slug uniqueness:** Backend enforces unique slugs per project; generate a short suffix client-side to avoid collisions.

2. **Output schemas:** Resolved. Backend hydrates missing builtin evaluator schemas from URI + parameters during create/edit.

3. **Permission model:** Is `RUN_WORKFLOWS` the right permission for evaluator playground? Or should there be `RUN_EVALUATORS`?

4. **Trace linking:** Should the playground display trace_id from workflow response for debugging?
