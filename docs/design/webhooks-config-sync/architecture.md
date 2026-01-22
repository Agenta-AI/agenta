# Architecture Options Analysis

## Overview

Three architecture options for webhook delivery, evaluated against **existing Agenta infrastructure**.

### Existing Infrastructure (Key Context)

Agenta already has:

1. **Two Redis Instances**:
   - `redis-volatile` (port 6379) - Caching, non-persistent
   - `redis-durable` (port 6381) - Persistent data (streams, task queues)

2. **Worker Patterns**:
   - **Redis Streams + Custom Worker** (`TracingWorker`) - High-throughput tracing ingestion
   - **Taskiq + Redis Streams** (`EvaluationsWorker`) - Evaluation task queue with retries

3. **Existing Streams**:
   - `streams:tracing` - Tracing spans
   - `queues:evaluations` - Evaluation tasks (via Taskiq)

---

## Option A: Synchronous Delivery

### How It Works
```
User saves config → API handler → Deliver webhook → Return response
```

### Evaluation

| Criteria | Rating | Notes |
|----------|--------|-------|
| Complexity | Low | Simple to implement |
| Reliability | Poor | Webhook failure = API failure |
| Latency Impact | High | User waits for webhook delivery |
| Infrastructure | None | Uses existing API servers |

### Verdict: **Not Recommended**
- Blocks user request
- No retry capability
- Doesn't scale

---

## Option B: Taskiq + Redis Streams (Recommended)

### How It Works
Leverage the existing Taskiq pattern used for evaluations:

```
User saves config → API handler → Queue task (Taskiq) → Return response
                                        ↓
                              Worker → Deliver webhook (with retries)
```

### Why Taskiq?

1. **Already integrated** - Used for `EvaluationsWorker`
2. **Redis Streams backend** - Uses `redis-durable` for persistence
3. **Built-in retry semantics** - Taskiq handles retries automatically
4. **Proven pattern** - Same approach as evaluation tasks

### Implementation

```python
# api/entrypoints/worker_webhooks.py

from taskiq_redis import RedisStreamBroker
from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker

# Create broker with durable Redis Streams
broker = RedisStreamBroker(
    url=env.redis.uri_durable,
    queue_name="queues:webhooks",
    consumer_group_name="worker-webhooks",
    idle_timeout=3600000,  # 1 hour - allow for retries
    socket_timeout=30,
    socket_connect_timeout=30,
)

webhooks_worker = WebhooksWorker(broker=broker)
```

### Task Definition

```python
# api/oss/src/tasks/taskiq/webhooks/worker.py

class WebhooksWorker:
    def __init__(self, broker: AsyncBroker):
        self.broker = broker
        self._register_tasks()

    def _register_tasks(self):
        @self.broker.task(
            task_name="webhooks.deliver",
            retry_on_error=True,
            max_retries=6,
        )
        async def deliver_webhook(
            *,
            delivery_id: UUID,
            webhook_id: UUID,
            event_type: str,
            payload: dict,
            attempt: int = 1,
        ) -> dict:
            """Deliver a single webhook with signature."""
            # Fetch webhook config
            webhook = await db_manager.get_webhook(str(webhook_id))
            if not webhook or not webhook.is_active:
                return {"status": "skipped", "reason": "webhook inactive"}

            # Sign payload
            timestamp = int(time.time())
            signature = sign_payload(payload, webhook.secret, timestamp)

            # Deliver
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(
                        webhook.url,
                        json=payload,
                        headers={
                            "Content-Type": "application/json",
                            "User-Agent": "Agenta-Webhooks/1.0",
                            "X-Agenta-Delivery": str(delivery_id),
                            "X-Agenta-Event": event_type,
                            "X-Agenta-Signature": f"t={timestamp},v1={signature}",
                        },
                    )
                    response.raise_for_status()
                    
                    # Mark as delivered
                    await db_manager.mark_delivery_success(
                        str(delivery_id),
                        response_status=response.status_code,
                    )
                    return {"status": "delivered", "code": response.status_code}

            except Exception as e:
                # Mark attempt failure
                await db_manager.mark_delivery_attempt_failed(
                    str(delivery_id),
                    attempt=attempt,
                    error=str(e),
                )
                # Re-raise for Taskiq retry
                raise

        self.deliver_webhook = deliver_webhook
```

### Evaluation

| Criteria | Rating | Notes |
|----------|--------|-------|
| Complexity | Low | Follows existing pattern |
| Reliability | Excellent | Persistent, automatic retries |
| Latency Impact | None | Non-blocking |
| Infrastructure | None | Uses existing Redis + Taskiq |

