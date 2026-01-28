# Implementation Plan

## Overview

Phased approach leveraging **existing Agenta infrastructure**:
- **Taskiq + Redis Streams** for task queue (like evaluations)
- **Cron** for cleanup and stuck retry (like meters/queries)
- **PostgreSQL** for persistent storage

---

## MVP Scope (v1)

### Goal
Enable users to receive webhook notifications when a config is deployed to an environment.

### In Scope
- Single event type: `config.deployed`
- Project-level webhooks (no app/environment filtering in MVP)
- CRUD API for webhook management
- HMAC-SHA256 signature verification
- Taskiq-based delivery with automatic retries
- Delivery history (last 30 days)
- Manual retry capability
- Test webhook endpoint
- Cron jobs for cleanup and stuck retry

### Out of Scope (Defer to v2)
- Multiple event types (`config.committed`, `variant.created`, etc.)
- App/environment filtering
- Webhook management UI
- Advanced analytics/monitoring
- Native GitHub App integration

---

## Phase 1: Database & Models (2-3 days)

### Tasks
1. [ ] Create Alembic migration for `webhooks` and `webhook_deliveries` tables
2. [ ] Add SQLAlchemy models to `db_models.py`
3. [ ] Create Pydantic models in `webhook_models.py`
4. [ ] Add DB manager functions for webhook CRUD

### Deliverables
```
api/oss/databases/postgres/migrations/core/versions/
└── xxxx_add_webhooks.py

api/oss/src/models/
├── db_models.py              # ADD: WebhookDB, WebhookDeliveryDB
└── api/
    └── webhook_models.py     # NEW
```

---

## Phase 2: Webhook Management API (2-3 days)

### Tasks
1. [ ] Create `webhooks_router.py` with CRUD endpoints
2. [ ] Implement secret generation (secure random bytes)
3. [ ] Add URL validation (HTTPS required in production)
4. [ ] Add permission checks for EE mode
5. [ ] Register router in main app
6. [ ] Write unit tests

### Endpoints
```
GET    /api/projects/{project_id}/webhooks
POST   /api/projects/{project_id}/webhooks
GET    /api/projects/{project_id}/webhooks/{webhook_id}
PATCH  /api/projects/{project_id}/webhooks/{webhook_id}
DELETE /api/projects/{project_id}/webhooks/{webhook_id}
POST   /api/projects/{project_id}/webhooks/{webhook_id}/regenerate-secret
```

### Deliverables
```
api/oss/src/routers/
└── webhooks_router.py        # NEW
```

---

## Phase 3: Taskiq Worker (3-4 days)

### Tasks
1. [ ] Create `WebhooksWorker` class following `EvaluationsWorker` pattern
2. [ ] Define `deliver_webhook` task with retry support
3. [ ] Implement HMAC signature generation
4. [ ] Implement HTTP delivery with timeout (10s)
5. [ ] Create worker entrypoint
6. [ ] Add to docker-compose
7. [ ] Write integration tests

### Taskiq Task Definition
```python
@self.broker.task(
    task_name="webhooks.deliver",
    retry_on_error=True,
    max_retries=6,
)
async def deliver_webhook(
    delivery_id: UUID,
    webhook_id: UUID,
    event_type: str,
    payload: dict,
) -> dict:
    # Fetch webhook, sign payload, deliver, update status
```

### Deliverables
```
api/
├── entrypoints/
│   └── worker_webhooks.py                  # NEW
└── oss/src/tasks/taskiq/webhooks/
    ├── __init__.py                         # NEW
    └── worker.py                           # NEW

hosting/docker-compose/oss/docker-compose.dev.yml  # ADD worker-webhooks service
```

---

## Phase 4: Event Emission (2 days)

### Tasks
1. [ ] Create `webhook_service.py` with `emit_webhook_event()` function
2. [ ] Integrate with `configs_deploy()` endpoint
3. [ ] Build webhook payload with proper structure
4. [ ] Queue Taskiq tasks for all matching webhooks
5. [ ] Write unit tests

### Integration Point
```python
# In variants_router.py, configs_deploy()
from oss.src.services.webhook_service import emit_webhook_event

await emit_webhook_event(
    project_id=request.state.project_id,
    event_type="config.deployed",
    data={
        "config": config.model_dump(),
        "deployed_by": request.state.user_id,
    }
)
```

### Deliverables
```
api/oss/src/services/
└── webhook_service.py        # NEW

api/oss/src/routers/
└── variants_router.py        # MODIFY
```

---

## Phase 5: Cron Jobs (1 day)

