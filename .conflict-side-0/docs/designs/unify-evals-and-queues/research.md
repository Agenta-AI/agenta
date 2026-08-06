# Research: Unifying Evaluations and Queues

## Scope

This note maps the evaluation/queue model that exists today and answers one concrete exploration question:

> What would it mean, in the current architecture, for a regular evaluation to always have a default linked queue that behaves like a simple queue when human evaluators are present?

The focus is backend behavior in:

- `api/oss/src/core/evaluations/*`
- `api/oss/src/apis/fastapi/evaluations/*`
- `api/oss/src/dbs/postgres/evaluations/*`
- the neighboring annotations layer where it clarifies the boundary

## Executive Summary

The system already has a single low-level evaluation substrate:

- an **evaluation run** defines the workflow graph and repeats
- **scenarios** are concrete work items within a run
- **results** are per-step, per-repeat outputs for a scenario
- **metrics** summarize results
- an **evaluation queue** is an overlay over a run that selects which scenarios and annotation steps are visible to which users

The split users see today is mostly created by wrapper layers:

- `SimpleEvaluationsService` wraps runs without queue-centric defaults
- `SimpleQueuesService` wraps runs plus a queue with queue-centric defaults

That means the proposed product direction is structurally plausible: it does **not** require inventing a new primitive. It mostly requires deciding what the canonical/default queue attached to a run means and when it should be created or updated.

The codebase is also already partway toward that direction:

- `EvaluationsService._ensure_human_annotation_queue(...)` creates a queue for a run with human annotation steps when none exists.
- Human-bearing live runs call this during refresh.
- Queue-backed batch dispatch paths call it before processing traces/testcases.

However, that helper currently creates a **narrow, snapshot-style** queue:

- only when human steps exist
- only if the run has no queue at all
- with `step_keys` captured from the run at that moment
- with no assignments
- with no explicit scenario restriction

It is a useful seam, but not yet the full default-queue model.

The sharper target model is simpler than the current helper:

- `scenario_ids=None` means all scenarios in the run
- `step_keys=None` means all steps included by the queue policy
- `user_ids=None` means unassigned
- repeats remain owned by the run, while assignments distribute scenario × repeat work

## Current Domain Model

### 1. Evaluation runs are the canonical execution object

`EvaluationRun` stores the durable definition of an evaluation:

- `data.steps`: input, invocation, and annotation steps
- `data.repeats`: repeat count for the run
- `data.mappings`: metric/result extraction mappings
- flags such as `is_live`, `is_queue`, `has_human`, `has_auto`, `has_testsets`, `has_queries`

A run is therefore already capable of representing:

- automatic-only evaluations
- human-only evaluations
- mixed human + automatic evaluations
- queue-backed and non-queue-backed flows

The evaluator origin is not a separate resource type. It is encoded on annotation steps as `origin in {custom, human, auto}`.

### 2. Queues are overlays over runs, not separate executions

`EvaluationQueue` points to a `run_id` and stores queue-specific selection/distribution state in `EvaluationQueueData`:

- `user_ids: List[List[UUID]] | None`
- `scenario_ids: List[UUID] | None`
- `step_keys: List[str] | None`
- optional batching controls

The queue does **not** own scenarios or results. It derives visible scenarios from the underlying run and optionally filters them.

This is important for the proposed default queue:

- if `scenario_ids is None`, the queue automatically covers **all current scenarios in the run**
- if `user_ids is None`, the queue is effectively **unassigned**
- if the queue has no user filter, the scenario query path returns the run scenarios directly

So the desired “default queue that follows future scenarios” already matches existing semantics **if** we leave `scenario_ids=None`.

### 3. Scenario assignment is derived, not persisted per scenario

Assignment behavior is computed from queue data at read time:

- no `user_ids` -> everyone sees the run’s scenarios
- with `user_ids` -> `filter_scenario_ids(...)` deterministically partitions scenarios per repeat/user lane
- sequential vs randomized distribution is controlled by queue flags/settings

That means the queue model already supports:

- no assignees
- assignees per repeat lane
- repeated review lanes
- deterministic re-computation as scenarios are added later

The subtle point is that **repeats live on the run**, while **assignment lanes live on the queue**. `SimpleQueuesService.create(...)` currently reconciles the two by setting run repeats to at least the number of assignment lanes.

