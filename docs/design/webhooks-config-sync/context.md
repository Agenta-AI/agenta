# Codebase Context & Integration Points

## Overview

This document maps the existing Agenta infrastructure and where webhook functionality should integrate.

---

## Existing Infrastructure

### 1. Redis (Two Instances)

| Instance | Port | Purpose | URI Env Var |
|----------|------|---------|-------------|
| `redis-volatile` | 6379 | Caching, non-persistent | `REDIS_URI_VOLATILE` |
| `redis-durable` | 6381 | Streams, task queues, persistent | `REDIS_URI_DURABLE` |

**Location**: `api/oss/src/utils/env.py` (lines 472-498)

```python
class RedisConfig(BaseModel):
    uri_volatile: str | None = os.getenv("REDIS_URI_VOLATILE") or "redis://redis-volatile:6379/0"
    uri_durable: str | None = os.getenv("REDIS_URI_DURABLE") or "redis://redis-durable:6381/0"
```

### 2. Worker Patterns

#### A. Taskiq + Redis Streams (Evaluations)

**Location**: `api/entrypoints/worker_evaluations.py`

```python
from taskiq_redis import RedisStreamBroker

broker = RedisStreamBroker(
    url=env.redis.uri_durable,
    queue_name="queues:evaluations",
    consumer_group_name="worker-evaluations",
)

evaluations_worker = EvaluationsWorker(broker=broker)
```

**Run**: `python -m entrypoints.worker_evaluations`

**Pattern**:
- Tasks defined in `api/oss/src/tasks/taskiq/evaluations/worker.py`
- Uses `@self.broker.task()` decorator
- Supports `retry_on_error=True`, `max_retries=N`
- Triggered via `.kiq()` (kick) method

#### B. Custom Redis Streams Worker (Tracing)

**Location**: `api/entrypoints/worker_tracing.py`

```python
tracing_worker = TracingWorker(
    service=tracing_service,
    redis_client=redis_client,
    stream_name="streams:tracing",
    consumer_group="worker-tracing",
)
await tracing_worker.run()
```

**Pattern**:
- Custom consumer using `XREADGROUP`
- Batching, grouping, manual ACK/DEL
- Used for high-throughput ingestion

### 3. Cron Jobs

**Location**: `api/oss/src/crons/` and `api/ee/src/crons/`

**Docker Setup**: `hosting/docker-compose/*/docker-compose.*.yml`

```yaml
cron:
    image: agenta-oss-dev-api:latest
    command: cron -f
    volumes:
        - ../../../api/oss/src/crons/queries.sh:/queries.sh
```

**Pattern**:
- Cron container runs `cron -f`
- Shell scripts mounted as volumes
- Scripts make HTTP calls to internal API endpoints
- Crontab files (`*.txt`) define schedules

**Existing Jobs**:

| Job | Schedule | Purpose | Script |
|-----|----------|---------|--------|
| `queries` | `* * * * *` (every minute) | Refresh evaluation runs | `queries.sh` |
| `meters` (EE) | `15,45 * * * *` (twice/hour) | Report billing usage | `meters.sh` |
| `spans` (EE) | Varies | Span cleanup | `spans.sh` |

**Example Cron Script Pattern**:
```bash
#!/bin/sh
AGENTA_AUTH_KEY=$(tr '\0' '\n' < /proc/1/environ | grep ^AGENTA_AUTH_KEY= | cut -d= -f2-)
curl -X POST -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/some-endpoint"
```

### 4. PostgreSQL

Used for persistent data storage. Webhooks tables would go here.

**Migrations**: `api/oss/databases/postgres/migrations/core/`

---

## Recommended Integration for Webhooks

### A. Task Queue: Taskiq + Redis Streams

Follow the `EvaluationsWorker` pattern:

```
api/
├── entrypoints/
│   └── worker_webhooks.py           # NEW: Entrypoint
└── oss/src/tasks/taskiq/webhooks/
    ├── __init__.py
    └── worker.py                     # NEW: WebhooksWorker
```

**Why Taskiq (not custom Redis Streams worker)**:
- Webhook delivery is discrete tasks, not high-throughput streams
- Taskiq provides built-in retry semantics
- Same pattern as evaluations = less cognitive load

### B. Cron: Cleanup & Monitoring

Add cron jobs for:

1. **Cleanup old deliveries** (daily)
   ```bash
   # webhooks-cleanup.sh
   curl -X POST "http://api:8000/admin/webhooks/cleanup?days=30"
   ```

2. **Retry stuck deliveries** (every 5 min)
   ```bash
   # webhooks-retry.sh  
   curl -X POST "http://api:8000/admin/webhooks/retry-stuck"
   ```

**Crontab** (`api/oss/src/crons/webhooks.txt`):
```
*/5 * * * * root sh /webhooks-retry.sh >> /proc/1/fd/1 2>&1
0 3 * * * root sh /webhooks-cleanup.sh >> /proc/1/fd/1 2>&1
```

