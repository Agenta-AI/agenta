# RFC: Annotation Queues — Simplified Interface over Evaluation Entities

**Status**: Draft
**Date**: 2026-02-24
**Based on**: Sprint planning discussion (2026-02-24) and [Linear PRD](https://linear.app/agenta/document/prd-annotation-queues-b80788a78c9a)

## Summary

We build annotation queues on top of the existing `EvaluationRun` + `EvaluationQueue` entities. The entities themselves already support the three core use cases (annotating traces, annotating test sets, human evaluation in eval runs). The problem is the **consumer-facing interface**, not the underlying data model.

This RFC proposes a thin convenience layer — both API and UI — that hides evaluation run machinery from annotation consumers. Behind the scenes, creating an annotation queue auto-creates the evaluation run, scenarios, and queue. The annotator never sees or interacts with these intermediary entities.

## Context

### What already exists

The backend has a complete `EvaluationQueue` implementation:

- `EvaluationQueue` entity with assignment algorithm (block-based, deterministic)
- Full CRUD API at `/preview/evaluations/queues/`
- Per-repeat assignment via `data.user_ids`
- Scenario partitioning via `filter_scenario_ids()`
- Stateless dispatch (same inputs → same assignment)

See [research.md](./research.md) and [research-human-eval-implementation.md](./research-human-eval-implementation.md) for full analysis.

### What's wrong today

The entities work, but the interface is messy:

1. To annotate traces, you must create a dummy evaluation run (no evaluators, no app), create scenarios for each trace, then create a queue linked to the run. The evaluation run is a meaningless intermediary.

2. To annotate test set rows, you must create an evaluation run from the test set, seed scenarios and results, then annotate through the eval table. The annotations live in `evaluation_results`, disconnected from the test set.

3. The frontend **does not call the queue endpoints at all**. Any annotator can annotate any scenario. There is no assignment, no inbox, no task status.

### What we decided

After evaluating multiple approaches (see [rfc.md](./rfc.md) for the original three options), the team aligned on:

> **The entities do everything we need. The problem is the interface. Fix the interface, not the entities.**

This means:
- No new domain entities (no `AnnotationTask` table)
- No metadata-on-traces approach (our query infrastructure isn't fast enough for this)
- Evaluation runs stay as the container — we just hide them behind a simpler API

---

## Approach

### Principle: Two layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  CONSUMER LAYER  (what users see)                                    │
│                                                                      │
│  "Annotation Queue"                                                  │
│  - Create from traces, test sets, or eval runs                       │
│  - Define what to annotate (evaluator schema)                        │
│  - Assign to people                                                  │
│  - Annotators see an inbox, work through items, submit               │
│  - Results write back to source                                      │
└──────────────────────────────────────────────────────────────────────┘
                              │
                    (auto-created, hidden)
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE LAYER  (existing entities)                           │
│                                                                      │
│  EvaluationRun  →  EvaluationScenario  →  EvaluationResult          │
│       ↕                                                              │
│  EvaluationQueue  (assignment, dispatch)                             │
│       ↕                                                              │
│  Annotation (OTel span, type=annotation)                             │
└──────────────────────────────────────────────────────────────────────┘
```

The consumer layer is a **convenience API** and a **set of UI views** that orchestrate the infrastructure layer. The consumer never constructs evaluation runs or scenarios by hand.

---

## Use Case Walkthroughs

### Use Case 1: Annotate Traces

**User intent:** "I have some traces from production. I want a domain expert to review them."

**What happens behind the scenes:**

1. User selects traces in observability view, clicks "Send to review"
2. User picks evaluators (what to annotate) and optionally assigns people
3. **Convenience API** auto-creates:
   - An EvaluationRun with `flags.is_annotation_only = true`
   - The run has no inputs (no testset, no query) — just annotation steps with `origin: "human"` for each evaluator
   - One EvaluationScenario per selected trace, with the trace's `trace_id` stored as the invocation reference in the scenario (no separate invocation step needed)
   - An EvaluationQueue linked to the run, with user assignments if specified
4. Annotator opens inbox → sees assigned traces → annotates → submits
5. On submit:
   - `POST /preview/annotations/` creates the annotation OTel span (same as today)
   - `PATCH /preview/evaluations/results/` links the annotation `trace_id` to the step result (same as today)
   - The annotation is also visible on the trace span in observability (existing write-through via OTel links)

**Key design choice: evaluations without inputs.** The run has no input steps. The trace being annotated is referenced as the invocation in the scenario. This requires backend support for runs where only invocation references exist (no testset inputs).

### Use Case 2: Annotate Test Set Rows

**User intent:** "I have a test set. I want experts to label each row with expected outputs and quality ratings."

**What happens behind the scenes:**

1. User opens a test set, clicks "Annotate" (or "Send to review")
2. User picks evaluators (what to annotate) — or defines them inline:
   - "What do you want to add?" → "Expected answer (text), Difficulty (1-5)"
   - Behind the scenes: a human evaluator is auto-created with a JSON schema matching these fields
3. **Convenience API** auto-creates:
   - An EvaluationRun linked to the test set revision, with annotation steps for each evaluator
   - One EvaluationScenario per test case row
   - An EvaluationQueue with optional user assignments
4. Annotator works through rows → fills in labels → submits
5. On submit: same annotation creation + result linking as today
6. **Write-back step** (separate action): User clicks "Save annotations to test set" → creates a new test set revision with annotation values as new columns

**Key design choice: annotating ≠ modifying the test set.** The annotation step creates annotation traces (OTel spans). These reference the test cases but don't modify them. Writing back to the test set is a separate, explicit action that creates a new revision. This preserves test case immutability and versioning.

**Constraint:** Test cases are immutable today — changing content creates new IDs, and changes only stick when attached to a revision. The write-back step must respect this by creating a new revision, not mutating existing test cases.

### Use Case 3: Human + Auto Evaluation in Eval Runs

**User intent:** "I want to evaluate my app with LLM-as-judge AND have a human review the results."

**What happens behind the scenes:**

1. User creates evaluation run with both auto and human evaluators (existing flow)
2. Auto evaluators execute immediately (existing flow)
3. Human evaluator steps → an EvaluationQueue is auto-created for the run
4. Annotators work through scenarios in the eval run detail table
5. Human annotations appear alongside auto scores in the same results view

**This is the case that works best today.** The main gap is that the frontend doesn't use the queue for assignment — any annotator can annotate anything. Wiring the queue to the frontend closes this gap.

**Future extension:** Run evaluation, see auto results, then send specific scenarios for re-annotation (e.g., the ones where auto and human disagreed). This is extending the queue to cover a subset of scenarios.

### Use Case 4: Programmatic Annotation

**User intent:** "My pipeline flags low-confidence outputs. I want to enqueue them for human review."

**What happens behind the scenes:**

1. Developer creates an annotation queue via API (convenience endpoint auto-creates the evaluation run)
2. Developer submits items by adding scenarios to the queue/run — each item is a scenario with the trace reference as the invocation
3. Annotators work through items in the UI
4. Developer retrieves results via API

This is essentially Use Case 1 but driven by API instead of UI.

---

## Convenience API Design

A thin layer over existing endpoints. Internally, each call orchestrates multiple existing operations.

### Create Annotation Queue

```
POST /preview/annotation-queues/
{
  "name": "Q1 Trace Review",
  "description": "Review flagged production traces",

  // What to annotate with
  "evaluators": [
    {"slug": "quality-rating"},        // existing evaluator
    {"slug": "safety-flag"}            // existing evaluator
  ],

  // Items to annotate (one of these)
  "source": {
    "type": "traces",                  // or "testset" or "eval_run"
    "trace_ids": ["abc123", "def456"]  // for traces
    // OR
    "testset_revision_id": "uuid"      // for test sets
    // OR
    "run_id": "uuid"                   // for eval runs
  },

  // Optional: who should annotate
  "assignees": ["user-id-1", "user-id-2"],

  // Optional: how many annotators per item
  "repeats": 1
}
```

**Behind the scenes:**
1. Creates EvaluationRun with `flags: {has_human: true, is_annotation_only: true}` and annotation steps per evaluator
2. Creates EvaluationScenarios from the source items
3. Creates EvaluationQueue with user assignment if `assignees` provided

**Returns:** Queue ID (which is also the queue's identifier for all subsequent operations)

### Add Items to Queue

```
POST /preview/annotation-queues/{queue_id}/items
{
  "trace_ids": ["new-trace-1", "new-trace-2"]
}
```

Adds new scenarios to the underlying evaluation run. The queue automatically includes them (if the queue is defined as "all scenarios in the run").

### Get Inbox (Assigned Items)

```
GET /preview/annotation-queues/inbox?user_id={user_id}
```

Queries all queues, runs `filter_scenario_ids()` for the user, and returns a flat list of items across all queues. Each item includes:
- Queue info (name, evaluators)
- Scenario data (the trace/testcase being annotated)
- Status (pending, completed by this user)

### Submit Annotation

Uses existing endpoints — no change needed:
- `POST /preview/annotations/` to create the annotation
- `PATCH /preview/evaluations/results/` to link it to the step result

### Write Back to Test Set

```
POST /preview/annotation-queues/{queue_id}/write-back
{
  "target": "testset",
  "columns": {
    "quality-rating.approved": "approved",
    "safety-flag.is_safe": "is_safe"
  }
}
```

Creates a new test set revision with annotation values as new columns.

---

## UI Design Direction

### Annotation Mode (View Swap)

Instead of a separate "annotation queue" page, the annotation experience lives **inside existing views**. The user switches to "annotation mode" on the current view:

**In observability (traces):**
- User filters traces as usual
- Clicks "Review mode" → the traces table transforms into an annotation interface
- Each row gets annotation widgets inline or a side panel
- User can also select traces and "Send to review" to create a queue for others

**In test set view:**
- User opens a test set
- Clicks "Annotate" → the table transforms into an annotation interface
- Each row gets inline annotation fields
- On completion, user can "Save to test set" (write-back as new revision)

**In eval run details:**
- Same as today but with actual assignment from the queue
- Annotator only sees their assigned scenarios

This approach avoids creating a separate "annotation queue" page. The queue is a background concept — the user works inside the views they already know.

### Inbox View

A single page where annotators see all their pending work across all queues:

```
┌─────────────────────────────────────────────────────────────────────┐
│  MY ANNOTATION INBOX                                                │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Q1 Trace Review          12 pending  │  3 completed        │   │
│  │  quality-rating, safety-flag                                │   │
│  │  [Open]                                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Test Set Labeling         45 pending  │  23 completed      │   │
│  │  expected-answer, difficulty                                │   │
│  │  [Open]                                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Sprint 12 Human Eval      8 pending  │  42 completed      │   │
│  │  quality-rating                                             │   │
│  │  [Open]                                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

Clicking "Open" navigates to the appropriate view (observability for trace queues, test set view for test set queues, eval run details for eval queues) in annotation mode, filtered to the user's assigned items.

---

## Key Design Decisions

### 1. Annotating ≠ Labeling

These are two distinct activities:

- **Annotating** = creating annotation traces (OTel spans with `type=annotation`). The source entity is not modified. This is what the annotation queue does.
- **Labeling / write-back** = modifying the test set to add columns from annotations. This creates a new test set revision. This is a separate, explicit action after annotation is complete.

Both activities need to exist. But they are separate in the data model and in the API, even if the product UX makes them feel seamless.

### 2. Evaluators ARE the annotation schema

Human evaluators already define what to annotate via their JSON schema in `data.service.format`. There is no need for a separate "annotation schema" concept. When the user says "I want to annotate with quality (1-5) and a text note," we create (or reuse) a human evaluator with that schema.

This means the evaluator picker in the annotation UI serves double duty: it defines both what metrics to collect and the annotation form layout.

### 3. No new domain entities

We do not create `AnnotationQueue`, `AnnotationTask`, or `AnnotationResult` tables. Everything uses:
- `evaluation_runs` (the container)
- `evaluation_scenarios` (the items)
- `evaluation_results` (the step results, linked to annotation traces)
- `evaluation_queues` (the assignment)
- Annotations stored as OTel spans (existing)

The convenience API is a stateless orchestration layer on top of these.

### 4. Evaluation runs without inputs

To support trace annotation, we need evaluation runs that have no input steps — only invocation references (the trace being annotated) and annotation steps. This is a minor backend extension.

### 5. Metadata-based approach rejected

The metadata-on-traces approach (tagging spans with review status) was considered but rejected because:
- Our Clickhouse-based tracing query infrastructure is not optimized for this kind of filtered-view pattern
- We would need to update spans on every status change (claim, complete, skip)
- Cross-entity inbox (spans + testcases in one view) requires merging multiple queries
- We already have evaluation entities that solve the assignment and dispatch problem

---

## Scope

### Must have (v1)

- Convenience API to create annotation queues from traces
- Convenience API to create annotation queues from test sets
- Automatic queue creation when eval run has human evaluators
- Inbox view showing pending work across queues
- Frontend wiring of existing `EvaluationQueue` assignment to the annotation UI
- Write-back from annotations to test set (as new revision)

### Should have

- "Annotation mode" view swap in observability and test set views
- Add items to existing queue (ongoing trace ingestion)
- Progress tracking (X of Y completed) per queue

### Out of scope

- Notifications (email, in-app)
- Multi-annotator agreement metrics
- Assignment to specific users from UI (use API for now)
- Programmatic API convenience layer (v1 can use existing evaluation endpoints directly)

---

## Open Questions

1. **Evaluations without inputs:** How much backend work is needed to support runs with no input steps? Are there assumptions in the scenario/result seeding that require inputs?

2. **Inbox location:** Where does the inbox live in the navigation? Sidebar item? Under evaluations? Standalone page?

3. **Queue visibility in eval runs:** When an eval run has human evaluators, is the auto-created queue visible in the eval run detail view? Or is it fully hidden?

4. **Write-back granularity:** When writing annotations back to a test set, does the user choose which annotation fields become columns? Or do all fields from all evaluators get written back?

5. **Queue lifecycle:** Do annotation queues have a lifecycle (draft → active → completed)? Or are they always active and implicitly complete when all items are annotated?

---

## Implementation Phases

### Phase 1: Wire the existing queue to the frontend

- Frontend calls `GET /queues/{id}/scenarios?user_id=X` to get assigned scenarios
- Annotator only sees their assigned items in eval run detail view
- No new API endpoints — just frontend wiring

### Phase 2: Convenience API + trace annotation

- New convenience endpoints (`/preview/annotation-queues/`)
- Support creating queues from traces
- "Send to review" button in observability view
- Inbox view

### Phase 3: Test set annotation + write-back

- Support creating queues from test sets
- Annotation mode in test set view
- Write-back to test set as new revision

### Phase 4: Polish

- Progress tracking
- View swap (annotation mode)
- Ongoing item ingestion
- UX refinements based on usage
