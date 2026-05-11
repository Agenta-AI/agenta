# Evaluation Iteration Patterns

**Created:** 2026-02-16
**Purpose:** Document the iteration patterns used to execute evaluation graphs and populate evaluation tensors across API and SDK

---

## Overview

This document maps out the key iteration patterns in the evaluation system, identifying where we:
1. **Execute the evaluation graph** - iterate to run applications and evaluators
2. **Populate the evaluation tensor** - iterate to collect and aggregate results into matrix structures

The evaluation system uses nested loops at multiple layers (SDK, API tasks, metrics aggregation) to orchestrate execution and build result matrices.

---

## Table of Contents

- [Evaluation Graph Execution Loops](#evaluation-graph-execution-loops)
  - [SDK - Preview Evaluation](#1-sdk---preview-evaluation)
  - [API - Legacy Batch Evaluation](#2-api---legacy-batch-evaluation)
  - [API - Live Query Evaluation](#3-api---live-query-evaluation)
- [Evaluation Tensor Population Loops](#evaluation-tensor-population-loops)
  - [Results Matrix Creation](#1-results-matrix-creation)
  - [Metrics Tensor Aggregation](#2-metrics-tensor-aggregation)
  - [Batch Storage](#3-batch-storage)
- [Matrix Structure](#matrix-structure)
- [Summary Table](#summary-table)

---

## Evaluation Graph Execution Loops

These loops orchestrate the execution of evaluation workflows by iterating over inputs (testcases/traces) and running applications and evaluators.

### 1. SDK - Preview Evaluation

**File:** `sdk/agenta/sdk/evaluations/preview/evaluate.py`
**Function:** `async def aevaluate()` (Lines 278-792)

#### Nested Iteration Structure (4 Levels)

```python
# Level 1: Testset Revisions
for testset_revision in testset_revisions.values():                    # Line 377
    testcases = testset_revision.testcases

    # Level 2: Testcases
    for testcase_idx, testcase in enumerate(testcases):                # Line 392
        # Create scenario for this testcase
        scenario = create_scenario(...)                                 # Line 412

        # Create testcase result entry
        result = create_result(...)                                     # Lines 427-432

        # Level 3: Applications
        for application_revision in application_revisions.values():     # Line 454
            # Invoke application with testcase inputs
            invocation_result = await invoke_application(...)

            # Store application result
            results[application_slug] = result                          # Lines 560-576

        # Level 4: Evaluators
        for evaluator_revision in evaluator_revisions.values():         # Line 591
            # Invoke evaluator with application outputs and testcase
            evaluation_result = await invoke_evaluator(...)

            # Store evaluator result
            results[evaluator_slug] = result                            # Lines 697-713
```

#### Key Iteration Points

| Line | Loop Variable | Purpose |
|------|---------------|---------|
| 377 | `testset_revision` | Process each testset revision (multiple datasets) |
| 392 | `testcase_idx, testcase` | For each testcase, run through entire pipeline |
| 454 | `application_revision` | Invoke each application variant with testcase |
| 591 | `evaluator_revision` | Run each evaluator against application outputs |

#### Data Flow

```
Testset Revision
    ↓
Testcase → Create Scenario
    ↓
Application 1 → Invoke → Store Result
Application 2 → Invoke → Store Result
    ↓
Evaluator 1 → Invoke → Store Result
Evaluator 2 → Invoke → Store Result
```

---

### 2. API - Legacy Batch Evaluation

**File:** `api/oss/src/core/evaluations/tasks/legacy.py`
**Function:** `async def evaluate_batch_testset()` (Lines 596-end)

#### Nested Iteration Structure (2 Levels)

```python
# Level 1: Scenarios (Testcase Creation)
for idx, scenario in enumerate(scenarios):                              # Line 900
    # Create testcase result entry
    testcase_result = create_result(...)                                # Lines 888-901

# Level 2: Testcase Processing
for idx in range(nof_testcases):                                        # Line 990
    # Fetch invocation results for this testcase
    invocation_results = results[idx]["invocations"]                    # Lines 953-983

    # Extract trace data
    trace = ...

    # Level 3: Evaluators
    for jdx in range(nof_annotations):                                  # Line 1066
        # Prepare evaluator request with testcase, app output, and trace
        evaluator_request = prepare_request(...)

        # Invoke evaluator workflow
        evaluation_result = await invoke_evaluator(...)

        # Create result entry
        create_evaluation_result(...)                                   # Lines 1302-1315
```

#### Key Iteration Points

| Line | Loop Variable | Purpose |
|------|---------------|---------|
| 900 | `idx, scenario` | Create initial testcase result entries |
| 990 | `idx` (testcase index) | Process invocation results for each testcase |
| 1066 | `jdx` (evaluator index) | Run all evaluators for each testcase |

#### Data Flow

```
Scenarios → Create Testcase Results
    ↓
For Each Testcase:
    Fetch Invocation Results
    Extract Trace Data
    ↓
    For Each Evaluator:
        Prepare Request
        Invoke Evaluator
        Create Result Entry
```

---

### 3. API - Live Query Evaluation

**File:** `api/oss/src/core/evaluations/tasks/live.py`
**Function:** `async def evaluate_live_query()` (Lines 195-end)

#### Nested Iteration Structure (3 Levels)

```python
# Level 1: Query Steps
for query_step_key in query_traces.keys():                              # Line 419
    # Create initial result entries for this query step
    query_results = create_results(...)                                 # Lines 457-471

    # Level 2: Traces
    for idx, trace in enumerate(query_traces[query_step_key].values()): # Line 490
        # Create scenario for this trace
        scenario = create_scenario(...)

        # Level 3: Evaluators
        for jdx in range(nof_annotations):                              # Line 528
            # Invoke evaluator on this trace
            evaluation_result = await invoke_evaluator(...)

            # Create result entry
            create_evaluation_result(...)                               # Lines 737-751
```

#### Key Iteration Points

| Line | Loop Variable | Purpose |
|------|---------------|---------|
| 419 | `query_step_key` | Process each query/input step |
| 490 | `idx, trace` | For each trace matching query criteria |
| 528 | `jdx` (evaluator index) | Run evaluators on each trace |

#### Data Flow

```
Query Steps
    ↓
Traces (within time window)
    ↓
For Each Trace:
    Create Scenario
    ↓
    For Each Evaluator:
        Invoke Evaluator
        Create Result Entry
```

---

### Worker Task Registration

**File:** `api/oss/src/tasks/taskiq/evaluations/worker.py`

This file registers the evaluation tasks with the async task broker:

- **`evaluate_batch_testset`** (Line 76) - Delegates to legacy batch evaluation
- **`evaluate_live_query`** (Line 114) - Delegates to live query evaluation

These tasks are invoked asynchronously by the evaluation service and executed in worker processes.

---

## Evaluation Tensor Population Loops

These loops collect individual results and aggregate them into matrix/tensor structures for storage and analysis.

### 1. Results Matrix Creation

The results matrix is populated **row-by-row** during evaluation execution. Each cell represents an individual `EvaluationResult` for a (scenario × step) combination.

#### Live Evaluation Task

**File:** `api/oss/src/core/evaluations/tasks/live.py` (Lines 419-798)

```python
# Build matrix: (scenario_idx) × (evaluator_idx)
for query_step_key in query_traces.keys():
    # Create initial result entries for query step
    query_results = create_results(...)                                 # Lines 457-471

    for idx, trace in enumerate(query_traces[query_step_key].values()):
        # Create scenario
        scenario = create_scenario(...)

        for jdx in range(nof_annotations):
            # Invoke evaluator
            evaluation_result = await invoke_evaluator(...)

            # Create result entry for this cell
            result = create_result(                                     # Lines 737-751
                run_id=run_id,
                scenario_id=scenario.id,
                step_key=step_key,
                trace_id=trace_id,
                status=status,
                error=error,
                ...
            )
```

**Matrix Structure:**
- **Rows:** Scenarios (one per trace)
- **Columns:** Steps/Evaluators
- **Cells:** `EvaluationResult` objects

---

#### Legacy Batch Task

**File:** `api/oss/src/core/evaluations/tasks/legacy.py` (Lines 900-1315)

```python
# Build matrix: (testcase_idx) × (evaluator_idx)
for idx, scenario in enumerate(scenarios):
    # Create testcase result
    testcase_result = create_result(...)                                # Lines 888-901

for idx in range(nof_testcases):
    # Process invocation results
    invocation_results = results[idx]["invocations"]

    for jdx in range(nof_annotations):
        # Invoke evaluator
        evaluation_result = await invoke_evaluator(...)

        # Create result entry for this cell
        result = create_result(                                         # Lines 1302-1315
            run_id=run_id,
            scenario_id=scenario_id,
            step_key=step_key,
            trace_id=trace_id,
            status=status,
            error=error,
            ...
        )
```

**Matrix Structure:**
- **Rows:** Scenarios (one per testcase)
- **Columns:** Steps/Evaluators
- **Cells:** `EvaluationResult` objects

---

#### SDK Preview Evaluation

**File:** `sdk/agenta/sdk/evaluations/preview/evaluate.py` (Lines 392-724)

```python
# Build matrix: (testcase_idx) × (application_idx) × (evaluator_idx)
for testcase_idx, testcase in enumerate(testcases):
    # Create scenario
    scenario = create_scenario(...)                                     # Line 412

    # Create testcase result entry
    testcase_result = create_result(...)                                # Lines 427-432

    results = {}

    # Populate application results
    for application_revision in application_revisions.values():
        application_result = await invoke_application(...)
        results[application_slug] = result                              # Lines 560-576

    # Populate evaluator results
    for evaluator_revision in evaluator_revisions.values():
        evaluator_result = await invoke_evaluator(...)
        results[evaluator_slug] = result                                # Lines 697-713
```

**Matrix Structure:**
- **Rows:** Testcases
- **Columns:** Applications + Evaluators (hierarchical)
- **Cells:** Result objects in `results` dict

---

### 2. Metrics Tensor Aggregation

The metrics tensor is built by **aggregating results** across all scenarios for each step. This produces summary statistics rather than individual cell values.

#### Metrics Refresh Service

**File:** `api/oss/src/core/evaluations/service.py`

##### `refresh_metrics` Method (Lines 789-867)

Orchestrates metrics computation across different scopes:

```python
# Refresh metrics for multiple scopes
for run_id in run_ids:                                                  # Line 820
    await _refresh_metrics(run_id=run_id)

for scenario_id in scenario_ids:                                        # Line 835
    await _refresh_metrics(scenario_id=scenario_id)

for timestamp in timestamps:                                            # Line 847
    await _refresh_metrics(timestamp=timestamp)
```

##### `_refresh_metrics` Method (Lines 869-1140)

Core tensor builder that aggregates metrics:

```python
# Step 1: Collect trace IDs for each step
for step_key in step_keys:                                              # Line 910
    # Query results for this step
    results = query_results(step_key=step_key)                          # Lines 918-924

    # Collect trace IDs
    trace_ids = [r.trace_id for r in results]                           # Lines 926-931

# Step 2: Gather metric specifications
for step in run.data.steps:                                             # Line 939
    # Get metric specs from evaluator schema
    schema = get_schema(step)
    metric_specs = extract_metrics(schema)                              # Lines 944-979

    # Infer schema from trace data if needed
    if not schema:
        infer_schema_from_traces(...)                                   # Lines 981-1004

# Step 3: Aggregate metrics for each step
metrics_data = {}
for step_key in intersection:                                           # Line 1034
    # Call analytics service to aggregate trace data
    bucket = await tracing_service.analytics(                           # Line 1070
        trace_ids=trace_ids[step_key],
        metrics=metric_specs[step_key],
        ...
    )

    # Populate metrics tensor
    metrics_data[step_key] = bucket.metrics                             # Line 1107

# Step 4: Create single EvaluationMetrics entry
metrics_entry = create_evaluation_metrics(                              # Lines 1120-1131
    run_id=run_id,
    scenario_id=scenario_id,
    timestamp=timestamp,
    data=metrics_data,  # {step_key: {metric_name: aggregated_values}}
)
```

**Tensor Structure:**
- **Single row** per scope (run/scenario/timestamp)
- **Columns:** Steps (each containing metrics buckets)
- **Cells:** `{metric_name: aggregated_values}` dicts

**Aggregation Flow:**

```
Results (individual cells)
    ↓
Group by Step
    ↓
Extract Trace IDs
    ↓
Analytics Service (aggregate across traces)
    ↓
Metrics Bucket per Step
    ↓
Single EvaluationMetrics Entry
```

---

### 3. Batch Storage

Results are stored in batches for performance.

#### Evaluations DAO

**File:** `api/oss/src/dbs/postgres/evaluations/dao.py` (Lines 134-193)

```python
async def create_results(
    self,
    *,
    results: List[EvaluationResultCreate],
) -> List[EvaluationResult]:
    """Create multiple evaluation results in a batch."""

    # Convert DTOs to DBEs
    dbes = []
    for result in results:                                              # Lines 156-172
        dbe = EvaluationResultDBE(
            run_id=result.run_id,
            scenario_id=result.scenario_id,
            step_key=result.step_key,
            trace_id=result.trace_id,
            status=result.status,
            error=result.error,
            ...
        )
        dbes.append(dbe)

    # Bulk insert
    session.add_all(dbes)                                               # Line 176
    await session.flush()

    # Convert back to DTOs
    return [EvaluationResult(**dbe.model_dump()) for dbe in dbes]       # Lines 180-186
```

**Batching Strategy:**
- Create DBE objects for all results in a list
- Use `session.add_all()` for bulk insert
- Return typed DTOs

---

## Matrix Structure

The evaluation system maintains two complementary data structures:

### Results Matrix (Individual Cells)

```
           Step 1      Step 2      Step 3      ...
           (Query)     (App 1)     (Eval 1)
         ┌───────────┬───────────┬───────────┬─────
Scenario 1│  Result   │  Result   │  Result   │ ...
         ├───────────┼───────────┼───────────┼─────
Scenario 2│  Result   │  Result   │  Result   │ ...
         ├───────────┼───────────┼───────────┼─────
Scenario 3│  Result   │  Result   │  Result   │ ...
         └───────────┴───────────┴───────────┴─────
```

**Each Result Cell Contains:**
- `trace_id` - Link to execution trace
- `status` - `SUCCESS` | `FAILURE` | `ERROR`
- `error` - Error message if failed
- `created_at`, `updated_at` - Timestamps
- `created_by_id` - User who triggered execution

**Stored In:** `evaluation_results` table

---

### Metrics Tensor (Aggregated)

```
Scope                    Metrics Data
(Run/Scenario/Timestamp)
┌─────────────────────┬──────────────────────────────────────────
│ Run #1              │ {
│                     │   "step_1": {
│                     │     "latency": [100, 150, 120, ...],
│                     │     "cost": [0.02, 0.03, 0.02, ...],
│                     │   },
│                     │   "step_2": {
│                     │     "accuracy": [0.9, 0.85, 0.92, ...],
│                     │   },
│                     │   ...
│                     │ }
├─────────────────────┼──────────────────────────────────────────
│ Scenario #5         │ { ... }
├─────────────────────┼──────────────────────────────────────────
│ Timestamp           │ { ... }
│ 2026-02-16 10:00    │
└─────────────────────┴──────────────────────────────────────────
```

**Each Metrics Entry Contains:**
- `run_id` | `scenario_id` | `timestamp` - Scope identifier
- `data` - `{step_key: {metric_name: [values]}}`
- Aggregated across all scenarios/traces in scope

**Stored In:** `evaluation_metrics` table

---

## Summary Table

### Execution Loops

| Component | File | Outer Loop | Middle Loop | Inner Loop | Purpose |
|-----------|------|------------|-------------|------------|---------|
| **SDK Evaluate** | `sdk/.../evaluate.py` | Testsets | Testcases | Applications → Evaluators | Execute evaluation graph |
| **Legacy Batch** | `api/.../legacy.py` | Testcases | Evaluators | - | Execute batch evaluation |
| **Live Query** | `api/.../live.py` | Query Steps | Traces | Evaluators | Execute live evaluation |

### Population Loops

| Component | File | Outer Loop | Inner Loop | Output | Purpose |
|-----------|------|------------|------------|--------|---------|
| **Live Task** | `api/.../live.py` | Query Steps → Traces | Evaluators | Results Matrix | Populate individual cells |
| **Legacy Task** | `api/.../legacy.py` | Testcases | Evaluators | Results Matrix | Populate individual cells |
| **SDK Preview** | `sdk/.../evaluate.py` | Testcases | Apps → Evaluators | Results Dict | Populate results hierarchy |
| **Metrics Refresh** | `api/.../service.py` | Scopes → Steps | Traces | Metrics Tensor | Aggregate metrics |
| **DAO Batch** | `api/.../dao.py` | Results List | - | Bulk Insert | Store results in DB |

---

## Key Patterns & Observations

1. **Dual Matrix Architecture**
   - **Results Matrix:** Individual results for each (scenario × step) combination
   - **Metrics Tensor:** Aggregated metrics for each step across all scenarios
   - Both are necessary: results for drill-down, metrics for overview

2. **Loop Nesting Depth**
   - **SDK:** 4 levels (testsets → testcases → apps → evaluators)
   - **API Tasks:** 2-3 levels (scenarios → evaluators, with trace processing)
   - **Metrics:** 3-4 levels (steps → results → traces → aggregation)

3. **Execution vs Population**
   - **Execution loops** drive the workflow (invoke apps/evaluators)
   - **Population loops** collect results into data structures
   - Often these are the same loops, but metrics aggregation is separate

4. **Batch Operations**
   - Results created in batches via `create_results()`
   - DAO layer uses SQLAlchemy `add_all()` for bulk inserts
   - Reduces database round-trips

5. **Data Flow Direction**
   ```
   Execution Loops → Individual Results → Batch Storage → Results Matrix
                                              ↓
                               Metrics Aggregation → Metrics Tensor
   ```

6. **Scalability Considerations**
   - Nested loops can lead to O(n × m) complexity
   - Large testsets × many evaluators = many iterations
   - Batch operations help, but execution is still sequential in many places
   - Potential for optimization: parallelization, incremental computation

---

## Related Documentation

- [Testing Documentation](../testing/README.md)
- API Architecture Patterns (see `AGENTS.md`)
- Evaluation Service: `api/oss/src/core/evaluations/service.py`
- Evaluation Tasks: `api/oss/src/core/evaluations/tasks/`
- SDK Preview Evaluation: `sdk/agenta/sdk/evaluations/preview/`

---

## Maintenance Notes

**Last Updated:** 2026-02-16
**Explored By:** Claude Code (Sonnet 4.5)

When modifying evaluation iteration logic:
- Ensure results are created for all (scenario × step) combinations
- Maintain batch operations for performance
- Update metrics aggregation if new metrics are added
- Consider impact on scalability when adding nested loops
- Test with large testsets to verify performance
