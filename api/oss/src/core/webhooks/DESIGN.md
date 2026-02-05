# Webhook System Design

## Architecture Overview

The webhook system implements an event-driven, asynchronous architecture for delivering HTTP notifications when workspace events occur. The design emphasizes reliability, fault tolerance, and non-blocking execution.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Event Source Layer                             │
│  ┌────────────────┐    ┌────────────────┐    ┌──────────────────────┐   │
│  │ variants_router│    │  Future Sources│    │  Future Sources      │   │
│  │  (deploys)     │    │ (evaluations)  │    │  (other events)      │   │
│  └───────┬────────┘    └───────┬────────┘    └──────────┬───────────┘   │
│          │                     │                         │               │
│          └─────────────────────┼─────────────────────────┘               │
│                                ↓                                         │
│                    trigger_webhook(workspace_id, event_type, payload)   │
└─────────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Business Logic Layer                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     WebhooksService                              │    │
│  │                                                                  │    │
│  │  trigger_event(workspace_id, event_type, payload):              │    │
│  │    1. Create WebhookEventDB (outbox pattern)                    │    │
│  │    2. Find active subscriptions for event_type                  │    │
│  │    3. Create WebhookDeliveryDB for each subscription            │    │
│  │    4. Enqueue delivery task to worker                           │    │
│  └──────────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Persistence Layer                                │
│  ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │webhook_subscriptions │  │ webhook_events   │  │webhook_deliveries│  │
│  │                      │  │                  │  │                  │  │
│  │ - workspace_id       │  │ - event_type     │  │ - subscription_id│  │
│  │ - url                │  │ - payload        │  │ - status         │  │
│  │ - events[]           │  │ - processed      │  │ - attempts       │  │
│  │ - secret (HMAC)      │  │ - created_at     │  │ - next_retry_at  │  │
│  │ - is_active          │  │                  │  │ - response_*     │  │
│  └──────────────────────┘  └──────────────────┘  └──────────────────┘  │
│                          PostgreSQL                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Task Queue Layer                                 │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Redis Stream (durable)                         │   │
│  │  Queue: "queues:webhooks"                                         │   │
│  │  Consumer Group: "worker-webhooks"                                │   │
│  │  Concurrency: 50 tasks                                            │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Worker Layer                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              WebhooksWorker (Taskiq)                              │   │
│  │                                                                   │   │
│  │  deliver_webhook(delivery_id):                                   │   │
│  │    1. Fetch delivery + subscription from DB                      │   │
│  │    2. Check circuit breaker                                      │   │
│  │    3. Generate HMAC signature                                    │   │
│  │    4. HTTP POST with signed payload                              │   │
│  │    5. Update delivery status in DB                               │   │
│  │    6. Record circuit breaker outcome                             │   │
│  │    7. Raise exception for retry (if needed)                      │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      Circuit Breaker Layer                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              CircuitBreaker (per-subscription)                    │   │
│  │                                                                   │   │
│  │  States: CLOSED → OPEN → HALF_OPEN → CLOSED                      │   │
│  │                                                                   │   │
│  │  Thresholds:                                                      │   │
│  │    - 5 failures in 60 seconds → OPEN                             │   │
│  │    - 5 minute cooldown                                           │   │
│  │    - 1 test request in HALF_OPEN                                 │   │
│  │                                                                   │   │
│  │  In-memory state (per subscription_id)                           │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      Delivery & Retry Layer                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              Exponential Backoff Strategy                         │   │
│  │                                                                   │   │
│  │  delay = min(base * (multiplier^attempt), max_delay) ± jitter   │   │
│  │                                                                   │   │
│  │  Attempt schedule:                                                │   │
│  │    0: immediate                                                   │   │
│  │    1: ~1 second                                                   │   │
│  │    2: ~5 seconds                                                  │   │
│  │    3: ~25 seconds                                                 │   │
│  │    4: ~125 seconds                                                │   │
│  │    5: ~625 seconds (capped at 600s)                              │   │
│  │                                                                   │   │
│  │  Jitter: ±20% randomization                                       │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      External Webhook Endpoint                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │          Customer HTTPS Endpoint                                  │   │
│  │                                                                   │   │
│  │  Receives:                                                        │   │
│  │    - Headers: X-Agenta-Signature, X-Agenta-Event-ID              │   │
│  │    - Body: {event_type, data}                                    │   │
│  │                                                                   │   │
│  │  Verifies:                                                        │   │
│  │    - HMAC-SHA256 signature                                       │   │
│  │    - Timestamp freshness (optional)                              │   │
│  │                                                                   │   │
│  │  Returns:                                                         │   │
│  │    - 2xx: Success (delivery marked complete)                     │   │
│  │    - 4xx/5xx: Failure (retry or mark failed)                     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Design Patterns