### Verdict: **Recommended**

---

## Option C: Custom Redis Streams Worker

### How It Works
Similar to `TracingWorker`, create a custom worker consuming from a Redis Stream:

```
User saves config → API handler → XADD to stream → Return response
                                        ↓
                              WebhookWorker (XREADGROUP) → Deliver
```

### When to Use
- High-throughput webhook delivery (thousands/sec)
- Need custom batching logic
- More control over consumer groups

### Evaluation

| Criteria | Rating | Notes |
|----------|--------|-------|
| Complexity | Medium | Need custom worker like TracingWorker |
| Reliability | Excellent | Consumer groups, persistent |
| Latency Impact | None | Non-blocking |
| Infrastructure | None | Uses existing Redis |

### Verdict: **Defer to v2 if Taskiq doesn't scale**

---

## Option D: PostgreSQL Queue (Previous Proposal)

### Why NOT Recommended Now

The previous proposal suggested using PostgreSQL as the queue. Given the existing infrastructure:

| PostgreSQL Queue | Redis Streams (Taskiq) |
|------------------|------------------------|
| New pattern to maintain | Existing pattern |
| Polling-based | Push-based (XREADGROUP) |
| More DB load | Dedicated Redis |
| Custom retry logic | Taskiq handles retries |

**Verdict: Use Redis Streams via Taskiq instead**

---

## Recommendation: Option B (Taskiq + Redis Streams)

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Server                                │
├─────────────────────────────────────────────────────────────────┤
│  POST /configs/deploy                                            │
│    1. Save config to PostgreSQL                                  │
│    2. Find matching webhooks                                     │
│    3. For each webhook: queue task via Taskiq                    │
│       await webhooks_worker.deliver_webhook.kiq(...)             │
│    4. Return response to user                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Redis (redis-durable:6381)                     │
├─────────────────────────────────────────────────────────────────┤
│  Stream: queues:webhooks                                         │
│    - Consumer group: worker-webhooks                             │
│    - Messages: {delivery_id, webhook_id, payload, ...}           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Webhook Worker (Taskiq)                             │
│           (separate process, like worker_evaluations)            │
├─────────────────────────────────────────────────────────────────┤
│  1. Consume task from queue                                      │
│  2. Fetch webhook config (URL, secret)                           │
│  3. Sign payload (HMAC-SHA256)                                   │
│  4. POST to endpoint with timeout                                │
│  5. On success: mark delivered in PostgreSQL                     │
│  6. On failure: Taskiq retries automatically                     │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
api/
├── entrypoints/
│   ├── worker_evaluations.py    # Existing
│   ├── worker_tracing.py        # Existing
│   └── worker_webhooks.py       # NEW: Webhook worker entrypoint
├── oss/src/
│   ├── tasks/
│   │   └── taskiq/
│   │       ├── evaluations/     # Existing
│   │       └── webhooks/        # NEW
│   │           ├── __init__.py
│   │           └── worker.py    # WebhooksWorker class
│   └── services/
│       └── webhook_service.py   # NEW: emit_webhook_event()
```

### Retry Strategy (Taskiq Built-in)

Taskiq supports `retry_on_error=True` and `max_retries`. For custom backoff:

```python
@self.broker.task(
    task_name="webhooks.deliver",
    retry_on_error=True,
    max_retries=6,
)
async def deliver_webhook(...):
    # Calculate delay based on attempt
    if attempt > 1:
        delays = [60, 300, 900, 3600, 14400]  # 1m, 5m, 15m, 1h, 4h
        delay = delays[min(attempt - 2, len(delays) - 1)]
        await asyncio.sleep(delay)
    
    # ... delivery logic
```

### Docker Compose Addition

```yaml
# hosting/docker-compose/oss/docker-compose.dev.yml

worker-webhooks:
    <<: *worker-common
    container_name: agenta-worker-webhooks
    command: ["python", "-m", "entrypoints.worker_webhooks"]
    depends_on:
        redis-durable:
            condition: service_healthy
        postgres:
            condition: service_healthy
```

### Benefits of This Approach

1. **Zero new infrastructure** - Uses existing Redis and Taskiq
2. **Proven pattern** - Same as `worker_evaluations`
3. **Built-in features** - Retries, dead-letter, monitoring
4. **Scalable** - Can run multiple worker instances
5. **Observable** - Taskiq provides task status tracking
