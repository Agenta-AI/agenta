# RFC: Annotation Queue v2

**Status**: Draft  
**Author**: Planning Agent  
**Created**: 2026-02-12  
**Last Updated**: 2026-02-12

## Summary

This RFC proposes a redesign of the annotation queue system to support four key capabilities: annotating test sets, human evaluation in eval runs, annotating traces, and programmatic annotation via API/SDK. Two solution approaches are presented with detailed tradeoffs.

## Motivation

The current `EvaluationQueue` implementation requires a `run_id` foreign key, coupling all annotation work to evaluation runs. This creates friction for use cases that don't naturally map to the evaluation model:

- **Traces**: Must create a dummy run, create scenarios for each trace, then annotate
- **Test sets**: Annotations live in evaluation results, not the test set itself
- **API submissions**: 3+ API calls to enqueue a single item

We need a system where annotation is a first-class capability that can accept items from any source.

## Requirements Summary

From the [PRD](./prd.md):

1. **Annotate test sets** — Label, rate, correct test set rows directly
2. **Human evaluation in eval runs** — Mix auto and human evaluators in one run
3. **Annotate traces** — Send traces to queue for human review
4. **Programmatic annotation** — Submit items via API/SDK

Cross-cutting concerns:
- Per-item task status (pending, claimed, completed, skipped)
- Annotation schema definition per queue
- Write-back to source entities
- Annotator inbox across all queues
- Assignment strategies (round-robin, first-come)

---

## Solution A: Evaluation Run as Universal Container

### Philosophy

Keep the `run_id` coupling. Accept that everything flows through an evaluation run. Add convenience APIs and adapters to hide the complexity from users.

### Approach

1. **Add origin tracking** to evaluation runs to distinguish annotation-only runs from real evaluations
2. **Create convenience endpoints** that auto-create run + scenarios + queue in one call
3. **Add write-back hooks** that sync annotation results to source entities
4. **Keep results in `evaluation_results`** — single source of truth

### Data Model Changes

```python
# Extend EvaluationRunFlags
class EvaluationRunFlags(BaseModel):
    # ... existing flags ...
    is_annotation_only: bool = False  # NEW: marks this as an annotation container

# Extend EvaluationRunData  
class EvaluationRunData(BaseModel):
    # ... existing fields ...
    source_type: Optional[str] = None   # NEW: "traces" | "testset" | "api"
    source_id: Optional[UUID] = None    # NEW: testset_revision_id, etc.
    annotation_schema: Optional[dict] = None  # NEW: JSON Schema for annotations

# Extend EvaluationScenario meta
# Store source reference in scenario.meta:
# { "source_type": "trace", "source_id": "trace-uuid", "source_data": {...} }
```

### New Convenience API

```
POST /annotations/from-traces
{
  "name": "Review flagged traces",
  "trace_ids": ["t1", "t2", "t3"],
  "annotation_schema": {
    "type": "object",
    "properties": {
      "quality": {"type": "string", "enum": ["good", "bad", "unclear"]},
      "notes": {"type": "string"}
    }
  },
  "assignees": [["user-a", "user-b"]],
  "assignment_strategy": "round_robin"
}

→ Response:
{
  "queue_id": "q-uuid",
  "run_id": "r-uuid",  // Exposed for transparency
  "task_count": 3
}
```

Internally this:
1. Creates `EvaluationRun` with `is_annotation_only=true`, `source_type="traces"`
2. Creates `EvaluationScenario` for each trace, storing trace data in `meta`
3. Creates `EvaluationQueue` linked to the run
4. Returns the queue ID

Similar endpoints for:
- `POST /annotations/from-testset`
- `POST /annotations/from-items` (programmatic)

### Write-back Mechanism

Add a write-back service that triggers when annotation results are submitted:

```python
class AnnotationWritebackService:
    async def on_result_created(self, result: EvaluationResult):
        run = await self.fetch_run(result.run_id)
        
        if not run.flags.is_annotation_only:
            return  # Normal eval run, no write-back
        
        source_type = run.data.source_type
        
        if source_type == "traces":
            await self._writeback_to_trace(result)
        elif source_type == "testset":
            await self._queue_testset_update(result)
        # etc.
    
    async def _writeback_to_trace(self, result):
        scenario = await self.fetch_scenario(result.scenario_id)
        trace_id = scenario.meta.get("source_id")
        
        # Write annotation as span attribute
        await self.tracing_service.add_annotation(
            trace_id=trace_id,
            annotation=result.meta,
        )
```

### Task Status Tracking

