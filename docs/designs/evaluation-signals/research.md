# Evaluation Signals: Research

## 1. Evaluation Run Topology Today

The current evaluation system is run-centric.

- `SimpleEvaluationsService.create(...)` accepts `SimpleEvaluationData`
- `_make_evaluation_run_data(...)` resolves testsets, applications, and evaluators into concrete `EvaluationRunDataStep` entries
- `_parse_evaluation_run(...)` later reconstructs `SimpleEvaluationData` from the run

Relevant files:

- `api/oss/src/core/evaluations/service.py`
- `api/oss/src/core/evaluations/types.py`

Key consequence:

- adding workflow-backed assertions means extending run compilation, parsing, and persistence

## 2. Step Vocabulary And Worker Behavior

The backend step type enum is currently:

- `input`
- `invocation`
- `annotation`

Relevant file:

- `api/oss/src/core/evaluations/types.py`

Workers are built around that assumption.

- live workers split runs into input, invocation, and annotation step groups
- human queue creation scans only `step.type == "annotation"`
- metrics refresh only considers `{"invocation", "annotation"}`

Relevant files:

- `api/oss/src/core/evaluations/tasks/live.py`
- `api/oss/src/core/evaluations/service.py`

Research conclusion:

- a real assertion design requires adding `assertion` to the step vocabulary and then updating worker routing, queue handling, and metrics extraction accordingly

## 3. Frontend Evaluation Creation Already Encodes The Old Model

The frontend currently builds evaluation runs with:

- one input step
- one invocation step
- evaluator judgment steps emitted as `type: "annotation"`

Relevant file:

- `web/oss/src/services/evaluationRuns/api/index.ts`

Run-details UI and client-side types also assume:

- input steps
- invocation steps
- annotation steps

Relevant files:

- `web/oss/src/lib/evaluations/types.ts`
- `web/oss/src/components/EvalRunDetails/...`

Research conclusion:

- introducing `assertion` is a full-stack model change, not only a backend change

## 4. Tracing And Annotation Contracts

Tracing currently supports only:

- `invocation`
- `annotation`
- `unknown`

Relevant file:

- `sdk/agenta/sdk/models/tracing.py`

Annotation creation is explicit:

- `AnnotationsService._create_annotation(...)` sets `trace_type = TraceType.ANNOTATION`

Relevant file:

- `api/oss/src/core/annotations/service.py`

Tracing processors derive annotation semantics from explicit tracing context or trace attributes, not from workflow semantics.

Relevant file:

- `sdk/agenta/sdk/tracing/processors.py`

Research conclusion:

- a workflow-backed assertion model requires a new trace type, `assertion`
- reusing `annotation` would keep the platform in the current overloaded state rather than expressing the new concept directly

## 5. Metrics Refresh Is Still Relevant

`EvaluationsService.refresh_metrics(...)`:

- reads evaluation results by run/scenario/timestamp
- collects trace ids per step
- loads evaluator schemas for annotation steps
- calls tracing analytics
- persists `evaluation_metrics` rows

Relevant files:

- `api/oss/src/core/evaluations/service.py`
- `api/oss/src/dbs/postgres/evaluations/dbes.py`

Research conclusion:

- assertion traces should be considered by metrics refresh alongside invocations and annotations where appropriate
- metric-derived signals can continue to build on `evaluation_metrics`

## 6. Existing Evaluator Outputs Already Match The Intended Assertion Payload

Current evaluator outputs often carry fields like:

- `success`
- `score`
- pass/fail style booleans
- explanatory fields

Relevant file:

- `sdk/agenta/sdk/evaluations/preview/utils.py`

Research conclusion:

- the system already has the rough payload shape needed for assertions
- the missing piece is first-class typing and routing, not the conceptual payload

## 7. What The Design Must Add

Required:

- `assertion` in evaluation step types
- `assertion` in tracing `TraceType`
- worker execution for assertion steps
- parsing/rendering support in frontend and SDK clients
- metrics refresh awareness of assertion traces if assertion outputs contribute metrics
- a unified signal-occurrence layer for assertions plus metric-derived alerts
- action dispatch for alerts and notifications

## 8. Main Conclusion

If assertions are backed by workflows, the platform needs a real structural change:

- assertion is a step
- assertion is a trace type

Anything less keeps assertions as an annotation convention rather than a first-class capability.
