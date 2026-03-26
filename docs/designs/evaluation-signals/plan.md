# Evaluation Signals: Implementation Plan

## Phase 0: Contract Changes

### Evaluation contracts

- extend evaluation step typing to include `assertion`
- add assertion-step config to `SimpleEvaluationData` and `EvaluationRunData`
- update run compilation and parsing in `SimpleEvaluationsService`

### Tracing contracts

- extend `TraceType` to include `assertion`
- update tracing DTO re-exports and parsers
- define canonical assertion payload fields: `success`, `score`, `reason`, `info`

## Phase 1: Backend Execution Support

### Evaluation workers

- split run steps into input, invocation, annotation, and assertion groups
- add assertion-step execution ordering
- ensure assertion results are written to `evaluation_results` with the assertion trace id

### Services

- either add a dedicated `AssertionsService` or generalize current annotation-style trace creation for assertions
- keep annotation and assertion creation paths distinct at the trace-type level
- persist normalized signal occurrences for assertion traces

### Metrics refresh

- decide whether assertion outputs contribute metrics
- if yes, include `assertion` in metrics-refresh step processing and schema extraction
- persist normalized signal occurrences for metric-derived alerts

## Phase 2: Tracing Support

### SDK tracing

- add `TraceType.ASSERTION`
- update processors so assertion context propagates correctly
- ensure helper APIs can create, fetch, and parse assertion traces cleanly

### API/core tracing

- update tracing model re-exports
- verify downstream consumers do not assume the trace type set is closed over invocation/annotation/unknown

## Phase 3: Frontend And SDK Product Support

### SDK evaluation APIs

- expose assertion-step configuration in evaluation creation/edit flows
- expose assertion traces and assertion-backed results in typed models

### Web

- build assertion steps explicitly instead of overloading annotation steps
- update evaluation run details to render assertion steps distinctly
- update any trace-type-specific UI to recognize assertion traces

## Phase 4: Integrated Signal Layer

- add unified signal-occurrence persistence
- add signal query APIs across assertion-backed and metric-backed signals
- add action delivery state and orchestration
- ensure signal history is normalized independently from raw traces

## Testing Plan

### API

- unit tests for assertion step compilation and parsing
- integration tests for worker execution of assertion steps
- integration tests for assertion trace creation and retrieval
- acceptance tests for end-to-end evaluation runs with assertion steps

### SDK

- tests for `TraceType.ASSERTION`
- acceptance tests for creating evaluations with assertion steps
- acceptance tests for fetching assertion traces from completed runs

### Web

- tests for run-definition builders producing assertion steps
- tests for run-details parsing/rendering of assertion results
- Playwright coverage for assertion-backed evaluations

## Sequencing Recommendation

1. Land step-type and trace-type contract changes.
2. Land backend execution and trace creation for assertion steps.
3. Land frontend and SDK support.
4. Extend metrics refresh and persist metric-backed signal occurrences.
5. Land the integrated signal layer and actions.
