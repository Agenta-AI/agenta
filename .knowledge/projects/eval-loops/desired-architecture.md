# Evaluation System - Desired Architecture

**Created:** 2026-02-16
**Status:** Design Proposal
**Related:** [Current State - Iteration Patterns](./iteration-patterns.md)

---

## Executive Summary

This document outlines the desired architecture for the evaluation system, focusing on:

1. **Unification** - SDK loops become the canonical implementation used by both SDK and backend
2. **Separation of Concerns** - Clear boundaries between graph management, execution, tensor population, and interpretation
3. **Ports & Adapters** - Dependency injection for persistence, enabling different adapters (API, DAO, JSON) for the same core logic
4. **Consistency** - Same loops and patterns across human evaluations, auto evaluations, and live evaluations

---

## Table of Contents

- [Guiding Principles](#guiding-principles)
- [Four Concerns](#four-concerns)
- [Architectural Goals](#architectural-goals)
- [Ports & Adapters Design](#ports--adapters-design)
- [Loop Unification Strategy](#loop-unification-strategy)
- [Execution Modes](#execution-modes)
- [Migration Path](#migration-path)
- [Open Questions](#open-questions)

---

## Guiding Principles

### 1. Single Source of Truth for Iteration Logic

**Current Problem:**
- SDK has one set of loops (`sdk/agenta/sdk/evaluations/preview/evaluate.py`)
- API has different loops (`api/oss/src/core/evaluations/tasks/legacy.py`, `live.py`)
- Logic duplication and divergence over time
- Changes must be made in multiple places

**Desired State:**
- **SDK loops become the canonical implementation**
- Backend uses the same loops via dependency injection
- One place to modify iteration logic
- Guaranteed consistency between SDK and API

---

### 2. Separation of Concerns

The evaluation system has **four distinct concerns** that should not be conflated:

| Concern | Responsibility | Should NOT |
|---------|---------------|------------|
| **Graph Management** | Create, modify steps (`add_step` / `remove_step`) | Execute the graph or populate results |
| **Orchestration (`process`)** | Drive execution across a `TensorSlice` | Manage the graph structure or directly store results |
| **Tensor Interface (`populate` / `probe` / `prune`)** | Write, read, and delete results in the tensor | Execute workflows or interpret data |
| **Tensor Interpretation** | Analyze and aggregate metrics | Modify the tensor or execute workflows |

**Current Problem:**
- These concerns are mixed in the same functions
- Graph execution code also handles persistence
- Tensor population is tightly coupled to execution

**Desired State:**
- Clean interfaces between concerns
- Each concern is independently testable
- Can swap implementations without affecting others

---

### 3. Dependency Injection via Ports & Adapters

**Current Problem:**
- SDK and API have hardcoded persistence mechanisms
- SDK makes HTTP calls directly
- API writes to database directly
- No way to test without external dependencies

**Desired State:**
- Core iteration logic is pure (no I/O)
- Persistence is injected via interfaces (ports)
- Different adapters for different contexts:
  - **SDK Context:** Adapter calls remote API
  - **Backend Context:** Adapter calls DAO layer
  - **Test Context:** Adapter writes to JSON or in-memory store

---

### 4. Consistency Across Evaluation Types

**Current Problem:**
- Human evaluations use different code than auto evaluations
- Live evaluations have separate iteration logic
- Batch evaluations have different patterns

**Desired State:**
- **Same core loops** for all evaluation types
- Differences handled through:
  - Configuration (which evaluators to run)
  - Execution mode (batch, live, sliced)
  - Data source (testset, live traces)
- Consistency reduces bugs and improves maintainability

---

## Four Concerns

### 1. Graph Management

**What:** Define and modify the evaluation graph structure

**Responsibilities:**
- Add/remove steps (`add_step` / `remove_step`) with `type` (input / invocation / annotation) and `origin` (human / custom / auto)
- Validate graph structure
- Persist step list in `run.data.steps`

**Operations:**
```python
# Graph Management Interface
class EvaluationGraphManager(Protocol):
    async def add_step(
        self,
        *,
        type: Literal["input", "invocation", "annotation"],
        origin: Literal["human", "custom", "auto"],
        references: dict,
    ) -> Step

    async def remove_step(self, *, step_key: str) -> None
    async def get_steps(self, *, run_id: UUID) -> list[Step]
```

**Impacts on Tensor:**
- Adding a step adds a column dimension to the tensor
- Removing a step should be followed by `prune(TensorSlice(steps=[step_key]))` to delete stale results
- Steps are immutable by reference once added — change = `remove_step` + `add_step`

**Examples:**
- User adds a new evaluator → `add_step(type="annotation", origin="auto", ...)`
- User removes an evaluator → `remove_step(step_key=...)` then `prune` stale results
- User changes evaluator config → new revision = new `step_key`

---

### 2. Orchestration (`process`)

**What:** Drive execution across a `TensorSlice` — the implementation of `process`

**Responsibilities:**
- Resolve which cells of the tensor need work (guided by `TensorSlice` + optional `probe`)
- Invoke steps in the correct order (topological sort of the step list)
- Call `populate` for each result produced
- Handle errors by recording them in results (collect-errors mode — see Decisions)
- Concurrency model is up to the implementor (sequential, parallel, distributed)

**Operations:**
```python
# Orchestration Interface
class EvaluationOrchestrator(Protocol):
    async def process(
        self,
        *,
        run: EvaluationRun,
        slice: TensorSlice,
        persistence: EvaluationPersistence,  # provides populate/probe/prune
    ) -> ProcessSummary
```

**Execution modes** (all expressed as `process(TensorSlice(...))`):
- **Full run:** `TensorSlice(scenarios="all", steps="all", repeats="all")`
- **Live (temporal):** `TensorSlice` scoped to scenarios derived from a trace query window
- **Targeted re-run:** `TensorSlice(scenarios=[id1, id2], steps=["evaluator-x"])`

**Does NOT:**
- Persist results directly — delegates to `populate`
- Modify graph structure
- Aggregate metrics (delegates to tensor interpretation)

---

### 3. Tensor Interface (`populate` / `probe` / `prune`)

**What:** The three primitive operations on tensor cells — the persistence port that `process` depends on

**Responsibilities:**
- `populate` — write a result for a `(scenario, step, repeat)` cell; result holds a `trace_id` reference and/or an `error` by value
- `probe` — read results for a `TensorSlice`; used by `process` to skip already-successful cells
- `prune` — delete results for a `TensorSlice`; used after step removal or to clear stale data

**Operations:**
```python
# Tensor Interface (persistence port)
class EvaluationPersistence(Protocol):
    async def populate(
        self,
        *,
        run_id: UUID,
        scenario_id: UUID,
        step_key: str,
        repeat_idx: int,
        trace_id: Optional[UUID] = None,
        testcase_id: Optional[UUID] = None,
        error: Optional[str] = None,
    ) -> EvaluationResult

    async def probe(
        self,
        *,
        run_id: UUID,
        slice: TensorSlice,
    ) -> list[EvaluationResult]

    async def prune(
        self,
        *,
        run_id: UUID,
        slice: TensorSlice,
    ) -> int  # number of results deleted
```

**Storage Adapters:**
- **Remote API Adapter (SDK):** POSTs/queries `/evaluations/results`
- **DAO Adapter (Backend):** Writes/reads `evaluation_results` table
- **In-Memory Adapter (Testing):** Stores in dict

**Does NOT:**
- Execute workflows
- Aggregate metrics (that's interpretation)
- Modify graph structure

---

### 4. Tensor Interpretation

**What:** Analyze and aggregate results from the tensor

**Responsibilities:**
- Aggregate metrics across scenarios (mean, p95, etc.)
- Compute derived metrics
- Generate metrics tensors (aggregated view)
- Support different aggregation scopes (run, scenario, temporal)

**Operations:**
```python
# Tensor Interpretation Interface
class EvaluationTensorInterpreter(Protocol):
    async def aggregate_metrics(
        self,
        run_id: Optional[UUID],
        scenario_id: Optional[UUID],
        timestamp: Optional[datetime],
        step_keys: list[str],
    ) -> MetricsBucket

    async def get_metrics(
        self,
        scope: AggregationScope,
    ) -> EvaluationMetrics

    async def compute_derived_metric(
        self,
        metric_name: str,
        results: list[EvaluationResult],
    ) -> Any
```

**Aggregation Scopes:**
- **Run-level:** Aggregate across all scenarios in a run
- **Scenario-level:** Metrics for a single scenario
- **Temporal:** Aggregate across time windows (e.g., last hour)
- **Step-level:** Metrics for a specific step across scenarios

**Does NOT:**
- Execute workflows
- Modify results
- Change graph structure

---

## Architectural Goals

### Goal 1: SDK Loops as Canonical Implementation

**Rationale:**
- SDK loops in `evaluate.py` are cleaner and more recent
- Better structured with clear separation of testsets → testcases → apps → evaluators
- Already handles multiple testset revisions, application variants, and evaluators
- More maintainable than legacy API loops

**Approach:**
1. Extract SDK loops into a **shared core module**
2. Make loops **pure functions** (no I/O, side effects injected)
3. Backend imports and uses the same loops
4. Persistence injected via adapters

**Example Structure:**
```
agenta/
├── core/
│   └── evaluations/
│       ├── engine/
│       │   ├── graph.py         # Graph management
│       │   ├── executor.py      # Graph execution (canonical loops)
│       │   ├── tensor.py        # Tensor population
│       │   └── metrics.py       # Tensor interpretation
│       └── interfaces/
│           ├── persistence.py   # Ports (protocols)
│           └── adapters/
│               ├── api.py       # API adapter (SDK uses this)
│               ├── dao.py       # DAO adapter (backend uses this)
│               └── json.py      # JSON adapter (testing uses this)
```

---

### Goal 2: Clean Interfaces via Ports & Adapters

**Port:** Interface (protocol) defining operations
**Adapter:** Implementation of the port for a specific context

#### Example: Persistence Port

```python
# Port (interface)
class EvaluationPersistence(Protocol):
    """Port for persisting evaluation results."""

    async def save_scenario(self, scenario: ScenarioCreate) -> Scenario:
        """Save a scenario and return with ID."""
        ...

    async def save_result(self, result: ResultCreate) -> EvaluationResult:
        """Save a single result."""
        ...

    async def save_results_batch(
        self,
        results: list[ResultCreate],
    ) -> list[EvaluationResult]:
        """Save multiple results in a batch."""
        ...

    async def get_result(
        self,
        run_id: UUID,
        scenario_id: UUID,
        step_key: str,
    ) -> Optional[EvaluationResult]:
        """Retrieve a specific result."""
        ...
```

#### Adapter 1: Remote API (for SDK)

```python
class RemoteAPIPersistence:
    """Adapter that persists via HTTP calls to backend API."""

    def __init__(self, api_client: AgentaAPIClient):
        self.client = api_client

    async def save_scenario(self, scenario: ScenarioCreate) -> Scenario:
        response = await self.client.post(
            "/evaluations/scenarios",
            json=scenario.model_dump(),
        )
        return Scenario(**response.json())

    async def save_results_batch(
        self,
        results: list[ResultCreate],
    ) -> list[EvaluationResult]:
        response = await self.client.post(
            "/evaluations/results/batch",
            json=[r.model_dump() for r in results],
        )
        return [EvaluationResult(**r) for r in response.json()]

    # ... other methods
```

#### Adapter 2: DAO (for Backend)

```python
class DAOPersistence:
    """Adapter that persists directly to database via DAO."""

    def __init__(self, evaluations_dao: EvaluationsDAO):
        self.dao = evaluations_dao

    async def save_scenario(self, scenario: ScenarioCreate) -> Scenario:
        return await self.dao.create_scenario(scenario=scenario)

    async def save_results_batch(
        self,
        results: list[ResultCreate],
    ) -> list[EvaluationResult]:
        return await self.dao.create_results(results=results)

    # ... other methods
```

#### Adapter 3: JSON (for Testing)

```python
class JSONPersistence:
    """Adapter that persists to JSON file for testing."""

    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.data = {"scenarios": [], "results": []}

    async def save_scenario(self, scenario: ScenarioCreate) -> Scenario:
        scenario_with_id = Scenario(
            id=uuid4(),
            **scenario.model_dump(),
        )
        self.data["scenarios"].append(scenario_with_id.model_dump())
        self._write_to_file()
        return scenario_with_id

    async def save_results_batch(
        self,
        results: list[ResultCreate],
    ) -> list[EvaluationResult]:
        results_with_ids = [
            EvaluationResult(id=uuid4(), **r.model_dump())
            for r in results
        ]
        self.data["results"].extend([r.model_dump() for r in results_with_ids])
        self._write_to_file()
        return results_with_ids

    def _write_to_file(self):
        with open(self.file_path, "w") as f:
            json.dump(self.data, f, indent=2, default=str)

    # ... other methods
```

---

### Goal 3: Loop Unification and Refactoring

#### Current State Analysis

From [iteration-patterns.md](./iteration-patterns.md), we have:

| Component | Loops | Pattern |
|-----------|-------|---------|
| SDK | Testsets → Testcases → Apps → Evaluators | 4-level nesting |
| Legacy API | Testcases → Evaluators | 2-level nesting |
| Live API | Query Steps → Traces → Evaluators | 3-level nesting |

#### Desired State: Unified Loop Structure

**Single canonical loop structure** that handles all cases:

```python
async def process(
    *,
    run: EvaluationRun,
    slice: TensorSlice,
    persistence: EvaluationPersistence,  # provides populate/probe/prune
) -> ProcessSummary:
    """
    Canonical process implementation.

    Used by:
    - SDK (with RemoteAPIPersistence adapter)
    - Backend batch evaluation (with DAOPersistence adapter)
    - Backend live evaluation (with DAOPersistence adapter)
    - Tests (with InMemoryPersistence adapter)
    """

    # 1. Resolve scenarios from slice
    scenarios = await _resolve_scenarios(run, slice)

    # 2. For each scenario
    for scenario in scenarios:
        node_outputs = {}

        # 3. Execute steps in topological order
        for step in run.data.steps:
            if slice.steps != "all" and step.key not in slice.steps:
                continue

            for repeat_idx in _resolve_repeats(slice):
                # Optionally probe to skip already-successful cells
                # (idempotency — collect-errors mode means errors are not skipped)

                # Invoke the step (app/evaluator call)
                output = await _invoke_step(step, scenario, node_outputs)

                # Populate result
                await persistence.populate(
                    run_id=run.id,
                    scenario_id=scenario.id,
                    step_key=step.key,
                    repeat_idx=repeat_idx,
                    trace_id=output.trace_id,
                    error=output.error,
                )

                node_outputs[step.key] = output

    return ProcessSummary(...)
```

**Key Benefits:**
- **Same loop** for batch, live, sliced execution
- **Persistence injected** → works in SDK, backend, tests
- **Graph-based** → supports arbitrary node structures
- **Clean separation** → execution logic independent of I/O

---

#### Refactoring Required

To achieve unification, we need to:

##### 1. **Split Loops**

**Current:** SDK has monolithic loop that does execution + persistence + aggregation

**Desired:** Split into:
- `execute_evaluation()` - Pure execution logic
- `persist_results()` - Delegated to adapter
- `aggregate_metrics()` - Separate interpreter

---

##### 2. **Merge Loops**

**Current:** Legacy and Live have separate, similar loops

**Desired:** Single `execute_evaluation()` that handles both via `execution_mode`:
- `ExecutionMode.BATCH` → iterate over testset
- `ExecutionMode.LIVE` → iterate over trace query results
- `ExecutionMode.SLICED` → iterate over subset

---

##### 3. **Change Loop Structure**

**Current:** Some loops iterate by index (`for idx in range(nof_testcases)`)

**Desired:** Iterate by object (`for scenario in scenarios`)
- More Pythonic
- Easier to slice/filter
- Better error handling

---

##### 4. **Extract Pure Functions**

**Current:** Loops have side effects (DB writes, API calls) inline

**Desired:** Extract to pure functions:
```python
# Pure function (no I/O)
def prepare_evaluator_inputs(
    testcase: Testcase,
    app_output: dict,
    trace: Trace,
) -> dict:
    """Prepare inputs for evaluator invocation."""
    return {
        "inputs": testcase.inputs,
        "output": app_output,
        "expected_output": testcase.expected_output,
        "trace": trace,
    }

# Execution loop calls pure function, then injects I/O
evaluator_inputs = prepare_evaluator_inputs(testcase, app_output, trace)
result = await persistence.save_result(...)
```

---

### Goal 4: Support Multiple Execution Modes via `TensorSlice`

All execution modes are expressed as `process(slice)` — the `TensorSlice` determines what subset of the tensor to work on.

#### TensorSlice

```python
@dataclass
class TensorSlice:
    """Defines which cells of the tensor to target."""

    scenarios: Literal["all", "none"] | list[UUID] = "all"
    steps: Literal["all", "none"] | list[str] = "all"
    repeats: Literal["all", "none"] | list[int] = "all"
```

#### Examples

**Full run (all scenarios × all steps × all repeats):**
```python
await orchestrator.process(
    run=run,
    slice=TensorSlice(),  # defaults to "all" on every dimension
    persistence=dao_persistence,
)
```

**Live evaluation (scenarios derived from a trace query window):**
```python
trace_scenario_ids = await resolve_live_scenarios(run, start_time, end_time)
await orchestrator.process(
    run=run,
    slice=TensorSlice(scenarios=trace_scenario_ids, steps="all", repeats="all"),
    persistence=dao_persistence,
)
```

**Targeted re-run (specific scenarios and evaluators):**
```python
await orchestrator.process(
    run=run,
    slice=TensorSlice(
        scenarios=[scenario_1_id, scenario_2_id],
        steps=["evaluator-accuracy", "evaluator-hallucination"],
        repeats="all",
    ),
    persistence=dao_persistence,
)
```

**Fill missing results (probe first, then process gaps):**
```python
existing = await persistence.probe(run_id=run.id, slice=TensorSlice())
missing_slice = compute_missing(full_tensor, existing)
await orchestrator.process(run=run, slice=missing_slice, persistence=dao_persistence)
```
```

---

## Loop Unification Strategy

### Phase 1: Extract Core Execution Logic

**Goal:** Create pure, testable execution functions

**Steps:**
1. Identify common iteration patterns across SDK and API loops
2. Extract pure functions (no I/O, no side effects)
3. Create `agenta/core/evaluations/engine/executor.py` with canonical loops
4. Add comprehensive unit tests (no DB, no API required)

**Example Pure Function:**
```python
def build_execution_plan(
    graph: EvaluationGraph,
    scenarios: list[Scenario],
) -> list[ExecutionStep]:
    """
    Build execution plan: which nodes to run for which scenarios.

    Pure function - no I/O, fully deterministic.
    """
    plan = []
    for scenario in scenarios:
        for node in graph.topological_order():
            plan.append(
                ExecutionStep(
                    scenario_id=scenario.id,
                    node_id=node.id,
                    depends_on=[...],
                )
            )
    return plan
```

---

### Phase 2: Define Ports (Interfaces)

**Goal:** Define clean contracts for I/O operations

**Steps:**
1. Create `agenta/core/evaluations/interfaces/persistence.py` with protocols
2. Create `agenta/core/evaluations/interfaces/invocation.py` for app/evaluator calls
3. Create `agenta/core/evaluations/interfaces/data_sources.py` for testsets/traces

**Example Invocation Port:**
```python
class WorkflowInvoker(Protocol):
    """Port for invoking applications and evaluators."""

    async def invoke(
        self,
        workflow_id: UUID,
        inputs: dict[str, Any],
    ) -> InvocationResult:
        """Invoke a workflow (app or evaluator) with inputs."""
        ...
```

---

### Phase 3: Implement Adapters

**Goal:** Create concrete implementations for each context

**Steps:**
1. Implement `RemoteAPIPersistence` (SDK uses this)
2. Implement `DAOPersistence` (backend uses this)
3. Implement `JSONPersistence` (tests use this)
4. Implement `InMemoryPersistence` (fast tests use this)

---

### Phase 4: Migrate SDK to Use Core Loops

**Goal:** SDK uses canonical implementation with remote adapter

**Steps:**
1. Update `sdk/agenta/sdk/evaluations/preview/evaluate.py`
2. Import `execute_evaluation` from core
3. Pass `RemoteAPIPersistence` adapter
4. Remove duplicate loop logic
5. Ensure backward compatibility (same API surface)

**Before:**
```python
# sdk/agenta/sdk/evaluations/preview/evaluate.py
async def aevaluate(...):
    # 300+ lines of loop logic + HTTP calls
    for testset in testsets:
        for testcase in testcases:
            # ... execute ...
            await api_client.post("/results", ...)  # Hardcoded API call
```

**After:**
```python
# sdk/agenta/sdk/evaluations/preview/evaluate.py
from agenta.core.evaluations.engine.executor import process
from agenta.core.evaluations.interfaces.adapters.api import RemoteAPIPersistence
from agenta.core.evaluations.types import TensorSlice

async def aevaluate(...):
    # Create persistence adapter
    persistence = RemoteAPIPersistence(api_client=agenta_api)

    # Execute using canonical process
    summary = await process(
        run=run,
        slice=TensorSlice(),  # all scenarios × all steps × all repeats
        persistence=persistence,
    )

    return summary
```

---

### Phase 5: Migrate Backend to Use Core Loops

**Goal:** Backend uses same loops with DAO adapter

**Steps:**
1. Update `api/oss/src/core/evaluations/tasks/legacy.py`
2. Import `execute_evaluation` from core (shared module)
3. Pass `DAOPersistence` adapter
4. Remove duplicate loop logic
5. Maintain same task API for worker

**Before:**
```python
# api/oss/src/core/evaluations/tasks/legacy.py
async def evaluate_batch_testset(...):
    # 700+ lines of loop logic + DAO calls
    for idx in range(nof_testcases):
        for jdx in range(nof_annotations):
            # ... execute ...
            await dao.create_result(...)  # Hardcoded DAO call
```

**After:**
```python
# api/oss/src/core/evaluations/tasks/legacy.py
from agenta.core.evaluations.engine.executor import process
from agenta.core.evaluations.interfaces.adapters.dao import DAOPersistence
from agenta.core.evaluations.types import TensorSlice

async def evaluate_batch_testset(...):
    # Create persistence adapter
    persistence = DAOPersistence(evaluations_dao=evaluations_dao)

    # Execute using canonical process
    summary = await process(
        run=run,
        slice=TensorSlice(),  # all scenarios × all steps × all repeats
        persistence=persistence,
    )

    # Update run status
    await update_run_status(run.id, summary)
```

---

### Phase 6: Consolidate Live and Batch

**Goal:** Same loop handles live and batch via execution mode

**Steps:**
1. Merge `live.py` and `legacy.py` into single task
2. Use `ExecutionMode.BATCH` vs `ExecutionMode.LIVE`
3. Data source (testset vs traces) resolved by mode
4. Remove code duplication

**Example:**
```python
# api/oss/src/core/evaluations/tasks/evaluate.py
async def evaluate(
    run_id: UUID,
    slice: TensorSlice,
):
    """
    Universal evaluation task.

    Handles:
    - Batch testset evaluation: TensorSlice()
    - Live trace evaluation: TensorSlice(scenarios=[...derived from trace query...])
    - Targeted re-run: TensorSlice(scenarios=[...], steps=[...])
    """
    run = await runs_dao.get(run_id)
    persistence = DAOPersistence(evaluations_dao=evaluations_dao)

    summary = await process(
        run=run,
        slice=slice,
        persistence=persistence,
    )

    return summary
```

---

## Execution Modes

All modes are expressed as `process(run, TensorSlice(...), persistence)`.

### Full Run (Testset Evaluation)

**Data Source:** Testset scenarios already in the tensor
**Slice:** `TensorSlice()` — all scenarios × all steps × all repeats
**Use Case:** Evaluate a full testset against applications/evaluators

**Step structure:**
```
input step (testset)
  → invocation step (application)
    → annotation step (evaluator 1)
    → annotation step (evaluator 2)
```

---

### Live Mode (Trace Evaluation)

**Data Source:** Trace query result (temporal window → scenario IDs)
**Slice:** `TensorSlice(scenarios=[...trace-derived ids...], steps="all", repeats="all")`
**Use Case:** Continuously evaluate production traces

**Step structure:**
```
input step (query/traces)
  → annotation step (evaluator 1)
  → annotation step (evaluator 2)
```

---

### Targeted Re-run (Partial Execution)

**Data Source:** Existing scenarios in the tensor
**Slice:** `TensorSlice(scenarios=[id1, id2], steps=["evaluator-x"], repeats="all")`
**Use Case:** Re-run specific evaluators on specific scenarios (e.g., after evaluator update)

---

### Fill Gaps (Idempotent Completion)

**Slice:** Computed from `probe` result — the set of missing or failed cells
**Use Case:** Resume an interrupted run; fill in cells that errored

```python
existing = await persistence.probe(run_id=run.id, slice=TensorSlice())
gap_slice = compute_missing(expected_full_tensor, existing)
await process(run=run, slice=gap_slice, persistence=persistence)
```

---

## Migration Path

### Stage 1: Foundation (Weeks 1-2)

**Goal:** Establish core architecture without breaking existing code

**Tasks:**
1. ✅ Document current state ([iteration-patterns.md](./iteration-patterns.md))
2. ✅ Document desired state (this document)
3. Create `agenta/core/evaluations/engine/` module structure
4. Define ports (protocols) in `interfaces/`
5. Extract pure functions from SDK loops
6. Write unit tests for pure functions (no I/O)

**Deliverables:**
- Core module structure in place
- Ports defined and documented
- Pure execution logic extracted and tested
- No changes to existing SDK or API code yet

---

### Stage 2: Adapters (Weeks 3-4)

**Goal:** Implement persistence adapters

**Tasks:**
1. Implement `DAOPersistence` adapter
2. Implement `RemoteAPIPersistence` adapter
3. Implement `InMemoryPersistence` adapter (for tests)
4. Write integration tests for each adapter
5. Document adapter usage patterns

**Deliverables:**
- All adapters implemented and tested
- Adapter selection guide documented
- Integration tests passing
- Still no changes to existing SDK/API code

---

### Stage 3: SDK Migration (Weeks 5-6)

**Goal:** Migrate SDK to use core loops

**Tasks:**
1. Update `sdk/agenta/sdk/evaluations/preview/evaluate.py`
2. Replace loop logic with `execute_evaluation()` call
3. Use `RemoteAPIPersistence` adapter
4. Maintain backward compatibility (same API surface)
5. Run full SDK test suite
6. Update SDK documentation

**Deliverables:**
- SDK uses canonical loops
- All SDK tests passing
- Backward compatible (no breaking changes)
- SDK documentation updated

---

### Stage 4: Backend Migration - Batch (Weeks 7-8)

**Goal:** Migrate backend batch evaluation to use core loops

**Tasks:**
1. Update `api/oss/src/core/evaluations/tasks/legacy.py`
2. Replace loop logic with `execute_evaluation()` call
3. Use `DAOPersistence` adapter
4. Maintain same task API for workers
5. Run full API test suite
6. Performance benchmarking

**Deliverables:**
- Backend batch evaluation uses canonical loops
- All API tests passing
- Performance meets or exceeds baseline
- Task API unchanged (backward compatible)

---

### Stage 5: Backend Migration - Live (Weeks 9-10)

**Goal:** Migrate backend live evaluation to use core loops

**Tasks:**
1. Update `api/oss/src/core/evaluations/tasks/live.py`
2. Replace loop logic with `execute_evaluation()` call
3. Use `DAOPersistence` adapter
4. Use `ExecutionMode.LIVE` with temporal scope
5. Run full API test suite
6. Performance benchmarking

**Deliverables:**
- Backend live evaluation uses canonical loops
- All API tests passing
- Performance meets or exceeds baseline
- Temporal execution working correctly

---

### Stage 6: Consolidation (Weeks 11-12)

**Goal:** Merge batch and live into single task

**Tasks:**
1. Create unified `evaluate()` task
2. Handle batch/live via `ExecutionMode` parameter
3. Deprecate `evaluate_batch_testset` and `evaluate_live_query`
4. Update all callers to use new unified task
5. Remove deprecated code after migration period
6. Update documentation

**Deliverables:**
- Single evaluation task handles all modes
- Deprecated tasks removed (or marked for removal)
- All callers migrated
- Documentation complete

---

### Stage 7: Metrics & Interpretation (Weeks 13-14)

**Goal:** Apply same architecture to metrics aggregation

**Tasks:**
1. Extract metrics aggregation into `TensorInterpreter`
2. Define `MetricsPort` interface
3. Implement adapters for different analytics backends
4. Migrate `refresh_metrics()` to use interpreter
5. Add support for custom aggregation functions

**Deliverables:**
- Metrics aggregation uses ports & adapters
- Custom aggregations supported
- All metrics tests passing
- Performance validated

---

## Decisions

### 1. Graph Representation

**Decided: Declarative configuration** — `run.data.steps` is a list of steps with `type`, `origin`, and `references`. The execution engine derives topology from this list. No explicit nodes+edges graph object.

---

### 2. Error Handling

**Decided: Collect errors** — execution continues across all cells; failures are recorded as error-valued results.

This is a natural fit for the data model: every `EvaluationResult` holds either a `trace_id` (reference to a successful trace) or an `error` stored by value — or both if a trace partially succeeded. Errors are visible in the tensor alongside successes without stopping the run.

---

### 3. Concurrency

**Decided: Implementation concern for `process`** — the architecture does not mandate sequential vs. parallel vs. distributed execution. The `TensorSlice` contract specifies _what_ to run; each `process` implementation (SDK, Taskiq worker, future distributed executor) chooses its own concurrency model. The persistence port (`populate`/`probe`/`prune`) must be safe to call concurrently.

---

### 4. Tensor Sparsity

**Decided: Handled by `process` and `populate`** — missing cells are a natural outcome of partial runs, failures, or slice-targeted execution. The mechanism for filling gaps is `process(TensorSlice(...))` targeting the missing subset, with `probe` used to discover what is missing. No separate sparsity-handling primitive is needed.

---

### 5. Shared Module Packaging

**Decided: Monorepo shared module for now.** Revisit if/when the canonical loop is stable and independent versioning becomes necessary.

---

### 6. Backward Compatibility

**Strategy:**
- Keep old task signatures; delegate to new implementation internally
- New stack ships under `/preview/*` while old endpoints remain mounted
- Remove old loops only after both SDK and backend are migrated and tested

---

## Success Criteria

### Technical Metrics

- [ ] **Single Source of Truth:** SDK and API use same execution loops
- [ ] **Test Coverage:** >90% coverage for core execution logic
- [ ] **Performance:** New implementation matches or exceeds current performance
- [ ] **Modularity:** Can swap persistence adapters without changing execution logic
- [ ] **Consistency:** Same loops used for batch, live, sliced, incremental modes

### Code Quality Metrics

- [ ] **Reduced Duplication:** <10% code duplication between SDK and API evaluation logic
- [ ] **Pure Functions:** >80% of execution logic is pure (no I/O)
- [ ] **Interface Adherence:** All I/O goes through defined ports
- [ ] **Documentation:** All ports, adapters, and execution modes documented

### Functional Metrics

- [ ] **Backward Compatibility:** All existing SDK and API tests pass
- [ ] **Feature Parity:** New implementation supports all current features
- [ ] **Error Handling:** Graceful handling of failures with clear error messages
- [ ] **Observability:** Execution progress and errors are logged/traced

---

## Related Documentation

- [Current State - Iteration Patterns](./iteration-patterns.md)
- [API Architecture Patterns](../../../AGENTS.md#api-architecture-patterns-oss--ee)
- [Testing Documentation](../testing/README.md)

---

## Appendix: Example End-to-End Flow

### Before (Current State)

**SDK:**
```python
# sdk/agenta/sdk/evaluations/preview/evaluate.py
async def aevaluate(...):
    for testset in testsets:
        for testcase in testcases:
            for app in apps:
                result = await invoke_app(...)
                await agenta_api.post("/results", result)  # Direct API call
            for evaluator in evaluators:
                result = await invoke_evaluator(...)
                await agenta_api.post("/results", result)  # Direct API call
```

**Backend:**
```python
# api/oss/src/core/evaluations/tasks/legacy.py
async def evaluate_batch_testset(...):
    for idx in range(nof_testcases):
        for jdx in range(nof_annotations):
            result = await invoke_evaluator(...)
            await dao.create_result(result)  # Direct DAO call
```

**Problems:**
- Duplicate loop logic (SDK and backend)
- Hardcoded persistence (API calls vs DAO)
- Different iteration patterns (objects vs indices)
- Hard to test without external dependencies

---

### After (Desired State)

**Core Module (Shared):**
```python
# agenta/core/evaluations/engine/executor.py
async def process(
    *,
    run: EvaluationRun,
    slice: TensorSlice,
    persistence: EvaluationPersistence,  # Injected — provides populate/probe/prune
) -> ProcessSummary:
    scenarios = await resolve_scenarios(run, slice)

    for scenario in scenarios:
        node_outputs = {}

        for step in run.data.steps:
            for repeat_idx in resolve_repeats(slice):
                output = await invoke_step(step, scenario, node_outputs)

                await persistence.populate(
                    run_id=run.id,
                    scenario_id=scenario.id,
                    step_key=step.key,
                    repeat_idx=repeat_idx,
                    trace_id=output.trace_id,
                    error=output.error,
                )
                node_outputs[step.key] = output

    return ProcessSummary(...)
```

**SDK:**
```python
# sdk/agenta/sdk/evaluations/preview/evaluate.py
from agenta.core.evaluations.engine.executor import process
from agenta.core.evaluations.interfaces.adapters.api import RemoteAPIPersistence
from agenta.core.evaluations.types import TensorSlice

async def aevaluate(...):
    persistence = RemoteAPIPersistence(agenta_api)
    return await process(run=run, slice=TensorSlice(), persistence=persistence)
```

**Backend:**
```python
# api/oss/src/core/evaluations/tasks/evaluate.py
from agenta.core.evaluations.engine.executor import process
from agenta.core.evaluations.interfaces.adapters.dao import DAOPersistence
from agenta.core.evaluations.types import TensorSlice

async def evaluate(run_id: UUID, slice: TensorSlice):
    run = await runs_dao.get(run_id)
    persistence = DAOPersistence(evaluations_dao)
    return await process(run=run, slice=slice, persistence=persistence)
```

**Benefits:**
- ✅ Single source of truth (shared `process`)
- ✅ Persistence injected via `populate`/`probe`/`prune` port
- ✅ Same iteration pattern (objects, not indices)
- ✅ Testable without external dependencies (use `InMemoryPersistence`)
- ✅ Consistent across SDK, backend, tests

---

**Document Status:** Draft for review and discussion
**Next Steps:** Review with team, refine based on feedback, begin Stage 1 implementation
