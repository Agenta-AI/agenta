# Research: Current Annotation Queue Implementation

This document analyzes the existing `EvaluationQueue` implementation to inform the v2 design.

## Architecture Overview

The current queue is implemented as part of the evaluations domain, not as a standalone entity.

```
api/oss/src/
├── core/evaluations/
│   ├── types.py          # EvaluationQueue DTOs (lines 377-432)
│   ├── service.py        # Queue service methods (lines 1296-1481)
│   ├── interfaces.py     # DAO interface (lines 441-538)
│   └── utils.py          # filter_scenario_ids algorithm (lines 1-84)
├── dbs/postgres/evaluations/
│   ├── dbes.py           # EvaluationQueueDBE entity (lines 259-300)
│   ├── dbas.py           # EvaluationQueueDBA mixin (lines 160-181)
│   └── dao.py            # Queue DAO implementation (lines 2261-2718)
└── apis/fastapi/evaluations/
    ├── router.py         # Queue endpoints (lines 412-484, 1557-1812)
    └── models.py         # Request/response models (lines 276-321)
```

## Data Model Analysis

### EvaluationQueue Entity

```python
class EvaluationQueueFlags(BaseModel):
    is_sequential: bool = False  # Controls assignment algorithm

class EvaluationQueueData(BaseModel):
    user_ids: Optional[List[List[UUID]]] = None    # 2D: repeats × assignees
    scenario_ids: Optional[List[UUID]] = None       # Subset filter
    step_keys: Optional[List[str]] = None           # Step filter

class EvaluationQueue(Version, Identifier, Lifecycle, Header, Metadata):
    flags: Optional[EvaluationQueueFlags] = None
    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING
    data: Optional[EvaluationQueueData] = None
    run_id: UUID  # <-- Required FK, the core constraint
```

### Database Schema

```sql
CREATE TABLE evaluation_queues (
    project_id UUID NOT NULL,
    id UUID NOT NULL,
    -- Version
    version VARCHAR,
    -- Lifecycle
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP,
    created_by_id UUID,
    updated_by_id UUID,
    deleted_by_id UUID,
    -- Header
    name VARCHAR,
    description VARCHAR,
    -- Flags/Tags/Meta/Data (JSONB)
    flags JSON,
    tags JSON,
    meta JSON,
    data JSON,
    -- Queue-specific
    status VARCHAR NOT NULL,
    run_id UUID NOT NULL,
    
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, run_id) 
        REFERENCES evaluation_runs(project_id, id) ON DELETE CASCADE
);
```

Key observations:
- Composite PK `(project_id, id)` follows project-scoped pattern
- `run_id` is NOT NULL with FK constraint — this is the blocker
- `data` column stores assignment configuration as JSON
- No individual task/item tracking — just scenario ID partitioning

## Assignment Algorithm

Location: `api/oss/src/core/evaluations/utils.py`

```python
BLOCKS = 1 * 2 * 3 * 4 * 5  # = 120

def filter_scenario_ids(
    user_id: UUID,
    user_ids: List[List[UUID]],  # Per-repeat assignee lists
    scenario_ids: List[UUID],
    is_sequential: bool,
    offset: int = 0,
) -> List[List[UUID]]:
    """Returns scenario IDs assigned to user_id, grouped by repeat."""
    
    MOD = min(len(scenario_ids), BLOCKS)
    
    for repeat_user_ids in user_ids:
        # Get this user's bounds within the MOD space
        bounds = _get_bounds(repeat_user_ids, user_id, MOD)
        
        for idx, scenario_id in enumerate(scenario_ids):
            # Compute modular index
            if is_sequential:
                mod = (offset + idx) % MOD
            else:
                mod = int(scenario_id) % MOD  # UUID as integer
            
            # Assign if mod falls within user's bounds
            if any(lower <= mod < upper for (lower, upper) in bounds):
                # ... append to result
```

Key observations:
- **Deterministic**: Same inputs always produce same assignment
- **Stateless**: No claim/lock mechanism, just computation
- **UUID-based**: Non-sequential mode uses UUID integer value for distribution
- **BLOCKS=120**: Chosen for clean division (divides evenly by 1-6, 8, 10, 12, etc.)

### Limitations

1. **No task status**: Can't track pending/claimed/completed per item
2. **No claim time**: No timeout mechanism for abandoned tasks
3. **Recomputed on every call**: No caching of assignments
4. **Assumes all scenarios exist upfront**: No incremental ingestion

## Service Layer

Location: `api/oss/src/core/evaluations/service.py` (lines 1296-1481)

### Methods

| Method | Purpose |
|--------|---------|
| `create_queue` | Create single queue |
| `create_queues` | Batch create |
| `fetch_queue` | Get by ID |
| `fetch_queues` | Get by IDs |
| `edit_queue` | Update single |
| `edit_queues` | Batch update |
| `delete_queue` | Delete single |
| `delete_queues` | Batch delete |
| `query_queues` | Filter/search |
| `fetch_queue_scenarios` | **Core method** - get assigned scenarios for user |

### fetch_queue_scenarios Implementation