## Current Public/Service Surfaces

### `SimpleEvaluationsService`

This is a convenience wrapper over runs. It builds run steps from query/testset/application/evaluator revision IDs and exposes CRUD/lifecycle operations as “simple evaluations.”

Notably:

- evaluator inputs can be lists or explicit origin maps
- run flags are inferred from step origins
- it is run-first, not queue-first

### `SimpleQueuesService`

This is a different convenience wrapper over the same substrate. It:

1. builds or reuses run data
2. creates a run with `is_queue=True`
3. creates one linked `EvaluationQueue`
4. stores queue-specific behavior such as assignments, step keys, and batching

It is effectively a preset constructor for “evaluation run + annotation queue.”

### Low-level evaluation endpoints

The main evaluations API exposes separate resources for:

- runs
- scenarios
- results
- metrics
- queues

This exposes the true underlying shape more directly than either simple wrapper.

### Annotations

The annotations module is adjacent but distinct. It creates/edit annotations as trace-linked artifacts and may provision evaluators, but it is not the queue abstraction itself. The queue system is still implemented in evaluations.

## How Simple Queues Work Today

A simple queue is not a separate backend domain. It is a prescribed composition:

1. Create an evaluation run whose input is either:
   - direct traces/testcases, or
   - source-backed queries/testsets
2. Add evaluator annotation steps.
3. Create one queue against that run.
4. Store only the annotation `step_keys` in the queue.
5. Optionally store assignments and batching settings.

The queue then queries scenarios by:

- starting from scenarios belonging to the run
- optionally applying `queue.data.scenario_ids`
- optionally applying user/repeat distribution

That is why a queue with:

- `scenario_ids=None`
- `step_keys=None`
- `user_ids=None`

is the natural shape of the default queue.

These are three independent axes:

- scenario selection decides which scenarios are in the queue
- repeat assignment decides which scenario × repeat lanes a user gets
- step selection decides which steps must be completed for each assigned scenario × repeat

`step_keys` do not participate in scenario or repeat selection, and they do not need to. Leaving them open is still the correct queue-level analogue of leaving `scenario_ids` open.

## The Existing Proto-Unification Seam

`EvaluationsService._ensure_human_annotation_queue(...)` currently does this:

1. inspect run steps
2. collect human annotation step keys
3. if there are no human steps, do nothing
4. if any queue already exists for the run, do nothing
5. otherwise create an `EvaluationQueue` with:
   - `run_id=run.id`
   - `status=RUNNING`
   - `step_keys=<human annotation step keys>`
   - no assignments
   - no explicit scenario IDs

This already gives the queue open scenario coverage and no default assignments, but it freezes step membership instead of leaving the queue open over the run’s steps.

Today it is invoked from:

- live run refresh before dispatch
- queue-backed trace/testcase batch evaluation dispatch

That tells us two things:

1. The architecture already treats queues as a natural companion to human annotation work.
2. The current behavior is still opportunistic and path-dependent, not a universal invariant of evaluation creation/editing.

## What the Desired Default Queue Maps To in Current Terms

| Desired behavior | Current primitive that already supports it |
|---|---|
| Queue linked to an evaluation | `EvaluationQueue.run_id` |
| No scenario selection; include all current/future scenarios | `queue.data.scenario_ids = None` |
| No assigned users by default | `queue.data.user_ids = None` |
| Cover all repeats | run-level `data.repeats`; queue assignment lanes can be absent |
| Step scope is not frozen | `queue.data.step_keys = None` |
| New scenarios added later become visible | queue scenario lookup derives from `run_id`, not a frozen list |

So the cleanest first interpretation of a **default queue** is:

```text
one canonical queue per evaluation run,
with no scenario restriction,
no step-key restriction,
and no assignees.
```

## Default Queue Policy

The target model has two separate policies.

### Structural policy

This is the run-level condition:

```text
has_human_evaluator_steps(run)
```

When default queues are conditional, this decides whether a run should currently have one.

### Global lifecycle policy

This is a configuration choice, for example:

```text
EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS
```

When enabled:

- create a default queue for every run
- never archive it merely because the run has no active human evaluators

When disabled:

- create or unarchive the default queue when the run has human evaluator steps
- archive the default queue when the run has no active human evaluator steps

