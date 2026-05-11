# Evaluation Structure

**Created:** 2026-02-16
**Purpose:** Document the evaluation structure — graph, tensor, flags, and constraints
**Related:**
- [Current State - Iteration Patterns](./iteration-patterns.md)
- [Desired Architecture](./desired-architecture.md)
- [Refactoring Analysis](./refactoring-analysis.md)
- [Evaluation Operations](./evaluation-operations.md)

---

## Table of Contents

- [Overview](#overview)
- [Graph Components](#graph-components)
- [Execution Flags](#execution-flags)
- [Data Source Types](#data-source-types)
- [Compatibility Constraints](#compatibility-constraints)
- [Tensor Structure](#tensor-structure)
  - [Five Entities](#five-entities)
  - [Tensor Dimensions](#tensor-dimensions)
  - [EvaluationResult: the Cell](#evaluationeresult-the-cell)
  - [Tensor Population Flow](#tensor-population-flow)
  - [Metrics](#metrics)
- [Current Graph Structures](#current-graph-structures)
- [Future Graph Structures](#future-graph-structures)

---

## Overview

An evaluation graph defines:
1. **Data sources** (what to evaluate)
2. **Execution steps** (applications, evaluators)
3. **Execution mode** (online vs offline, batch vs sliced)
4. **Constraints** (compatibility rules between components)

The graph structure determines:
- What can be executed together
- How data flows between steps
- When and how often execution occurs
- What results are collected

---

## Graph Components

### Node Types

#### 1. Query Node (Data Source)
**Purpose:** Load traces from the tracing system

**Properties:**
- `type: "query"`
- `query_spec`: Query criteria (filters, time window, etc.)
- `time_window`: Optional time bounds (start_time, end_time)

**Behavior:**
- **Offline mode:** Executes once, returns snapshot of matching traces
- **Online mode:** Executes periodically, windowed by current interval

**Example:**
```json
{
  "type": "query",
  "query_spec": {
    "filters": {
      "status": "success",
      "application_id": "app-123"
    },
    "time_window": {
      "start_time": "2026-02-16T00:00:00Z",
      "end_time": "2026-02-16T23:59:59Z"
    }
  }
}
```

---

#### 2. Testset Node (Data Source)
**Purpose:** Load test cases from a testset revision

**Properties:**
- `type: "testset"`
- `testset_id`: UUID
- `testset_revision_id`: UUID
- `testset_variant_id`: Optional UUID

**Behavior:**
- **Offline mode:** Returns all test cases from the testset revision
- **Online mode:** ❌ Not compatible (re-execution yields same data)

**Example:**
```json
{
  "type": "testset",
  "testset_id": "ts-123",
  "testset_revision_id": "rev-456",
  "testset_variant_id": "var-789"
}
```

---

#### 3. Application Node (Execution Step)
**Purpose:** Invoke an application workflow with inputs

**Properties:**
- `type: "application"`
- `application_id`: UUID
- `application_revision_id`: UUID
- `application_variant_id`: Optional UUID

**Inputs:**
- From data source node: `testcase.data` or `trace inputs`

**Outputs:**
- `trace_id`: Execution trace
- `outputs`: Application outputs (extracted from trace)

**Example:**
```json
{
  "type": "application",
  "application_id": "app-123",
  "application_revision_id": "rev-456"
}
```

---

#### 4. Evaluator Node (Execution Step)
**Purpose:** Invoke an evaluator workflow to score/judge outputs

**Properties:**
- `type: "evaluator"`
- `evaluator_id`: UUID
- `evaluator_revision_id`: UUID
- `evaluator_variant_id`: Optional UUID

**Inputs:**
- From data source node: `testcase` or `trace`
- From application node: `outputs`, `trace`

**Outputs:**
- `trace_id`: Evaluation trace
- `metrics`: Evaluation scores/judgments

**Example:**
```json
{
  "type": "evaluator",
  "evaluator_id": "eval-123",
  "evaluator_revision_id": "rev-456"
}
```

---

## Execution Flags

### Current Flags

#### 1. `is_live` - Online vs Offline Evaluation

**Type:** `boolean`
**Default:** `false`
**Location:** `EvaluationRun.is_live` (or similar field)

**Purpose:** Determines execution mode

##### `is_live = false` (Offline / Batch Evaluation)
- **Execution:** One-time, on-demand or scheduled
- **Scenarios:** Created once for all inputs
- **Data sources:** Testsets OR Queries (snapshot)
- **Use case:** Evaluate a specific dataset or time window

**Behavior:**
```
1. Load data source (testset or query)
2. Create scenarios (one per input)
3. Execute graph for all scenarios
4. Complete run
```

---

##### `is_live = true` (Online / Live Evaluation)
- **Execution:** Periodic, runs on interval (e.g., every hour)
- **Scenarios:** Include `timestamp` and `interval` fields
- **Data sources:** Queries ONLY (windowed by interval)
- **Use case:** Continuously evaluate production traffic

**Behavior:**
```
For each interval (e.g., hourly):
1. Overwrite query time window with current interval
   Example: interval = "2026-02-16T10:00:00Z to 2026-02-16T11:00:00Z"
2. Execute query → get traces from that window
3. Create scenarios (one per trace) with timestamp + interval
4. Execute graph for scenarios
5. Wait for next interval
```

**Scenario fields:**
```python
class EvaluationScenario:
    id: UUID
    run_id: UUID
    timestamp: Optional[datetime]  # Only for is_live=true
    interval: Optional[str]         # Only for is_live=true (e.g., "1h")
    status: EvaluationStatus
```

---

#### Why Testsets are Incompatible with Online Evaluation

**Constraint:** `is_live = true` → Data source MUST be Query

**Reason:**
- **Testsets are static:** Re-executing a testset always yields the same test cases
- **Queries are dynamic:** Re-executing a query with different time windows yields different traces

**Example:**

```
Testset (static):
  Interval 1 (10:00-11:00): [testcase_1, testcase_2, testcase_3]
  Interval 2 (11:00-12:00): [testcase_1, testcase_2, testcase_3]  ← Same data!
  Interval 3 (12:00-13:00): [testcase_1, testcase_2, testcase_3]  ← Same data!

Query (dynamic):
  Interval 1 (10:00-11:00): [trace_a, trace_b] from 10:00-11:00
  Interval 2 (11:00-12:00): [trace_c, trace_d, trace_e] from 11:00-12:00  ← Different!
  Interval 3 (12:00-13:00): [trace_f] from 12:00-13:00  ← Different!
```

**Implication:**
- Online evaluation with testsets would create duplicate scenarios for the same test cases every interval
- No new information would be gained
- Wasteful and confusing

---

### Compatibility Matrix

| Data Source | `is_live = false` (Offline) | `is_live = true` (Online) |
|-------------|-----------------------------|---------------------------|
| **Testset** | ✅ Compatible               | ❌ Not compatible         |
| **Query**   | ✅ Compatible (snapshot)    | ✅ Compatible (windowed)  |

---

#### Companion Flag: `is_active` (Works with `is_live`)

**Type:** `boolean`
**Default:** `true` (when `is_live = true`)
**Location:** `EvaluationRun.is_active` (or similar field)

**Purpose:** Controls whether online evaluation should actually execute on periodic ticks

**Interaction with `is_live`:**

| `is_live` | `is_active` | Behavior |
|-----------|-------------|----------|
| `false` | N/A | Offline evaluation (not periodic) |
| `true` | `true` | Online evaluation **running** (executes on ticks) |
| `true` | `false` | Online evaluation **paused** (skipped on ticks) |

**Use cases:**
- **Pause online evaluation:** Set `is_active = false` to temporarily stop execution without deleting the run
- **Resume online evaluation:** Set `is_active = true` to restart execution
- **Debugging:** Pause problematic evaluations without losing configuration

**Behavior on periodic tick:**
```python
# Periodic scheduler (e.g., every hour)
for run in get_online_evaluations():
    if run.is_live and run.is_active:
        # Execute this online evaluation
        await execute_live_evaluation(run)
    elif run.is_live and not run.is_active:
        # Skip - evaluation is paused
        continue
```

**Status:** Likely implemented (needs verification)

---

### Graph Configuration Flags

These are the key flags that control evaluation behavior:

---

#### 2. `repeat_target` (CRITICAL - Currently Implicit)
**Current state:** Hardcoded (location TBD in code)
**Current value:** Unknown (needs investigation)
**Type:** `Literal["application", "evaluator"]`

**Purpose:** Determines where repeats are applied in the graph

This is a **critical degree of freedom** that fundamentally changes:
- What variability is being measured
- Tensor structure (rows vs columns)
- Execution order
- Cost (app invocations vs evaluator invocations)

---

##### `repeat_target = "application"` (Test Application Variability)

**Fanout location:** Between inputs and application invocations

**What's being tested:** Variability/consistency of the application under test

**Graph structure:**
```
Input 1 → Application (repeat 1) → Evaluator 1
                                 → Evaluator 2
        → Application (repeat 2) → Evaluator 1
                                 → Evaluator 2
        → Application (repeat 3) → Evaluator 1
                                 → Evaluator 2

Input 2 → Application (repeat 1) → Evaluator 1
                                 → Evaluator 2
        → Application (repeat 2) → Evaluator 1
                                 → Evaluator 2
        ...
```

**Execution flow:**
```python
for testcase in testcases:
    for repeat_idx in range(repeats):  # REPEAT HERE
        scenario = create_scenario(
            testcase=testcase,
            repeat_idx=repeat_idx,
        )

        # Invoke application (different each repeat)
        outputs = invoke_application(testcase.inputs)

        # Invoke evaluators (once per app repeat)
        for evaluator in evaluators:
            metrics = invoke_evaluator(testcase, outputs)
```

**Tensor structure:**
```
Rows: Scenarios (Input × Repeat)
Cols: Steps (Testset, Applications, Evaluators)

           Testset  App-1  App-2  Eval-1  Eval-2  Eval-3
Input-1-r1   ✓       ✓      ✓       ✓       ✓       ✓
Input-1-r2   ✓       ✓      ✓       ✓       ✓       ✓
Input-1-r3   ✓       ✓      ✓       ✓       ✓       ✓
Input-2-r1   ✓       ✓      ✓       ✓       ✓       ✓
Input-2-r2   ✓       ✓      ✓       ✓       ✓       ✓
Input-2-r3   ✓       ✓      ✓       ✓       ✓       ✓

Each row = one scenario (input + repeat index)
Each column = one step (evaluators run once per row)
```

**Use cases:**
- Testing LLM temperature/sampling variability: "How consistent is GPT-4 at temp=0.7?"
- Testing RAG retrieval variability: "Do we get different docs each time?"
- A/B testing with random assignment: "Does feature flag affect results?"
- Measuring baseline noise: "What's the natural variation in our application?"

**Cost implications:**
- Application invoked: `num_inputs × repeats` times
- Evaluators invoked: `num_inputs × repeats × num_evaluators` times
- Example: 100 inputs, 3 repeats, 2 evaluators = 300 app calls, 600 evaluator calls

---

##### `repeat_target = "evaluator"` (Test Evaluator Variability)

**Fanout location:** Between application outputs and evaluator invocations

**What's being tested:** Variability/consistency of the evaluators

**Graph structure:**
```
Input 1 → Application (once) → Evaluator 1 (repeat 1)
                             → Evaluator 1 (repeat 2)
                             → Evaluator 1 (repeat 3)
                             → Evaluator 2 (repeat 1)
                             → Evaluator 2 (repeat 2)
                             → Evaluator 2 (repeat 3)

Input 2 → Application (once) → Evaluator 1 (repeat 1)
                             → Evaluator 1 (repeat 2)
                             ...
```

**Execution flow:**
```python
for testcase in testcases:
    scenario = create_scenario(testcase=testcase)

    # Invoke application (ONCE per input)
    outputs = invoke_application(testcase.inputs)

    # Invoke evaluators (REPEAT HERE)
    for evaluator in evaluators:
        for repeat_idx in range(repeats):
            metrics = invoke_evaluator(testcase, outputs)
            log_result(
                scenario=scenario,
                step_key=f"{evaluator.id}-r{repeat_idx}",
                metrics=metrics,
            )
```

**Tensor structure:**
```
Rows: Scenarios (Input only, no repeat dimension)
Cols: Steps (Testset, Applications, Evaluators × Repeats)

         Testset  App-1  Eval-1-r1  Eval-1-r2  Eval-1-r3  Eval-2-r1  Eval-2-r2  Eval-2-r3
Input-1    ✓       ✓        ✓          ✓          ✓          ✓          ✓          ✓
Input-2    ✓       ✓        ✓          ✓          ✓          ✓          ✓          ✓
Input-3    ✓       ✓        ✓          ✓          ✓          ✓          ✓          ✓

Each row = one scenario (input only)
Each column = one step (evaluators have repeat dimension)
```

**Use cases:**
- Testing human evaluator agreement: "Do 3 humans agree on quality score?"
- Testing LLM-as-judge consistency: "How stable is GPT-4 as an evaluator?"
- Ensemble evaluation: "Get multiple independent judgments, aggregate later"
- Inter-rater reliability: "Measure Cohen's kappa across evaluator repeats"

**Cost implications:**
- Application invoked: `num_inputs` times (no repeat multiplier!)
- Evaluators invoked: `num_inputs × num_evaluators × repeats` times
- Example: 100 inputs, 3 repeats, 2 evaluators = 100 app calls, 600 evaluator calls

**Key difference:** Much cheaper when applications are expensive (e.g., long-running workflows, API costs)

---

##### Comparison Table

| Aspect | `repeat_target = "application"` | `repeat_target = "evaluator"` |
|--------|----------------------------------|-------------------------------|
| **Fanout location** | Input → Application | Application → Evaluator |
| **What's tested** | Application variability | Evaluator variability |
| **Scenario dimension** | Input × Repeat | Input only |
| **Step dimension** | Evaluators (no repeat) | Evaluators × Repeat |
| **Tensor rows** | `num_inputs × repeats` | `num_inputs` |
| **Tensor cols** | `num_steps` | `num_steps × repeats` |
| **App invocations** | `inputs × repeats` | `inputs` |
| **Eval invocations** | `inputs × repeats × evals` | `inputs × evals × repeats` |
| **Typical use case** | LLM consistency, RAG variability | Human agreement, LLM-judge stability |

---

##### Current Implementation Status

**Status:** HARDCODED (exact mode needs investigation)

**Likely location in code:**
- SDK: `sdk/agenta/sdk/evaluations/preview/evaluate.py` (check where `repeats` is used)
- API: May not be implemented yet

**Questions to answer:**
1. ✅ Is `repeats` currently implemented?
2. ✅ If yes, which mode is hardcoded? (`application` or `evaluator`)
3. ✅ Where in the loop does the repeat happen?
4. ✅ How does it affect scenario creation?
5. ✅ How does it affect the tensor structure in practice?

**Future requirement:**
- Make `repeat_target` an explicit flag in graph definition
- Support both modes
- Default to `application` for backward compatibility (if that's current behavior)
- Add validation: `repeat_target = "application"` requires application nodes in graph

---

#### 3. `reuse_traces` (CRITICAL - Currently Implicit)
**Current state:** Hardcoded (location TBD in code)
**Current value:** Unknown (likely `false` - needs investigation)
**Type:** `boolean`

**Purpose:** Avoid re-computing expensive workflows by reusing existing traces with matching inputs

This is a **critical optimization** that enables:
- Cost savings (reuse expensive LLM calls, long-running workflows)
- Reproducibility (use same outputs across evaluations)
- Faster iteration (skip computation, reuse results)

---

##### Trace Reuse Mechanism

**1. Compute stable hash:**
```python
hash = compute_hash(
    node_config=node.config,
    inputs=inputs,
    references=references,
    links=links,
)
```

**Utility location:** `compute_hash()` (exists in codebase - needs verification)

**Hash represents:** "What this computation means" - deterministic based on:
- Node configuration (workflow, parameters)
- Inputs (testcase data, upstream outputs)
- References (testset, application, evaluator IDs/versions)
- Links (upstream trace IDs, span IDs)

---

**2. Hash-based trace lookup:**

**Key property:** Hash is **NOT a primary key** (one-to-many relationship)
- Multiple traces can share the same hash (from different runs, repeats)
- Fetch traces by hash index
- Filter out failed traces (with exceptions/errors)

**Lookup logic:**
```python
if reuse_traces:
    hash = compute_hash(node, inputs, references, links)

    # Fetch all traces matching this hash
    existing_traces = fetch_traces_by_hash(
        hash=hash,
        exclude_errors=True,  # Only successful traces
    )

    if existing_traces:
        # Reuse existing trace
        trace = select_trace(existing_traces)
        return trace
    else:
        # No existing trace, compute fresh
        trace = invoke_workflow(node, inputs)
        return trace
else:
    # Always compute fresh (ignore hash)
    trace = invoke_workflow(node, inputs)
    return trace
```

---

##### Critical Interaction with `repeat_target`

The `reuse_traces` flag behaves differently depending on `repeat_target`:

---

###### Case 1: `repeat_target = "application"` + `reuse_traces = true`

**Constraint:** **CANNOT reuse same trace across repeats** within the same evaluation

**Reason:** Testing application variability requires different outputs for each repeat

**Behavior:**
```python
for testcase in testcases:
    hash = compute_hash(testcase, application_config, ...)
    existing_traces = fetch_traces_by_hash(hash, exclude_errors=True)

    for repeat_idx in range(repeats):
        if existing_traces and len(existing_traces) > repeat_idx:
            # Reuse DIFFERENT trace for each repeat
            trace = existing_traces[repeat_idx]
        else:
            # Need to compute fresh trace
            trace = invoke_application(testcase.inputs)

        # Create scenario with this trace
        scenario = create_scenario(
            testcase=testcase,
            trace_id=trace.id,
            repeat_idx=repeat_idx,
        )
```

**Requirements:**
- Fetch **multiple different traces** from hash index (one per repeat)
- If not enough traces cached, compute additional ones
- Each repeat gets a different trace (even if inputs are identical)

**Example:**
```
Evaluation run 1 (reuse_traces=false):
  Input-1, repeat-1: Compute trace_a
  Input-1, repeat-2: Compute trace_b
  Input-1, repeat-3: Compute trace_c
  → All 3 traces stored with same hash

Evaluation run 2 (reuse_traces=true):
  Input-1, repeat-1: Reuse trace_a (from hash)
  Input-1, repeat-2: Reuse trace_b (from hash)
  Input-1, repeat-3: Reuse trace_c (from hash)
  → No computation needed!
```

---

###### Case 2: `repeat_target = "evaluator"` + `reuse_traces = true`

**Constraint:** **MUST reuse same trace across evaluator repeats** within the same evaluation

**Reason:** Testing evaluator variability requires the same app output for all repeats

**Behavior:**
```python
for testcase in testcases:
    hash = compute_hash(testcase, application_config, ...)
    existing_traces = fetch_traces_by_hash(hash, exclude_errors=True)

    if existing_traces:
        # Reuse SAME trace for all evaluator repeats
        trace = existing_traces[0]  # Pick any one
    else:
        # Compute fresh trace
        trace = invoke_application(testcase.inputs)

    # Create single scenario (no repeat dimension)
    scenario = create_scenario(
        testcase=testcase,
        trace_id=trace.id,
    )

    # All evaluator repeats use this same trace
    for evaluator in evaluators:
        for repeat_idx in range(repeats):
            metrics = invoke_evaluator(
                testcase=testcase,
                outputs=trace.outputs,  # Same for all repeats
            )
```

**Requirements:**
- Fetch **single trace** from hash index
- All evaluator repeats use this same trace
- If multiple traces available (from previous runs), pick any one

**Example:**
```
Evaluation run 1 (reuse_traces=false):
  Input-1: Compute trace_a
  Evaluator-1, repeat-1: Evaluate trace_a
  Evaluator-1, repeat-2: Evaluate trace_a (same!)
  Evaluator-1, repeat-3: Evaluate trace_a (same!)
  → Only 1 trace computed, evaluated 3 times

Evaluation run 2 (reuse_traces=true):
  Input-1: Reuse trace_a (from hash)
  Evaluator-1, repeat-1: Evaluate trace_a (same!)
  Evaluator-1, repeat-2: Evaluate trace_a (same!)
  Evaluator-1, repeat-3: Evaluate trace_a (same!)
  → No computation needed!
```

---

##### Comparison Table

| Aspect | `repeat_target = "application"` | `repeat_target = "evaluator"` |
|--------|----------------------------------|-------------------------------|
| **Trace reuse constraint** | Different trace per repeat | Same trace across repeats |
| **Traces fetched per input** | `repeats` traces | `1` trace |
| **Trace selection** | `existing_traces[repeat_idx]` | `existing_traces[0]` (any) |
| **Variability source** | Application (different traces) | Evaluator (same trace) |
| **Scenario creation** | One per repeat (with trace_id) | One per input (reused trace_id) |

---

##### Scenario Creation with Trace Reuse

Even when reusing traces, scenarios are still created:

**Case 1: `repeat_target = "application"`**
```python
# Multiple scenarios (one per repeat), each with different trace
scenario_1 = Scenario(
    testcase_id=testcase.id,
    trace_id=trace_a.id,  # Reused or fresh
    repeat_idx=0,
)

scenario_2 = Scenario(
    testcase_id=testcase.id,
    trace_id=trace_b.id,  # Different trace
    repeat_idx=1,
)

scenario_3 = Scenario(
    testcase_id=testcase.id,
    trace_id=trace_c.id,  # Different trace
    repeat_idx=2,
)
```

**Case 2: `repeat_target = "evaluator"`**
```python
# Single scenario, same trace reused across evaluator repeats
scenario = Scenario(
    testcase_id=testcase.id,
    trace_id=trace_a.id,  # Reused or fresh, but same for all evals
)

# Evaluators reference this same scenario/trace
result_1 = EvaluationResult(
    scenario_id=scenario.id,
    step_key="evaluator-1-r0",
    trace_id=evaluator_trace_1.id,
)

result_2 = EvaluationResult(
    scenario_id=scenario.id,  # Same scenario!
    step_key="evaluator-1-r1",
    trace_id=evaluator_trace_2.id,
)
```

---

##### Filtering and Selection

**Filter failed traces:**
```python
existing_traces = fetch_traces_by_hash(
    hash=hash,
    exclude_errors=True,  # Only successful traces
)
```

**Selection when multiple available:**
- Order doesn't matter (everything is stochastic)
- Can pick traces in any order (e.g., by creation time, random)
- As long as different traces are used for different application repeats

**Example:**
```python
# Fetch traces by hash
traces = [trace_a, trace_b, trace_c, trace_d]  # All have same hash

# Application repeats: Use different traces
repeat_0_trace = traces[0]  # trace_a
repeat_1_trace = traces[1]  # trace_b
repeat_2_trace = traces[2]  # trace_c

# Evaluator repeats: Use same trace
all_repeats_trace = traces[0]  # trace_a (any one is fine)
```

---

##### Use Cases

**With `repeat_target = "application"`:**
- Caching expensive app runs: "Run GPT-4 once, reuse across evaluations"
- A/B testing with fixed outputs: "Test different evaluators on same app outputs"
- Debugging: "Fix evaluator bug, re-evaluate without re-running app"

**With `repeat_target = "evaluator"`:**
- Measuring human evaluator agreement: "Same output judged by multiple humans"
- LLM-as-judge stability: "Same output scored by LLM multiple times"
- Cost optimization: "Run app once, test evaluator variability cheaply"

---

##### Current Implementation Status

**Status:** Unknown - needs investigation

**Likely locations in code:**
- Hash computation: Utility function `compute_hash()` or similar
- Trace lookup: Tracing service or DAO with hash index
- SDK: May not be implemented yet
- API: May exist in some form

**Questions to answer:**
1. ✅ Is trace reuse currently implemented?
2. ✅ Where is `compute_hash()` located?
3. ✅ Is there a hash index on traces table?
4. ✅ How are traces fetched by hash?
5. ✅ Does it filter out failed traces?
6. ✅ How does it interact with repeats?

**Future requirements:**
- Make `reuse_traces` an explicit flag in graph definition
- Implement hash-based trace lookup if not present
- Add validation: `repeat_target = "application"` + `reuse_traces = true` requires enough cached traces
- Document hash computation algorithm

---

#### 4. `is_closed` (State Management - Likely Implemented)
**Current state:** Likely implemented
**Current value:** `false` by default, set to `true` when evaluation is finalized
**Type:** `boolean`

**Purpose:** Controls whether the evaluation graph and tensor are editable

**Behavior:**

##### When `is_closed = false` (Open - Default)
- ✅ Can modify graph structure
- ✅ Can add/edit/delete scenarios
- ✅ Can add/edit/delete results
- ✅ Can re-run evaluation
- ✅ Can edit metadata (name, description)

##### When `is_closed = true` (Closed - Finalized)
- ❌ **Cannot** modify graph structure
- ❌ **Cannot** add/edit/delete scenarios
- ❌ **Cannot** add/edit/delete results
- ❌ **Cannot** re-run evaluation (execution blocked)
- ✅ **Can still** edit metadata (name, description)
- ✅ **Can** reopen (with appropriate permissions/operations)

**Enforcement:**
- **DAO level:** Database operations fail for closed evaluations
- **API level:** Returns error (e.g., 409 Conflict, 403 Forbidden)
- **UI level:** Disable edit buttons, show read-only mode

**Reopening:**
```python
# Some operations can reopen a closed evaluation
await evaluations_dao.update_run(
    run_id=run_id,
    is_closed=False,  # Reopen
)
```

**Use cases:**
- **Finalize results:** Prevent accidental modification after review
- **Archival:** Mark completed evaluations as read-only
- **Compliance:** Lock evaluations for audit trail
- **Versioning:** Freeze evaluation state at specific point in time

**Metadata operations (allowed when closed):**
- Update run name
- Update run description
- Add tags/labels
- Change visibility/permissions

**Status:** Likely implemented (needs verification)

---

## Summary: Confirmed Flags

| Flag | Type | Purpose | Status |
|------|------|---------|--------|
| `is_live` | `boolean` | Online (periodic) vs offline (one-time) execution | ✅ Explicit |
| `is_active` | `boolean` | Pause/resume online evaluations | ✅ Explicit (companion to `is_live`) |
| `repeat_target` | `"application" \| "evaluator"` | Where repeats fan out (critical for tensor structure) | ⚠️ Currently implicit |
| `reuse_traces` | `boolean` | Cost optimization via trace caching | ⚠️ Currently implicit |
| `is_closed` | `boolean` | Lock evaluation to prevent edits | ✅ Explicit (state management) |

---

## Future Considerations (Not Confirmed as Flags)

The following behaviors may need to be configurable in the future, but are not currently discussed as flags:

### Execution Behavior
- **Concurrency:** Sequential vs parallel scenario execution
- **Error handling:** Fail fast vs collect all errors
- **Application invocation:** Whether to invoke apps (currently determined by graph structure)

### Metrics Computation
- **Timing:** Immediate vs deferred vs on-demand
- **Scope:** Per-scenario vs per-run
- **Current behavior:** SDK computes immediately, API defers to separate task

These should be documented separately if/when they become explicit configuration options.

---

## Data Source Types

### 1. Testset Data Source

**Structure:**
```python
class TestsetDataSource:
    type: Literal["testset"]
    testset_id: UUID
    testset_revision_id: UUID
    testset_variant_id: Optional[UUID]
```

**Resolution:**
```python
async def resolve_testset_scenarios(
    data_source: TestsetDataSource,
) -> list[Scenario]:
    """
    Load test cases from testset revision.

    Returns one scenario per test case.
    """
    testset_revision = await testsets_dao.get_revision(
        testset_revision_id=data_source.testset_revision_id,
    )

    scenarios = []
    for testcase in testset_revision.testcases:
        scenarios.append(
            Scenario(
                data_source_type="testset",
                testcase=testcase,
            )
        )

    return scenarios
```

**Properties:**
- **Static:** Same test cases every execution
- **Bounded:** Known size (number of test cases)
- **Versioned:** Tied to specific revision
- **Portable:** Can be shared across projects

**Compatible with:**
- ✅ Offline evaluation
- ❌ Online evaluation

---

### 2. Query Data Source

**Structure:**
```python
class QueryDataSource:
    type: Literal["query"]
    query_spec: QuerySpec
    time_window: Optional[TimeWindow]

class QuerySpec:
    filters: dict[str, Any]
    limit: Optional[int]
    order_by: Optional[str]

class TimeWindow:
    start_time: datetime
    end_time: datetime
```

**Resolution (Offline):**
```python
async def resolve_query_scenarios_offline(
    data_source: QueryDataSource,
) -> list[Scenario]:
    """
    Execute query once, return snapshot of traces.

    Returns one scenario per trace.
    """
    traces = await tracing_service.query_traces(
        filters=data_source.query_spec.filters,
        start_time=data_source.time_window.start_time,
        end_time=data_source.time_window.end_time,
        limit=data_source.query_spec.limit,
    )

    scenarios = []
    for trace in traces:
        scenarios.append(
            Scenario(
                data_source_type="query",
                trace=trace,
            )
        )

    return scenarios
```

**Resolution (Online):**
```python
async def resolve_query_scenarios_online(
    data_source: QueryDataSource,
    interval_start: datetime,
    interval_end: datetime,
) -> list[Scenario]:
    """
    Execute query for current interval window.

    Overwrites data_source.time_window with interval bounds.
    Returns one scenario per trace.
    """
    traces = await tracing_service.query_traces(
        filters=data_source.query_spec.filters,
        start_time=interval_start,  # Overwritten!
        end_time=interval_end,      # Overwritten!
        limit=data_source.query_spec.limit,
    )

    scenarios = []
    for trace in traces:
        scenarios.append(
            Scenario(
                data_source_type="query",
                trace=trace,
                timestamp=interval_start,  # Online-specific
                interval=f"{interval_end - interval_start}",  # Online-specific
            )
        )

    return scenarios
```

**Properties:**
- **Dynamic:** Different traces every execution (if time window changes)
- **Unbounded:** Size depends on query results (use `limit` for safety)
- **Temporal:** Can be windowed by time
- **Live:** Reflects current system state

**Compatible with:**
- ✅ Offline evaluation (snapshot)
- ✅ Online evaluation (windowed)

---

## Tensor Structure

The evaluation tensor is the data structure that holds all results produced by running a graph. It is a 3D table indexed by **scenarios × steps × repeats**, stored as five related entities.

---

### Five Entities

```
EvaluationRun
└── EvaluationScenario (one per row)
    └── step_key (column label — string, not an entity)
        └── repeat_idx (depth label — integer, not an entity)
            └── EvaluationResult (the cell)
```

| Entity | Nature | Description |
|--------|--------|-------------|
| `EvaluationRun` | Entity (DB row) | The evaluation job. Owns the graph definition and all flag values. |
| `EvaluationScenario` | Entity (DB row) | One row in the tensor. Represents one input × (optionally) one application repeat. |
| `step_key` | String label | Column label — identifies which graph step produced the result (e.g. `"app-123"`, `"eval-456"`, `"eval-456-r2"`). |
| `repeat_idx` | Integer label | Depth label — which evaluator repeat this result belongs to (0-based). |
| `EvaluationResult` | Entity (DB row) | The cell. Identified by `(scenario_id, step_key, repeat_idx)`. |

**There is no dedicated "Step" or "Repeat" entity** — `step_key` and `repeat_idx` are fields on the result row, forming a composite key together with `scenario_id`.

---

### Tensor Dimensions

#### Rows: Scenarios

Each `EvaluationScenario` is one row. Its meaning depends on `repeat_target`:

| `repeat_target` | Row = |
|-----------------|-------|
| `"application"` | One input × one application repeat (repeat dimension is in the row) |
| `"evaluator"` | One input (repeat dimension is in the column) |

For online evaluations (`is_live = true`), each scenario also carries:
- `timestamp`: The start of the interval that produced it
- `interval`: The interval duration (e.g. `"1h"`)

#### Columns: Steps

Each distinct `step_key` is one logical column. Step keys are stable strings derived from the graph node identity:

```
"testset-{testset_id}"          ← testset node result
"app-{application_revision_id}" ← application node result
"eval-{evaluator_revision_id}"  ← evaluator node result (no repeat)
"eval-{evaluator_revision_id}-r{repeat_idx}" ← evaluator repeat (repeat_target="evaluator")
```

#### Depth: Repeats

`repeat_idx` is the 0-based repeat index. Its role depends on `repeat_target`:

| `repeat_target` | `repeat_idx` in result |
|-----------------|------------------------|
| `"application"` | Always `0` (repeats are rows, not depth) |
| `"evaluator"` | `0..N-1` across evaluator repeats |

In practice, for `repeat_target = "application"`, the scenario itself carries the repeat index, and results within a scenario have `repeat_idx = 0`.

---

### EvaluationResult: the Cell

**Composite key:** `(scenario_id, step_key, repeat_idx)`

There is no dedicated UUID primary key for a result — the three-field composite uniquely identifies the cell.

#### Result Content: By Reference Only

Results do **not** copy values inline. They store references:

```python
class EvaluationResult:
    # Identity
    scenario_id: UUID
    step_key: str
    repeat_idx: int

    # References (no inline values)
    testcase_id: Optional[UUID]   # Reference to the testcase used as input
    trace_id: Optional[UUID]      # Reference to the execution trace (app or evaluator)
    error: Optional[str]          # Error message if the step failed

    # Status
    status: EvaluationStatus      # pending | running | completed | failed
```

**Key principle:** To read the actual inputs or outputs of a result, you follow the reference to the trace and read it there. The result row is only a pointer.

**Why by reference:**
- Traces are already stored in the tracing system with full span detail
- Copying data into results would duplicate storage and create drift
- Metrics computation reads trace IDs from results and queries the tracing system directly

---

### Tensor Population Flow

The tensor is populated in three stages that correspond to the execution lifecycle:

```
1. Create EvaluationRun     → Defines graph, flags, metadata
                               (tensor shape is implied by graph + inputs)

2. Create EvaluationScenario → Adds a row
                                Happens as inputs are enumerated
                                (one per testcase for offline; one per trace for online)

3. Create/Update EvaluationResult → Populates a cell
                                     Happens as each step completes
                                     (one per scenario × step × repeat)
```

**Example: Offline testset evaluation (2 testcases, 1 application, 2 evaluators, 1 repeat)**

```
Stage 1: Create run
  run_id = "run-abc"

Stage 2: Create scenarios (2 rows)
  scenario_1 = Scenario(run_id="run-abc", testcase_id="tc-1")
  scenario_2 = Scenario(run_id="run-abc", testcase_id="tc-2")

Stage 3: Populate cells
  # Application step
  result(scenario_1, step_key="app-rev-1", repeat_idx=0) = { trace_id: "trace-a1" }
  result(scenario_2, step_key="app-rev-1", repeat_idx=0) = { trace_id: "trace-a2" }

  # Evaluator steps
  result(scenario_1, step_key="eval-rev-1", repeat_idx=0) = { trace_id: "trace-e1" }
  result(scenario_1, step_key="eval-rev-2", repeat_idx=0) = { trace_id: "trace-e2" }
  result(scenario_2, step_key="eval-rev-1", repeat_idx=0) = { trace_id: "trace-e3" }
  result(scenario_2, step_key="eval-rev-2", repeat_idx=0) = { trace_id: "trace-e4" }
```

Resulting tensor:

```
             app-rev-1    eval-rev-1   eval-rev-2
scenario_1   trace-a1     trace-e1     trace-e2
scenario_2   trace-a2     trace-e3     trace-e4
```

---

### Metrics

Metrics are **separate entities** from the tensor cells. They are computed after results are collected, by fetching trace IDs from results and running SQL aggregations over the traces.

#### Metrics Computation

```
1. Fetch results for the run (or scenario)
2. Extract trace_ids from those results
3. Query the tracing system for those trace IDs
4. Run SQL aggregations over the trace data
5. Write metrics entity
```

This means metrics are always **derived, not stored inline**. They can be recomputed at any time by repeating steps 1–5.

#### Three Metrics Types

| Type | Scope | Compatible with | Description |
|------|-------|-----------------|-------------|
| **Global** | Entire run (all scenarios × all repeats) | `is_live = false` (offline only) | Aggregate statistics across the full evaluation |
| **Variational** | Per scenario (across all repeats for that scenario) | Both | Per-input statistics, showing variation across repeats |
| **Temporal** | Per interval / timestamp | `is_live = true` (online only) | Global statistics binned by time interval |

---

#### Global Metrics (Offline Only)

**Scope:** All scenarios × all repeats in the run.

**Structure:** Per step → per output key → statistics.

```python
class GlobalMetrics:
    run_id: UUID

    # Nested: step → output_key → stats
    steps: dict[str, dict[str, MetricStats]]
    #           step_key  output_key

class MetricStats:
    # Numeric outputs
    mean: Optional[float]
    std: Optional[float]
    min: Optional[float]
    max: Optional[float]
    p50: Optional[float]
    p95: Optional[float]
    count: int

    # Categorical / score outputs
    distribution: Optional[dict[str, int]]  # value → count
```

**Example:**
```python
GlobalMetrics(
    run_id="run-abc",
    steps={
        "eval-rev-1": {
            "score":    MetricStats(mean=0.72, std=0.15, p50=0.75, count=50),
            "category": MetricStats(distribution={"pass": 38, "fail": 12}),
        },
        "eval-rev-2": {
            "latency_ms": MetricStats(mean=320, p95=850, count=50),
        },
    }
)
```

**Not available for online evaluations** — there is no well-defined "total" population for a continuously-running evaluation; use Temporal metrics instead.

---

#### Variational Metrics (Both Modes)

**Scope:** Per scenario, across all repeats for that scenario.

**Purpose:** Show how variable the results are for a given input. For `repeat_target = "application"` this reveals application stochasticity; for `repeat_target = "evaluator"` it reveals evaluator disagreement.

**Structure:** Same nested structure as Global, but one entity per scenario.

```python
class VariationalMetrics:
    scenario_id: UUID

    # Nested: step → output_key → stats (across repeats for this scenario)
    steps: dict[str, dict[str, MetricStats]]
    #           step_key  output_key
```

**Example:**
```python
VariationalMetrics(
    scenario_id="scenario-1",  # Input: "What is 2+2?"
    steps={
        "eval-rev-1": {
            # 3 repeats scored this input as: 0.8, 0.7, 0.9
            "score": MetricStats(mean=0.8, std=0.082, min=0.7, max=0.9, count=3),
        },
    }
)
```

**Available for both offline and online evaluations.**

---

#### Temporal Metrics (Online Only)

**Scope:** Per time interval (aggregated across all scenarios in that interval).

**Purpose:** Show how quality changes over time in a live evaluation.

**Structure:** Same as Global, but keyed by interval.

```python
class TemporalMetrics:
    run_id: UUID
    interval_start: datetime
    interval_end: datetime

    # Nested: step → output_key → stats (all scenarios in this interval)
    steps: dict[str, dict[str, MetricStats]]
    #           step_key  output_key
```

**Example:**
```python
TemporalMetrics(
    run_id="run-abc",
    interval_start=datetime(2026, 2, 17, 10, 0),
    interval_end=datetime(2026, 2, 17, 11, 0),
    steps={
        "eval-rev-1": {
            "score": MetricStats(mean=0.68, count=42),
        },
    }
)
```

**Not available for offline evaluations** — offline runs have no meaningful interval breakdown; use Global metrics instead.

---

#### Metrics Compatibility Summary

| Metrics Type | Offline (`is_live = false`) | Online (`is_live = true`) |
|--------------|-----------------------------|-----------------------------|
| **Global** | ✅ Primary aggregate view | ❌ Not applicable |
| **Variational** | ✅ Per-input variation | ✅ Per-input variation |
| **Temporal** | ❌ Not applicable | ✅ Primary time-series view |

---

#### Metrics Entity Relationship

```
EvaluationRun
├── GlobalMetrics (1 per run, offline only)
├── TemporalMetrics (N per run, online only — one per interval)
└── EvaluationScenario (N per run)
    ├── VariationalMetrics (1 per scenario)
    └── EvaluationResult (M per scenario — one per step × repeat)
        └── → trace_id (reference into tracing system)
```

---

## Current Graph Structures

### Structure 1: Batch Testset Evaluation (SDK)

**Current implementation:** `sdk/agenta/sdk/evaluations/preview/evaluate.py`

**Graph:**
```
Testset → Application(s) → Evaluator(s)
```

**Nodes:**
- 1 Testset node
- N Application nodes
- M Evaluator nodes

**Execution:**
```
For each testcase in testset:
    scenario = create_scenario()

    For each application:
        outputs = invoke_application(testcase.inputs)
        log_result(scenario, application, outputs)

    For each evaluator:
        metrics = invoke_evaluator(testcase, application.outputs)
        log_result(scenario, evaluator, metrics)

    compute_metrics(scenario)
```

**Flags:**
- `is_live = false` (offline)
- `application_required = true` (implicit)
- `concurrent_execution = false` (implicit)

---

### Structure 2: Batch Testset Evaluation (API Legacy)

**Current implementation:** `api/oss/src/core/evaluations/tasks/legacy.py`

**Graph:**
```
Testset → [Applications already invoked] → Evaluator(s)
```

**Nodes:**
- 1 Testset node
- N Application nodes (invoked separately, before this task)
- M Evaluator nodes

**Execution:**
```
# Applications already invoked, results available as "invocations"

For each testcase:
    scenario = scenarios[idx]  # Already created
    invocation = invocations[idx]  # Already executed

    If invocation has error:
        skip evaluators

    trace = fetch_trace(invocation.trace_id)

    For each evaluator:
        metrics = invoke_evaluator(testcase, invocation.outputs)
        log_result(scenario, evaluator, metrics)

# Metrics computed later via separate task
```

**Flags:**
- `is_live = false` (offline)
- `application_required = true` (but invoked separately)
- `concurrent_execution = false` (implicit)
- `metrics_computation_mode = "deferred"` (implicit)

---

### Structure 3: Live Query Evaluation (API)

**Current implementation:** `api/oss/src/core/evaluations/tasks/live.py`

**Graph:**
```
Query → Evaluator(s)
```

**Nodes:**
- 1 Query node
- M Evaluator nodes
- **No application nodes** (evaluates existing traces)

**Execution:**
```
For each interval (e.g., hourly):
    # Overwrite query time window with current interval
    traces = query_traces(
        filters=query_spec.filters,
        start_time=interval_start,  # Overwritten
        end_time=interval_end,      # Overwritten
    )

    scenarios = create_scenarios(
        nof_scenarios=len(traces),
        timestamp=interval_start,
        interval=interval_duration,
    )

    For each trace:
        scenario = scenarios[idx]

        For each evaluator:
            metrics = invoke_evaluator(trace, trace.outputs)
            log_result(scenario, evaluator, metrics)

# Metrics computed later via separate task
```

**Flags:**
- `is_live = true` (online)
- `application_required = false` (implicit - no apps invoked)
- `concurrent_execution = false` (implicit)
- `metrics_computation_mode = "deferred"` (implicit)

---

## Future Graph Structures

### Structure 4: Multi-Application Comparison (Future)

**Use case:** Compare multiple application variants on the same testset

**Graph:**
```
Testset → Application A → Evaluator 1
        → Application B → Evaluator 1
        → Application C → Evaluator 1
```

**Challenge:**
- Current implementation evaluates all evaluators against each application
- Need to support: All applications evaluated by the same evaluators

**Desired execution:**
```
For each testcase:
    scenario = create_scenario()

    outputs_by_app = {}
    For each application:
        outputs = invoke_application(testcase.inputs)
        outputs_by_app[application.id] = outputs
        log_result(scenario, application, outputs)

    For each evaluator:
        For each application:
            metrics = invoke_evaluator(testcase, outputs_by_app[application.id])
            log_result(scenario, f"{evaluator.id}-{application.id}", metrics)
```

**New requirement:**
- Evaluators need access to ALL application outputs for comparison
- Graph edges must specify which app outputs go to which evaluators

---

### Structure 5: Chained Applications (Future)

**Use case:** Multi-step workflows (e.g., retrieval → generation → verification)

**Graph:**
```
Testset → Retrieval App → Generation App → Verification App → Evaluator
```

**Challenge:**
- Current implementation assumes applications are independent
- Need to support: Application B takes Application A's outputs as inputs

**Desired execution:**
```
For each testcase:
    scenario = create_scenario()

    # Step 1: Retrieval
    retrieval_outputs = invoke_application(retrieval_app, testcase.inputs)

    # Step 2: Generation (uses retrieval outputs)
    generation_inputs = {
        **testcase.inputs,
        "context": retrieval_outputs["documents"],
    }
    generation_outputs = invoke_application(generation_app, generation_inputs)

    # Step 3: Verification (uses generation outputs)
    verification_inputs = {
        **testcase.inputs,
        "generated_text": generation_outputs["text"],
    }
    verification_outputs = invoke_application(verification_app, verification_inputs)

    # Step 4: Evaluate final output
    metrics = invoke_evaluator(testcase, verification_outputs)
```

**New requirements:**
- Graph edges must specify input/output mappings
- Topological sort to determine execution order
- Support for partial failures (if step 2 fails, skip step 3)

---

### Structure 6: Conditional Evaluation (Future)

**Use case:** Run different evaluators based on outputs

**Graph:**
```
Testset → Application → [if output.type == "chat"] → Chat Evaluator
                      → [if output.type == "completion"] → Completion Evaluator
```

**Challenge:**
- Current implementation runs all evaluators for all scenarios
- Need to support: Conditional evaluator invocation based on outputs

**Desired execution:**
```
For each testcase:
    scenario = create_scenario()

    outputs = invoke_application(testcase.inputs)

    # Conditional evaluator selection
    if outputs.get("type") == "chat":
        evaluators = [chat_evaluator_1, chat_evaluator_2]
    elif outputs.get("type") == "completion":
        evaluators = [completion_evaluator_1]
    else:
        evaluators = [generic_evaluator]

    For each evaluator in evaluators:
        metrics = invoke_evaluator(testcase, outputs)
```

**New requirements:**
- Graph edges can have conditions
- Evaluator selection based on runtime data
- Support for dynamic graph execution

---

### Structure 7: Human-in-the-Loop Evaluation (Future)

**Use case:** Mix automated and human evaluation

**Graph:**
```
Testset → Application → Auto Evaluator 1
                      → Auto Evaluator 2
                      → Human Evaluator (async)
```

**Challenge:**
- Current implementation expects synchronous evaluator responses
- Human evaluation is asynchronous (can take hours/days)

**Desired execution:**
```
For each testcase:
    scenario = create_scenario()

    outputs = invoke_application(testcase.inputs)

    # Automated evaluators (synchronous)
    For each auto_evaluator:
        metrics = invoke_evaluator(testcase, outputs)
        log_result(scenario, auto_evaluator, metrics)

    # Human evaluator (asynchronous)
    task = create_human_evaluation_task(testcase, outputs)
    log_result(scenario, human_evaluator, status="pending")

# Later, when human completes evaluation:
update_result(scenario, human_evaluator, metrics=human_metrics)
```

**New requirements:**
- Support for async/pending results
- Ability to update results after initial execution
- Separate "automated complete" vs "fully complete" states

---

### Structure 8: Iterative Refinement (Future)

**Use case:** Evaluate, refine, re-evaluate in a loop

**Graph:**
```
Testset → Application v1 → Evaluator → [if score < threshold] → Application v2 → Evaluator
```

**Challenge:**
- Current implementation is single-pass
- Need to support: Conditional re-execution based on results

**Desired execution:**
```
For each testcase:
    scenario = create_scenario()

    version = 1
    max_iterations = 3

    While version <= max_iterations:
        outputs = invoke_application(app[version], testcase.inputs)
        metrics = invoke_evaluator(testcase, outputs)

        if metrics["score"] >= threshold:
            break  # Success!

        version += 1

    log_final_result(scenario, version, metrics)
```

**New requirements:**
- Support for loops in graph
- Conditional loop exit
- Tracking iterations in results

---

## Graph Representation

### Current Representation (Implicit)

**Location:** Embedded in execution logic, not explicit data structure

**Example (SDK):**
```python
# Implicit graph in loop structure
for testset_revision in testsets:
    for testcase in testcases:
        for application in applications:
            # Edge: testset → application
            invoke_application(testcase.inputs)

            for evaluator in evaluators:
                # Edge: application → evaluator
                invoke_evaluator(application.outputs)
```

**Problems:**
- Graph structure is code, not data
- Can't serialize/visualize graph
- Hard to validate before execution
- No way to query "what will this evaluation do?"

---

### Desired Representation (Explicit)

**Goal:** Represent graph as data structure

**Example:**
```python
class EvaluationGraph:
    """Explicit graph representation."""

    nodes: list[GraphNode]
    edges: list[GraphEdge]

class GraphNode:
    id: str
    type: Literal["testset", "query", "application", "evaluator"]
    config: dict[str, Any]

class GraphEdge:
    from_node_id: str
    to_node_id: str
    port_mapping: dict[str, str]  # Maps output ports to input ports
    condition: Optional[str]       # Optional condition (future)

# Example graph for batch testset evaluation
graph = EvaluationGraph(
    nodes=[
        GraphNode(
            id="testset-1",
            type="testset",
            config={
                "testset_id": "ts-123",
                "testset_revision_id": "rev-456",
            }
        ),
        GraphNode(
            id="app-1",
            type="application",
            config={
                "application_id": "app-789",
                "application_revision_id": "rev-abc",
            }
        ),
        GraphNode(
            id="eval-1",
            type="evaluator",
            config={
                "evaluator_id": "eval-xyz",
                "evaluator_revision_id": "rev-def",
            }
        ),
    ],
    edges=[
        GraphEdge(
            from_node_id="testset-1",
            to_node_id="app-1",
            port_mapping={
                "testcase.data": "inputs",  # testcase data → app inputs
            }
        ),
        GraphEdge(
            from_node_id="app-1",
            to_node_id="eval-1",
            port_mapping={
                "outputs": "outputs",       # app outputs → eval outputs
                "trace": "trace",           # app trace → eval trace
            }
        ),
        GraphEdge(
            from_node_id="testset-1",
            to_node_id="eval-1",
            port_mapping={
                "testcase": "testcase",     # testcase → eval testcase
            }
        ),
    ],
)
```

**Benefits:**
- Serializable (can save/load)
- Validatable (check before execution)
- Visualizable (render as diagram)
- Queryable (analyze without executing)

---

## Validation Rules

### Rule 1: Data Source Compatibility
**Constraint:** `is_live = true` → Data source MUST be Query

**Validation:**
```python
def validate_live_data_source(graph: EvaluationGraph, is_live: bool) -> None:
    """Validate data source is compatible with is_live flag."""
    data_source_node = graph.get_data_source_node()

    if is_live and data_source_node.type == "testset":
        raise ValidationError(
            "Live evaluation (is_live=true) requires Query data source, "
            "not Testset. Testsets yield the same data every interval."
        )
```

---

### Rule 2: Graph Connectivity
**Constraint:** All non-source nodes must be reachable from a source node

**Validation:**
```python
def validate_graph_connectivity(graph: EvaluationGraph) -> None:
    """Validate all nodes are reachable from data source."""
    source_nodes = [n for n in graph.nodes if n.type in ["testset", "query"]]

    if not source_nodes:
        raise ValidationError("Graph must have at least one data source node")

    reachable = set()
    to_visit = [n.id for n in source_nodes]

    while to_visit:
        current = to_visit.pop()
        if current in reachable:
            continue
        reachable.add(current)

        # Add downstream nodes
        for edge in graph.edges:
            if edge.from_node_id == current:
                to_visit.append(edge.to_node_id)

    unreachable = set(n.id for n in graph.nodes) - reachable

    if unreachable:
        raise ValidationError(
            f"Nodes {unreachable} are not reachable from data source"
        )
```

---

### Rule 3: No Cycles (Current - may relax in future)
**Constraint:** Graph must be a DAG (Directed Acyclic Graph)

**Validation:**
```python
def validate_no_cycles(graph: EvaluationGraph) -> None:
    """Validate graph has no cycles."""
    visited = set()
    in_path = set()

    def has_cycle(node_id: str) -> bool:
        if node_id in in_path:
            return True  # Cycle detected
        if node_id in visited:
            return False

        visited.add(node_id)
        in_path.add(node_id)

        for edge in graph.edges:
            if edge.from_node_id == node_id:
                if has_cycle(edge.to_node_id):
                    return True

        in_path.remove(node_id)
        return False

    for node in graph.nodes:
        if has_cycle(node.id):
            raise ValidationError(
                f"Graph contains a cycle involving node {node.id}"
            )
```

**Note:** This rule may be relaxed in the future to support iterative refinement (Structure 8)

---

### Rule 4: Valid Port Mappings
**Constraint:** Edge port mappings must reference valid ports

**Validation:**
```python
def validate_port_mappings(graph: EvaluationGraph) -> None:
    """Validate edge port mappings reference valid ports."""

    # Define valid ports for each node type
    PORT_DEFINITIONS = {
        "testset": {
            "outputs": ["testcase", "testcase.data", "testcase.id"]
        },
        "query": {
            "outputs": ["trace", "trace.id", "trace.inputs", "trace.outputs"]
        },
        "application": {
            "inputs": ["inputs"],
            "outputs": ["outputs", "trace", "trace_id", "span_id"]
        },
        "evaluator": {
            "inputs": ["testcase", "inputs", "outputs", "trace"],
            "outputs": ["metrics", "trace", "trace_id"]
        },
    }

    for edge in graph.edges:
        from_node = graph.get_node(edge.from_node_id)
        to_node = graph.get_node(edge.to_node_id)

        from_ports = PORT_DEFINITIONS[from_node.type]["outputs"]
        to_ports = PORT_DEFINITIONS[to_node.type]["inputs"]

        for from_port, to_port in edge.port_mapping.items():
            if from_port not in from_ports:
                raise ValidationError(
                    f"Node {from_node.id} ({from_node.type}) "
                    f"has no output port '{from_port}'"
                )

            if to_port not in to_ports:
                raise ValidationError(
                    f"Node {to_node.id} ({to_node.type}) "
                    f"has no input port '{to_port}'"
                )
```

---

## Summary

### Current State
- **3 graph structures** currently supported (testset batch, testset batch API, query live)
- **1 explicit flag** (`is_live`)
- **5 implicit flags** (hardcoded behaviors)
- **Implicit graph** representation (embedded in code)
- **Tensor model:** 5 entities — EvaluationRun → EvaluationScenario → EvaluationResult (keyed by `step_key`, `repeat_idx`)
- **Results:** By reference only (testcase_id, trace_id, error — no inline values)
- **Metrics:** 3 types — Global (offline), Variational (both), Temporal (online); computed via SQL over trace IDs from results

### Key Constraints
- **Live evaluation requires Query data source** (testsets yield same data)
- **Graphs must be DAGs** (no cycles, for now)
- **All nodes must be reachable** from data source

### Future Evolution
- **Explicit graph representation** (nodes + edges as data)
- **More complex structures** (multi-app comparison, chained apps, conditionals)
- **Additional flags** (concurrency, error handling, metrics mode)
- **Relaxed constraints** (cycles for iterative refinement, async evaluators)

### Next Steps
1. Define explicit graph data structure
2. Implement graph validation rules
3. Support serialization/deserialization
4. Add graph visualization
5. Extend to support future structures

---

**Document Status:** Draft - covers graph structure, confirmed flags, tensor model, and metrics types
**Next Action:** Review flag taxonomy, tensor entity schemas, and metrics computation with team