### 1. Outbox Pattern

**Implementation**: `webhook_events` table

**Purpose**: Ensures events are durably recorded before async processing

**Flow**:
```
1. Event occurs (e.g., config deployed)
2. WebhookEventDB row created in same transaction
3. Event marked as processed after deliveries enqueued
4. Survives process crashes and database failures
```

**Trade-offs**:
- ✓ Durability: No event loss even if worker crashes
- ✓ Auditability: Complete event history in database
- ✗ Storage overhead: Events never deleted (no retention policy)
- ✗ Processing overhead: Additional database write per event

### 2. Circuit Breaker Pattern

**Implementation**: `CircuitBreaker` class (in-memory state)

**Purpose**: Prevents cascading failures from repeatedly attempting delivery to failing endpoints

**States**:
```
CLOSED (normal operation)
  → 5 failures in 60s
OPEN (reject all requests)
  → 5 minute cooldown
HALF_OPEN (allow 1 test)
  → success: CLOSED | failure: OPEN
```

**Trade-offs**:
- ✓ Protects worker pool from wasted attempts
- ✓ Per-subscription isolation (bad endpoints don't affect others)
- ✗ In-memory state lost on worker restart
- ✗ No distributed coordination (multiple workers have separate state)
- ✗ No alerting when circuit opens

### 3. Exponential Backoff with Jitter

**Implementation**: `calculate_next_retry` in `utils.py`

**Formula**: `delay = min(base * (multiplier^attempt), max_delay) ± jitter`

**Purpose**: Prevents thundering herd and respects endpoint recovery time

**Trade-offs**:
- ✓ Reduces retry storm impact
- ✓ Gives endpoints time to recover
- ✗ Delays can extend to 10 minutes (long wait for final attempt)
- ✗ No adaptive backoff (fixed parameters)

### 4. Lazy Initialization

**Implementation**: `trigger.py` lazy imports

**Purpose**: Avoids circular import dependencies between modules

**Trade-offs**:
- ✓ Breaks circular dependency chains
- ✓ Reduces module coupling
- ✗ Initialization cost on first call
- ✗ Errors delayed until runtime (not import time)

## Data Flow

### 1. Subscription Creation

```
User → Frontend → API (/POST /webhooks)
    → WebhooksService.create_subscription()
    → Generate random 32-char secret
    → WebhooksDAO.create_subscription()
    → Insert webhook_subscriptions row
    → Return subscription (secret included once)
```

### 2. Event Triggering

```
Event occurs (e.g., config deployed)
    → variants_router.py calls trigger_webhook()
    → WebhooksService.trigger_event()
    → Insert webhook_events row (outbox)
    → Query active subscriptions matching event_type
    → For each subscription:
        → Insert webhook_deliveries row (status=pending)
        → Enqueue deliver_webhook task to Redis Stream
    → Mark event as processed
```

### 3. Delivery Attempt

```
WebhooksWorker picks task from Redis Stream
    → deliver_webhook(delivery_id)
    → Fetch delivery + subscription from DB
    → Check circuit_breaker.is_open(subscription_id)
        → If OPEN: set next_retry_at, return (no attempt)
    → Generate HMAC signature:
        payload_json = json.dumps(payload, sort_keys=True)
        signature = HMAC-SHA256(secret, f"{timestamp}.{payload_json}")
    → HTTP POST with headers:
        X-Agenta-Signature: t=<timestamp>,v1=<signature>
        X-Agenta-Event-ID: <event_id>
    → On success (2xx):
        → circuit_breaker.record_success()
        → Update delivery: status=success, delivered_at=now()
    → On failure (timeout, 4xx, 5xx):
        → circuit_breaker.record_failure()
        → If attempts < max_attempts:
            → Calculate next_retry_at (exponential backoff)
            → Update delivery: status=retrying, next_retry_at
            → Raise exception (triggers Taskiq retry)
        → Else:
            → Update delivery: status=failed, failed_at=now()
```

### 4. Circuit Breaker State Transitions

```
CLOSED (normal):
    → Record failure
    → If failures >= 5 in 60s window: transition to OPEN

OPEN (rejecting):
    → On is_open() check:
        → If cooldown elapsed (5 min): transition to HALF_OPEN, return False
        → Else: return True (reject delivery)

HALF_OPEN (testing):
    → Allow 1 delivery attempt
    → On success: transition to CLOSED
    → On failure: transition to OPEN
```



## Technology Choices

- PostgreSQL for Persistence
- Taskiq + Redis Streams for Task Queue
- In-Memory Circuit Breaker
- HMAC-SHA256 Signatures

## Future Improvements

- **Observability**: OpenTelemetry tracing, Prometheus metrics (delivery/latency), and structured logging.
- **Operational**: Retention policy (30-day default), Redis-backed circuit breaker state, and failure alerting.
- **Security**: Timestamp validation (5-min freshness), internal IP blocking, and encrypted secrets.
- **Features**: Event filtering, delivery replay, webhook templates, and additional event types.
- **Advanced**: Bulk operations, rate limiting, and mutual TLS support.

## Deployment Considerations

### Worker Scaling

Current: 1 worker with 50 concurrent tasks

**Recommendations**:
- Horizontal scaling: Multiple worker instances with shared Redis Stream
- Vertical scaling: Increase concurrent task limit (requires monitoring)
- Auto-scaling: Scale based on queue depth and delivery latency

### Database Maintenance

**Required**:
- Regular VACUUM on deliveries table (high insert volume)
- Index monitoring (ix_webhook_deliveries_retry)
- Partition deliveries table by created_at (monthly)

**Retention Policy**:
- Archive deliveries older than 30 days to cold storage
- Delete archived subscriptions older than 90 days
- Compress old events table

### Monitoring

**Critical Metrics**:
- Queue depth (queues:webhooks)
- Delivery success rate (per subscription, per workspace)
- Circuit breaker open count
- Worker task processing time (p95, p99)
- Database connection pool utilization

**Alerts**:
- Queue depth > 1000 messages
- Delivery success rate < 50% over 5 minutes
- Circuit breaker open for > 10 minutes
- Worker processing time p99 > 30 seconds

### Circuit Breaker Persistence

**Current**: In-memory (lost on restart)

**Recommendation**: Persist state to Redis with TTL
```
Key: circuit_breaker:<subscription_id>
Value: {state, failures: [{timestamp}], opened_at}
TTL: 10 minutes
```

**Benefits**:
- Survives worker restarts
- Shared across multiple workers
- Queryable state for debugging

## Conclusion

The webhook system implements a production-capable event notification architecture with focus on reliability and simplicity. The design prioritizes:

1. **Event durability** via outbox pattern
2. **Fault tolerance** via automatic retries and circuit breaking
3. **Security** via HMAC signing
4. **Workspace isolation** for multi-tenancy

Current limitations center on observability, performance optimization, and feature completeness. The modular architecture allows incremental enhancement without major refactoring.

Critical next steps:
1. Add observability (tracing, metrics, alerting)
2. Implement retention policies
3. Persist circuit breaker state
4. Expand event types and filtering capabilities
