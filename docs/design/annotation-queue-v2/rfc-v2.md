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
- Full CRUD API at `/evaluations/queues/`
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

1. User selects traces in observability view, clicks "Send to annotation queue"
2. User chooses an **existing annotation queue** or **creates a new one**:
   - If creating new: configures annotation labels (e.g., "correctness", "quality 1-5"), assigns annotators, sets repeats per item
   - Behind the scenes, an evaluator is auto-created from the label definitions (see [Key Design Decision #2](#2-evaluators-are-the-annotation-schema))
3. **Convenience API** auto-creates the backing infrastructure:
   - An EvaluationRun with `flags.has_human = true`
   - One EvaluationScenario per selected trace, with the trace's `trace_id` stored as the invocation reference in the scenario (no separate invocation step needed)
   - An EvaluationQueue linked to the run, with user assignments if specified
4. Annotator opens their annotation queues page → sees assigned queues → opens one → works through traces → annotates → submits
5. On submit:
   - `POST /annotations/` creates the annotation OTel span (same as today)
   - `PATCH /evaluations/results/` links the annotation `trace_id` to the step result (same as today)
   - The annotation is also visible on the trace span in observability (existing write-through via OTel links)

6. **Deletion:** When the user deletes an annotation queue, the convenience API cleans up the backing infrastructure — deletes the EvaluationQueue, associated EvaluationScenarios/Results, and the EvaluationRun (but NOT the annotations themselves, which are immutable OTel spans).

**Frontend: tracking progress and status.** The FE discovers status per item and overall progress through:
- **Per-item status:** Each `EvaluationResult` for a human annotation step has a `status` field (PENDING, COMPLETED, FAILURE). When the annotator submits, the result is updated to COMPLETED and gets a `trace_id` linking to the annotation OTel span. The FE queries results for the queue's scenarios to determine which items are done vs open.
- **Overall progress:** Count of COMPLETED results vs total scenarios × annotation steps. The convenience API can expose this as `GET /annotation-queues/{queue_id}` returning `{completed: N, total: M}`.
- **Editing after completion:** Yes — the annotator can re-submit an annotation for a completed item. This creates a new annotation OTel span (annotations are append-only traces) and updates the `EvaluationResult.trace_id` to point to the latest annotation. The previous annotation span is preserved in the tracing store.

**Key design choice: evaluations without inputs.** The run has no input steps. The trace being annotated is referenced as the invocation in the scenario. This requires backend support for runs where only invocation references exist (no testset inputs). See [Appendix A](#appendix-a-evaluations-without-inputs--technical-analysis) for a detailed technical analysis of what needs to change.

### Use Case 2: Annotate Test Set Rows

**User intent:** "I have a test set. I want experts to label each row with expected outputs and quality ratings."

**What happens behind the scenes:**

1. User opens a test set, clicks "Annotate" (or "Send to annotation queue")
2. User specifies **what labels they want** — not evaluators. The UI presents a simple form:
   - "What do you want annotators to provide?" → e.g., "Expected answer (text), Difficulty (1-5), Is correct? (yes/no)"
   - We offer defaults: `correct_answer`, `quality_rating`, `judge_guidelines`
   - Behind the scenes: the FE/BE auto-creates a human evaluator with a JSON schema matching these label definitions (see [Key Design Decision #2](#2-evaluators-are-the-annotation-schema))
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
2. **The evaluation orchestrator** executes auto evaluators immediately (existing flow)
3. For human evaluator steps, the orchestrator **skips invocation** (checks `step.origin == "human"`), seeds results as PENDING, and auto-creates an EvaluationQueue for the human steps
4. Annotators open the Annotation Queues page → see the queue for this eval run → work through scenarios → submit annotations
5. Human annotations appear alongside auto scores in the same eval run results view

**Current state (broken):** Today, the orchestrator does NOT check `is_human` — it tries to invoke human evaluators, which fail with `InvalidInterfaceURIV0Error`. Human steps are recorded as FAILURE. No queue is created. This is a **required fix** regardless of annotation queues.

**Who creates the queue:** The evaluation orchestrator itself. After processing all steps, it detects `has_human` steps and creates the EvaluationQueue as part of the run lifecycle. The convenience API is NOT involved in this case — the orchestrator handles it natively. This is the cleanest approach because:
- The orchestrator already knows which steps are human and which scenarios exist
- No need for the convenience API to "wait" for the orchestrator to finish before creating a queue
- Follows the pattern of the online eval flow, which also creates infrastructure as part of its execution

**Discoverability:** The eval run detail view should show a prominent banner when human annotation is pending: "This evaluation has X human annotation tasks. [Go to annotation queue]". The Annotation Queues page also shows this queue with the eval run name as context.

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
POST /annotation-queues/
{
  "name": "Q1 Trace Review",
  "description": "Review flagged production traces",

  // What to annotate — defined as labels, not evaluators
  "labels": [
    {"name": "correctness", "type": "boolean"},
    {"name": "quality", "type": "rating", "min": 1, "max": 5},
    {"name": "notes", "type": "text"}
  ],
  // OR reference existing evaluators
  "evaluator_slugs": ["quality-rating", "safety-flag"],

  // Source type: "traces" or "testset"
  "source": {
    "type": "traces",
    "trace_ids": ["abc123", "def456"]  // optional: initial items
    // OR
    "type": "testset",
    "testset_revision_id": "uuid"
  },

  // Optional: who should annotate
  "assignees": ["user-id-1", "user-id-2"],

  // Optional: how many annotators per item
  "repeats": 1
}
```

**Note:** `eval_run` is NOT a source type here. For eval runs with human evaluators, the evaluation orchestrator creates the queue directly (see Use Case 3). The convenience API only handles the two cases where the user explicitly creates a queue: from traces or from a test set.

**Behind the scenes:**
1. If `labels` provided: auto-creates a human evaluator with a JSON schema matching the label definitions
2. Creates EvaluationRun with `flags: {has_human: true}` and annotation steps per evaluator
3. Creates EvaluationScenarios from the source items (one per trace_id or per test case)
4. Creates EvaluationQueue with user assignment if `assignees` provided

**Returns:** Queue ID + summary (item count, label names, assignees)

### Add Items to Queue

```
POST /annotation-queues/{queue_id}/items
{
  // For trace-sourced queues:
  "trace_ids": ["new-trace-1", "new-trace-2"]

  // For testset-sourced queues:
  // "testcase_ids": ["tc-1", "tc-2"]  // adds specific test cases
  // OR omit to add all test cases from a new revision
}
```

Adds new scenarios to the underlying evaluation run. Validates that the item type matches the queue's source type (can't add traces to a testset-sourced queue).

### List Queues (for current user)

```
GET /annotation-queues/?user_id={user_id}
```

Returns all queues where the user is an assignee. Each queue includes:
- Queue info (name, labels, source type)
- Progress (completed / total items)
- Status (active / completed)

### Get Queue Detail + Items

```
GET /annotation-queues/{queue_id}?user_id={user_id}
```

Returns queue metadata + the user's assigned items with their annotation status. Internally calls `filter_scenario_ids()` to scope to the user's partition.

### Submit Annotation

Uses existing endpoints — no change needed:
- `POST /annotations/` to create the annotation
- `PATCH /evaluations/results/` to link it to the step result

### Write Back / Save as Test Set

```
POST /annotation-queues/{queue_id}/export
{
  // For testset-sourced queues: create new revision with annotation columns
  "target": "testset_revision",
  "column_mapping": {
    "correctness": "is_correct",
    "quality": "quality_score"
  }

  // For trace-sourced queues: create new test set from annotated traces
  // "target": "new_testset",
  // "name": "Curated Q1 traces",
  // "include_annotations_as_columns": true
}
```

The endpoint name is `export` rather than `write-back` to better reflect that it works for both directions: writing annotations back to an existing test set (new revision) or creating an entirely new test set from annotated traces.

**Who triggers this:** The queue creator/admin, not individual annotators. It's a one-time action available on the queue detail page.

---

## UI Design Direction

### Annotation Queue Page (primary)

A dedicated **Annotation Queues** page in the sidebar navigation. This is the main entry point for annotation work.

**Queue list view:** Shows all queues the user has access to (see wireframe in Annotation Queues Page section above).

**Queue detail / annotation view:** When the user clicks "Open" on a queue, they enter the **annotation view**. This view is **the same regardless of source type** (traces, testset, or eval run). It is an extension of the existing annotation drawer/eval table, adapted to show:

- A table of items to annotate (traces or test cases)
- For each item: the data to review (inputs, outputs, trace details) and annotation form fields
- Progress indicator (X/Y completed for this user)
- Navigation (prev/next item, skip)
- The annotation form is driven by the evaluator's JSON schema (same as the existing annotation drawer)

The key principle: **one annotation view, multiple data types**. The view renders trace data and testcase data uniformly — both have inputs and outputs that can be displayed in a standard layout. The annotation form on the side is always the same.

### Frontend interaction per use case

**Observability (traces):**
- User selects traces → clicks "Send to annotation queue" → modal to configure or select existing queue
- FE calls `POST /annotation-queues/` with `source.type = "traces"` and selected trace_ids
- Annotator sees this queue on the Annotation Queues page, clicks Open → annotation view shows trace data

**Test set view:**
- User opens test set → clicks "Send to annotation queue" → modal to configure labels and assignees
- FE calls `POST /annotation-queues/` with `source.type = "testset"` and testset_revision_id
- Annotator sees this queue on the Annotation Queues page, clicks Open → annotation view shows testcase data
- On completion: queue admin clicks "Export to test set" → creates new revision with annotation columns

**Eval run details:**
- User creates eval run with human evaluators (existing flow)
- Orchestrator auto-creates EvaluationQueue for human steps
- Eval run detail view shows banner: "This evaluation has human annotation tasks. [Go to annotation queue]"
- Annotator sees this queue on the Annotation Queues page, clicks Open → annotation view shows scenario data (same as eval run table rows)
- Human results appear alongside auto results in the eval run detail table

### Annotation Mode (orthogonal — future / separate concern)

> **Note:** An "annotation mode" view swap (e.g., toggling traces table into an annotation interface for the current user) is orthogonal to annotation queues. It is local/stateless and does not require queue infrastructure. This could be built independently as a lightweight feature — essentially the existing annotation drawer expanded to inline mode. It is out of scope for this RFC but could be built in parallel.

### Annotation Queues Page

A dedicated page listing all annotation queues the current user is assigned to. This is a first-class page in the sidebar navigation (under Evaluations or as a top-level item).

```
┌─────────────────────────────────────────────────────────────────────┐
│  ANNOTATION QUEUES                                                   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Q1 Trace Review          12/15 done  │  Assigned to: me    │    │
│  │  Labels: correctness, safety                                │    │
│  │  Source: traces                                             │    │
│  │  [Open]                                                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Test Set Labeling         23/45 done │  Assigned to: me    │    │
│  │  Labels: expected_answer, difficulty                        │    │
│  │  Source: testset                                            │    │
│  │  [Open]                                                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Sprint 12 Human Eval      42/50 done │  Assigned to: me   │    │
│  │  Labels: quality-rating                                     │    │
│  │  Source: eval run                                           │    │
│  │  [Open]                                                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**v1**: Shows queues assigned to the current user. Each queue shows name, progress (X/Y done), labels being collected, and source type. "Open" navigates to the annotation view for that queue.

**v2 (future)**: A global inbox that aggregates pending items across all queues into a flat task list, with cross-queue prioritization and filtering.

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

- New convenience endpoints (`/annotation-queues/`)
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

---

## Appendix A: Evaluations Without Inputs — Technical Analysis

This section documents what needs to change in the backend to support evaluation runs where scenarios only have a `trace_id` reference but no input steps (no testset, no query).

### Current state

The data model is already flexible enough:
- `EvaluationScenario` has no `inputs` field — it's a grouping entity. Actual data lives on `EvaluationResult` rows.
- `EvaluationResult.testcase_id` is already `Optional[UUID]` (nullable in DB).
- `EvaluationResult.trace_id` is already `Optional[str]` (nullable in DB).
- `EvaluationRunData.steps` accepts only invocation + annotation steps (no requirement for input steps at the DTO level).

### What blocks it today

1. **Start gate in `SimpleEvaluationsService.start()`** (`api/oss/src/core/evaluations/service.py`, ~line 1885): The batch dispatch branch requires `_evaluation.data.query_steps or _evaluation.data.testset_steps`. Without either, the run is never dispatched to a worker.

2. **Batch worker assumes testsets** (`api/oss/src/core/evaluations/tasks/legacy.py`, ~line 720): `evaluate_batch_testset` extracts `testset_revision_id` from input steps and would crash (TypeError) if none exist. Scenario count = testcase count.

3. **No trace-only worker**: Neither the batch nor live worker handles the case of "here are N trace_ids, create one scenario per trace and run annotation steps."

### What needs to change

| # | Component | Severity | Description |
|---|-----------|----------|-------------|
| 1 | `start()` gate | **BLOCKING** | Add branch for trace-only runs (no query/testset steps, but has annotation steps + pre-provided trace_ids) |
| 2 | New `SimpleEvaluationData` field | **BLOCKING** | Add `trace_ids: Optional[List[str]]` to carry the list of traces to annotate |
| 3 | New worker task | **BLOCKING** | Implement `evaluate_trace_batch` — creates scenarios from trace_ids, fetches traces, runs human annotation steps |
| 4 | Run data builder | MEDIUM | Handle annotation step `inputs` when no input steps exist (reference only `__all_invocations__`) |
| 5 | Worker registration | MEDIUM | Register new task in Taskiq worker |
| 6 | Run flags | LOW | Optionally add `has_traces` flag to `EvaluationRunFlags` |
| 7 | DB schema | NONE | No migrations needed — all fields already nullable |

### Recommended approach

Model the new worker after the **live evaluation flow** (`evaluate_live_query` in `live.py`) which already:
- Creates scenarios from traces (not testcases)
- Sets `testcase=None`, `inputs=None` for evaluator invocations
- Falls back to trace root span attributes for inputs/outputs

The key difference: instead of running a tracing query to discover traces, the new worker accepts a pre-provided list of `trace_ids`. This is essentially a simplified version of the live worker without the query/scheduling machinery.

### Estimate

~2-3 days of backend work for a senior developer familiar with the evaluation subsystem. The new worker is a hybrid of existing patterns, not a greenfield implementation.

---

## Appendix B: Annotation View — Current State vs Proposed Changes

This section documents how the annotation view works TODAY in the frontend, and what needs to change to support annotation queues.

### How it works today

There are **two separate annotation contexts** in the current frontend:

#### Context 1: Trace Drawer (ad-hoc annotation)

- **Where:** Observability/Traces pages. User clicks an "Annotate" button on a trace span.
- **Component:** `AnnotateDrawer` (`web/oss/src/components/SharedDrawers/AnnotateDrawer/`)
- **What it shows:** A 400px side drawer with ONLY the annotation form. No trace inputs/outputs are shown in the drawer — the user sees them in the trace detail behind the drawer.
- **Evaluator source:** User selects from ALL human evaluators via a multi-step wizard (Annotate → Select Evaluators → Create Evaluator). Selection persisted in localStorage.
- **Annotation kind:** `adhoc` (origin: human, channel: web)
- **API calls:** `POST /annotations/` to create, `PATCH /annotations/{traceId}/{spanId}` to update
- **State:** SWR for fetching, local React state for form values
- **No assignment, no queue, no progress tracking**

#### Context 2: Eval Run Detail (evaluation annotation)

This has **two sub-views:**

**2a. Table view ("Scenarios" tab):**
- **Where:** Eval run detail page, scenarios table
- **Component:** `EvalRunDetailsTable` → `ActionCell` → `VirtualizedScenarioTableAnnotateDrawer`
- **What it shows:** The eval table shows all scenarios with columns for inputs, outputs, and evaluator results. Clicking "Annotate" on a row opens a side drawer with ONLY the annotation form (no inputs/outputs in the drawer).
- **Evaluator source:** Auto-determined from the run's configured evaluators (no selection UI)
- **Save behavior:** Creates annotation + upserts step result + upserts scenario metrics + updates scenario/run status
- **State:** Jotai atoms (`virtualScenarioTableAnnotateDrawerAtom`, `scenarioAnnotationsQueryAtomFamily`)

**2b. Focus view ("Annotate" tab):**
- **Where:** Eval run detail page, "Annotate" tab (default for human eval runs)
- **Component:** `SingleScenarioViewerPOC` → `ScenarioAnnotationPanel`
- **What it shows:** Full-page layout with:
  - Left side (7/12 width): Input card (testcase data) + Output card (invocation result + trace link)
  - Right side (5/12 width): Sticky annotation panel with evaluator metric forms
- **Navigation:** `ScenarioNavigator` with prev/next arrows + dropdown. Iterates ALL scenarios.
- **Auto-run:** If invocation not yet run, auto-triggers it when the scenario is opened
- **Annotation form:** Collapsible panels per evaluator. Supports: number/slider, boolean (True/False radio), text, multi-select tags (array with enum), single-select dropdown (anyOf).
- **JSON schema source:** `evaluator.data.service.format.properties.outputs.properties` or `evaluator.data.schemas.outputs`
- **State:** React hooks (`useAnnotationState`) for form values, Jotai atoms as backup

### What does NOT exist today

| Feature | Status |
|---------|--------|
| Assignment (show only items assigned to current user) | **Does not exist.** No FE code calls EvaluationQueue endpoints. All scenarios shown to all users. |
| Progress tracking (X/Y completed) | **Does not exist.** No progress bar or completion counter anywhere. |
| Trace data in annotation view | **Partial.** Focus view shows inputs+outputs but not full trace tree. Table drawer shows nothing. |
| Queue-based navigation | **Does not exist.** ScenarioNavigator iterates ALL scenarios, not assigned ones. |
| Auto-advance after annotation | **Does not exist.** User stays on same scenario after save. |
| Unified view for traces + testcases | **Does not exist.** Trace drawer and eval run views are completely separate code paths. |

### What needs to change

The **Focus View** (`SingleScenarioViewerPOC` + `ScenarioAnnotationPanel`) is the closest to what we need. It already shows inputs + outputs + annotation form in a single layout. The annotation queue view should be built as an evolution of this component.

#### 1. New "Annotation Queue View" page component

Create a new page at the annotation queue route that wraps the focus view pattern:
- Fetches queue metadata (name, labels, source type, progress)
- Fetches assigned scenario IDs from `EvaluationQueue` API (new FE service needed)
- Renders items using the focus view layout (inputs/outputs on left, annotation form on right)
- Adapts data rendering based on source type:
  - **Traces:** Fetch trace span data, show inputs/outputs from trace root span attributes
  - **Testcases:** Show testcase data columns (same as current focus view)
  - **Eval run scenarios:** Show testcase inputs + invocation outputs (same as current focus view)

#### 2. Assignment filtering

- New atom: `assignedScenarioIdsAtom` — fetched from `GET /annotation-queues/{queue_id}?user_id=X`
- `ScenarioNavigator`: Filter `loadedScenarios` to only show assigned IDs
- `ActionCell` (if table view is used): Only show "Annotate" button for assigned scenarios

#### 3. Progress tracking

- Add progress bar to page header: `{completed}/{total} completed`
- Data source: convenience API returns `{completed, total}` on queue detail endpoint
- `ScenarioNavigator`: Show completion status per item (checkmark icon for completed scenarios)

#### 4. Navigation improvements

- **Auto-advance:** After saving annotation, auto-navigate to next unfinished item
- **Keyboard shortcuts:** Add `Cmd+ArrowLeft/Right` for prev/next (focus view already has `Cmd+Enter` for run)
- **Skip button:** Allow annotator to skip an item and come back later

#### 5. Trace data rendering

- For trace-sourced queues: Fetch trace data via tracing API, extract `ag.data.inputs` and `ag.data.outputs` from root span
- Render using the same `ColumnValueView` components as the current focus view
- Include a "View full trace" link that opens the trace drawer

### Estimate

The annotation queue view is an evolution of the existing Focus View. Key work:
- New page route + queue list page: ~2 days
- Queue detail → annotation view (adapting Focus View): ~3 days
- Assignment integration (new API service + filtering): ~1 day
- Progress tracking: ~1 day
- Navigation improvements (auto-advance, keyboard): ~1 day
- **Total: ~8 days FE work**
