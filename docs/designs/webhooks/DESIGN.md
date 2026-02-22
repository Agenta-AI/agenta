# Webhook System Design

## Architecture Overview

The webhook system implements an event-driven, asynchronous architecture for delivering HTTP notifications when project events occur. The design emphasizes reliability, fault tolerance, and non-blocking execution through a layered approach: API → Service → DAO → Worker → Delivery.

A central design principle is the **Append-Only Delivery Pattern**: the `webhook_deliveries` table is treated as an immutable event log. Every delivery attempt INSERTs a new row; no existing row is ever updated. Rows for the same event delivery are grouped by `delivery_id`.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Event Source Layer                            │
│  ┌────────────────┐    ┌────────────────┐    ┌──────────────────────┐  │
│  │ variants_router│    │  Future Sources│    │  Future Sources      │  │
│  │  (deploys)     │    │ (evaluations)  │    │  (other events)      │  │
│  └───────┬────────┘    └───────┬────────┘    └──────────┬───────────┘  │
│          └─────────────────────┼─────────────────────────┘              │
│                                ↓                                        │
│              trigger_webhook(project_id, event_type, payload)           │
└─────────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Business Logic Layer                             │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                       WebhooksService                             │   │
│  │                                                                   │   │
│  │  trigger_event(project_id, event_type, payload):                 │   │
│  │    1. Find active subscriptions for event_type + project_id      │   │
│  │    2. For each subscription (independently, errors isolated):    │   │
│  │       a. INSERT delivery record (attempt_number=1, pending)      │   │
│  │       b. Enqueue deliver_webhook task to Redis Stream             │   │
│  └────────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                  Persistence Layer (two databases)                       │
│                                                                          │
│  Core DB (PostgreSQL)          Tracing DB (PostgreSQL, append-only)     │
│  ┌──────────────────────┐      ┌────────────────────────────────────┐   │
│  │ webhook_subscriptions│      │ webhook_deliveries                 │   │
│  │                      │      │                                    │   │
│  │ - id (UUIDv7)        │      │ - id (UUIDv7, per-attempt PK)     │   │
│  │ - project_id (FK)    │      │ - delivery_id (groups attempts)   │   │
│  │ - url                │      │ - subscription_id (no FK)         │   │
│  │ - events[]           │      │ - attempt_number                  │   │
│  │ - secret (HMAC)      │      │ - status (pending/retrying/       │   │
│  │ - is_active          │      │           success/failed)         │   │
│  │ - archived_at        │      │ - status_code, response_body      │   │
│  └──────────────────────┘      │ - error_message, duration_ms      │   │
│                                 └────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Task Queue Layer                                 │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              Redis Stream (durable connection)                    │   │
│  │  Queue: "queues:webhooks"  Consumer Group: "worker-webhooks"     │   │
│  │  Concurrency: 50 tasks                                           │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Worker Layer                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              WebhooksWorker (Taskiq)                              │   │
│  │                                                                   │   │
│  │  deliver_webhook(delivery_id):                                   │   │
│  │    1. Fetch latest delivery record by delivery_id               │   │
│  │    2. Idempotency check (skip if already success/final-failed)  │   │
│  │    3. Fetch subscription (skip if inactive/missing)             │   │
│  │    4. Check circuit breaker (INSERT skipped record if open)     │   │
│  │    5. Generate HMAC-SHA256 signature                            │   │
│  │    6. HTTP POST with signed payload                             │   │
│  │    7. INSERT new record with attempt result                     │   │
│  │    8. Raise exception to trigger Taskiq retry (if retrying)    │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      External Webhook Endpoint                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Receives: X-Agenta-Signature, X-Agenta-Delivery-ID,            │   │
│  │            X-Agenta-Event-Type, Body: {event_type, data}        │   │
│  │  Returns:                                                         │   │
│  │    2xx      → INSERT success record, circuit.record_success()   │   │
│  │    4xx/5xx  → INSERT retry/failed record, raise for Taskiq      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Design Patterns

### 1. Append-Only Delivery Pattern

**Implementation**: `WebhookDeliveryDBE` in tracing DB; `create_delivery` and `create_retry` in `WebhooksDAO`

**Purpose**: Treat the delivery table as an immutable event log. Every state transition INSERTs a new row; no row is ever UPDATEd or DELETEd.

