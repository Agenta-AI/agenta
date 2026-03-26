# Evaluation Signals: Terminology

## Recommended Terms

### Signal
Umbrella product term for meaningful evaluation outcomes that may need to be:

- displayed
- queried
- aggregated
- used for alerts or gates

Examples:

- assertion result
- regression alert
- anomaly marker
- rollout gate

### Assertion
A workflow-backed signal whose primary meaning is a judgment or validation.

Examples:

- pass/fail evaluator output
- policy check
- CI expectation
- contractual threshold check

In this design:

- assertion is not just semantics
- assertion is a first-class step type
- assertion is a first-class trace type

### Annotation
Existing trace/API/storage mechanism for non-assertion annotation artifacts.

In this design:

- annotation remains a valid trace and step concept
- assertion is no longer modeled as "just another annotation"

### Assertion Step
A workflow/evaluation step with `type="assertion"`.

Its responsibility is to execute judgment logic and emit an assertion trace payload.

### Assertion Trace
A trace with `trace_type="assertion"`.

This is the canonical trace form for workflow-backed judgment artifacts.

## Canonical Assertion Payload

Assertion traces should normalize around:

- `success: boolean | null`
- `score: float | null`
- `reason: string | null`
- `info: dict | null`

Notes:

- `success` covers pass/fail
- `score` covers graded judgments
- `reason` is the short explanation
- `info` carries structured evidence, matched conditions, or detailed output

## Recommended Semantics

### Workflow-backed judgment

- step type: `assertion`
- trace type: `assertion`

### Non-judgment annotation

- step type: `annotation`
- trace type: `annotation`

### Metric-derived alert

- not necessarily a workflow step
- may remain a signal/alert concept on top of persisted evaluation metrics

## Anti-Patterns

- Do not use `annotation` to mean workflow-backed assertion.
- Do not treat `assertion` as only a UI label or semantic subtype.
- Do not use `signal` as a reason to avoid adding the actual `assertion` step and trace types.
