# Evaluation Signals: Context

## Purpose
Evaluation signals are the product-level abstraction for important evaluation outcomes:

- workflow-backed assertions
- metric-derived alerts
- future anomaly markers, summaries, and rollout gates

This design assumes a specific requirement:

- if assertions are backed by workflows, they must be represented as a first-class workflow/evaluation step
- if assertions are emitted by those workflow steps, they must be represented as a first-class trace type

## Current Architecture We Have To Change

### Evaluation definitions are compiled into evaluation runs
Today, `SimpleEvaluationsService.create(...)` turns `SimpleEvaluationData` into `EvaluationRunData`, stores that on an `EvaluationRun`, and dispatches workers from the run topology.

Relevant files:

- `api/oss/src/core/evaluations/service.py`
- `api/oss/src/core/evaluations/types.py`

Implication:

- assertion support must be added at evaluation-run compilation time
- this is not only a UI concern or only a tracing concern

### Evaluation runs currently only know three step types
`EvaluationRunDataStep.type` is currently:

- `input`
- `invocation`
- `annotation`

Relevant file:

- `api/oss/src/core/evaluations/types.py`

Implication:

- to support workflow-backed assertions, the type contract must become:
  - `input`
  - `invocation`
  - `annotation`
  - `assertion`

### Evaluator-like judgments currently flow through annotation steps
Workers and frontend creation logic currently model evaluator-style judgment steps as annotation steps.

Relevant files:

- `api/oss/src/core/evaluations/tasks/live.py`
- `sdk/agenta/sdk/evaluations/preview/evaluate.py`
- `web/oss/src/services/evaluationRuns/api/index.ts`

Implication:

- assertion support is a deliberate migration away from overloading `annotation` for all judgments
- the worker topology and frontend run-definition builders must be updated accordingly

### Trace typing is too narrow for the target design
The tracing model currently only exposes:

- `invocation`
- `annotation`
- `unknown`

Relevant file:

- `sdk/agenta/sdk/models/tracing.py`

Implication:

- to support workflow-backed assertions cleanly, tracing must gain `assertion`
- processors, parsers, SDK helpers, and any UI logic that branches on trace type must be updated

### Metrics refresh already gives us a hook for metric-derived signals
`EvaluationsService.refresh_metrics(...)` computes and stores metrics at:

- run scope
- scenario scope
- temporal run scope

Relevant files:

- `api/oss/src/core/evaluations/service.py`
- `api/oss/src/dbs/postgres/evaluations/dbes.py`

Implication:

- not every signal must be workflow-backed
- but workflow-backed assertions must still become their own step and trace type

## Design Direction

This doc set recommends:

- add `assertion` as a first-class evaluation/workflow step type
- add `assertion` as a first-class trace type
- use assertion traces for workflow-backed judgment artifacts
- continue treating `signal` as the umbrella product term
- add a unified signal-occurrence layer for cross-source querying, aggregation, and actions

## Non-Goals

- no attempt to avoid the required step-type and trace-type changes
- no pretending `annotation` is sufficient for workflow-backed assertions
- no generic user-code rules engine
- no collapsing the design into trace-only semantics without a product-level signal layer
