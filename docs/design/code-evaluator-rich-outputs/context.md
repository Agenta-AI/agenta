# Context

## The problem in one paragraph

A user opens a code evaluator in the playground and writes an `evaluate()` function
that returns a dict, expecting each key to become a metric or a piece of feedback.
Instead they get `Error during code execution: Result is not a float after conversion:
<class 'dict'>`. The evaluator interface forces a single float score. Other evaluators
on the platform already produce multiple metrics (LLM-as-a-judge with a JSON schema,
multi-field JSON match), so this limit is specific to code evaluators, not to the
platform.

## Why it matters

Code evaluators are the escape hatch. When a built-in evaluator does not fit, users
write code. A single float forces them to create one evaluator per metric, which means
N sandbox runs, N configurations, and N columns to keep in sync. One evaluator that
returns `{"relevance": 0.8, "tone": 0.4, "reason": "..."}` is the natural shape.

There is a second expectation behind this: code evaluators in the UI and evaluators in
the SDK should be interchangeable. Write the function once, run it in the playground,
run it locally through the SDK, or call it remotely. Today that expectation holds only
partially (see research.md, "Interchangeability today").

## Goals

1. A code evaluator in the playground can return a dict. Each key shows up as a metric
   or feedback field in the playground result view and in evaluation run metrics.
2. The same evaluator works from the SDK: fetched and run locally, or invoked remotely
   on the platform, producing the same output shape.
3. Existing float-returning evaluators keep working unchanged (they normalize to
   `{"score": x, "success": x >= threshold}` as today).

## Non-goals

- Changing the v1/v2 evaluate signatures. The
  [align-evaluator-interface](../align-evaluator-interface/README.md) work settled
  `evaluate(inputs, outputs, trace)` for v2.
- Making the platform execute SDK-decorated (`@ag.evaluator`) Python functions
  server-side. Those live in the user's environment by design.
- Redesigning the metrics aggregation pipeline. It already handles multi-key outputs.

## Prior work

- `align-evaluator-interface` migrated code evaluators to the v2 signature and added
  the `trace` argument, but kept the `-> float` contract.
- `json_multi_field_match` (handlers.py) was the first built-in evaluator to emit
  per-field metrics plus an aggregate score, with a dynamic output schema built from
  its settings. It proves the downstream path works.
