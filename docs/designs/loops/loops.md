# Evaluation Loops

## Purpose

This document describes the evaluation loop kinds that currently exist in the runtime.

It is meant to answer two questions clearly:

1. what all loops have in common
2. what is specific to each loop

The goal is that anyone reading this can understand:

- how a run is shaped
- what step cardinalities are allowed
- where scenarios are created
- where results are created
- where repeats apply
- where cache lookup can apply
- where `is_split` is meaningful and where it is not

## Common Execution Model

All evaluation loops work with the same conceptual entities:

- inputs
- executable steps
- scenarios
- results
- repeats

### Steps

A run is made of step definitions in `run.data.steps`.

Each step has a:

- `key`
- `type`
- `origin`
- `references`

The main step types are:

- `input`
- `invocation`
- `annotation`

In practice:

- `input` usually means query input or testset input
- `invocation` usually means application execution
- `annotation` usually means evaluator execution

### Scenarios

A scenario is a concrete source item being processed by the run.

Depending on the loop, a scenario may correspond to:

- a query trace
- a testcase
- a queue trace item
- a queue testcase item

### Results

The target identity of a result is:

- `scenario_id`
- `step_key`
- `repeat_idx`

That means the intended execution model is:

1. for each scenario
2. for each executable step
3. for each repeat slot
4. either reuse an existing trace or invoke execution

### Cache

When caching is enabled through `is_cached=true`, a loop may:

1. compute the expected hash for the step being executed
2. query traces by that hash
3. reuse matching traces
4. invoke only for missing result slots

Cache is step-local:

- application steps can reuse application traces
- evaluator steps can reuse evaluator traces

### Split

`is_split` controls where repeat fan-out happens when both of these are true:

- `repeats > 1`
- the loop has both an application step and evaluator steps

Interpretation:

- `is_split=true`: fan out at the application step
- `is_split=false`: do not fan out at the application step, fan out at evaluator steps

If a loop has no application step, `is_split` is not meaningful.

If a loop has no evaluator step, `is_split` is also not meaningful.

## Loop Matrix

| Loop kind | Inputs | Applications | Evaluators | Source unit | Scenario source | Fan-out validity | Cache insertion points |
|---|---:|---:|---:|---|---|---|---|
| Live query | `1..N` | `0` | `1..N` | query trace | queried trace | evaluator only | evaluator |
| Batch query | `1..N` | `0` | `1..N` | query trace | queried trace | evaluator only | evaluator |
| Batch testset | `1..N` | `1` | `1..N` | testcase | testcase from any input testset | application or evaluator | application, evaluator |
| Batch invocation | `1..N` | `1` | `0` | testcase | testcase from any input testset | application only | application |
| Queue traces | `1` generated source input | `0` | `1..N` | trace item | provided trace ID | evaluator only | evaluator |
| Queue testcases | `1` generated source input | `0` | `1..N` | testcase item | provided testcase ID | evaluator only | evaluator |
| SDK/local | run-defined | run-defined | run-defined | local runner-defined | local runner-defined | external to worker dispatch | local runner-defined |

## Dispatch Rules

Current worker dispatch recognizes these non-live topologies:

- query steps + evaluator steps -> batch query loop
- testset steps + application steps + evaluator steps -> batch testset loop
- testset steps + application steps + no evaluator steps -> batch invocation loop

Queue batch dispatch is separate:

- queue traces
- queue testcases

Live query evaluation is dispatched separately.

Anything outside these shapes is not part of the supported worker topology today.

## Loop Details

### 1. Live Query

Primary runtime:

- [`live.py`](/api/oss/src/core/evaluations/tasks/live.py)

Purpose:

- evaluate traces returned by one or more query steps using one or more evaluator steps

Supported step cardinality:

- inputs: `1..N`
- applications: `0`
- evaluators: `1..N`

Scenario creation:

- traces are queried first
- one scenario is created per returned trace

Result creation:

- one input/query result per scenario and per repeat slot
- one evaluator result per scenario, evaluator step, and repeat slot

Repeat semantics:

- operationally, repeats fan out only at evaluator steps
- there is no application boundary in this loop

`is_split`:

- must effectively be `false`
- there is no application step to split on

Cache insertion point:

- evaluator step only

Specificity:

- source items are already traces
- the loop does not need to produce application traces
- cache lookup is therefore purely evaluator-side

### 2. Batch Query

Primary dispatch:

- [`service.py`](/api/oss/src/core/evaluations/service.py)
- [`worker.py`](/api/oss/src/tasks/taskiq/evaluations/worker.py)

Purpose:

- run a one-shot non-live version of the live query loop

Supported step cardinality:

- inputs: `1..N`
- applications: `0`
- evaluators: `1..N`

Scenario creation:

- same source model as live query
- one scenario per query trace

Result creation:

- same structural result model as live query

Repeat semantics:

- evaluator-only fan-out

`is_split`:

- must effectively be `false`

Cache insertion point:

- evaluator step only

Specificity:

- this is the same loop family as live query
- the difference is scheduling and time window behavior, not execution topology

### 3. Batch Testset

Primary runtime:

- [`legacy.py`](/api/oss/src/core/evaluations/tasks/legacy.py)

Purpose:

- apply one application revision to one or more input testset steps
- then run one or more evaluator steps on the produced application traces

Supported step cardinality:

- inputs: `1..N`
- applications: `1`
- evaluators: `1..N`

Scenario creation:

- every input testset step is resolved
- testcases from all input testsets are flattened into one scenario list
- one scenario is created per testcase

Result creation:

