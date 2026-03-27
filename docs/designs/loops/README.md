# Trace Reuse via Hashing

## What Hashing Does

Hashing assigns a stable identity to a trace node from:

- the references that define the node from which the trace was generated
- the links that describe the nodes before it in the execution chain

The goal is to identify whether a node that is about to run is logically the same node as one that has already been traced.

The references can include identities such as:

- `testset`
- `testcase`
- workflow lineage
- application lineage
- evaluator lineage

For artifact-based entities, that lineage may be expressed at the artifact, variant, or revision level.

The hash is not derived from the entire trace payload. It is derived from the canonical identity of the node in context.

## Scope Of The Hash

The hash is built from:

- canonical references for the node
- canonical upstream links for the node

For trace reuse, `testset_variant` and `testset_revision` are excluded from hashing so that the same testcase can reuse traces across testset variants and revisions.

## How To Use It

In an evaluation loop, when a workflow, application, or evaluator is about to be invoked, first compute the expected hash for that node and try to fetch an existing trace by that hash.

Flow:

1. Compute the expected hash from the node's references and upstream links.
2. Query existing traces by that hash.
3. If a matching trace is found, reuse its `trace_id` instead of invoking the runnable.
4. If no matching trace is found, invoke the runnable normally.

Persistence does not need a separate step here, because traces are already persisted automatically when the runnable executes.

Operationally, the switch is only:

- fetch and reuse
- fetch, miss, and invoke

## Required Utilities And Components

The core primitive utilities are:

- `make_hash(...)`
- `fetch_traces_by_hash(...)`

`fetch_traces_by_hash(...)` should be plural by default.

This is necessary because reuse depends on cardinality:

- application-step fan-out may need up to `repeats` traces
- evaluator-step fan-out may need up to `repeats` traces
- partial cache hits need all matching traces, not just one

On top of those primitives, the runtime also needs:

- `select_traces_for_reuse(...)`
- `plan_missing_traces(...)`
- a repeat-aware fan-out planner
- a repeat-aware result-slot planner
- a reuse resolver that decides, for each result slot, whether to bind an existing trace or invoke execution

### Responsibility Split

- `make_hash(...)`
  - compute the canonical identity for the node in context
- `fetch_traces_by_hash(...)`
  - fetch all candidate traces for that identity
- `select_traces_for_reuse(...)`
  - choose which fetched traces satisfy the current repeat demand
- `plan_missing_traces(...)`
  - determine how many additional executions are still required

At execution time, this must be applied at the runnable step boundary:

- workflow step
- application step
- evaluator step

## When To Use It

Hash-based trace reuse must be explicit.

The run should opt into reuse through a dedicated flag, for example:

- `is_cached=true`

This avoids implicit behavior changes and makes reuse a deliberate execution choice.

When `repeats > 1`, the run should also explicitly declare where fan-out happens through:

- `is_split`

Semantics:

- `is_split=false` by default
- if `repeats > 1` and `is_split=true`, fan-out happens at the application step
- if `repeats > 1` and `is_split=false`, fan-out happens at the evaluator step

Hash-based trace reuse may be used for:

- workflow steps
- application steps
- evaluator steps

Hash-based trace reuse must also be coherent with repeat fan-out.

### Repeats Fan Out At Application Steps

If repeats fan out at application steps and `is_cached` is true:

- fetch traces by hash for the application step
- if the number of matching traces is greater than or equal to the number of repeats, reuse them
- if the number of matching traces is smaller than the number of repeats, reuse the traces that exist and generate the missing traces
- the newly generated traces will carry the same hash

### Repeats Fan Out At Evaluator Steps

If repeats fan out at evaluator steps and `is_cached` is true:

- for evaluator steps, fetch traces by hash for the evaluator step
- if the number of matching traces is greater than or equal to the number of repeats, reuse them
- if the number of matching traces is smaller than the number of repeats, reuse the traces that exist and generate the missing traces
- the newly generated traces will carry the same hash

There is also a cross-step optimization when repeats fan out at evaluator steps:

- for application steps, fetch traces by hash
- if there is at least one matching application trace, reuse the latest matching application trace for all evaluator repeats
- only invoke the application step when there is no matching application trace

## When Not To Use It

- if `is_cached=false`, do not use hashes
- if `is_cached=true` and repeats fan out at the application step, but the number of traces with the hash is smaller than the number of repeats, some traces must still be generated
- if `is_cached=true` and repeats fan out at the evaluator step, but the number of traces with the hash is smaller than the number of repeats, some traces must still be generated

## Summary

Hashing gives us a stable identity for a trace node so we can tell whether we have already generated the same logical node before.

That identity is computed from:

- references, which describe what node this trace came from
- links, which describe the upstream nodes before it in the execution chain

So the hash is not "hash the whole trace payload." It is "hash the canonical identity of this node in context."

We use that in evaluation loops to avoid unnecessary execution. Before invoking a runnable, we compute the expected hash and try to fetch an existing trace with that hash.

This applies to runnable steps such as:

- workflow
- application
- evaluator

The runtime flow is:

1. Compute the expected hash for the node.
2. Query traces by hash.
3. If a matching trace exists, reuse its `trace_id`.
4. If no matching trace exists, invoke normally.

There is no extra persistence step to think about. If we do invoke, trace persistence already happens automatically.

So the decision is always:

- fetch and reuse
- fetch, miss, and invoke

One important correction we made is that `testset_variant` and `testset_revision` should not affect the hash. If they do, the same testcase ends up with different hashes across testset revisions or variants, which breaks reuse for something that is logically the same testcase input.

When should hashes be used?
Only when explicitly enabled, for example with `is_cached=true`. Reuse should never be implicit.

Then fan-out behavior has to stay coherent for the step where repeats happen.

When `repeats > 1`, that fan-out location should be explicit:

- `is_split=true` means application-step fan-out
- `is_split=false` means evaluator-step fan-out

If repeats fan out at the application step and `is_cached=true`:

- fetch traces for that application-step hash
- if matching traces are greater than or equal to repeats, reuse them
- if matching traces are fewer than repeats, reuse what exists and generate the missing traces

If repeats fan out at the evaluator step and `is_cached=true`, the same rule applies at the evaluator step:

- fetch traces for that evaluator-step hash
- if matching traces are greater than or equal to repeats, reuse them
- if matching traces are fewer than repeats, reuse what exists and generate the missing traces

There is also a cross-step case.

If repeats fan out at evaluator steps, then at the application step there is no need to regenerate identical application traces for each evaluator repeat. In that case:

- if at least one matching application trace exists, reuse the latest one for all evaluator repeats
- only invoke the application if there is no matching trace at all

When not to use hashes:

- if `is_cached=false`
- if `is_cached=true` but the number of matching traces is smaller than the repeat demand for the step that actually fans out, missing traces still must be generated

The mental model is:

- hashes define logical node identity
- reuse is an explicit opt-in
- `is_split` defines where fan-out happens when `repeats > 1`
- workflow, application, and evaluator steps can all use hashes
- the reuse policy depends on where repeats fan out
- hashes reduce duplicate work, but they do not eliminate the need to generate missing traces when repeat cardinality requires them