**Mechanics**:
- The first record is created by the service with `attempt_number=1`, `status="pending"`.
- The worker fetches the row with the highest `attempt_number` for a given `delivery_id` to determine current state.
- After each HTTP attempt, a new record is INSERTed with `attempt_number=latest+1` and the outcome.
- `delivery_id` groups all records for one event delivery; it is distinct from `id` (the per-attempt PK).

**Trade-offs**:
- ✓ Complete audit trail of every delivery attempt
- ✓ No UPDATE contention under concurrent retries
- ✓ Simple idempotency (check latest record's status before acting)
- ✗ Storage grows linearly with retry count (up to 5 rows per delivery)
- ✗ Querying current state requires `ORDER BY attempt_number DESC LIMIT 1`
- ✗ No built-in retention policy

### 2. Circuit Breaker Pattern

**Implementation**: `CircuitBreaker` class in `circuit_breaker.py` (in-memory, global singleton per worker process)

**Purpose**: Prevent cascading failures by stopping delivery attempts to consistently failing endpoints.

**States**:
```
CLOSED  → 5 failures within 60s → OPEN
OPEN    → 5 minute cooldown     → HALF_OPEN
HALF_OPEN → success: CLOSED | failure: OPEN
```

**Circuit-open behavior**: When open, the worker INSERTs a `status="retrying"` record and returns **without raising**. This prevents Taskiq from immediately re-queuing, avoiding hot-retry loops.

**Trade-offs**:
- ✓ Per-subscription isolation (one bad endpoint doesn't affect others)
- ✓ `asyncio.Lock()` ensures async-safe state transitions
- ✗ In-memory: state lost on worker restart, not shared across worker instances
- ✗ No alerting when a circuit opens

### 3. Exponential Backoff with Jitter

**Implementation**: `calculate_next_retry` in `utils.py`; delay applied via Taskiq's retry mechanism

**Formula**: `delay = min(base * (multiplier^attempt), max_delay) ± jitter`

**Purpose**: Reduce retry storm impact and give endpoints time to recover.

**Trade-offs**:
- ✓ Jitter (±20%) spreads retries across subscriptions
- ✗ Final attempt delayed up to 10 minutes
- ✗ Fixed parameters, not adaptive

### 4. Query Caching

**Implementation**: `get_cache` / `set_cache` / `invalidate_cache`; namespace `webhook_query_subscriptions`

**Cache key**: Built from all filter and pagination fields; `None` values excluded. Invalidated on any subscription mutation (create, update, archive).

**Trade-offs**:
- ✓ Reduces DB read load for frequently polled subscription lists
- ✗ Relies on explicit invalidation, no TTL-based expiry fallback

### 5. Lazy Initialization

**Implementation**: `trigger.py` and `__init__.py`

**Purpose**: Break circular import dependencies between the webhook module and its callers (e.g., `variants_router`). `trigger.py` lazily imports `WebhooksDAO` on first call; `__init__.py` exposes `trigger_webhook` via `__getattr__`.

**Trade-offs**:
- ✓ Prevents circular import errors at module initialization
- ✗ Import errors deferred to first call, not caught at startup

## Data Flow

### Event Triggering

```
Event occurs (e.g., config deployed)
  → trigger_webhook(project_id, event_type, payload)
  → WebhooksService.trigger_event()
    → dao.get_active_subscriptions_for_event(project_id, event_type)
    → For each subscription (errors isolated per-subscription):
        → dao.create_delivery()
            → INSERT webhook_deliveries (attempt_number=1, status="pending")
        → worker.deliver_webhook.kiq(delivery_id=delivery.id)
            → Enqueue to Redis Stream
        → On enqueue failure: log.error, continue to next subscription
```

Note: enqueue failures are caught by a broad `except Exception` and logged but not propagated. A Redis outage silently drops the event with no dead-letter or alerting.

### Delivery Attempt (Worker)

```
Taskiq picks task from Redis Stream
  → deliver_webhook(delivery_id)

  1. Fetch state
     → dao.get_latest_delivery(delivery_id)  [ORDER BY attempt_number DESC LIMIT 1]
     → If not found: log error, return
     → If status="success": return (idempotency)
     → If attempt_number >= max_attempts AND status="failed": return (idempotency)

  2. Fetch subscription
     → If not found or inactive: INSERT failed record, return

  3. Circuit breaker
     → If OPEN: INSERT retrying record (error="Circuit breaker open"), return
       (no HTTP call, no Taskiq retry raised)

  4. Sign payload
     → payload_json = json.dumps(payload, sort_keys=True, separators=(",",":"))
     → to_sign = f"{unix_timestamp}.{payload_json}"
     → signature = HMAC-SHA256(secret, to_sign).hexdigest()

  5. HTTP POST (timeout=10s)
     → response.raise_for_status()

  6. Record result
     → success (2xx):
         circuit.record_success() → INSERT success record → return
     → failure (timeout / 4xx / 5xx):
         circuit.record_failure()
         status = "retrying" if attempt+1 < WEBHOOK_MAX_RETRIES else "failed"
         INSERT record with status + error details
         If "retrying": raise exception → Taskiq schedules retry
```

### Test Webhook Flow

```
POST /webhooks/test {url, event_type, subscription_id?}
  → WebhooksService.test_webhook()
    → Generate temporary 32-char test_secret
    → Build payload with "test": true, real project_id
    → Sign with test_secret (same algorithm as production)
    → httpx.AsyncClient(timeout=5.0).post(url)
    → If subscription_id provided:
        → dao.record_test_delivery() [max_attempts=1, single record]
    → Return {success, status_code, response_body, duration_ms,
              test_secret, signature_format, signing_payload}
```

## Technology Choices

**Two PostgreSQL databases**: `webhook_subscriptions` in the core DB (mutable configuration); `webhook_deliveries` in the tracing DB (append-only history). This mirrors the broader Agenta pattern of separating operational data from observability data, allowing independent scaling and retention policies.

**Taskiq + Redis Streams**: Redis Streams with a durable connection provide message persistence until acknowledged (survives consumer restart), consumer group fan-out for horizontal scaling, and observable queue depth for scaling decisions.

**In-memory circuit breaker**: A module-level singleton shared across all concurrent Taskiq tasks in a single worker process. Simpler than a distributed Redis-backed solution but loses state on restart and is not shared between worker instances.

**HMAC-SHA256 signatures**: Signing payload is `{timestamp}.{sorted_json}`, tying the signature to both content and time. Customers can verify authenticity and optionally enforce a freshness window on the timestamp.

## Future Improvements

### Observability
- OpenTelemetry tracing for the delivery lifecycle (enqueue → attempt → outcome)
- Prometheus metrics: delivery success rate, retry count, queue depth, latency (p95/p99)
- Structured logging with `delivery_id` and `subscription_id` as correlation fields
- Alerting when a circuit opens or delivery success rate drops below a threshold

### Operational
- **Retention policy**: Archive `webhook_deliveries` rows older than 30 days; purge archived subscriptions after 90 days
- **Redis-backed circuit breaker**: Persist state as `circuit_breaker:<subscription_id>` with TTL for restart resilience and multi-worker coordination
- **Partition `webhook_deliveries`** by `delivered_at` (monthly) for large deployments

### Security
- **Timestamp validation**: Reject signatures older than a freshness window (e.g., 5 minutes) to prevent replay attacks
- **Internal IP blocking**: Validate endpoint URLs against SSRF block lists before enqueuing
- **Secret encryption**: Application-level encryption of secrets before DB write
- **Secret rotation**: `POST /{id}/rotate-secret` endpoint

### Features
- **Event filtering**: Subscriptions filter on payload fields (e.g., `environment_name=production`)
- **Delivery replay**: Re-trigger failed deliveries via API
- **Additional event types**: `config.updated`, `evaluation.completed`, etc.

## Deployment Considerations

### Worker Scaling

**Current**: 1 worker process, 50 concurrent Taskiq tasks.

- **Horizontal**: Multiple instances consuming from the same Redis Stream consumer group. Each maintains independent in-memory circuit breaker state.
- **Auto-scaling**: Scale on Redis Stream queue depth (`XLEN queues:webhooks`).

### Database Maintenance

- Regular `VACUUM` on `webhook_deliveries` (high-volume INSERT-only table)
- Monitor index usage on `ix_webhook_deliveries_delivery_id_attempt`
- Archive delivery rows older than 30 days; purge archived subscriptions older than 90 days

### Monitoring

**Key metrics**: Redis Stream queue depth, delivery success rate per subscription/project, open circuit breaker count, worker p95/p99 task processing time.

**Alert thresholds**: queue depth > 1,000; success rate < 50% over 5 min; circuit open > 10 min; p99 processing time > 30s.
