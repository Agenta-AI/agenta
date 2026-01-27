# Risk Analysis: Evaluator Playground Migration

## Coupling Points

### 1. State Management Coupling

**Location:** `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms.ts`

**Risk Level:** MEDIUM

The playground state is tightly coupled to the `EvaluatorConfig` shape:

```typescript
// playgroundEditValuesAtom expects EvaluatorConfig shape
interface EvaluatorConfig {
    id: string
    evaluator_key: string
    name: string
    settings_values: Record<string, any>
}
```

**Impact:** 
- `commitPlaygroundAtom` expects `EvaluatorConfig` as input
- `playgroundEditValuesAtom` is read throughout ConfigureEvaluator and DebugSection
- Form initialization relies on `settings_values` property name

**Mitigation (PR 1):**
- Update atoms to use `SimpleEvaluator` shape directly
- Add derived atoms for backward-compatible access (e.g., `evaluator_key` from URI)
- Update all atom consumers in ConfigureEvaluator and DebugSection

---

### 2. Form Initialization Coupling

**Location:** `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/index.tsx`

**Risk Level:** MEDIUM

Form initialization directly accesses `settings_values`:

```typescript
// Line 383-410
if (editMode && editEvalEditValues) {
    form.setFieldsValue({
        ...editEvalEditValues,
        settings_values: editEvalEditValues.settings_values || {},
    })
}
```

**Impact:**
- Changing to `data.parameters` would break form binding
- DynamicFormField components use `["settings_values", field.key]` name paths

**Mitigation (PR 1):**
- Update form field names from `settings_values` to `parameters`
- Update DynamicFormField name paths
- Update form.getFieldsValue() to extract `parameters`

---

### 3. Service Layer Coupling

**Location:** `web/oss/src/services/evaluators/index.ts`

**Risk Level:** LOW-MEDIUM

API calls directly construct legacy payload shapes:

```typescript
// createEvaluatorConfig
return axios.post(`/evaluators/configs?project_id=${projectId}`, {
    ...config,
})

// updateEvaluatorConfig  
return axios.put(`/evaluators/configs/${configId}?project_id=${projectId}`, config)
```

**Impact:**
- Need to update URLs and payload transformation
- Response handling needs to unwrap `{ evaluator: ... }` wrapper

**Mitigation (PR 1):**
- Replace all service functions with new implementations
- New functions build `SimpleEvaluator` payloads directly
- Handle response wrapper in service layer

---

### 4. Evaluators Registry Coupling

**Location:** `web/oss/src/components/Evaluators/hooks/useEvaluatorsRegistryData.ts`

**Risk Level:** MEDIUM

The hook transforms and combines data from two sources:

```typescript
const {evaluatorConfigs} = useFetchEvaluatorsData()
// Combines with evaluator templates for display
```

**Impact:**
- Table columns expect `evaluator_key` property
- Tag cells, type pills depend on config shape
- Filtering/search operates on legacy property names

**Mitigation (PR 1):**
- Update hook to work with `SimpleEvaluator[]`
- Derive `evaluator_key` from `data.uri` for display
- Update column accessors in getColumns.tsx

---

### 5. Debug Section - Evaluator Run Coupling

**Location:** `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx`

**Risk Level:** MEDIUM (PR 2)

The evaluator run uses legacy endpoint:

```typescript
const runResponse = await createEvaluatorRunExecution(
    selectedEvaluator.key,  // evaluator_key
    { inputs: outputs, settings: ... }
)
```

**Impact:**
- Must migrate to `/preview/workflows/invoke`
- Need to construct `WorkflowServiceRequest`
- Different error handling (workflow status vs HTTP errors)

**Mitigation (PR 2):**
- Create new `invokeEvaluator()` service function
- Build `WorkflowServiceRequest` with URI from `SimpleEvaluator.data.uri`
- Map workflow response/errors to UI

---

### 6. Global Atoms Coupling

**Location:** `web/oss/src/state/evaluators/atoms.ts`

**Risk Level:** MEDIUM

Query atoms return legacy-shaped data:

```typescript
const evaluatorConfigsQueryAtomFamily = atomFamily((projectId) =>
    atomWithQuery(() => ({
        queryKey: ['evaluator-configs', projectId],
        queryFn: () => fetchAllEvaluatorConfigs(null, projectId),
    }))
)
```

