# Proposal

## Goal

Unify human evaluation and annotation queues at the backend model level by making the queue a default companion of evaluation runs rather than a separately created product concept.

This proposal covers API and service semantics only. Frontend behavior, copy, and product nudges can vary later without requiring a different backend model.

## Proposed Model

Keep the current evaluation substrate:

- runs define evaluation structure and repeats
- scenarios are concrete work items
- results are step × repeat outputs
- queues overlay a run to expose and distribute human work

Add one canonical **default queue** concept for evaluation runs.

A default queue has:

- `scenario_ids=None`
- `step_keys=None`
- `user_ids=None`
- no queue-specific batching restriction

Those open fields mean:

- all scenarios in the run are eligible
- all queue-relevant steps are eligible
- no users are assigned by default
- run repeats remain fully covered because repeats belong to the run

## Queue Axes

The queue has three independent axes:

| Axis | Governs |
|---|---|
| scenario selection | which scenarios belong to the queue |
| repeat assignment | which scenario × repeat lanes a user receives |
| step selection | which steps must be completed for each assigned scenario × repeat |

Default queues leave all three axes open except for the run boundary itself.

## Default Queue Policies

### Structural policy

The structural condition is simple:

```text
has_human_evaluator_steps(run)
```

This says whether a run warrants a default queue when queues are conditional.

### Global lifecycle policy

A configuration value controls whether default queues exist for all runs regardless of human steps, for example:

```text
EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS
```

When enabled:

- every run gets a default queue at creation
- the default queue is never archived merely because no active human evaluator steps remain

When disabled:

- a default queue exists only while active human evaluator steps exist
- adding/restoring human evaluator work creates or unarchives the default queue
- removing/archiving the last active human evaluator archives the default queue

## Default Queue Lifecycle

Default queue reconciliation should use durable identity:

- missing + required -> create
- archived + required -> unarchive
- active + required -> no-op
- active + not required -> archive

Default queues should not be hard-deleted as part of normal reconciliation.

## Queue Lifecycle Support

Queues should gain product-level soft-delete support:

- archive endpoint/service/DAO path
- unarchive endpoint/service/DAO path
- `include_archived` query support
- archived-inclusive lookup for default-queue reconciliation

Hard delete may remain available for existing low-level semantics, but default-queue lifecycle should use archive/unarchive.

## Canonical Queue Identity

The system needs a reliable way to identify the default queue independently of shape. A custom queue may coincidentally have no scenario filter, no step filter, and no assignments.

The proposal requires one of:

- an explicit queue role/flag such as `is_default`
- or another canonical linkage that uniquely identifies the default queue for a run

An explicit marker is the clearer fit.

## Service Placement

Default-queue reconciliation belongs with run creation and run mutation, not only dispatch flows.

The current `_ensure_human_annotation_queue(...)` seam should evolve into a more general lifecycle operation such as:

```text
reconcile_default_queue(run)
```

It should evaluate the global lifecycle policy and, when needed, the structural human-step policy.

## Compatibility

This proposal preserves:

- existing evaluation-run primitives
- existing custom queue behavior
- existing queue-backed execution paths
- hard-delete support where still needed

It changes the default composition:

- default queue existence becomes managed by run lifecycle
- open `step_keys` become a supported queue shape rather than a snapshot omission
- simple evaluations can participate in the same queue model as simple queues

## Product Boundary

The backend supports both product postures:

- default queues for every evaluation, including auto-only evaluations
- default queues only when human evaluator work exists

The frontend can later decide whether to expose empty queues, nudge users toward adding human evaluators, or hide queues until human work appears. The API does not need to change again for that choice.