Extend `EvaluationResult` to track task lifecycle:

```python
class EvaluationResultFlags(BaseModel):
    task_status: str = "pending"  # pending | claimed | completed | skipped
    claimed_at: Optional[datetime] = None
    claimed_by: Optional[UUID] = None
    completed_at: Optional[datetime] = None
```

Add claim/release endpoints:

```
POST /annotations/tasks/{result_id}/claim
POST /annotations/tasks/{result_id}/release
POST /annotations/tasks/{result_id}/submit
POST /annotations/tasks/{result_id}/skip
```

### Annotator Inbox

Query all tasks assigned to a user across all annotation-only runs:

```
GET /annotations/inbox?user_id=X

→ Returns tasks from all queues where:
  - run.flags.is_annotation_only = true
  - user is in queue.data.user_ids
  - result.flags.task_status in ["pending", "claimed"]
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Convenience API Layer                        │
│  POST /annotations/from-traces                                   │
│  POST /annotations/from-testset                                  │
│  POST /annotations/from-items                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ creates
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EvaluationRun                                │
│  flags: { is_annotation_only: true }                            │
│  data: { source_type, source_id, annotation_schema }            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ contains
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   EvaluationScenario                             │
│  meta: { source_type, source_id, source_data }                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ has results
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   EvaluationResult                               │
│  flags: { task_status, claimed_at, claimed_by }                 │
│  meta: { annotation_data }                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ triggers
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  WritebackService                                │
│  → Trace attributes                                              │
│  → Testset revision                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Pros

| Benefit | Details |
|---------|---------|
| Minimal schema changes | Extends existing tables, no new tables |
| Results infrastructure exists | Aggregation, metrics, querying all work |
| Single query model | All annotation results queryable the same way |
| Backward compatible | Existing queues keep working |
| Faster to implement | Less new code, more adaptation |

### Cons

| Drawback | Details |
|---------|---------|
| Conceptual leakage | "Evaluation run" for non-evaluation use cases is misleading |
| Entity bloat | EvaluationRun accumulates annotation-specific fields |
| Write-back is bolted on | Not a first-class concept, easy to break |
| Source adapters | Each source type needs custom from-X endpoint |
| Naming confusion | Is it an evaluation or an annotation? UI/docs complexity |

### Effort Estimate

- **Backend**: 2-3 weeks
  - Convenience endpoints: 3-4 days
  - Task status tracking: 2-3 days
  - Write-back service: 3-4 days
  - Inbox query: 1-2 days
  - Tests: 2-3 days
- **Frontend**: 3-4 weeks (inbox, annotation UI, integration points)
- **SDK**: 1 week

---

## Solution B: Annotation as Independent Domain

### Philosophy

Build a new `AnnotationQueue` / `AnnotationTask` domain from scratch. It can optionally link to evaluation runs but doesn't require one. Annotation is a first-class concept with its own storage.

### Approach

1. **New domain entities**: `AnnotationQueue`, `AnnotationTask`, `AnnotationResult`
2. **Polymorphic source binding**: Tasks reference their source via `source_type` + `source_id`
3. **Native task lifecycle**: pending → claimed → completed, with timeouts
4. **Dedicated write-back per source type**
5. **Integration with evaluations**: When an eval run has human steps, auto-create annotation tasks

### Data Model

#### AnnotationQueue

```python
class AnnotationQueueFlags(BaseModel):
    is_active: bool = True
    allow_skip: bool = True
    require_claim: bool = True  # vs. implicit claim on view

class AnnotationQueueConfig(BaseModel):
    assignment_strategy: str = "round_robin"  # round_robin | first_come | manual
    claim_timeout_seconds: Optional[int] = 3600  # 1 hour default
    repeats: int = 1  # How many annotators per item

class AnnotationQueue(Version, Identifier, Lifecycle, Header, Metadata):
    flags: Optional[AnnotationQueueFlags] = None
    status: str = "draft"  # draft | active | paused | completed | cancelled
    
    # Source binding (optional — for tracking origin)
    source_type: Optional[str] = None  # "evaluation" | "traces" | "testset" | "api"
    source_id: Optional[UUID] = None
    
    # Configuration
    config: Optional[AnnotationQueueConfig] = None
    annotation_schema: dict  # JSON Schema defining what annotators fill in
    
    # Assignment
    assignees: Optional[List[UUID]] = None  # User IDs who can work on this queue
    
    # Stats (denormalized for performance)
    task_count: int = 0
    completed_count: int = 0
```

#### AnnotationTask

```python
class AnnotationTaskFlags(BaseModel):
    is_priority: bool = False

