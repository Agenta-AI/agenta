# Research: SDK Evaluator Metrics Bug

## Problem Summary

SDK custom evaluators defined with `@ag.evaluator` show columns in the evaluation UI but results are empty. The root cause is that SDK custom evaluators register without `schemas.outputs`, so metrics aggregation has no keys to extract.

---

## SDK Evaluation Flow (Detailed)

### High-Level Sequence

```
aevaluate()
│
├─ 1. _parse_evaluate_kwargs()     # Parse input specs
│
├─ 2. _upsert_entities()           # Create revisions BEFORE run
│     ├─ aupsert_application()     # Create app revision
│     └─ aupsert_evaluator()       # Create evaluator revision (NO SCHEMA!)
│
├─ 3. acreate_run()                # Create evaluation run with revision IDs
│
├─ 4. _retrieve_entities()         # Fetch created revisions
│
├─ 5. For each testcase:
│     ├─ aadd_scenario()           # Create scenario
│     ├─ alog_result()             # Log testcase result
│     │
│     ├─ invoke_application()      # Run app, get trace
│     ├─ alog_result()             # Log invocation result
│     │
│     └─ For each evaluator:
│           ├─ invoke_evaluator()  # Run evaluator, get trace with outputs
│           ├─ alog_result()       # Log annotation result (step_key)
│           └─ (outputs contain score/success but schema not stored)
│
├─ 6. acompute_metrics()           # Refresh metrics (per scenario + run)
│
└─ 7. aclose_run()                 # Close evaluation
```

### Key Files

| File | Purpose |
|------|---------|
| `sdk/agenta/sdk/evaluations/preview/evaluate.py` | Main evaluation orchestration |
| `sdk/agenta/sdk/evaluations/runs.py` | Create/close evaluation runs |
| `sdk/agenta/sdk/evaluations/results.py` | Log evaluation results |
| `sdk/agenta/sdk/managers/evaluators.py` | `aupsert_evaluator()` - creates revisions |
| `sdk/agenta/sdk/decorators/running.py` | `@ag.evaluator` decorator |

---

## The Schema Problem

### Where Evaluator Revision is Created

In `_upsert_entities()` (evaluate.py lines 176-199):

```python
for evaluator_handler in simple_evaluation_data.evaluator_steps:
    if callable(evaluator_handler):
        evaluator_revision_id = await aupsert_evaluator(
            handler=evaluator_handler,
        )
        evaluator_steps[str(evaluator_revision_id)] = "custom"
```

### What `aupsert_evaluator()` Does

In `managers/evaluators.py` (lines 80-125):

```python
async def aupsert(handler, ...):
    evaluator_workflow = auto_workflow(handler, ...)
    req = await evaluator_workflow.inspect()
    
    simple_evaluator_data = SimpleEvaluatorData(
        **(req.interface.model_dump(...) if req and req.interface else {}),
        ...
    )
    # Sends to backend - but interface.schemas is None for custom evaluators!
```

### Why Schemas are Missing

For custom evaluators defined with `@ag.evaluator`:

1. `workflow.__init__()` sets `self.schemas = schemas` (None if not provided)
2. `_register_handler()` sets `self.interface.schemas = self.schemas` (None)
3. `inspect()` returns `WorkflowServiceRequest` with `interface.schemas = None`
4. `aupsert_evaluator()` sends data without schemas
5. Backend stores revision with only `uri` and `version`, no `schemas`

**Contrast with built-in evaluators:**
- Built-in evaluators (e.g., `auto_exact_match`) have interfaces in `INTERFACE_REGISTRY`
- `retrieve_interface(uri)` returns interface WITH schemas pre-defined
- Registration includes schemas

---

## Evaluation Run Creation

### When is the Run Created?

The evaluation run is created **BEFORE** any evaluators execute:

