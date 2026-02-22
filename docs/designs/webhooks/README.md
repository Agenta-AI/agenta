# Webhooks

Webhooks enable real-time event notifications from Agenta to external systems. When specific events occur in a project, Agenta sends HTTP POST requests to configured endpoints.

## Features

- **Event Subscriptions**: Subscribe to project events (e.g., config deployments)
- **Secure Delivery**: HMAC-SHA256 signed payloads for verification
- **Automatic Retries**: Exponential backoff with up to 4 HTTP delivery attempts
- **Circuit Breaking**: Prevents repeated delivery attempts to failing endpoints
- **Append-Only Delivery History**: Each attempt creates a new immutable record
- **Test Endpoint**: Verify webhook configuration before activation
- **Project Scoped**: Webhooks are isolated per project

## Code Map

```
api/
├── entrypoints/
│   ├── routers.py                          # Wires WebhooksDAO → WebhooksService → WebhooksRouter, mounts /webhooks
│   └── worker_webhooks.py                  # Worker entrypoint: Redis Stream broker + WebhooksWorker startup
│
├── oss/src/
│   ├── core/webhooks/                      # Business logic layer (no HTTP, no DB drivers)
│   │   ├── config.py                       # All tunable constants (retries, timeouts, jitter)
│   │   ├── dtos.py                         # Typed data contracts between layers
│   │   ├── events.py                       # WebhookEventType enum (add new event types here)
│   │   ├── interfaces.py                   # WebhooksDAOInterface — contract the service depends on
│   │   ├── service.py                      # WebhooksService: create/query/update/archive/trigger/test
│   │   ├── tasks.py                        # deliver_webhook(): HTTP attempt, signature, append-only writes
│   │   ├── circuit_breaker.py              # CircuitBreaker: per-subscription in-memory state machine
│   │   ├── trigger.py                      # trigger_webhook() helper with lazy DAO import (breaks circular deps)
│   │   ├── utils.py                        # calculate_next_retry(): exponential backoff + jitter
│   │   └── __init__.py                     # Lazy re-export of trigger_webhook via __getattr__
│   │
│   ├── apis/fastapi/webhooks/              # HTTP layer
│   │   ├── router.py                       # WebhooksRouter: route registration + permission checks
│   │   └── models.py                       # Request/response Pydantic models (separate from core DTOs)
│   │
│   └── dbs/postgres/
│       ├── webhooks/                       # Subscription persistence (core database)
│       │   ├── dbas.py                     # WebhookSubscriptionDBA + WebhookDeliveryDBA (column definitions)
│       │   ├── dbes.py                     # WebhookSubscriptionDBE (SQLAlchemy entity, core DB)
│       │   ├── dao.py                      # WebhooksDAO: all DB reads/writes for subscriptions + deliveries
│       │   └── mappings.py                 # DBE ↔ DTO mapping functions
│       │
│       └── tracing/
│           └── webhook_dbes.py             # WebhookDeliveryDBE (SQLAlchemy entity, tracing DB, append-only)
│
└── tasks/taskiq/webhooks/
    └── worker.py                           # WebhooksWorker: registers deliver_webhook task with Taskiq broker
```

### Where to make common changes

| Change | File |
|--------|------|
| Add a new event type | `core/webhooks/events.py` |
| Change retry/timeout settings | `core/webhooks/config.py` |
| Modify delivery HTTP logic | `core/webhooks/tasks.py` |
| Add a new API endpoint | `apis/fastapi/webhooks/router.py` + `models.py` |
| Change circuit breaker thresholds | `core/webhooks/circuit_breaker.py` |
| Add a new subscription query filter | `dbs/postgres/webhooks/dao.py` |
| Wire a new caller to emit events | Call `trigger_webhook()` from the relevant router/service |

## Database Schema

### webhook_subscriptions (core database)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier (UUIDv7) |
| project_id | UUID | FOREIGN KEY → projects (CASCADE) | Project owner |
| name | VARCHAR(255) | NOT NULL | Subscription name |
| url | VARCHAR(2048) | NOT NULL | Endpoint URL (HTTPS or localhost) |
| events | TEXT[] | NOT NULL | Event types to subscribe to |
| secret | VARCHAR(128) | NOT NULL | HMAC signing secret (32 random chars) |
| is_active | BOOLEAN | DEFAULT TRUE | Enable/disable subscription |
| meta | JSONB | | Extensible metadata |
| created_at | TIMESTAMP WITH TIME ZONE | NOT NULL | Creation timestamp |
| updated_at | TIMESTAMP WITH TIME ZONE | NOT NULL | Last update timestamp |
| created_by_id | UUID | FOREIGN KEY → users (SET NULL) | Creator user |
| archived_at | TIMESTAMP WITH TIME ZONE | | Soft delete marker (NULL = active) |