**Impact:**
- Multiple components may depend on these atoms
- Changing shape could cascade through application

**Mitigation (PR 1):**
- Update service function to return `SimpleEvaluator[]`
- Update all consumers to handle new shape
- Change in one place (service), ripple through atoms automatically

---

### 7. Evaluator Templates vs Configs Distinction

**Location:** Throughout frontend

**Risk Level:** LOW

The frontend distinguishes between:
- **Evaluator templates** (`Evaluator`): Built-in evaluator definitions with `settings_template`
- **Evaluator configs** (`SimpleEvaluator`): User-created configurations with `data.parameters`

**Impact:**
- This distinction is maintained in the new system
- Templates come from `/evaluators/` (unchanged)
- Configs become `SimpleEvaluator` objects

**Mitigation:**
- No conceptual change needed
- Templates API unchanged
- Just update config handling

---

## Risk Summary Table

| Component | Risk Level | PR | Priority |
|-----------|-----------|-----|----------|
| Service Layer | LOW-MEDIUM | PR 1 | HIGH (change first) |
| State Atoms | MEDIUM | PR 1 | HIGH |
| ConfigureEvaluator Form | MEDIUM | PR 1 | MEDIUM |
| Evaluators Registry | MEDIUM | PR 1 | MEDIUM |
| Global Query Atoms | MEDIUM | PR 1 | MEDIUM |
| Debug Section (Run) | MEDIUM | PR 2 | MEDIUM |

## Concrete Breakage Scenarios

### Scenario 1: Form Submission Fails

**Trigger:** Form still uses `settings_values` but service expects `parameters`

**Symptoms:**
- Form submits but settings are lost
- Backend receives empty configuration
- Evaluator created but doesn't work

**Prevention:**
- Update form field names to `parameters`
- Test form submission with real backend
- Verify payload in network tab

---

### Scenario 2: Evaluator List Empty

**Trigger:** Query endpoint returns `SimpleEvaluator[]`, UI expects `EvaluatorConfig[]`

**Symptoms:**
- Evaluators registry shows empty list
- No error messages (data exists but unparseable)
- Console shows undefined property access

**Prevention:**
- Update all components to use `SimpleEvaluator` shape
- Add null checks for `data?.uri`, `data?.parameters`
- Log transformation errors

---

### Scenario 3: Edit Mode Fails to Load

**Trigger:** Component expects `settings_values`, receives `data.parameters`

**Symptoms:**
- Navigate to edit page, form is empty
- Settings not populated
- Save overwrites with empty config

**Prevention:**
- Update form initialization to read from `data.parameters`
- Test edit flow with existing configs

---

### Scenario 4: Delete Fails Silently

**Trigger:** `DELETE` endpoint no longer exists, `POST .../archive` required

**Symptoms:**
- Click delete, no error
- Evaluator still appears
- Network tab shows 404/405

**Prevention:**
- Update delete function to use archive endpoint
- Verify response handling

---

### Scenario 5: Evaluator Run Fails (PR 2)

**Trigger:** Workflow invoke returns different response shape

**Symptoms:**
- Run button shows error
- Results not displayed
- Console shows parsing errors

**Prevention:**
- Map `WorkflowServiceBatchResponse` to expected output format
- Handle `status.code` errors from workflow response
- Test with all evaluator types

---

## Recommended Testing Strategy

### PR 1 Testing

**Unit Tests:**
- [ ] URI parsing (`agenta:builtin:key:v0` → `key`)
- [ ] Slug generation from name
- [ ] Service function request/response handling

**Integration Tests:**
- [ ] Create evaluator config flow
- [ ] Edit evaluator config flow  
- [ ] Delete (archive) evaluator config flow
- [ ] List/query evaluator configs flow

**E2E Tests:**
- [ ] Full playground flow: select template → configure → test → commit
- [ ] Edit existing evaluator configuration
- [ ] Clone evaluator configuration
- [ ] Delete evaluator configuration

### PR 2 Testing

**Unit Tests:**
- [ ] `WorkflowServiceRequest` construction
- [ ] Response mapping to evaluator output format
- [ ] Error status handling

**Integration Tests:**
- [ ] Run evaluator with different types (exact_match, regex, AI critique)
- [ ] Error scenarios (invalid inputs, missing outputs)

**Regression Tests:**
- [ ] Existing configs load correctly
- [ ] Batch evaluations still work (they use backend workflow invoke)
