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

**Mitigation:**
- Create adapter functions to convert between `SimpleEvaluator` and internal state
- Or update atoms to use `SimpleEvaluator` shape and update all consumers

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

**Mitigation:**
- Keep internal form structure as `settings_values` 
- Transform on API boundary (adapter pattern)

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

**Mitigation:**
- Create new service functions for new endpoints
- Keep old functions temporarily for gradual migration
- Add response/request transformers

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

**Mitigation:**
- Update hook to handle new `SimpleEvaluator` shape
- Transform data at fetch boundary, keep internal shape consistent

---

### 5. Debug Section - Evaluator Run Coupling

**Location:** `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx`

**Risk Level:** LOW

The evaluator run uses `evaluator_key` directly:

```typescript
// Line 456
const runResponse = await createEvaluatorRunExecution(
    selectedEvaluator.key,  // evaluator_key
    { inputs: outputs, settings: ... }
)
```

**Impact:**
- This endpoint (`/evaluators/{key}/run/`) remains unchanged
- Uses `selectedEvaluator.key` from template, not config
- No direct coupling to `EvaluatorConfig` shape

**Mitigation:**
- No changes needed for run functionality
- Keep using evaluator templates for the `key` value

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

**Mitigation:**
- Update query functions to use new endpoints
- Transform response at query boundary to maintain internal shape
- Or update all consumers to handle new shape

---

### 7. Evaluator Templates vs Configs Distinction

**Location:** Throughout frontend

**Risk Level:** LOW

The frontend distinguishes between:
- **Evaluator templates** (`Evaluator`): Built-in evaluator definitions with `settings_template`
- **Evaluator configs** (`EvaluatorConfig`): User-created configurations with `settings_values`

**Impact:**
- This distinction is maintained in the new system
- Templates come from `/evaluators/` (unchanged)
- Configs become `SimpleEvaluator` objects

**Mitigation:**
- No conceptual change needed
- Just update config handling

---

## Risk Summary Table

| Component | Risk Level | Complexity | Priority |
|-----------|-----------|------------|----------|
| Service Layer | LOW-MEDIUM | LOW | HIGH (change first) |
| State Atoms | MEDIUM | MEDIUM | HIGH |
| ConfigureEvaluator Form | MEDIUM | MEDIUM | MEDIUM |
| Evaluators Registry | MEDIUM | MEDIUM | MEDIUM |
| Debug Section | LOW | LOW | LOW |
| Global Query Atoms | MEDIUM | LOW | MEDIUM |

## Concrete Breakage Scenarios

### Scenario 1: Form Submission Fails

**Trigger:** Change `settings_values` to `data.parameters` without updating form

**Symptoms:**
- Form submits but settings are lost
- Backend receives empty configuration
- Evaluator created but doesn't work

**Prevention:**
- Transform at API boundary, not in form
- Test form submission with real backend

---

### Scenario 2: Evaluator List Empty

**Trigger:** Query endpoint returns new shape, UI expects old

**Symptoms:**
- Evaluators registry shows empty list
- No error messages (data exists but unparseable)
- Console shows undefined property access

**Prevention:**
- Update data transformation in hook
- Add null checks and fallbacks
- Log transformation errors

---

### Scenario 3: Edit Mode Fails to Load

**Trigger:** `playgroundEditValuesAtom` receives `SimpleEvaluator`, expects `EvaluatorConfig`

**Symptoms:**
- Navigate to edit page, form is empty
- Settings not populated
- Save overwrites with empty config

**Prevention:**
- Transform at atom level
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

## Recommended Testing Strategy

### Unit Tests
- [ ] Service layer transformers (old shape ↔ new shape)
- [ ] URI parsing (`agenta:builtin:key:v0` → `key`)
- [ ] Slug generation from name

### Integration Tests
- [ ] Create evaluator config flow
- [ ] Edit evaluator config flow  
- [ ] Delete (archive) evaluator config flow
- [ ] List/query evaluator configs flow

### E2E Tests
- [ ] Full playground flow: select template → configure → test → commit
- [ ] Edit existing evaluator configuration
- [ ] Clone evaluator configuration
- [ ] Delete evaluator configuration

### Regression Tests
- [ ] Evaluator run still works
- [ ] Batch evaluations still work (use config IDs)
- [ ] Existing configs load correctly after migration
