# Product Requirements: Annotation Queue v2

## Overview

A centralized queue where human evaluation tasks are collected and worked through. Today, human evaluation exists but is disconnected from the rest of the evaluation workflow. This redesign makes human annotation first-class.

## Vision

Annotators have a single inbox showing all their pending annotation work, regardless of source. They can claim items, complete annotations, and see their progress. Results flow back to the source entities automatically.

---

## Capabilities

### Capability 1: Annotate Test Sets

**Description**: Annotate test set rows directly (label, rate, correct, etc.)

**User Story**: As a data scientist, I want to add quality labels to my test set rows so that I can use them for fine-tuning or as ground truth for evaluations.

**Flow**:
1. User selects a test set (or test set revision)
2. User defines annotation schema (e.g., "quality" dropdown with options, "notes" text field)
3. User assigns annotators and creates the annotation queue
4. Annotators work through their assigned rows
5. Annotations are saved and can be exported or committed back to the test set as new columns

**Acceptance Criteria**:
- [ ] Can create annotation queue from test set UI
- [ ] Can define custom annotation schema per queue
- [ ] Annotations persist and are queryable
- [ ] Can export annotations as CSV/JSON
- [ ] Can commit annotations back to test set as new revision with added columns

---

### Capability 2: Human Evaluation in Eval Runs

**Description**: Select both automatic and human evaluators when creating an eval run. Automatic evaluators run immediately; human evaluators create tasks in the queue.

**User Story**: As an ML engineer, I want to combine automated metrics with human judgment in a single evaluation run so that I get comprehensive quality assessment.

**Flow**:
1. User creates evaluation run with mix of auto and human evaluators
2. Auto evaluators execute via workers (existing flow)
3. Human evaluator steps create annotation tasks in the queue
4. Annotators complete their assigned scenarios
5. Results appear in the evaluation run alongside auto results
6. User can also send existing evaluation runs for re-annotation

**Acceptance Criteria**:
- [ ] Can select human evaluators when creating eval run
- [ ] Human eval steps create queue tasks automatically
- [ ] Annotator results write to evaluation_results table
- [ ] Results visible in eval run details UI
- [ ] Can trigger re-annotation on completed runs

---

### Capability 3: Annotate Traces

**Description**: Send traces from observability to the annotation queue for human review.

**User Story**: As an ops engineer, I want to flag traces for human review so that my team can label edge cases, identify issues, and build training data from production traffic.

**Flow**:
1. User views traces in observability UI
2. User selects traces and sends them to annotation queue
3. User defines what to annotate (e.g., "response_quality", "safety_flag")
4. Annotators review traces and provide annotations
5. Annotations are stored and visible on the trace detail view
6. Can filter traces by annotation values

**Acceptance Criteria**:
- [ ] Can select traces and send to annotation queue
- [ ] Can define annotation schema for trace review
- [ ] Annotations stored on trace spans (as attributes or linked entity)
- [ ] Annotations visible in trace detail view
- [ ] Can filter/search traces by annotation values

---

### Capability 4: Programmatic Annotation

**Description**: Send items to the queue via API/SDK for human review.

**User Story**: As a developer, I want to programmatically submit items for human annotation so that I can integrate annotation workflows into my CI/CD or custom applications.

**Flow**:
1. Developer calls API/SDK to create annotation queue
2. Developer submits items (with data payload) to the queue
3. Annotators work through items in UI
4. Developer polls or receives webhook for completed annotations
5. Developer retrieves annotation results via API

**Acceptance Criteria**:
- [ ] SDK method to create annotation queue
- [ ] SDK method to submit items to queue
- [ ] SDK method to query annotation results
- [ ] Webhook support for annotation completion (stretch)
- [ ] Items can include arbitrary JSON data payload

---

## Annotation Schema

Each queue has an **annotation schema** that defines what annotators fill in. The schema should support:

| Field Type | Example Use Case |
|------------|------------------|
| Single select (enum) | Quality rating: Poor / Fair / Good / Excellent |
| Multi select | Tags: Hallucination, Off-topic, Harmful, Correct |
| Boolean | Is this response safe? Yes/No |
| Numeric (integer) | Rating 1-5 |
| Numeric (continuous) | Confidence score 0.0-1.0 |
| Text (short) | Brief note |
| Text (long) | Detailed feedback |
| JSON | Structured correction/rewrite |

Schema definition format should align with JSON Schema for consistency with existing evaluator output schemas.

---

## Task Assignment

### Assignment Strategies

| Strategy | Description |
|----------|-------------|
| Round-robin | Items distributed evenly across annotators |
| Manual | Admin assigns specific items to specific users |
| First-come | Annotators claim items from a shared pool |
| Load-balanced | Considers annotator workload/availability |

Initial implementation: **Round-robin** (current algorithm) + **First-come** (shared pool).

### Repeats / Multi-annotator

Some use cases require multiple annotators per item (inter-annotator agreement). Support configuring `repeats: N` where each item is annotated N times by different users.

---

## Task Lifecycle

