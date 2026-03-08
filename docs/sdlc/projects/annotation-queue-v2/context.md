# Context: Annotation Queue v2

## Background

Agenta is an LLM developer platform that provides observability, evaluation, and prompt management. Human evaluation is a critical part of the evaluation workflow, allowing teams to incorporate human judgment alongside automated evaluators.

Today, human evaluation exists but is disconnected from the broader annotation workflow. The current implementation (`EvaluationQueue`) was designed specifically for assigning evaluation scenarios to human annotators within an evaluation run context.

## Current State

### What Exists

An `EvaluationQueue` entity that:
- Is tightly coupled to an `EvaluationRun` via a required `run_id` foreign key
- Partitions scenarios among assigned users using a modular arithmetic algorithm
- Supports "repeats" (multiple annotators reviewing the same items)
- Has full CRUD API at `/preview/evaluations/queues/`
- Has no frontend UI

### Data Model

```
EvaluationQueue
├── run_id: UUID (required FK to evaluation_runs)
├── status: pending | queued | running | success | failure | ...
├── flags:
│   └── is_sequential: bool (controls assignment algorithm)
└── data:
    ├── user_ids: List[List[UUID]]  (per-repeat annotator assignments)
    ├── scenario_ids: List[UUID]    (optional subset filter)
    └── step_keys: List[str]        (optional step filter)
```

### How It Works

1. An evaluation run exists with N scenarios
2. Someone creates a queue linked to that run, specifying which users are assigned
3. Annotators call `GET /queues/{id}/scenarios?user_id=X` to get their assigned scenario IDs
4. The `filter_scenario_ids()` algorithm partitions scenarios using modular arithmetic
5. Annotators fetch and annotate their scenarios; results are written to `evaluation_results`

### Key Code Locations

| Layer | Path |
|-------|------|
| Types/DTOs | `api/oss/src/core/evaluations/types.py` (lines 377-432) |
| Service | `api/oss/src/core/evaluations/service.py` (lines 1296-1481) |
| Assignment Algorithm | `api/oss/src/core/evaluations/utils.py` (lines 1-84) |
| DAO | `api/oss/src/dbs/postgres/evaluations/dao.py` (lines 2261-2718) |
| Router | `api/oss/src/apis/fastapi/evaluations/router.py` (lines 412-484, 1557-1812) |
| DB Entity | `api/oss/src/dbs/postgres/evaluations/dbes.py` (lines 259-300) |

## Problem Statement

The `run_id` coupling creates friction for annotation use cases that don't naturally fit the evaluation run model:

### 1. Annotating Traces
To annotate traces from observability, you must:
1. Create a dummy evaluation run (no evaluators)
2. Create evaluation scenarios for each trace
3. Create a queue linked to the run
4. After annotation, manually sync results back to trace spans

The evaluation run is a meaningless intermediary.

### 2. Annotating Test Sets
To annotate test set rows directly:
1. Create a dummy evaluation run
2. Create scenarios from test set rows
3. Create a queue
4. Annotations live in evaluation results, NOT in the test set
5. Need a separate mechanism to write annotations back to test set columns

The test set and evaluation systems have separate storage with no built-in sync.

### 3. Programmatic Annotation via API/SDK
External systems sending items for human review must:
1. Ensure an evaluation run exists
2. Create scenarios for their items
3. Create/update the queue
4. Poll for results in evaluation_results

This is 3+ API calls for what should be a simple enqueue operation.

### 4. Human Evaluators in Eval Runs
This is the ONE use case that works well today. The queue was designed for this.

## Goals

1. Make human annotation a first-class capability across all data sources
2. Provide a unified "annotation inbox" experience for annotators
3. Support per-item task status (pending, claimed, completed, skipped)
4. Enable write-back of annotations to source entities
5. Allow continuous ingestion (traces streaming in) not just batch

## Non-Goals

1. Replacing the existing evaluation run system
2. Building a general-purpose task queue (we're focused on annotation)
3. Complex workflow orchestration (sequential steps, dependencies)
4. Real-time collaboration features (multiple annotators on same item)

## Constraints

- Must integrate with existing evaluation run workflow for capability #2
- Must work with existing permissions system (EE)
- Should reuse existing UI patterns and components where possible
- Backend changes should be backward compatible (existing queues keep working)

## Success Criteria

1. All four capabilities in the PRD can be accomplished with a clean API
2. Annotators have a single view of their pending work across all sources
3. Annotations can be written back to source entities (traces, test sets)
4. The API surface is simple enough for SDK/programmatic use