### Tasks
1. [ ] Create admin endpoints for cleanup and retry
2. [ ] Create cron shell scripts
3. [ ] Create crontab file
4. [ ] Update docker-compose volumes

### Admin Endpoints
```python
# In admin_router.py or webhooks_router.py
@router.post("/admin/webhooks/cleanup")
async def cleanup_old_deliveries(days: int = 30):
    """Delete deliveries older than N days."""
    
@router.post("/admin/webhooks/retry-stuck")
async def retry_stuck_deliveries():
    """Retry deliveries stuck in 'delivering' state > 1 hour."""
```

### Cron Scripts
```bash
# webhooks-cleanup.sh (daily at 3am)
curl -X POST -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/webhooks/cleanup?days=30"

# webhooks-retry.sh (every 5 minutes)
curl -X POST -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/webhooks/retry-stuck"
```

### Crontab
```
# webhooks.txt
*/5 * * * * root sh /webhooks-retry.sh >> /proc/1/fd/1 2>&1
0 3 * * * root sh /webhooks-cleanup.sh >> /proc/1/fd/1 2>&1
```

### Deliverables
```
api/oss/src/crons/
├── webhooks.txt              # NEW
├── webhooks-cleanup.sh       # NEW
└── webhooks-retry.sh         # NEW

hosting/docker-compose/oss/docker-compose.dev.yml  # ADD volumes to cron service
```

---

## Phase 6: Delivery History & Testing (2 days)

### Tasks
1. [ ] Add delivery history endpoints to router
2. [ ] Implement test webhook endpoint
3. [ ] Add manual retry capability
4. [ ] Write integration tests for full flow

### Additional Endpoints
```
GET  /api/projects/{project_id}/webhooks/{webhook_id}/deliveries
GET  /api/projects/{project_id}/webhooks/{webhook_id}/deliveries/{delivery_id}
POST /api/projects/{project_id}/webhooks/{webhook_id}/deliveries/{delivery_id}/retry
POST /api/projects/{project_id}/webhooks/{webhook_id}/test
```

---

## Phase 7: Documentation & Rollout (1-2 days)

### Tasks
1. [ ] Update API documentation
2. [ ] Write user-facing documentation
3. [ ] Add signature verification examples (Python, Node, Go)
4. [ ] Create changelog entry
5. [ ] Deploy to staging
6. [ ] Deploy to production

---

## Timeline Summary

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| 1. Database & Models | 2-3 days | None |
| 2. Management API | 2-3 days | Phase 1 |
| 3. Taskiq Worker | 3-4 days | Phase 1 |
| 4. Event Emission | 2 days | Phase 3 |
| 5. Cron Jobs | 1 day | Phase 1 |
| 6. History & Testing | 2 days | Phase 2, 4 |
| 7. Documentation | 1-2 days | Phase 6 |

**Total: ~13-17 days** (3-4 weeks with buffer)

---

## Infrastructure Summary

### Uses Existing
| Component | Existing | Purpose |
|-----------|----------|---------|
| Redis (durable) | `redis-durable:6381` | Taskiq broker |
| PostgreSQL | `postgres:5432` | Webhooks tables |
| Cron container | `cron` | Cleanup & retry jobs |
| Taskiq | `taskiq_redis` | Task queue |

### New Additions
| Component | Type | Purpose |
|-----------|------|---------|
| `worker-webhooks` | Docker service | Taskiq worker process |
| `webhooks` table | PostgreSQL | Webhook subscriptions |
| `webhook_deliveries` table | PostgreSQL | Delivery queue/history |
| `queues:webhooks` | Redis Stream | Task queue |

---

## v2 Roadmap (Future)

### Additional Event Types
- `config.committed` - New config version saved
- `variant.created` / `variant.deleted`
- `evaluation.completed`

### Filtering
- Filter by application
- Filter by environment
- Filter by labels/tags

### UI
- Webhook management in dashboard
- Delivery logs viewer

### Scale
- If volume grows significantly, evaluate Svix

---

## Complexity Assessment

| Aspect | Rating | Notes |
|--------|--------|-------|
| Overall | **Medium** | Follows existing patterns |
| Database | Low | Two simple tables |
| API | Low | Standard CRUD |
| Taskiq Worker | Low | Copy EvaluationsWorker pattern |
| Cron | Low | Copy existing scripts |
| Event Emission | Low | Single integration point |
| Testing | Medium | Need mock HTTP server |

**Risk factors:**
- Taskiq retry behavior customization
- Ensuring delivery idempotency

**Mitigation:**
- Start with Taskiq defaults, customize if needed
- Clear documentation on `X-Agenta-Delivery` header for consumers