These policies are related but not interchangeable. The global setting defines whether default queues are unconditional. The structural rule only governs lifecycle when default queues are conditional.

## Default Queue Lifecycle

The desired queue identity is durable:

- if the default queue does not exist and policy requires one, create it
- if it exists and is archived, unarchive it
- if it exists and is active, leave it alone
- if policy no longer requires it, archive it rather than hard-delete it

This fits the broader evaluator model if evaluators are archived rather than removed. A queue can disappear from normal views while retaining identity and later return if human evaluator work becomes active again.

The current queue API is not yet aligned with that lifecycle:

- queues have lifecycle fields
- queue endpoints currently expose hard deletion
- queue queries do not yet expose `include_archived`
- queue lookup does not currently distinguish active from archived queues

If default queues become durable linked objects, queue archive/unarchive operations and archived-aware lookup become part of the needed foundation.

## Remaining Model Gaps

### 1. `step_keys` are currently stored as a snapshot

The current helper captures the human step keys that exist at creation time. The default queue should instead leave step scope open with `step_keys=None`, so later step changes do not require queue rewrites.

### 2. There is no first-class distinction between default and custom queues

Currently, a queue is just a queue. `_ensure_human_annotation_queue(...)` only checks whether **any** queue exists for the run.

That creates ambiguity:

- if a custom filtered queue exists, should it suppress creation of the evaluation’s default queue?
- if multiple queues exist, which one is the queue shown inside the evaluation?
- which archived queue should be restored when the default-queue invariant becomes true again?

A stable default-queue marker or equivalent canonical linkage is needed once default queues and custom queues can coexist.

### 3. `is_queue` still encodes a product distinction on the run

Simple queues create runs with `is_queue=True`; simple evaluations generally do not. This flag is used for querying and queue-specific dispatch guards.

If ordinary evaluations can have linked queues, `is_queue` should remain a technical execution flag rather than the signal that a run has a queue companion.

### 4. Queue lifecycle is currently path-dependent

Today automatic queue creation is reached from execution paths, not from the run mutation paths that define whether human work exists.

Default-queue reconciliation belongs next to run creation/editing so it can enforce either:

- unconditional queue existence, or
- conditional existence based on active human evaluator steps.

## Multiple Human Evaluators, Assignments, and Repeats

### Multiple human evaluators

The run model supports many human evaluator steps already. A queue can target multiple annotation steps through `step_keys`.

So there is no fundamental blocker to one default queue covering multiple human evaluators. The real question is product semantics:

- should one task card represent one scenario with multiple human fields?
- or one scenario × evaluator step as separate queue work?

The current queue primitive points at multiple step keys but scenario listing is scenario-oriented, not step-oriented. That suggests today’s model is closer to “one scenario can carry several annotation steps” than “each evaluator creates a separate queue item.”

### Assignments

The queue model already supports repeat-lane assignments:

```text
user_ids = [[repeat_0 users], [repeat_1 users], ...]
```

A default queue with `user_ids=None` naturally means “unassigned.”

What still needs product clarification is how assignment should behave when:

- the evaluation repeat count increases later
- a human evaluator is added after assignments exist
- different human evaluators should have different assignee pools

The current queue data model has one assignment matrix for the whole queue, not per evaluator step. If evaluators need separate assignment rules, one shared default queue may be insufficient or the model must evolve.

### Repeats

Repeats are owned by `EvaluationRunData.repeats`, not by the queue. Simple queue creation enforces:

```text
run.repeats >= number of assignment lanes
```

That is compatible with a default queue that “covers all existing repeats,” provided the queue derives from the run rather than freezing repeat-specific scope.

The open design question is what happens if repeats are later edited downward/upward after a queue already has assignments. The current storage model permits temporary mismatch.

## Likely Design Direction

### Recommended conceptual model

Treat the queue as a **view/controller over human annotation work for an evaluation run**, not as a sibling product object that users must create manually.

A practical backend direction would be:

1. Every evaluation run may have one **canonical/default queue**.
2. The default queue is created automatically when the run first contains human annotation steps.
3. The default queue has:
   - no scenario filter
   - no assignments
   - derived human-step membership, or managed synchronization
