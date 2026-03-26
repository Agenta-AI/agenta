# Evaluation Signals: Proposal

## Recommendation

Implement workflow-backed assertions as first-class platform concepts:

- add `assertion` as a workflow/evaluation step type
- add `assertion` as a tracing `TraceType`

`signal` remains the umbrella product term, but workflow-backed assertion behavior should not stay encoded as annotation.

## Core Decisions

### 1. Add `assertion` to evaluation step contracts
Extend evaluation step typing so runs can contain:

- `input`
- `invocation`
- `annotation`
- `assertion`

This change applies to:

- backend DTOs
- run compilation in `SimpleEvaluationsService`
- worker routing
- web run-definition builders
- run-details parsing

### 2. Add `assertion` to tracing contracts
Extend tracing `TraceType` so the platform can emit:

- `invocation`
- `annotation`
- `assertion`
- `unknown`

This change applies to:

- SDK tracing models
- tracing processors
- API/core tracing DTO re-exports
- any parsing or UI logic branching on trace type

### 3. Use assertion traces for workflow-backed judgment artifacts
When an assertion step executes, it should emit an assertion trace with a canonical payload:

- `success`
- `score`
- `reason`
- `info`

That trace becomes the canonical artifact for workflow-backed judgment results.

### 4. Keep annotation separate
`annotation` still exists, but it is no longer the default container for workflow-backed assertions.

Use `annotation` for:

- human comments
- linked notes
- non-assertion judgment-adjacent artifacts

Use `assertion` for:

- policy checks
- evaluator judgments
- validation and gate decisions backed by workflow logic

### 5. Add an integrated signal layer
In addition to assertion traces, add a product-level signal layer that can represent:

- assertion-backed signals
- metric-derived alerts
- action delivery state
- unified query and history

Recommended shape:

- assertion traces remain the canonical workflow artifact
- an `evaluation_signals` model records normalized signal occurrences across sources
- actions execute from signal occurrences rather than directly from trace writes

## Suggested Assertion Definition Shape

```json
{
  "key": "toxicity_assertion",
  "kind": "assertion",
  "enabled": true,
  "scope": "scenario",
  "step": {
    "type": "assertion",
    "inputs": ["input", "invocation"]
  },
  "predicate": {
    "operator": "lte",
    "path": "score",
    "value": 0.2
  }
}
```

## Execution Model

1. the evaluation run contains one or more `assertion` steps
2. workers execute those steps after the required upstream inputs
3. each assertion step emits an `assertion` trace
4. evaluation results store the trace id for the assertion step
5. the integrated signal layer records a normalized occurrence
6. metrics refresh and UI surfaces can consume assertion traces explicitly

## Impacted Areas

### Backend

- `EvaluationRunDataStep.type`
- run compilation and parsing
- worker execution branches
- queue logic where human assertions matter
- metrics refresh if assertion outputs contribute metrics

### Tracing

- `TraceType`
- trace processors and context propagation
- trace parsing and fetch helpers

### Signal layer

- occurrence persistence and query APIs
- action delivery orchestration
- normalized signal history across assertions and metrics

### Frontend and SDK

- evaluation creation payloads
- run-details step grouping and rendering
- trace-type-specific display logic

## Why This Is The Right Cut

- It matches the requirement directly.
- It removes the current annotation overload.
- It gives assertions an explicit workflow and tracing identity.
- It gives the product a complete signal model rather than only a trace-type change.
