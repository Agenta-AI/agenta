# Evaluation Operations

**Created:** 2026-02-17
**Purpose:** Document the supported operations on an evaluation — graph mutations, tensor interface, and orchestration
**Related:**
- [Evaluation Structure](./evaluation-structure.md)
- [Iteration Patterns](./iteration-patterns.md)
- [Desired Architecture](./desired-architecture.md)

---

## Table of Contents

- [Design Principle: Everything is a Mutation](#design-principle-everything-is-a-mutation)
- [Layer Model](#layer-model)
- [Step Model](#step-model)
- [Creation](#creation)
- [Graph Mutations](#graph-mutations)
  - [add_step](#add_step)
  - [remove_step](#remove_step)
  - [Edit Step (via Remove + Add)](#edit-step-via-remove--add)
- [Tensor Mutations](#tensor-mutations)
  - [add_scenario / remove_scenario](#add_scenario--remove_scenario)
  - [increase_repeats / decrease_repeats](#increase_repeats--decrease_repeats)
  - [populate / prune](#populate--prune)
  - [probe](#probe)
- [Metrics](#metrics)
  - [refresh_metrics](#refresh_metrics)
- [Flag Operations](#flag-operations)
  - [get_flags / set_flags](#get_flags--set_flags)
  - [set_flag](#set_flag)
- [Orchestration: process](#orchestration-process)
- [TensorSlice](#tensorslice)
- [Operation Summary](#operation-summary)

---

## Design Principle: Everything is a Mutation

**Creation with a graph definition is sugar for: create empty + apply mutations.**

```
create(graph_definition)
≡
create_empty()
+ add_step(type="input", ...)       [for each data source in graph]
+ add_step(type="invocation", ...)  [for each application in graph]
+ add_step(type="annotation", ...)  [for each evaluator in graph]
```

This makes the operation model explicit:
- If a mutation is supported, it is supported at creation time
- If a mutation is not supported (or gated by a flag), that applies at creation time too
- There are no "creation-only" special cases

---

## Layer Model

Operations are organized into two symmetric layers, plus an orchestration layer above both:

```
┌─────────────────────────────────────────────────────────┐
│                     Orchestration                        │
│              process(slice)                              │
│   SDK | Backend | Frontend — each impl.                 │
│   All converge on the tensor layer below ↓              │
└─────────────────────────────────────────────────────────┘

┌──────────────────────────┐  ┌──────────────────────────┐
│      Graph Layer         │  │      Tensor Layer         │
│                          │  │                           │
│  add_step                │  │  add_scenario             │
│  remove_step  ───────────┼─►│  remove_scenario          │
│                          │  │                           │
│  (steps define the       │  │  increase_repeats         │
│   shape of the tensor)   │  │  decrease_repeats         │
│                          │  │                           │
│                          │  │  populate   (write)       │
│                          │  │  prune      (delete)      │
│                          │  │  probe      (read)        │
└──────────────────────────┘  └──────────────────────────┘
```

**Graph layer** defines the structure: which steps exist, what they reference.
**Tensor layer** operates on the data: scenarios, repeats, and result cells.
**Cross-layer cascade:** `remove_step` triggers tensor-level operations (`remove_scenario` for input steps, `prune` for results of that step).

**Tensor interface** (`probe` / `prune` / `populate`) is the shared contract. `process` is not a single implementation but a role: the SDK, the backend task runner, and the frontend each implement it differently, but all call `populate` to commit results.

---

## Step Model

All graph nodes are **steps**. A step has a `type` and an `origin`.

### Step type

**Field:** `type: Literal["input", "invocation", "annotation"]`
**Source:** `api/oss/src/core/evaluations/types.py:27`

| Type | Meaning | Examples |
|------|---------|---------|
| `"input"` | Data source — provides inputs | Testset, Query |
| `"invocation"` | Invokes a workflow, produces a trace | Application/variant |
| `"annotation"` | Evaluates/scores, produces a trace | Evaluator/judge |

### Step origin

**Field:** `origin: Literal["human", "custom", "auto"]`
**Source:** `api/oss/src/core/evaluations/types.py:28`

| Origin | Who populates results | Web behavior | Backend behavior |
|--------|----------------------|--------------|-----------------|
| `"auto"` | Backend | Transparent | Runs step automatically |
| `"human"` | A person via the UI | Prompts user for data | Waits — does not run |
| `"custom"` | External / programmatic | Transparent | Does not run |

**Key rule:** `process` only runs `"auto"` steps. `"human"` and `"custom"` steps are populated via direct `populate` calls from outside the process orchestration.

### Step definition (from codebase)

```python
class EvaluationRunDataStep(BaseModel):
    key: str                                    # step_key — unique per run
    type: Literal["input", "invocation", "annotation"]
    origin: Literal["human", "custom", "auto"]
    references: Dict[str, Reference]            # points to specific revision
    inputs: Optional[List[EvaluationRunDataStepInput]] = None
```

**Source:** `api/oss/src/core/evaluations/types.py:113-118`

Nodes are **immutable by reference** — `references` points to a specific revision. It cannot be changed once set.

---

## Creation

### `create_empty()`

Creates an evaluation with no graph and no tensor. All flags at defaults.

```
EvaluationRun:
  steps: []
  tensor: { scenarios: [], results: [], metrics: [] }
  flags: { is_live: false, is_active: true, repeat_target: "application",
           reuse_traces: false, is_closed: false,
           allow_decrease_repeats: false }
```

### `create(graph_definition?)`

Equivalent to `create_empty()` followed by `add_step(...)` for each step in the definition. All the same mutation rules apply.

---

## Graph Mutations

---

### `add_step`

**Operation:** `add_step(type, origin, references, key?, inputs?)`

Adds a step to the graph. Multiple steps of the same type are supported.

```python
add_step(
    type: Literal["input", "invocation", "annotation"],
    origin: Literal["human", "custom", "auto"],
    references: Dict[str, Reference],
    key: Optional[str] = None,       # auto-generated if not provided
    inputs: Optional[List[StepInput]] = None,
)
```

**Compatibility check:** `is_live = true` rejects `type = "input"` steps backed by a testset.

**Effect on tensor:** None immediately. Data is created during process or via direct populate.

**Allowed when `is_closed`:** No.

---

### `remove_step`

**Operation:** `remove_step(step_key: str)`

Removes a step and all its associated tensor data.

**Effect:**
1. Remove step from graph
2. `prune(TensorSlice(steps=[step_key], scenarios="all", repeats="all"))` — results
3. Flush metrics referencing `step_key`
4. If `type = "input"`: also prune scenarios sourced exclusively from this step

**Allowed when `is_closed`:** No.

---

### Edit Step (via Remove + Add)

**There is no `edit_step` operation.** References are immutable.

Changing a reference = `remove_step(old_key)` + `add_step(new_references)`. The flush cost is intentional and visible.

---

## Tensor Mutations

Tensor operations work on the data inside the evaluation — scenarios, repeats, and result cells. They are organized as symmetric pairs plus a read operation.

---

### `add_scenario` / `remove_scenario`

**`add_scenario(source: TestcaseRef | TraceRef)`** — adds a row to the tensor.

```python
class TestcaseRef:
    testcase_id: UUID

class TraceRef:
    trace_id: UUID
    timestamp: Optional[datetime]   # required for is_live=true
    interval: Optional[str]         # required for is_live=true
```

Normally created automatically during `process`. Direct `add_scenario` supports manual or incremental construction.

---

**`remove_scenario(scenario_id: UUID)`** — removes a row and all its results.

Equivalent to:
```python
prune(TensorSlice(scenarios=[scenario_id], steps="all", repeats="all"))
# + delete the scenario row itself
```

Triggered automatically by `remove_step` when the removed step was the sole input source for a scenario.

**Both allowed when `is_closed`:** No.

---

### `increase_repeats` / `decrease_repeats`

**`increase_repeats(new_count: int)`** — expands the repeat dimension. `new_count > current`. Non-destructive: no data is deleted. New slots are empty until filled by `populate` or `process`.

---

**`decrease_repeats(new_count: int)`** — shrinks the repeat dimension. `new_count < current`.

**Effect:**
1. `prune(TensorSlice(scenarios="all", steps="all", repeats=[n, ..., old_count-1]))`
2. Full metrics flush — recompute with `refresh_metrics()`

**Gated by flag:** `allow_decrease_repeats: bool` (default `false`).

**Both allowed when `is_closed`:** No.

---

### `populate` / `prune`

**`populate(slice: TensorSlice, results: List[ResultData])`** — writes result cells. Creates or overwrites.

```python
class ResultData:
    scenario_id: UUID
    step_key: str
    repeat_idx: int
    trace_id: Optional[UUID]   # reference to execution trace
    error: Optional[str]       # set if the step failed
```

**This is the convergence point.** All `process` implementations — SDK, backend, frontend — call `populate` to commit results, regardless of how they produced them:
- Backend `process`: calls `populate` after running `auto` steps
- Frontend `process`: calls `populate` after a human submits an annotation
- External `process`: calls `populate` after a custom/programmatic step completes

Does not automatically refresh metrics — call `refresh_metrics()` after bulk populate.

---

**`prune(slice: TensorSlice)`** — deletes result cells within the slice and flushes affected metrics.

```python
# All results for a specific step
prune(TensorSlice(steps=["eval-rev-abc"], scenarios="all", repeats="all"))

# High repeat indices (after decrease_repeats)
prune(TensorSlice(steps="all", scenarios="all", repeats=[3, 4, 5]))

# All results for specific scenarios
prune(TensorSlice(steps="all", scenarios=[sid1, sid2], repeats="all"))
```

Metrics are always flushed conservatively — recompute with `refresh_metrics()`.

**Both allowed when `is_closed`:** No.

---

### `probe`

**`probe(slice: TensorSlice, status: StatusFilter) → List[ResultRef]`** — read-only. Returns all cells within the slice that match the status.

```python
StatusFilter = Literal["missing", "success", "failure", "any"]
```

| Status | Meaning |
|--------|---------|
| `"missing"` | Cell in slice has no result yet |
| `"success"` | Result exists with no error and a valid `trace_id` |
| `"failure"` | Result exists with a non-null `error` |
| `"any"` | All cells in the slice |

**Returns:** List of `(scenario_id, step_key, repeat_idx)` composite keys.

**Primary use:** Determine what to (re-)process, or audit completeness before closing.

**Allowed when `is_closed`:** Yes.

---

## Metrics

Metrics are derived from results. They are not part of the core tensor interface but follow the same slice-scoped pattern.

### `refresh_metrics`

**Operation:** `refresh_metrics(scope?: GlobalScope | VariationalScope | TemporalScope)`

Recomputes metrics from current results.

```
1. Fetch results matching scope
2. Extract trace_ids
3. Run SQL aggregations over trace data
4. Write metrics entities
```

**When to call:**
- After `process` completes
- After `decrease_repeats`
- After `remove_step`
- After bulk `populate`
- On user-initiated recalculate

**Allowed when `is_closed`:** Yes (metrics are derived, not structural).

---

## Flag Operations

Flags are properties of the `EvaluationRun` that control behavior. At the storage level there is no per-flag update — flags are always read as a set and written as a set. The user-facing API provides `set_flag` which wraps that read-modify-write cycle.

---

### `get_flags` / `set_flags`

**`get_flags(run_id) → EvaluationFlags`** — returns all current flag values.

```python
class EvaluationFlags:
    is_live: bool                              # online vs offline execution
    is_active: bool                            # pause/resume (only meaningful when is_live=true)
    repeat_target: Literal["application", "evaluator"]
    reuse_traces: bool
    is_closed: bool                            # lock evaluation against mutations
    allow_decrease_repeats: bool               # gate on destructive repeat reduction
```

---

**`set_flags(run_id, flags: EvaluationFlags)`** — low-level write of the full flags object. Replaces all flags atomically.

This is the primitive. Not intended to be called directly in most contexts — use `set_flag` instead.

---

### `set_flag`

**`set_flag(run_id, name: str, value: Any)`** — set a single flag. Internally performs:

```
flags = get_flags(run_id)
flags[name] = value
set_flags(run_id, flags)
```

**Available flags and their constraints:**

| Flag | Type | Constraint on set |
|------|------|-------------------|
| `is_live` | `bool` | Setting `true` when testset input steps exist → rejected |
| `is_active` | `bool` | Only meaningful when `is_live = true` |
| `repeat_target` | `"application" \| "evaluator"` | Changing after results exist → requires `prune` first (or explicit override) |
| `reuse_traces` | `bool` | No structural constraint |
| `is_closed` | `bool` | Setting `true` gates all subsequent mutations; setting `false` reopens |
| `allow_decrease_repeats` | `bool` | Safety gate — must be set `true` before calling `decrease_repeats` |

**Allowed when `is_closed`:**
- `is_closed` itself: Yes — you must be able to set it to `false` to reopen
- All other flags: No — closed evaluation is read-only

---

## Orchestration: process

**Operation:** `process(slice: TensorSlice)`

Drives `auto`-origin steps within the slice, in graph-topological order.

`process` is **not a single implementation** — it is a role. The SDK, the backend task runner, and the frontend each implement it differently. What they share is the contract: read from the graph, produce results, call `populate`.

```
process(slice):
  for each scenario in slice:
    ensure scenario exists (add_scenario if needed)
    for each auto step in slice (topological order):
      for each repeat in slice:
        if probe({scenario}, {step}, {repeat}, "success"):
          skip (already done)
        run step → trace_id or error
        populate({scenario, step, repeat, trace_id, error})
  refresh_metrics()
```

**What it does NOT do:**
- Does not touch `human` or `custom` steps — those are populated from outside
- Does not run steps outside the slice

**Common patterns:**

```python
# Full run
process(TensorSlice(scenarios="all", steps="all", repeats="all"))

# Retry all failures
failed = probe(TensorSlice(scenarios="all", steps="all", repeats="all"), status="failure")
process(TensorSlice(
    scenarios=[r.scenario_id for r in failed],
    steps="all",
    repeats="all",
))

# Fill missing results for one evaluator
process(TensorSlice(scenarios="all", steps=["eval-rev-abc"], repeats="all"))

# Fill new repeat slots after increase_repeats
process(TensorSlice(scenarios="all", steps="all", repeats=[3, 4]))
```

**Allowed when `is_closed`:** No.

---

## TensorSlice

A `TensorSlice` specifies a subset of the tensor along all three dimensions. Used by `probe`, `prune`, `populate`, and `process`.

```python
class TensorSlice:
    scenarios: Literal["all", "none"] | List[UUID]   # scenario_ids
    steps: Literal["all", "none"] | List[str]         # step_keys
    repeats: Literal["all", "none"] | List[int]       # repeat_idx values
```

| Value | Meaning |
|-------|---------|
| `"all"` | Every item in this dimension |
| `"none"` | Nothing (empty slice — no-op for write operations) |
| `[...]` | Only the listed items |

---

## Operation Summary

### Graph Mutations

| Operation | Flushes Results | Flushes Metrics | Allowed when `is_closed` |
|-----------|-----------------|-----------------|--------------------------|
| `add_step(...)` | No | No | No |
| `remove_step(key)` | Yes — for `key` | Yes — for `key` | No |
| ~~`edit_step`~~ | — | — | Not supported; use remove + add |

### Tensor Mutations

| Operation | Pair | Deletes Data | Flushes Metrics | Gated by Flag | Allowed when `is_closed` |
|-----------|------|--------------|-----------------|---------------|--------------------------|
| `add_scenario(...)` | ↕ | No | No | No | No |
| `remove_scenario(id)` | ↕ | Yes — scenario + its results | Yes — for scenario | No | No |
| `increase_repeats(n)` | ↕ | No | No | No | No |
| `decrease_repeats(n)` | ↕ | Yes — pruned repeats | Yes — full flush | `allow_decrease_repeats` | No |
| `populate(slice, results)` | ↕ | No (overwrites) | No | No | No |
| `prune(slice)` | ↕ | Yes — per slice | Yes — per scope | No | No |
| `probe(slice, status)` | — | No | No | No | Yes |

### Metrics

| Operation | Allowed when `is_closed` |
|-----------|--------------------------|
| `refresh_metrics(scope?)` | Yes |

### Flag Operations

| Operation | Effect | Allowed when `is_closed` |
|-----------|--------|--------------------------|
| `get_flags(run_id)` | Read all flags | Yes |
| `set_flags(run_id, flags)` | Write all flags atomically (low-level) | Only for `is_closed` itself |
| `set_flag(run_id, name, value)` | Read-modify-write a single flag | Only for `is_closed` itself |

### Orchestration

| Operation | Calls | Respects `origin` | Allowed when `is_closed` |
|-----------|-------|-------------------|--------------------------|
| `process(slice)` | probe + populate + refresh_metrics | Yes — only runs `auto` steps | No |

### Invariants

1. **Steps are immutable by reference.** Use remove + add to change a reference. The flush is intentional.
2. **Graph and tensor are symmetric.** Graph has `add_step` / `remove_step`; tensor has matching add/remove pairs for scenarios, repeats, and cells.
3. **`remove_step` cascades to the tensor.** It triggers `remove_scenario` (for input steps) and `prune` (for results of that step).
4. **Closed evaluations are read-only for structure and results.** `probe` and `refresh_metrics` work when closed; all mutations do not.
5. **Decreasing repeats is destructive.** Gated by `allow_decrease_repeats`.
6. **Metrics are always derived.** Flushing is cache invalidation, not data loss.
7. **`process` only touches `auto` steps.** `human` and `custom` steps are populated from outside via direct `populate` calls.
8. **`populate` is the convergence point.** All process implementations — SDK, backend, frontend — call `populate` to commit results.
9. **Creation is mutation.** No operation available at creation is unavailable afterward, and vice versa.

---

**Document Status:** Draft
**Next Action:** Review layer model and tensor interface contract with team