**Index**: `ix_webhook_subscriptions_project_id` on `project_id` (filtered on `archived_at IS NULL`)

### webhook_deliveries (tracing database, append-only)

Each HTTP attempt INSERTs a new row — existing rows are **never updated**. All attempts for the same event delivery share a `delivery_id` (the grouping key). This table lives in the tracing database and has **no foreign key** to `webhook_subscriptions` (cross-DB).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique per-attempt identifier (UUIDv7) |
| delivery_id | UUID | NOT NULL, INDEXED | Groups all attempts for one event delivery |
| subscription_id | UUID | NOT NULL | Target subscription (no FK — cross-DB) |
| event_type | VARCHAR(100) | NOT NULL | Event type string |
| payload | JSONB | NOT NULL | Delivered event payload |
| attempt_number | INTEGER | NOT NULL | Sequence number (1 = initial pending) |
| max_attempts | INTEGER | NOT NULL | Maximum attempts (= `WEBHOOK_MAX_RETRIES`) |
| status | VARCHAR(20) | NOT NULL | `pending` / `retrying` / `success` / `failed` |
| status_code | INTEGER | | HTTP response code (NULL on network error) |
| response_body | TEXT | MAX 2000 chars | Response body (truncated) |
| error_message | TEXT | | Error details |
| duration_ms | INTEGER | | HTTP request duration in milliseconds |
| url | VARCHAR(2048) | NOT NULL | URL used for this attempt |
| delivered_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Record insertion time |

**Indexes**:
- `ix_webhook_deliveries_delivery_id_attempt` on `(delivery_id, attempt_number)`
- `ix_webhook_deliveries_subscription_id_delivered_at` on `(subscription_id, delivered_at)`

### Attempt Sequence

```
attempt_number=1  status=pending   ← written by service (before enqueue)
attempt_number=2  status=retrying  ← first HTTP attempt failed
attempt_number=3  status=retrying  ← second HTTP attempt failed
attempt_number=4  status=retrying  ← third HTTP attempt failed
attempt_number=5  status=failed    ← fourth (final) HTTP attempt failed
```

With `WEBHOOK_MAX_RETRIES=5`, there are at most **4 actual HTTP delivery attempts** (attempt numbers 2–5).

## Available Events

| Event Type | Description | Payload Fields |
|------------|-------------|----------------|
| `config.deployed` | Configuration deployed to environment | `variant_id`, `environment_name`, `deployed_by`, `timestamp`, `version` |

## Webhook Request Format

### Headers

Production deliveries send:
```
Content-Type: application/json
X-Agenta-Signature: t=<timestamp>,v1=<hmac_sha256_hex>
X-Agenta-Delivery-ID: <delivery_record_uuid>
X-Agenta-Event-Type: <event_type>
User-Agent: Agenta-Webhook/1.0
```

Test requests (`POST /test`) send `X-Agenta-Event` and `X-Agenta-Delivery` instead of the `-ID`/`-Type` variants, and use `User-Agent: Agenta-Webhook-Test/1.0`.

### Signature Verification

```
HMAC-SHA256(secret, "<unix_timestamp>.<json_payload>")
```

`json_payload` uses sorted keys and no whitespace (`separators=(",", ":")`). The header format is `t=<timestamp>,v1=<hex_digest>`.

### Body Structure

```json
{
  "event_type": "config.deployed",
  "data": {
    "variant_id": "uuid",
    "environment_name": "production",
    "deployed_by": "user_uuid",
    "timestamp": "2024-01-01T00:00:00Z",
    "version": 1
  }
}
```

Test requests include `"test": true` and a `"triggered_by"` field in `data`.

## Retry Behavior

| HTTP Attempt | attempt_number | Delay before attempt |
|-------------|----------------|----------------------|
| 1st | 2 | immediate |
| 2nd | 3 | ~1 second |
| 3rd | 4 | ~5 seconds |
| 4th (final) | 5 | ~25 seconds |

Delays include ±20% jitter. After all attempts are exhausted, the final record is written with `status="failed"`.

## Circuit Breaker

After 5 failures within 60 seconds, the circuit opens and stops delivery attempts for 5 minutes. When open, the worker inserts a `status="retrying"` record and exits without raising (preventing Taskiq from re-queuing). After cooldown, one test delivery is attempted (HALF_OPEN). Success closes the circuit; failure reopens it.

