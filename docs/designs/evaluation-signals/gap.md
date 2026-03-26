# Evaluation Signals: Gap Analysis

## Required Gaps To Close

### 1. No assertion step type
Current evaluation runs only support:

- `input`
- `invocation`
- `annotation`

To support workflow-backed assertions, the step model must gain:

- `assertion`

### 2. No assertion trace type
Current tracing only supports:

- `invocation`
- `annotation`
- `unknown`

To support workflow-backed assertions cleanly, tracing must gain:

- `assertion`

### 3. Workers do not route assertion steps
Current execution paths split work into:

- input steps
- invocation steps
- annotation steps

There is no assertion execution branch.

### 4. Metrics refresh does not understand assertion traces
Current metrics refresh only processes step types in:

- `{"invocation", "annotation"}`

If assertion outputs can carry metrics, `assertion` must be included.

### 5. Frontend and SDK contracts assume the old topology
Current clients model evaluator-backed judgment steps as annotation.

That assumption must be replaced with explicit assertion support in:

- evaluation creation
- run parsing
- run details UI
- tracing clients and helpers

### 6. No integrated signal layer
Even with assertion traces, the product still lacks a unified place to handle:

- metric-derived alerts
- assertion-backed signal history
- action delivery state
- cross-source signal querying

The design therefore also needs an integrated signal layer, not just new trace typing.

## Main Risk

The real risk is not adding too much. The real risk is adding a partial concept:

- calling something "assertion" in docs or UI
- while still storing and routing it as annotation underneath

That would preserve ambiguity instead of removing it.
