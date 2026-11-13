# Research

## Scope

This note summarizes the currently implemented evaluation loop behavior around:

- live query evaluation
- batch query evaluation
- batch testset evaluation
- batch invocation-only evaluation
- annotation queues

The goal is to separate what the runtime actually supports from what is only implied by shared data models.

## Core Finding

The product has three distinct evaluation families:

1. query-backed runs
2. testset-backed runs
3. queue-backed annotation runs

These families do not expose the same source types or evaluator behavior.
That fragmentation is the current normal state of the runtime, not something we are trying to eliminate in this work.

## Setup Surfaces

The current API exposes these setup entry points:

- auto evaluation creation for app + variant + testset + evaluators
- human evaluation creation for testset + single variant + evaluators
- live evaluation dispatch for query-backed trace sampling
- annotation queue endpoints for trace IDs or testcase IDs

That means the system is not currently set up as one universal "evaluation source" flow.
Instead, each family has its own source shape and dispatch rules.

## Query-Backed Runs

Query-backed runs are built from query revisions that resolve to traces.

Supported shapes:

- live query evaluation
- batch query evaluation

Supported flags:

- `is_live=true` for live query evaluation
- `is_live=false` for batch query evaluation

Supported step shape:

- input query step(s)
- annotation step(s)
- no application step

What is supported:

- automatic evaluator execution on annotation steps
- trace sampling / trace querying

What is not supported as an execution path:

- human evaluators as a live or batch query execution path
- custom evaluators as a live or batch query execution path

Reason:

- the query-backed workers only implement the query-to-trace loop
- there is no branch that converts query runs into pending human/custom annotation work

## Testset-Backed Runs

Testset-backed runs are built from testset revisions and testcases.

Supported shapes:

- batch testset evaluation
- batch invocation-only evaluation

Supported step shape for batch testset:

- input testset step(s)
- one application invocation step
- annotation step(s)

Supported step shape for batch invocation-only:

- input testset step(s)
- one application invocation step
- no annotation steps

What is supported:

- auto evaluator execution
- human evaluator steps as pending/manual work
- custom evaluator steps as pending/manual work

Reason:

- the batch testset worker explicitly skips annotation steps whose origin is `human` or `custom`
- those steps remain pending and are expected to be completed later through annotation flows

## Annotation Queues

Annotation queues are separate from query-backed and testset-backed evaluation runs.

Supported queue inputs:

- traces
- testcases

Not supported as queue inputs:

- queries
- testsets

Reason:

- the public queue APIs accept `trace_ids` or `testcase_ids`
- queue kind detection only recognizes:
  - traces when `has_queries=true` and `has_testsets=false`
  - testcases when `has_testsets=true` and `has_queries=false`
- mixed query/testset queue kinds are rejected

What is supported:

- auto evaluators
- human evaluators
- custom evaluators

What happens for human/custom:

- they are not auto-executed in the queue loop
- they remain manual annotation work

Current queue run shape:

- direct trace/testcase queue creation stores only a synthetic source step for the concrete item family
- the run does not currently preserve a query revision or testset revision as part of the queue step definitions
- this is fine for the existing direct-ID queue path, but it is a limitation for any future source-aware queue creation path

## Summary Table

| Loop family | Source input | Auto evaluators | Human evaluators | Custom evaluators |
|---|---|---:|---:|---:|
| Live query | query revision -> traces | yes | no | no |
| Batch query | query revision -> traces | yes | no | no |
| Batch testset | testset revisions -> testcases | yes | yes, pending/manual | yes, pending/manual |
| Batch invocation-only | testset revisions -> testcases | no | no | no |
| Queue traces | traces | yes | yes, pending/manual | yes, pending/manual |
| Queue testcases | testcases | yes | yes, pending/manual | yes, pending/manual |

The current direct queue paths consume concrete item IDs.
If we add source-aware queue creation later, the revision source would need to be preserved in the run step definitions while the loop still executes on concrete items.

## Practical Interpretation

If the run is query-backed:

- it is an auto-evaluation path only
- it does not provide a human/custom pending branch

If the run is queue-backed:

- it is source-item driven
- it accepts traces or testcases, not queries or testsets
- it can carry human/custom evaluators as manual annotation work

If the run is testset-backed:

- it can mix auto and manual evaluator origins
- human/custom steps are left pending instead of auto-executed

## References

- [`EvaluationRunFlags`]( /Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/types.py#L81 )
- [`start()` dispatch logic]( /Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/service.py#L2152 )
- [`_make_evaluation_run_data()`]( /Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/service.py#L2453 )
- [`SimpleQueuesService`]( /Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/service.py#L3303 )
- [`evaluate_batch_testset()`]( /Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/tasks/legacy.py#L223 )
- [`_evaluate_batch_items()`]( /Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/tasks/legacy.py#L1661 )
- [`evaluate_live_query()`]( /Users/junaway/Agenta/github/application/api/oss/src/core/evaluations/tasks/live.py#L223 )