```python
# Line 342-351 in evaluate.py
run = await acreate_run(
    name=name,
    testset_steps=simple_evaluation_data.testset_steps,
    application_steps=simple_evaluation_data.application_steps,
    evaluator_steps=simple_evaluation_data.evaluator_steps,  # Revision IDs
)
```

### What Does the Run Store?

The run stores `evaluator_steps` as a dict of `{revision_id: origin}`:

```python
data=dict(
    status="running",
    evaluator_steps=evaluator_steps,  # e.g., {"uuid-123": "custom"}
    ...
)
```

### Result Logging

Results are logged with `step_key` format `evaluator-{slug}`:

```python
# Line 698-703 in evaluate.py
result = await alog_result(
    run_id=run.id,
    scenario_id=scenario.id,
    step_key="evaluator-" + evaluator_revision.slug,
    trace_id=trace_id,
)
```

The `step_key` links the result to the evaluator. The backend uses this to find the evaluator revision for metrics aggregation.

---

## Metrics Aggregation

### How Backend Finds Schema

In `api/oss/src/core/evaluations/service.py` `_refresh_metrics()`:

```python
for step in run.data.steps:
    if step.type == "annotation":
        evaluator_revision = await git_service.fetch_evaluator_revision(...)
        
        if evaluator_revision.data and evaluator_revision.data.schemas:
            # Extract metrics keys from schemas.outputs
            metrics_keys = get_metrics_keys_from_schema(
                schema=evaluator_revision.data.schemas.get("outputs")
            )
        elif evaluator_revision.data and evaluator_revision.data.service:
            # Fallback: extract from service.format
            metrics_keys = get_metrics_keys_from_schema(
                schema=evaluator_revision.data.service.get("format")
            )
        # else: no custom metrics, only DEFAULT_METRICS (duration, costs, tokens)
```

### Why Custom Evaluators Fail

1. `evaluator_revision.data.schemas` is `None`
2. `evaluator_revision.data.service` is also `None`
3. Only `DEFAULT_METRICS` are aggregated
4. Score/success fields are not extracted

---

## Scenario Drill In Behavior

The scenario drill in view uses two data sources:

1. Run data mappings. These mappings define which columns to show and which paths to read.
2. Annotations query. This provides evaluator outputs for the annotation panel.

### Mapping issue

When evaluator schemas are missing at run creation, the run uses a fallback mapping:

```
path = attributes.ag.data.outputs.outputs
column.name = outputs
```

This path does not exist in traces or annotations. The real values live at
`attributes.ag.data.outputs.score` and `attributes.ag.data.outputs.success`.

Result. The scenario table shows results for LLM judge evaluators. It does not show
results for custom evaluators, because the fallback mapping is invalid.

Why LLM judge looked fine. LLM judge evaluators ship with schemas. The run mappings
include explicit `score` and `success` paths at creation time. The scenario table
uses those mappings, so the values appear even if the annotation references do not
include slug.

### Annotation reference mismatch

The annotations endpoint returns evaluator references with ids only. It does not include slug.
The evaluator list includes both id and slug. The annotation panel matched by slug only.
This caused a match failure for custom evaluators in the annotation panel.

Why the UI uses slug. Scenario columns and step keys use evaluator revision slug in the form
`evaluator-{revision_slug}`. The UI uses slug to keep keys stable and human readable. Using id
as the primary key would require changing column ids and local state keys across the UI.

Result. The annotation panel showed nothing for custom evaluators even though
the annotation payload contained `score` and `success`.

Implementation details for the fixes are in `backend-fix.md` and `ui-fix.md`.

---

## Refresh Timing

The metrics refresh runs when the UI requests scenario metrics and considers them stale.
It also runs on the refresh endpoint when triggered manually. The new schema inference path
adds a trace query only when the evaluator revision lacks `schemas.outputs` and `service.format`.
If the schema exists, the refresh path does not add extra trace queries.

## Proposed SDK Work

The long term SDK plan is documented in `plan.md`. It covers first scenario deferral,
dry run alternatives, and the file changes needed in the SDK.