State is **per-subscription** and **in-memory** — lost on worker restart.

## Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| `WEBHOOK_MAX_RETRIES` | 5 | Total records including initial pending (4 actual HTTP attempts) |
| `WEBHOOK_RETRY_BASE_DELAY` | 1.0s | Initial retry delay |
| `WEBHOOK_RETRY_MULTIPLIER` | 5.0 | Exponential backoff multiplier |
| `WEBHOOK_RETRY_MAX_DELAY` | 600s | Maximum retry delay (10 min) |
| `WEBHOOK_RETRY_JITTER_FACTOR` | 0.2 | ±20% jitter |
| `WEBHOOK_TIMEOUT` | 10s | Request timeout (production deliveries) |
| Test endpoint timeout | 5s | `httpx` timeout for test requests |
| Circuit breaker threshold | 5 failures / 60s | Opens circuit |
| Circuit breaker cooldown | 300s | Cooldown period (5 min) |
| Max concurrent deliveries | 50 | Worker concurrency |

## API Endpoints

All endpoints are mounted under `/webhooks` and require `project_id` in the request context.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `POST` | `/` | `EDIT_WEBHOOKS` | Create subscription |
| `POST` | `/query` | `VIEW_WEBHOOKS` | Query subscriptions (filterable, paginated, cached) |
| `POST` | `/test` | `EDIT_WEBHOOKS` | Test a webhook endpoint |
| `GET` | `/{subscription_id}` | `VIEW_WEBHOOKS` | Get subscription details |
| `PUT` | `/{subscription_id}` | `EDIT_WEBHOOKS` | Update subscription |
| `POST` | `/{subscription_id}/archive` | `EDIT_WEBHOOKS` | Archive (soft-delete) subscription |

The `/test` response includes `test_secret`, `signature_format`, and `signing_payload` so the caller can verify the signature locally.

## Not Implemented

The following capabilities are deliberately out of scope for the current implementation. Each represents a meaningful architectural gap that will need its own design pass before being built.

### Event Bus System

Events are triggered by direct in-process function calls (`trigger_webhook(...)`) from within the API handler. There is no shared event bus, so:

- **No fan-out routing**: If a second consumer of the same event is added (audit logging, evaluations), each must be called independently with no central dispatcher.
- **No event schema registry**: Payloads are plain dicts with no enforced schema, versioning, or validation contract between producers and consumers.
- **No replay or rewind**: If no subscriptions exist when an event fires, it is silently dropped and cannot be recovered.
- **Silent loss on enqueue failure**: If Redis is unavailable, enqueuing fails silently (broad `except Exception`) and the event is gone.

A proper event bus would accept typed event objects, persist them to a durable store, and fan out to registered consumers without producers knowing who consumes.

### Rate Limiting

There is no rate limiting at any layer:

- **No per-subscription limit**: A single subscription can receive an unbounded number of deliveries per minute, exhausting the worker pool.
- **No per-project limit**: A high-traffic project can saturate the Redis Stream queue for all other projects.
- **No test endpoint throttling**: `POST /test` makes a synchronous outbound HTTP call on every request with no limit per user or project.

The circuit breaker protects the downstream endpoint from Agenta's retries, but does not throttle Agenta's own delivery rate. Rate limiting would require a Redis sliding-window counter checked at `trigger_event` time.

### Entitlement

Beyond EE permission checks (`EDIT_WEBHOOKS`, `VIEW_WEBHOOKS`), there is no entitlement enforcement:

- **No subscription count cap**: Any project can create unlimited subscriptions with no enforcement in the service or DAO.
- **No event type gating**: All event types are available on all plan tiers.
- **No delivery volume cap**: No monthly or daily limit on deliveries triggered or received.
- **No worker-level quota**: The worker processes any enqueued task regardless of the project's plan.

Entitlement would require quota checks in `WebhooksService.create_subscription()`, a delivery volume meter incremented at enqueue time, and plan-tier gating via the existing `is_ee()` pattern or a plan-check in the service layer.

## Risks and Considerations

### Performance
- `webhook_deliveries` grows indefinitely (no retention policy)
- Worker pool saturation at 50 concurrent tasks under high event volume
- Circuit breaker state lost on restart, resetting all per-subscription failure counters

### Security
- Signing secrets stored in plaintext in the database
- No IP validation — internal network addresses can be registered (SSRF risk)
- No timestamp freshness window — stale signatures are accepted (replay attack risk)

### Operational
- No alerting on delivery failures or circuit breaker activations
- Subscription mutations (create/update/archive) are not separately audit-logged
- Multiple worker instances each have independent in-memory circuit breaker state
