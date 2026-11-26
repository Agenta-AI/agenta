# Unify Evals Extension Synthesis

## Purpose

This note captures the refined model that emerged after relating the queue-unification work to the parallel eval-loop unification work.

The central clarification is that several concepts currently overloaded into “queue” should be separated:

- source family
- default queue identity
- simple-queue eligibility
- queue lifecycle

## Final Vocabulary

### Source-family flags on runs

Runs should expose distinct inferred flags for each source family:

- `has_queries`
- `has_testsets`
- `has_traces`
- `has_testcases`

These flags answer where scenarios come from and should drive:

- validation
- topology classification
- source-family filtering
- mixed-input prevention

They should replace the current tendency to infer direct trace/testcase behavior indirectly through `is_queue` plus synthetic step-key inspection.

### `run.flags.is_queue`

`is_queue` should become the persisted derived flag that answers:

> Can this evaluation currently be interacted with through the simple annotation queue surface?

The intended condition is:

```text
active default queue exists
and active human evaluator work exists
```

This aligns the name with the product meaning and makes the flag directly useful for querying.

It should be maintained eagerly, like the other persisted run flags, whenever:

- the default queue is created
- the default queue is archived or unarchived
- active human evaluator work appears or disappears

### `queue.flags.is_default`

Queues need an explicit canonical-default marker:

```text
queue.flags.is_default = true
```

Shape alone is not enough to identify the canonical queue, because a custom queue may coincidentally have the same open filters.

## Default Queue Model

A default queue is the canonical persisted queue view for a run.

Its invariant shape is:

```text
scenario_ids = None
step_keys    = None
user_ids     = None
```

and no queue-specific batching constraints.

Interpretation:

- no scenario filter -> all run scenarios
- no step filter -> all included steps
- no user assignments -> unassigned
- repeat coverage remains run-owned

### Uniqueness

There must be at most one default queue per run, including archived queues.

Because queue flags are persisted JSONB, this can be enforced with a partial unique index over the materialized JSONB flag:

```sql
CREATE UNIQUE INDEX ux_evaluation_queues_default_per_run
ON evaluation_queues (project_id, run_id)
WHERE (flags ->> 'is_default')::boolean = true;
```

An archived default queue still occupies the uniqueness slot. Reconciliation should unarchive it rather than create a duplicate.

### Edit restrictions

When `is_default=true`, editing must not allow:

- scenario filters
- step-key filters
- assignments
- batching settings

Default queues are canonical open views, not user-customizable slices.

## Default Queue Lifecycle

There are two policies.

### Structural policy

```text
has_active_human_evaluator_steps(run)
```

This says whether a run warrants a default queue when queues are conditional.

### Global lifecycle policy

A global policy toggle determines whether default queues are unconditional for all runs, for example:

```text
EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS
```

When enabled:

- every run gets a default queue
- the default queue is not archived merely because active human work disappears

When disabled:

- active human work requires a default queue
- absence of active human work archives the default queue

### Reconciliation behavior

```text
required + missing   -> create
required + archived  -> unarchive
required + active    -> no-op
not required + active -> archive
```

Queue lifecycle should use soft deletion for this behavior. Hard deletion may remain available separately where still needed.

Queue queries need archived-aware support so reconciliation can restore the existing canonical row.

## Simple Queue Semantics

A `SimpleQueue` should be understood as:

```text
a simplified human-work projection of an evaluation's default queue
```

not as a wrapper around runs that happen to use a special ingestion mode.

### Eligibility

A run is simple-queue eligible when:

```text
run.flags.is_queue == true
```

under the redefined meaning above.

That means all of these can appear through the simple queue surface when they have active human work and an active default queue:

- query-backed evaluations
- testset-backed evaluations
- direct trace-backed evaluations
- direct testcase-backed evaluations

Auto-only evaluations with an eager but empty default queue are not simple-queue eligible unless product later decides otherwise.

### Identifiers

Simple queue endpoints should remain queue-ID based.

If a caller starts from a run, add one small lookup endpoint:

```http
GET /evaluations/runs/{run_id}/default-queue
```

This returns the canonical queue resource or ID, after which existing simple queue endpoints can continue using queue IDs.

There is no need for run-scoped archive/unarchive endpoints.

## Relationship to Unified Eval Loops

The parallel eval-loop work formalizes:

```text
evaluation = graph + tensor + process(slice)
```

The queue model fits above that as:

```text
default queue = canonical persisted human-work view over the tensor
```

The queue axes align naturally with tensor dimensions:

- scenarios
- steps
- repeats

A default queue is the open/default view over those dimensions.

### Boundary

The default queue is not orchestration.

- eval runtime owns planning, processing, and tensor population
- queues own visibility, assignment, queue lifecycle, and user workflow

## Shared Design Tension: Step Lifecycle

The unified-loop design currently leans toward:

```text
remove_step -> prune tensor cells
```

But if product semantics require evaluators or steps to be archived rather than hard-removed, the graph model needs to support active versus archived steps.

That affects queue logic directly:

- queue eligibility should depend on active human steps
- archived human steps may remain visible historically without keeping the queue active
- old tensor cells may remain instead of being pruned

This needs explicit alignment with the eval-loop mutation model.

## Recommended Backend Changes

1. Add inferred run flags:
   - `has_traces`
   - `has_testcases`
2. Redefine persisted `run.flags.is_queue` as simple-queue eligibility.
3. Add `queue.flags.is_default`.
4. Enforce one default queue per run with a partial unique index over `flags.is_default`.
5. Reject filters/assignments/batching edits on default queues.
6. Add queue archive/unarchive support and archived-aware queries.
7. Add default-queue reconciliation tied to run creation/editing and queue lifecycle changes.
8. Persist and eagerly refresh `run.flags.is_queue` when the default queue or active human-work state changes.
9. Keep simple queue endpoints queue-ID based.
10. Add a small run-scoped lookup endpoint for the default queue:

```http
GET /evaluations/runs/{run_id}/default-queue
```

11. Align eval-loop mutation semantics around active vs archived steps before hardening remove/prune behavior.
