# Plan: Fix SDK Evaluator Metrics Bug

## Summary

SDK custom evaluators register without `schemas.outputs`, so metrics aggregation has no
keys to extract. The backend and UI fixes are documented in `backend-fix.md` and
`ui-fix.md`. This plan focuses on the long term SDK fix.

---

## Current State

### Backend Fix (Complete)

**Location:** `api/oss/src/core/evaluations/service.py`

When `_refresh_metrics()` encounters an evaluator step without `schemas.outputs`:
1. Tracks step as "missing schema"
2. After collecting trace IDs, queries sample traces
3. Infers schema from `attributes.ag.data.outputs` using `genson.SchemaBuilder`
4. Uses inferred schema to extract metrics keys

**Pros:** Works without SDK changes and with zero user effort
**Cons:** Extra trace query per evaluator per metrics refresh

---

## Proposed SDK Fix: Partial Deferral (First Scenario)

### Key Insight

**Problem with full deferral:** If we defer creation of evaluation/steps entirely, the UI cannot display evaluation results at all - bad UX.

**Better approach:** Defer evaluator revision creation only until the FIRST scenario runs. Once we have one output sample, we can:
1. Infer the schema
2. Create the evaluator revision with schema
3. Update the evaluation run with proper evaluator_steps
4. Continue remaining scenarios normally

This way the UI sees the evaluation immediately, and after the first scenario completes, everything is properly configured.

### Concept

Instead of creating evaluator revisions BEFORE running evaluators, create them after FIRST scenario:

```
CURRENT:
1. aupsert_evaluator()        # Before any scenarios
2. acreate_run()              # Run created with evaluator_steps
3. For each scenario:
     invoke_evaluator()       # Run evaluator
4. (no schema in revision)

PROPOSED (First-Scenario Deferral):
1. acreate_run()              # Run created (evaluator_steps empty or minimal)
2. FIRST scenario:
     invoke_evaluator()       # Run evaluator
     infer_schema()           # From outputs
     aupsert_evaluator()      # Create revision WITH schema
     update_run()             # Add evaluator_steps to run
3. Remaining scenarios:
     invoke_evaluator()       # Normal flow, revision exists
4. (schema exists in revision!)
```

### Implementation

#### Phase 1: Restructure evaluate.py for first-scenario handling

**File:** `sdk/agenta/sdk/evaluations/preview/evaluate.py`

```python
# Track which evaluators need schema inference
pending_evaluators = {handler: None for handler in evaluator_handlers}  # handler -> revision
evaluator_schemas = {}  # handler -> inferred schema

for testcase_idx, testcase in enumerate(testcases):
    # ... run application ...
    
    for evaluator_handler in evaluator_handlers:
        # Run evaluator
        evaluator_response = await invoke_evaluator(
            handler=evaluator_handler,
            request=...,
        )
        
        # FIRST SCENARIO: Infer schema and create revision
        if testcase_idx == 0:
            outputs = evaluator_response.data.outputs
            schema = _infer_schema_from_outputs(outputs)
            evaluator_schemas[evaluator_handler] = schema
            
            # Create revision WITH schema
            revision_id = await aupsert_evaluator(
                handler=evaluator_handler,
                schemas={"outputs": schema},
            )
            pending_evaluators[evaluator_handler] = revision_id
        
        # Log result (revision now exists)
        revision = pending_evaluators[evaluator_handler]
        result = await alog_result(
            step_key="evaluator-" + revision.slug,
            trace_id=evaluator_response.trace_id,
        )

# After first scenario: update run with evaluator_steps
if testcase_idx == 0:
    await update_run_evaluator_steps(run_id, pending_evaluators)
```

#### Phase 2: Add schema inference helper

```python
from genson import SchemaBuilder

def _infer_schema_from_outputs(outputs: dict) -> dict:
    """Infer JSON schema from evaluator outputs."""
    if not outputs or not isinstance(outputs, dict):
        return None
    
    builder = SchemaBuilder()
    builder.add_object(outputs)
    return builder.to_schema()
```