```
┌─────────┐    claim     ┌─────────────┐    submit    ┌───────────┐
│ PENDING │ ───────────► │ IN_PROGRESS │ ───────────► │ COMPLETED │
└─────────┘              └─────────────┘              └───────────┘
     │                          │
     │         skip             │        timeout
     ▼                          ▼
┌─────────┐              ┌─────────────┐
│ SKIPPED │              │   EXPIRED   │ (returns to PENDING)
└─────────┘              └─────────────┘
```

- **PENDING**: Available to be claimed
- **IN_PROGRESS**: Claimed by an annotator, timer starts
- **COMPLETED**: Annotation submitted
- **SKIPPED**: Annotator explicitly skipped (optional, may reassign)
- **EXPIRED**: Claim timed out, returns to pool (configurable timeout)

---

## Queue Lifecycle

```
┌─────────┐    start    ┌────────┐   all done   ┌───────────┐
│  DRAFT  │ ──────────► │ ACTIVE │ ───────────► │ COMPLETED │
└─────────┘             └────────┘              └───────────┘
                             │
                             │   pause / cancel
                             ▼
                        ┌──────────┐
                        │ PAUSED / │
                        │ CANCELLED│
                        └──────────┘
```

- **DRAFT**: Queue created but not yet accepting work
- **ACTIVE**: Annotators can claim and complete tasks
- **PAUSED**: Temporarily stopped (no new claims)
- **COMPLETED**: All tasks done
- **CANCELLED**: Aborted, no further work

---

## Results Destination

Annotations should be stored canonically AND written back to source entities:

| Source Type | Canonical Storage | Write-back Target |
|-------------|-------------------|-------------------|
| Evaluation run | `evaluation_results` | Same (already canonical) |
| Traces | `annotation_results` (new) | Trace span attributes |
| Test set | `annotation_results` (new) | New test set revision (on commit) |
| API/custom | `annotation_results` (new) | None (API retrieval only) |

---

## UI Requirements

### Annotator Inbox View

- List of assigned tasks across all queues
- Filter by queue, status, source type
- Sort by date, priority
- Click to open annotation interface

### Annotation Interface

- Display source item (trace, test case, scenario data)
- Render annotation form based on schema
- Submit / Skip buttons
- Progress indicator (X of Y completed)
- Navigation (previous/next item)

### Queue Management View (Admin)

- List all queues in project
- Create new queue
- View queue status and progress
- Assign/reassign annotators
- Pause/resume/cancel queue

### Integration Points

- Traces list: "Send to annotation queue" action
- Test set view: "Create annotation queue" action
- Eval run creation: Human evaluator selection
- Eval run details: View human evaluation progress

---

## Permissions (EE)

| Permission | Description |
|------------|-------------|
| `view_annotation_queues` | View queues and tasks |
| `create_annotation_queues` | Create new queues |
| `manage_annotation_queues` | Edit, pause, cancel queues |
| `annotate` | Claim and complete annotation tasks |
| `view_annotation_results` | View annotation results |
| `export_annotations` | Export annotation data |

---

## API Surface (High-Level)

### Queues
- `POST /annotations/queues` - Create queue
- `GET /annotations/queues` - List queues
- `GET /annotations/queues/{id}` - Get queue details
- `PATCH /annotations/queues/{id}` - Update queue
- `DELETE /annotations/queues/{id}` - Delete queue
- `POST /annotations/queues/{id}/start` - Activate queue
- `POST /annotations/queues/{id}/pause` - Pause queue

### Tasks
- `POST /annotations/queues/{id}/tasks` - Add tasks to queue
- `GET /annotations/queues/{id}/tasks` - List tasks in queue
- `GET /annotations/tasks/inbox` - Get current user's assigned tasks
- `POST /annotations/tasks/{id}/claim` - Claim a task
- `POST /annotations/tasks/{id}/submit` - Submit annotation
- `POST /annotations/tasks/{id}/skip` - Skip task

### Results
- `GET /annotations/queues/{id}/results` - Get all results for queue
- `GET /annotations/results` - Query results across queues
- `POST /annotations/queues/{id}/export` - Export results

---

## Success Metrics

1. **Adoption**: Number of annotation queues created per month
2. **Throughput**: Average annotations completed per annotator per hour
3. **Completion rate**: % of queue tasks completed vs. created
4. **Time to completion**: Average time from queue creation to all tasks done
5. **Write-back success**: % of annotations successfully synced to source entities

---

## Open Questions

1. **Annotation conflict resolution**: If two annotators somehow annotate the same item, which wins?
2. **Partial annotations**: Can annotators save drafts, or must they submit complete annotations?
3. **Annotation versioning**: Can annotations be edited after submission? Audit trail?
4. **Real-time updates**: Should the inbox update in real-time as tasks are completed by others?
5. **Bulk operations**: Should annotators be able to bulk-annotate (apply same label to multiple items)?

---

## Out of Scope (v2)

- Annotation guidelines/instructions editor
- Inter-annotator agreement metrics and reports
- Annotation quality scoring (gold standard comparison)
- Complex routing rules (skills-based assignment)
- Mobile-optimized annotation interface
- Offline annotation support