```python
async def fetch_queue_scenarios(
    self,
    *,
    project_id: UUID,
    user_id: Optional[UUID] = None,
    queue_id: UUID,
) -> List[List[UUID]]:
    # 1. Fetch the queue
    queue = await self.fetch_queue(project_id=project_id, queue_id=queue_id)
    
    # 2. Get scenario_ids filter from queue data (optional)
    queue_scenario_ids = queue.data.scenario_ids if queue.data else None
    
    # 3. Query all scenarios for this run
    scenarios = await self.query_scenarios(
        project_id=project_id,
        scenario=EvaluationScenarioQuery(
            run_id=queue.run_id,
            ids=queue_scenario_ids,
        ),
    )
    
    # 4. Extract scenario IDs
    run_scenario_ids = [s.id for s in scenarios if s.id]
    
    # 5. If no user assignment, return all
    queue_user_ids = queue.data.user_ids if queue.data else None
    if not queue_user_ids:
        return [run_scenario_ids]
    
    # 6. Partition using algorithm
    is_sequential = queue.flags and queue.flags.is_sequential or False
    return filter_scenario_ids(user_id, queue_user_ids, run_scenario_ids, is_sequential)
```

Key observations:
- Scenarios come from the evaluation run, not the queue itself
- No caching — queries scenarios on every call
- Returns `List[List[UUID]]` — outer list is per-repeat

## API Endpoints

Location: `api/oss/src/apis/fastapi/evaluations/router.py`

Mounted at: `/preview/evaluations/queues/`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/queues/` | Create queues (batch) |
| PATCH | `/queues/` | Edit queues (batch) |
| DELETE | `/queues/` | Delete queues (batch) |
| POST | `/queues/query` | Query/filter queues |
| GET | `/queues/{queue_id}` | Fetch single queue |
| PATCH | `/queues/{queue_id}` | Edit single queue |
| DELETE | `/queues/{queue_id}` | Delete single queue |
| GET | `/queues/{queue_id}/scenarios` | **Get assigned scenarios** |

### Request/Response Models

```python
class EvaluationQueuesCreateRequest(BaseModel):
    queues: List[EvaluationQueueCreate]

class EvaluationQueueResponse(BaseModel):
    count: int
    queue: Optional[EvaluationQueue]

class EvaluationQueueScenarioIdsResponse(BaseModel):
    count: int
    scenario_ids: List[List[UUID]]  # Per-repeat assignment
```

## Integration Points

### With Evaluation Runs

The queue doesn't create scenarios — it assumes they exist in the linked run. Scenarios are created by:
- Batch evaluation task (`api/oss/src/core/evaluations/tasks/batch.py`)
- Live evaluation task (`api/oss/src/core/evaluations/tasks/live.py`)

### With Results

Annotation results are written to `evaluation_results` table with:
- `run_id`: From the queue's linked run
- `scenario_id`: The scenario being annotated
- `step_key`: The human evaluation step identifier
- `repeat_idx`: Which repeat (maps to queue's user_ids structure)

### With Permissions (EE)

```python
Permission.VIEW_EVALUATION_QUEUES
Permission.EDIT_EVALUATION_QUEUES
```

Checked in router handlers before service calls.

## What's Missing for v2

| Gap | Description |
|-----|-------------|
| Source independence | Queue is locked to evaluation runs |
| Per-item status | No pending/claimed/completed tracking |
| Claim mechanism | No lock/timeout for assigned items |
| Progress tracking | No completion percentage |
| Write-back | No mechanism to sync to source entities |
| Annotation schema | Schema comes from evaluator, not queue |
| Inbox view | No cross-queue task aggregation |
| Continuous ingestion | Items must exist upfront |

## Reusable Components

These can be preserved or adapted:

1. **Assignment algorithm** (`filter_scenario_ids`): Sound logic, could be extracted
2. **DAO patterns**: Standard CRUD + query with windowing
3. **Permission model**: EE permission checks in router
4. **Composite PK pattern**: `(project_id, id)` scoping
5. **JSONB columns**: flags, tags, meta, data pattern

## Related Entities

Understanding the evaluation hierarchy helps inform the design:

```
EvaluationRun
├── flags: { is_live, is_active, is_closed, has_human, has_auto, ... }
├── data.steps[]: { key, type, origin, references }
├── data.repeats: int
│
├── EvaluationScenario (1:N)
│   ├── run_id
│   ├── interval, timestamp
│   └── meta (input data)
│
├── EvaluationResult (1:N per scenario × step × repeat)
│   ├── run_id, scenario_id
│   ├── step_key, repeat_idx
│   ├── trace_id, testcase_id
│   └── meta (output data)
│
├── EvaluationMetrics (aggregations)
│   ├── Global (run-level)
│   ├── Variational (per-scenario)
│   └── Temporal (time-series)
│
└── EvaluationQueue (1:N, current implementation)
    ├── run_id
    └── data.user_ids
```

The run is the container that holds everything together. Breaking this coupling requires either:
- A new container (AnnotationQueue with its own items)
- Or making the run a lightweight/optional wrapper
