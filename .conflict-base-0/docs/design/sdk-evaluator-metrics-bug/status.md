# Status: SDK Evaluator Metrics Bug

## Current Status: BACKEND AND UI FIXES APPLIED, SDK FIX PLANNED

**Date:** 2026-01-29

---

## Summary

SDK custom evaluators were showing empty results because they register without `schemas.outputs`. We added backend schema inference from traces and updated run mappings so the scenario drill in view can render evaluator outputs. We also added UI fallbacks for missing schemas and missing evaluator slugs.

---

## Completed Work

### 1. Backend Schema Inference (DONE)

**File:** `api/oss/src/core/evaluations/service.py`

Added `_infer_evaluator_schema_from_traces()` method that:
- Detects evaluator steps missing `schemas.outputs`
- Queries sample traces after collecting trace IDs
- Extracts outputs from `attributes.ag.data.outputs`
- Infers JSON schema using `genson.SchemaBuilder`
- Uses inferred schema to build metrics keys

**Test Result:** OK. Metrics now include `score` and `success` for SDK evaluators

### 2. Run Mapping Repair (DONE)

**File:** `api/oss/src/core/evaluations/service.py`

When evaluator schema is inferred, we now update the run mappings to remove the invalid
`attributes.ag.data.outputs.outputs` fallback and replace it with explicit `score` and
`success` mappings.

We also keep `status`, `name`, `description`, and `flags` in the edit call to avoid
database constraint errors.

### 3. Mapping Deduplication (DONE)

**File:** `api/oss/src/core/evaluations/service.py`

We dedupe annotation mappings during refresh so repeated refresh does not append duplicate
score and success columns.

### 4. UI Fallbacks for Missing Schemas and Slugs (DONE)

**Files:**
- `web/oss/src/components/EvalRunDetails/components/views/SingleScenarioViewerPOC/ScenarioAnnotationPanel/useAnnotationState.ts`
- `web/oss/src/components/EvalRunDetails/components/views/SingleScenarioViewerPOC/types.ts`
- `web/oss/src/components/EvalRunDetails/atoms/scenarioColumnValues.ts`

The annotation panel now:
- Accepts evaluator outputs schemas from either `data.schemas.outputs` or `data.service.format`.
- Falls back to inferring field definitions from annotation outputs when schema is missing.
- Matches evaluators by id if slug is missing in annotation references.

### 5. SDK Research (NOT REMOVED)

We kept the SDK investigation in `research.md`. That document covers why custom evaluators
do not send schemas and how the first scenario deferred creation approach could fix it.

---

## Planned Work

### SDK First-Scenario Deferred Creation

**Goal:** Infer schema automatically in SDK without requiring user to add type hints

**Key Insight:** Full deferral breaks UI (evaluation not visible). Better approach: defer only until FIRST scenario completes.

**Approach:** Restructure `evaluate.py` to:
1. Create evaluation run immediately (UI can see it)
2. Run FIRST scenario through all evaluators
3. Capture outputs, infer schema for each evaluator
4. Create evaluator revisions WITH schemas
5. Update run with evaluator_steps
6. Continue remaining scenarios normally

**Benefits:**
- UI sees evaluation immediately
- Schema inferred from actual outputs (always correct)
- Schema stored permanently in revision (no re-inference needed)

**Status:** Research complete, approach refined, implementation pending

See `plan.md` for full implementation details.

---

## Test Results

### Latest Test Run

```
Run ID: 019c08bf-95bf-7213-8ad3-534ed5b3e8c7
URL: http://144.76.237.122:9000/.../evaluations/results/019c08bf-95bf-7213-8ad3-534ed5b3e8c7

Metrics for scenario 019c08bf-9701-7c73-b494-5d4bd51fc4aa:
  evaluator-f6b2cf8d24ed:
    - attributes.ag.data.outputs.score (ok)
    - attributes.ag.data.outputs.success (ok)
    - attributes.ag.metrics.duration.cumulative
  evaluator-218b679f7e44:
    - attributes.ag.data.outputs.score (ok)
    - attributes.ag.data.outputs.success (ok)
    - attributes.ag.metrics.duration.cumulative
```

---

## Files Modified

### Backend
- `api/oss/src/core/evaluations/service.py` - Added schema inference, mapping update, and mapping dedupe

### Frontend
- `web/oss/src/components/EvalRunDetails/components/views/SingleScenarioViewerPOC/ScenarioAnnotationPanel/useAnnotationState.ts`
- `web/oss/src/components/EvalRunDetails/components/views/SingleScenarioViewerPOC/types.ts`
- `web/oss/src/components/EvalRunDetails/atoms/scenarioColumnValues.ts`

---

## Open Questions

1. Should we implement SDK deferred creation, or is backend inference sufficient?
2. Should the annotations endpoint include evaluator slug to avoid UI fallback logic?
3. How to handle evaluator failures that produce no outputs to infer from?

---

## Next Steps

1. **Decision:** Confirm first-scenario deferral approach
2. **Implementation:**
   - Modify `evaluate.py` to handle first scenario specially
   - Add schema inference helper using `genson`
   - Add/modify API to update run's evaluator_steps
   - Extract logic into clear helper functions
3. **Testing:** Run full evaluation suite with custom evaluators
4. **Edge cases:** Handle first-scenario failures, empty testsets
5. **PR:** Update draft PR with final changes

---

## Notes from Discussion

### Why Not Full Deferral?

> "If you defer the creation of the evaluation and the steps, the UI cannot read the evaluation results."

The UI needs to see the evaluation immediately. Full deferral would mean the evaluation doesn't appear until after everything runs - bad UX.

### First-Scenario Approach

> "It would be up to the point of running the first evaluation evaluator scenario. At the moment that you know the evaluator and schema because you inferred them from the first scenario, you should complete everything for the evaluation itself."

This is the sweet spot:
- Create run immediately -> UI sees it
- First scenario runs -> we get real outputs
- Infer schema, create revisions, update run -> everything is properly configured
- Remaining scenarios run normally