- one input result per scenario and repeat slot
- one application result per scenario and repeat slot
- one evaluator result per scenario, evaluator step, and repeat slot

Repeat semantics:

- if `is_split=true`, repeats fan out at the application step
- if `is_split=false`, one application trace is reused across evaluator repeats for the scenario

`is_split`:

- meaningful

Cache insertion points:

- application step
- evaluator step

Specificity:

- this is the only loop where both application and evaluator fan-out matter at runtime
- it is the canonical loop for `is_cached` + `is_split` interaction

Important detail:

- application hashes and evaluator hashes are scenario-specific
- they include testcase identity and testset lineage
- with multiple input testsets, the same application step is reused independently per scenario

### 4. Batch Invocation

Primary runtime:

- [`legacy.py`](/api/oss/src/core/evaluations/tasks/legacy.py)

Purpose:

- apply one application revision to one or more input testset steps without evaluator execution

Supported step cardinality:

- inputs: `1..N`
- applications: `1`
- evaluators: `0`

Scenario creation:

- every input testset step is resolved
- testcases from all input testsets are flattened into one scenario list
- one scenario is created per testcase

Result creation:

- one input result per scenario and repeat slot
- one application result per scenario and repeat slot

Repeat semantics:

- repeats are application-side only
- there is no downstream evaluator boundary to defer fan-out to

`is_split`:

- not meaningful

Cache insertion point:

- application step only

Specificity:

- this loop is the application-only subset of batch testset
- it still uses per-scenario hash lookup and partial cache-hit behavior

### 5. Queue Traces

Primary runtime:

- [`legacy.py`](/api/oss/src/core/evaluations/tasks/legacy.py)
- [`service.py`](/api/oss/src/core/evaluations/service.py)

Purpose:

- evaluate ad-hoc trace items with one or more evaluator steps

Supported step cardinality:

- inputs: `1` generated source input step
- applications: `0`
- evaluators: `1..N`

Scenario creation:

- source trace IDs are supplied externally
- one scenario is created per trace item

Result creation:

- one source/input result per scenario and repeat slot
- one evaluator result per scenario, evaluator step, and repeat slot

Repeat semantics:

- evaluator-only fan-out

`is_split`:

- must effectively be `false`

Cache insertion point:

- evaluator step only

Specificity:

- the upstream trace already exists
- there is no application execution stage in the loop itself

### 6. Queue Testcases

Primary runtime:

- [`legacy.py`](/api/oss/src/core/evaluations/tasks/legacy.py)
- [`service.py`](/api/oss/src/core/evaluations/service.py)

Purpose:

- evaluate ad-hoc testcase items with one or more evaluator steps

Supported step cardinality:

- inputs: `1` generated source input step
- applications: `0`
- evaluators: `1..N`

Scenario creation:

- source testcase IDs are supplied externally
- one scenario is created per testcase item

Result creation:

- one source/input result per scenario and repeat slot
- one evaluator result per scenario, evaluator step, and repeat slot

Repeat semantics:

- evaluator-only fan-out

`is_split`:

- must effectively be `false`

Cache insertion point:

- evaluator step only

Specificity:

- unlike queue traces, the loop starts from testcase payload rather than an existing trace
- but it still has no application step

### 7. SDK / Local

Primary behavior:

- local runner path outside legacy worker dispatch

Purpose:

- execute an evaluation locally without dispatching the worker loop

Supported step cardinality:

- not enforced by the worker topology
- determined by the local runner implementation

Scenario creation:

- local-runner-defined

Result creation:

- local-runner-defined

Repeat semantics:

- local-runner-defined

`is_split`:

- not a worker concern here

Cache insertion point:

- local-runner-defined

Specificity:

- this is not a distinct worker loop
- it is important only because it bypasses the normal dispatch topology rules

## Common Differences Between Loops

### Inputs

There are two broad input families:

- query-derived inputs
- testset-derived inputs

Queue loops use generated synthetic source steps:

- `query-direct` for trace queues
- `testset-direct` for testcase queues

### Applications

Only two loop families execute application steps:

- batch testset
- batch invocation

Every other loop starts from existing source data and only runs evaluators.

### Evaluators

Loops with evaluators:

- live query
- batch query
- batch testset
- queue traces
- queue testcases

Loop without evaluators:

- batch invocation

### Repeats

Loops where repeats can only fan out at evaluator steps:

- live query
- batch query
- queue traces
- queue testcases

Loop where repeats can fan out at application or evaluator steps:

- batch testset

Loop where repeats can only fan out at application steps:

- batch invocation

### Cache

Application cache exists only where application execution exists:

- batch testset
- batch invocation

Evaluator cache exists only where evaluator execution exists:

- live query
- batch query
- batch testset
- queue traces
- queue testcases

## Supported Worker Topologies

The worker runtime currently supports these topologies:

- `query(1..N) -> evaluator(1..N)`
- `testset(1..N) -> application(1) -> evaluator(1..N)`
- `testset(1..N) -> application(1)`
- `queue source(1) -> evaluator(1..N)`

Anything else should be treated as unsupported until an explicit loop is added.

Examples of unsupported topologies today:

- multiple application steps in a single worker-dispatched run
- query steps mixed with application steps
- testset steps without application steps but with evaluator steps in non-queue mode

## Practical Reading Guide

If you want to know whether `is_split` matters:

- ask whether the loop has both application and evaluator execution

If you want to know whether application cache matters:

- ask whether the loop actually invokes an application step

If you want to know what a scenario represents:

- ask what the loop’s source unit is

If you want to know whether multiple inputs are supported:

- check the input cardinality for that loop, not the generic run-data builder alone