### C. Database: PostgreSQL

Add tables via Alembic migration (see `schema.md`).

---

## File Structure (Complete)

```
api/
├── entrypoints/
│   ├── worker_evaluations.py        # Existing
│   ├── worker_tracing.py            # Existing
│   └── worker_webhooks.py           # NEW
├── oss/
│   ├── src/
│   │   ├── routers/
│   │   │   ├── variants_router.py   # MODIFY: Add event emission
│   │   │   └── webhooks_router.py   # NEW: CRUD + history endpoints
│   │   ├── services/
│   │   │   └── webhook_service.py   # NEW: emit_webhook_event()
│   │   ├── tasks/
│   │   │   └── taskiq/
│   │   │       └── webhooks/
│   │   │           ├── __init__.py  # NEW
│   │   │           └── worker.py    # NEW: WebhooksWorker
│   │   ├── models/
│   │   │   ├── db_models.py         # MODIFY: Add WebhookDB, WebhookDeliveryDB
│   │   │   └── api/
│   │   │       └── webhook_models.py # NEW: Pydantic models
│   │   └── crons/
│   │       ├── webhooks.txt         # NEW: Crontab
│   │       ├── webhooks-cleanup.sh  # NEW
│   │       └── webhooks-retry.sh    # NEW
│   └── databases/postgres/migrations/core/versions/
│       └── xxxx_add_webhooks.py     # NEW: Alembic migration
└── hosting/docker-compose/
    └── oss/docker-compose.dev.yml   # MODIFY: Add worker-webhooks service
```

---

## Integration Points in Existing Code

### 1. Event Emission (variants_router.py)

**Location**: `api/oss/src/routers/variants_router.py`

**Function**: `configs_deploy()` (line ~785)

```python
@router.post("/configs/deploy", ...)
async def configs_deploy(request: Request, ...):
    config = await deploy_config(...)
    
    if not config:
        raise HTTPException(status_code=404, detail="Config not found.")

    await invalidate_cache(project_id=request.state.project_id)
    
    # ADD: Emit webhook event
    await emit_webhook_event(
        project_id=request.state.project_id,
        event_type="config.deployed",
        data={
            "config": config.model_dump(),
            "deployed_by": request.state.user_id,
        }
    )
    
    return config
```

### 2. Webhook Worker Instantiation

**Location**: `api/entrypoints/worker_webhooks.py` (NEW)

Follow the pattern from `worker_evaluations.py`:

```python
from taskiq_redis import RedisStreamBroker
from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker

broker = RedisStreamBroker(
    url=env.redis.uri_durable,
    queue_name="queues:webhooks",
    consumer_group_name="worker-webhooks",
    idle_timeout=3600000,  # 1 hour
    socket_timeout=30,
    socket_connect_timeout=30,
)

webhooks_worker = WebhooksWorker(broker=broker)

def main():
    args = WorkerArgs(
        broker="entrypoints.worker_webhooks:broker",
        modules=[],
        fs_discover=False,
        workers=1,
        max_async_tasks=10,
    )
    return run_worker(args)
```

### 3. Router Registration

**Location**: `api/entrypoints/routers.py` or main app

```python
from oss.src.routers import webhooks_router

app.include_router(
    webhooks_router.router,
    prefix="/api/projects/{project_id}",
    tags=["webhooks"],
)
```

### 4. Docker Compose

**Location**: `hosting/docker-compose/oss/docker-compose.dev.yml`

```yaml
worker-webhooks:
    <<: *worker-common  # or copy from worker-tracing
    container_name: agenta-worker-webhooks
    command: ["python", "-m", "entrypoints.worker_webhooks"]
    depends_on:
        redis-durable:
            condition: service_healthy
        postgres:
            condition: service_healthy
    restart: always

cron:
    volumes:
        - ../../../api/oss/src/crons/queries.sh:/queries.sh
        - ../../../api/oss/src/crons/webhooks-cleanup.sh:/webhooks-cleanup.sh   # ADD
        - ../../../api/oss/src/crons/webhooks-retry.sh:/webhooks-retry.sh       # ADD
```

---

## Environment Variables

No new env vars required for MVP. Uses existing:
- `REDIS_URI_DURABLE` - For Taskiq broker
- `AGENTA_AUTH_KEY` - For internal cron API calls

Optional future env vars:
```bash
WEBHOOK_TIMEOUT=10           # HTTP timeout in seconds
WEBHOOK_MAX_RETRIES=6        # Max delivery attempts
WEBHOOK_REQUIRE_HTTPS=true   # Require HTTPS endpoints
```

---

## Permissions (EE Mode)

**Location**: `api/ee/src/models/shared_models.py`

```python
class Permission(str, Enum):
    # ... existing ...
    VIEW_WEBHOOKS = "view_webhooks"
    MANAGE_WEBHOOKS = "manage_webhooks"
```

Permission checks follow existing pattern in routers.