4. Additional custom queues may still exist for advanced filtered/assigned workflows.
5. The evaluation API should expose the canonical queue link directly so the UI can render the same queue both inside the evaluation and on the Queues surface.

### Why this fits the current code well

It reuses what already exists:

- run/scenario/result storage
- evaluation queue storage
- scenario derivation by `run_id`
- assignment logic by repeat lane
- the already-present `_ensure_human_annotation_queue(...)` seam

The largest required addition is not storage volume; it is **semantics**:

- how to mark the canonical queue
- how default queue step membership stays current
- where invariant enforcement lives

## Concrete Gaps to Resolve Before Implementation

### Product/behavior questions

1. Is the default queue only for **human** steps, or for all annotation steps?
   - The current helper chooses human-only.
   - The product statement sounds human-focused.

2. With multiple human evaluators, is assignment shared across them or evaluator-specific?
   - Current queue data supports shared assignment only.

3. When a run already has a custom queue, should the default queue still exist?
   - Current helper says no because it stops if *any* queue exists.

4. If human evaluators are removed, should the default queue remain, archive, or disappear?

5. Should all evaluation runs have a default queue immediately, or only runs with human work?
   - The latter better matches current semantics and avoids empty queues for automatic-only runs.

### Technical questions

1. Should default queue membership be derived with `step_keys=None`, or synchronized explicitly?
2. How is “default queue” represented?
3. Should queue creation/update happen in service-layer run mutation methods rather than dispatch flows?
4. Does `is_queue` remain meaningful once ordinary evaluations can have linked queues?
5. What migration/backfill is needed for existing runs with human steps but no queue?

## Candidate Implementation Shapes

### Option A — Minimal evolution

Keep explicit `step_keys`, add a default queue marker, and update `_ensure_human_annotation_queue(...)` plus run-edit paths to keep the default queue synced.

**Pros**

- smallest delta from current code
- easiest to reason about with existing queue reads
- preserves explicit custom queue semantics

**Cons**

- sync bugs remain possible
- every run edit touching human steps must remember to update the queue

### Option B — Derived default queues

Define `step_keys=None` on a default queue as “all current human annotation steps for this run.” Custom queues continue to use explicit step keys.

**Pros**

- best match for “follows the evaluation as it changes”
- new human evaluators appear automatically
- fewer synchronization paths

**Cons**

- requires read-time logic to distinguish default/derived queues from unconstrained queues
- needs crisp semantics for historical behavior and custom queues

### Option C — No persisted default queue; virtualize it

Do not persist a canonical queue. Derive one virtually from the run whenever human steps exist.

**Pros**

- no sync issue
- cleanest conceptual model

**Cons**

- weaker fit with “visible in Queues” unless the Queues API/UI also supports virtual resources
- assignments and future edits become awkward because there is no row to mutate

**Current recommendation:** Option B looks like the strongest long-term fit, with Option A as the lower-risk incremental step if we want a small migration first.

## Key References

- `api/oss/src/core/evaluations/types.py`
  - `EvaluationRun*`
  - `EvaluationQueue*`
  - `SimpleEvaluation*`
  - `SimpleQueue*`
- `api/oss/src/core/evaluations/service.py`
  - `EvaluationsService._ensure_human_annotation_queue(...)`
  - `EvaluationsService.fetch_queue_scenarios(...)`
  - `SimpleEvaluationsService`
  - `SimpleQueuesService`
- `api/oss/src/core/evaluations/utils.py`
  - `filter_scenario_ids(...)`
- `api/oss/src/dbs/postgres/evaluations/dao.py`
  - queue CRUD and user filtering
- `api/oss/src/apis/fastapi/evaluations/router.py`
  - low-level evaluation endpoints
  - simple evaluation endpoints
  - simple queue endpoints
- `api/oss/src/core/annotations/service.py`
  - neighboring annotation abstraction, distinct from queueing

## Bottom Line

The backend already has the right primitive split for unification:

- **evaluation run** = what is being evaluated
- **queue** = how human annotation work over that run is exposed/distributed

The exploration should therefore avoid introducing a new “human evaluation” abstraction. The more promising path is to make a linked default queue a first-class, automatically maintained aspect of evaluation runs that contain human steps, while keeping custom queues as an advanced overlay when users need narrower assignment or filtering behavior.
