# Gap Analysis

## Queue Semantics

Missing from current state:

- no explicit meaning that `step_keys=None` is the open/default step scope
- current auto-created human queues snapshot human step keys instead of leaving step scope open
- no canonical default-queue marker distinct from arbitrary custom queues

Already present:

- `scenario_ids=None` already leaves scenario scope open over the run
- `user_ids=None` already means unassigned
- repeats are already run-owned rather than queue-owned

## Default Queue Lifecycle

Missing from current state:

- no default-queue reconciliation tied to run creation/editing
- current helper is path-dependent and only reached from selected execution flows
- no two-policy model separating:
  - human-step structural condition
  - unconditional default-queue global setting
- no logic to archive/unarchive the default queue as human evaluator availability changes

## Queue Archival

Missing from current state:

- no queue archive endpoint
- no queue unarchive endpoint
- no queue service/DAO archive lifecycle path
- no `include_archived` support on queue query/fetch surfaces
- default-queue lookup cannot currently search archived queues for restoration

Present but underused:

- queue DTOs already inherit lifecycle fields such as `deleted_at` and `deleted_by_id`

## Queue Identity

Missing from current state:

- no reliable way to distinguish the canonical default queue from a custom queue with the same open shape
- current ensure logic stops if any queue exists for the run, which is insufficient once default and custom queues coexist

## Run Semantics

Needs clarification or adjustment:

- `is_queue` currently distinguishes simple queue-created runs from simple evaluations
- linked default queues should not require ordinary evaluation runs to become queue-ingest runs
- the old meaning of `is_queue` must be replaced by persisted simple-queue eligibility

## Configuration

Missing from current state:

- no global policy toggle for unconditional default queues
- no shared policy helper for deciding default-queue lifecycle mode

## Tests

Missing from current state:

- open default queue behavior with `step_keys=None`
- default queue creation for simple evaluations under unconditional mode
- conditional creation when human evaluator steps exist
- no creation / archive when conditional mode has no active human evaluator steps
- unarchive of an existing archived default queue instead of duplicate creation
- coexistence of default and custom queues
- archived-inclusive queue query behavior
- regression tests for existing queue assignment and scenario selection behavior

## API Surface

Missing from current state:

- archive/unarchive queue endpoints
- `include_archived` request/query support for queues
- response behavior that lets callers distinguish active from archived queues where relevant

## UI Surface

Not covered by this backend design:

- whether auto-only evaluations show an empty queue
- whether users are nudged to add human evaluators
- how the default queue appears inside evaluation details versus Queues
- any migration of frontend terminology from “human evaluation” to “evaluation with human evaluators”