class AnnotationTask(Version, Identifier, Lifecycle, Metadata):
    queue_id: UUID
    
    # Status
    status: str = "pending"  # pending | claimed | completed | skipped | expired
    
    # Assignment
    assigned_to: Optional[UUID] = None
    assigned_at: Optional[datetime] = None
    repeat_index: int = 0  # For multi-annotator scenarios
    
    # Source reference
    source_type: str  # "scenario" | "trace" | "testcase" | "custom"
    source_id: Optional[UUID] = None  # ID of source entity
    
    # Data (for custom/API submissions or denormalized source data)
    input_data: Optional[dict] = None
    
    # Result (inline for simplicity, or separate table)
    result_data: Optional[dict] = None
    completed_at: Optional[datetime] = None
    completed_by: Optional[UUID] = None
    
    flags: Optional[AnnotationTaskFlags] = None
```

### Database Schema

```sql
-- annotation_queues
CREATE TABLE annotation_queues (
    project_id UUID NOT NULL,
    id UUID NOT NULL,
    version VARCHAR,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP,
    created_by_id UUID,
    updated_by_id UUID,
    deleted_by_id UUID,
    name VARCHAR,
    description VARCHAR,
    flags JSONB,
    tags JSONB,
    meta JSONB,
    
    status VARCHAR NOT NULL DEFAULT 'draft',
    source_type VARCHAR,
    source_id UUID,
    config JSONB,
    annotation_schema JSONB NOT NULL,
    assignees JSONB,  -- List of user UUIDs
    task_count INT DEFAULT 0,
    completed_count INT DEFAULT 0,
    
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX ix_annotation_queues_status ON annotation_queues(status);
CREATE INDEX ix_annotation_queues_source ON annotation_queues(source_type, source_id);
CREATE INDEX ix_annotation_queues_assignees ON annotation_queues USING GIN(assignees);

-- annotation_tasks
CREATE TABLE annotation_tasks (
    project_id UUID NOT NULL,
    id UUID NOT NULL,
    queue_id UUID NOT NULL,
    version VARCHAR,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP,
    created_by_id UUID,
    updated_by_id UUID,
    deleted_by_id UUID,
    flags JSONB,
    tags JSONB,
    meta JSONB,
    
    status VARCHAR NOT NULL DEFAULT 'pending',
    assigned_to UUID,
    assigned_at TIMESTAMP,
    repeat_index INT DEFAULT 0,
    source_type VARCHAR NOT NULL,
    source_id UUID,
    input_data JSONB,
    result_data JSONB,
    completed_at TIMESTAMP,
    completed_by UUID,
    
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, queue_id) 
        REFERENCES annotation_queues(project_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_annotation_tasks_queue_id ON annotation_tasks(queue_id);
CREATE INDEX ix_annotation_tasks_status ON annotation_tasks(status);
CREATE INDEX ix_annotation_tasks_assigned_to ON annotation_tasks(assigned_to);
CREATE INDEX ix_annotation_tasks_source ON annotation_tasks(source_type, source_id);
```

### API Design

#### Queue Management

```
POST   /annotations/queues                    # Create queue
GET    /annotations/queues                    # List queues
GET    /annotations/queues/{id}               # Get queue
PATCH  /annotations/queues/{id}               # Update queue
DELETE /annotations/queues/{id}               # Delete queue
POST   /annotations/queues/{id}/activate      # Start accepting work
POST   /annotations/queues/{id}/pause         # Pause queue
POST   /annotations/queues/{id}/complete      # Mark complete
```

#### Task Management

```
POST   /annotations/queues/{id}/tasks         # Add tasks to queue
GET    /annotations/queues/{id}/tasks         # List tasks in queue
DELETE /annotations/queues/{id}/tasks         # Remove tasks (bulk)

GET    /annotations/tasks/{id}                # Get task details
POST   /annotations/tasks/{id}/claim          # Claim task
POST   /annotations/tasks/{id}/release        # Release claim
POST   /annotations/tasks/{id}/submit         # Submit annotation
POST   /annotations/tasks/{id}/skip           # Skip task
```

#### Inbox & Results

```
GET    /annotations/inbox                     # Get user's assigned tasks
GET    /annotations/queues/{id}/results       # Get all results for queue
POST   /annotations/queues/{id}/export        # Export results
```

#### Convenience Endpoints

```
POST   /annotations/from-traces               # Create queue + tasks from traces
POST   /annotations/from-testset              # Create queue + tasks from testset
POST   /annotations/from-evaluation           # Create queue + tasks from eval run
```

### Example Flows

#### Annotating Traces

```python
# 1. Create queue with tasks in one call
response = client.annotations.create_from_traces(
    name="Review flagged traces",
    trace_ids=["t1", "t2", "t3"],
    annotation_schema={
        "type": "object",
        "properties": {
            "quality": {"type": "string", "enum": ["good", "bad"]},
        }
    },
    assignees=["user-a", "user-b"],
)
queue_id = response.queue_id

# 2. Annotator claims and completes task
task = client.annotations.inbox.next()  # Gets next available task
client.annotations.tasks.submit(
    task_id=task.id,
    result={"quality": "good"}
)

# 3. Results written back to traces automatically
```

#### Human Evaluation in Eval Run

```python
# 1. Create eval run with human evaluator
run = client.evaluations.create_run(
    testset_id="ts-123",
    evaluators=[
        {"id": "auto-scorer", "type": "auto"},
        {"id": "human-review", "type": "human", "schema": {...}},
    ]
)

# 2. Auto evaluators run via workers
# 3. Human evaluator creates annotation queue automatically

# 4. Query the linked annotation queue
queue = client.annotations.queues.query(
    source_type="evaluation",
    source_id=run.id,
)

# 5. Annotators work through queue
# 6. Results sync back to evaluation_results
```

### Write-back Service

```python
class AnnotationWritebackService:
    """Syncs annotation results to source entities."""
    
    async def on_task_completed(self, task: AnnotationTask):
        if task.source_type == "trace":
            await self._writeback_trace(task)
        elif task.source_type == "testcase":
            await self._queue_testset_writeback(task)
        elif task.source_type == "scenario":
            await self._writeback_evaluation(task)
    
    async def _writeback_trace(self, task: AnnotationTask):
        """Write annotation as trace span attributes."""
        await self.tracing_service.set_span_attributes(
            span_id=task.source_id,
            attributes={
                "annotation.result": task.result_data,
                "annotation.by": str(task.completed_by),
                "annotation.at": task.completed_at.isoformat(),
            }
        )
    
    async def _writeback_evaluation(self, task: AnnotationTask):
        """Write annotation to evaluation_results."""
        queue = await self.fetch_queue(task.queue_id)
        
        await self.evaluations_service.create_result(
            run_id=queue.source_id,
            scenario_id=task.source_id,
            step_key=queue.meta.get("step_key"),
            repeat_idx=task.repeat_index,
            meta=task.result_data,
            status="success",
        )
```

### Integration with Evaluation Runs

When an evaluation run is created with human evaluators:

```python
class EvaluationsService:
    async def create_run(self, run: EvaluationRunCreate):
        # ... create run and scenarios ...
        
        # Check for human evaluator steps
        human_steps = [s for s in run.data.steps if s.origin == "human"]
        
        if human_steps:
            for step in human_steps:
                # Create annotation queue for this step
                queue = await self.annotations_service.create_queue(
                    name=f"{run.name} - {step.key}",
                    source_type="evaluation",
                    source_id=run.id,
                    annotation_schema=step.references.get("schema"),
                    meta={"step_key": step.key},
                )
                
                # Create tasks for each scenario
                tasks = [
                    AnnotationTaskCreate(
                        source_type="scenario",
                        source_id=scenario.id,
                    )
                    for scenario in scenarios
                ]
                await self.annotations_service.add_tasks(queue.id, tasks)
```

### Domain Structure

```
api/oss/src/
├── core/annotations/
│   ├── types.py          # AnnotationQueue, AnnotationTask DTOs
│   ├── service.py        # Business logic
│   ├── interfaces.py     # DAO interface
│   └── writeback.py      # Write-back service
├── dbs/postgres/annotations/
│   ├── dbes.py           # Database entities
│   ├── dbas.py           # Mixins
│   └── dao.py            # DAO implementation
└── apis/fastapi/annotations/
    ├── router.py         # Endpoints
    └── models.py         # Request/response models
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Layer                                 │
│  /annotations/queues    /annotations/tasks    /annotations/inbox │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AnnotationService                              │
│  create_queue, add_tasks, claim, submit, inbox, ...             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────────────┐
│ AnnotationQueue  │ │AnnotationTask│ │  WritebackService        │
│ (annotation_     │ │(annotation_  │ │  → TracingService        │
│  queues table)   │ │ tasks table) │ │  → TestsetsService       │
└──────────────────┘ └──────────────┘ │  → EvaluationsService    │
                                      └──────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────────┐
        │ Traces  │  │Testsets │  │ Eval Runs   │
        │(source) │  │(source) │  │ (source)    │
        └─────────┘  └─────────┘  └─────────────┘
```

### Pros

| Benefit | Details |
|---------|---------|
| Clean domain model | Annotation is a first-class concept |
| Per-task lifecycle | Native pending/claimed/completed tracking |
| Source agnostic | Any source type works naturally |
| Clear write-back contract | Explicit per-source-type handlers |
| Extensible | Easy to add new source types |
| Clear naming | No "evaluation run" confusion |
| Independent evolution | Annotation features don't bloat evaluation code |

### Cons

| Drawback | Details |
|---------|---------|
| More code | New domain, tables, migrations, API surface |
| Duplication | Some overlap with evaluation results storage |
| Integration complexity | Must wire eval runs ↔ annotation queues |
| Two systems | Evaluation results + annotation results |
| Migration path | Existing EvaluationQueue users need migration |
| Learning curve | New concepts for users to understand |

### Effort Estimate

- **Backend**: 4-5 weeks
  - Domain entities + DAO: 1 week
  - Service layer: 1 week
  - API endpoints: 3-4 days
  - Write-back service: 3-4 days
  - Evaluation integration: 3-4 days
  - Tests: 1 week
- **Frontend**: 4-5 weeks (new domain, inbox, annotation UI)
- **SDK**: 1-2 weeks
- **Migration**: 2-3 days (deprecate old queue, data migration if needed)

---

## Comparison Matrix

| Aspect | Solution A (Extend Runs) | Solution B (New Domain) |
|--------|--------------------------|-------------------------|
| **Schema changes** | Minimal (extend existing) | New tables |
| **Conceptual clarity** | Muddled ("eval run" misnomer) | Clean (annotation is annotation) |
| **Per-task status** | Bolted onto EvaluationResult | Native |
| **Write-back** | Hooks on result creation | Explicit service |
| **Source flexibility** | Via adapters | Native polymorphism |
| **Query model** | Reuses evaluation queries | New query patterns |
| **Backward compat** | High | Requires migration |
| **Implementation effort** | 2-3 weeks backend | 4-5 weeks backend |
| **Maintenance burden** | Higher (dual-purpose entities) | Lower (separation of concerns) |
| **Future extensibility** | Limited by eval model | Unconstrained |

## Recommendation

**For a product where annotation is becoming a core workflow**: Choose **Solution B**. The upfront investment pays off in cleaner architecture, better extensibility, and reduced long-term maintenance.

**For a quick win with limited scope**: Choose **Solution A**. If annotation is primarily a supporting feature for evaluations and the other use cases are secondary, the pragmatic approach gets you there faster.

### Decision Factors

Choose **Solution A** if:
- Annotation is primarily used within evaluation runs
- Time-to-market is critical
- Team is already deep in evaluation codebase
- Minimal new concepts preferred

Choose **Solution B** if:
- Annotation is a major product pillar
- Trace annotation and test set annotation are important use cases
- Clean APIs for SDK/programmatic access matter
- Long-term maintainability is prioritized

---

## Open Questions

1. **Deprecation of EvaluationQueue**: Either solution should plan for deprecating the existing `EvaluationQueue` entity. Migration path?

2. **Real-time updates**: Should the inbox show live updates as tasks are claimed by others? WebSocket/SSE?

3. **Annotation editing**: Can annotations be edited after submission? If so, versioning?

4. **Bulk operations**: Should annotators be able to apply the same annotation to multiple items at once?

5. **Analytics**: What metrics/dashboards are needed for annotation throughput, quality, etc.?

---

## Next Steps

1. **Decide on solution approach** — A or B
2. **Detail the chosen solution** — API specs, detailed schema, migration plan
3. **Create implementation plan** — Phased rollout, milestones
4. **Design UI/UX** — Wireframes for inbox, annotation interface
5. **SDK design** — Client library ergonomics

---

## Appendix: Current Implementation Reference

See [research.md](./research.md) for detailed analysis of the existing `EvaluationQueue` implementation.

Key files:
- Types: `api/oss/src/core/evaluations/types.py` (lines 377-432)
- Service: `api/oss/src/core/evaluations/service.py` (lines 1296-1481)
- Algorithm: `api/oss/src/core/evaluations/utils.py` (lines 1-84)
- Database: `api/oss/src/dbs/postgres/evaluations/dbes.py` (lines 259-300)
- Router: `api/oss/src/apis/fastapi/evaluations/router.py` (lines 412-484, 1557-1812)