#### Phase 3: Modify aupsert_evaluator to accept schemas

**File:** `sdk/agenta/sdk/managers/evaluators.py`

```python
async def aupsert(
    handler: Callable,
    schemas: Optional[dict] = None,  # NEW PARAMETER
    ...
) -> Optional[UUID]:
    evaluator_workflow = auto_workflow(handler, ...)
    req = await evaluator_workflow.inspect()
    
    simple_evaluator_data = SimpleEvaluatorData(
        **(req.interface.model_dump(...) if req and req.interface else {}),
        schemas=schemas,  # Use provided schemas if available
        ...
    )
```

#### Phase 4: Handle evaluation run creation

Two options:

**Option A: Create run without evaluator_steps, update later**
```python
run = await acreate_run(
    evaluator_steps={},  # Empty initially
)
# ... run evaluators, create revisions ...
await aupdate_run(run_id=run.id, evaluator_steps=collected_evaluator_steps)
```

**Option B: Create run after evaluators are set up**
```python
# Run first evaluator iteration to create revisions
# Then create run with all evaluator_steps
```

---

## Challenges & Solutions

### Challenge 1: UI needs to see evaluation immediately

**Problem:** If we fully defer everything, UI shows nothing
**Solution:** Create evaluation run immediately, defer only evaluator revision creation until first scenario completes. After first scenario, update run with evaluator_steps.

### Challenge 2: Trace references without revision (first scenario only)

**Problem:** `invoke_evaluator()` sets references including `evaluator_revision`
**Solution:** For first scenario, invoke with minimal references. Metrics use `step_key` anyway, and we update run immediately after.

### Challenge 3: Run needs evaluator_steps

**Problem:** `acreate_run()` expects `evaluator_steps` with revision IDs
**Solution:** Create run with empty/placeholder evaluator_steps, then call `update_run_evaluator_steps()` after first scenario completes.

### Challenge 4: Evaluator failure on first scenario

**Problem:** If first evaluator fails, no outputs to infer schema from
**Solution:** 
- Try next testcase until we get outputs
- Fall back to backend inference if all fail
- Log warning about missing schema

### Challenge 5: Complexity of first-scenario special case

**Problem:** Logic becomes tricky with special handling for first scenario
**Solution:** 
- Extract into clear helper functions
- Use flags to track "schema inferred" state per evaluator
- Consider: could also do a "dry run" with first testcase before starting evaluation

---

## Testing Plan

1. Run test script with custom evaluators
2. Verify evaluator revisions have `schemas.outputs` after creation
3. Verify metrics include score/success fields
4. Verify UI displays values correctly

---

## Rollback Plan

If issues arise:
1. Backend inference is already in place as fallback
2. Can revert SDK changes without breaking functionality
3. We can add an explicit `output_schema` parameter if needed

---

## Timeline

- Phase 1 (evaluate.py restructure): 2 hours
- Phase 2 (schema inference): 30 minutes
- Phase 3 (aupsert modification): 30 minutes
- Phase 4 (run handling): 1 hour
- Testing: 1 hour

**Total: ~5 hours**

---

## Decision Point

Before implementing, we need to decide:

1. **Option A: First-scenario deferral** - Defer revision creation until first scenario, then update run
2. **Option B: Keep backend inference only** - Already working, simpler, no SDK changes
3. **Option C: Dry-run inference** - In `_upsert_entities`, do a "dry run" with sample data to get schema before creating revision

### Comparison

| Option | UI Impact | Complexity | Schema Persistence |
|--------|-----------|------------|-------------------|
| A: First-scenario deferral | Good (run visible immediately) | Medium | Yes (in revision) |
| B: Backend inference | None | Low | No (re-inferred each time) |
| C: Dry-run inference | None | Medium | Yes (in revision) |

### Recommendation

**Option A (First-scenario deferral)** is the cleanest long-term solution because:
- Schema is captured once and stored permanently
- No extra trace queries on each metrics refresh
- User experience is unchanged
- Logic complexity is manageable with good abstractions
