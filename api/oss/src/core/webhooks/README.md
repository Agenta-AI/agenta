# Webhooks

Webhooks enable real-time event notifications from Agenta to external systems. When specific events occur in a workspace, Agenta sends HTTP POST requests to configured endpoints.

## Features

- **Event Subscriptions**: Subscribe to workspace events (e.g., config deployments)
- **Secure Delivery**: HMAC-SHA256 signed payloads for verification
- **Automatic Retries**: Exponential backoff with up to 5 retry attempts
- **Circuit Breaking**: Prevents repeated delivery attempts to failing endpoints
- **Delivery History**: Audit trail of all webhook delivery attempts
- **Test Endpoint**: Verify webhook configuration before activation
- **Workspace Scoped**: Webhooks are isolated per workspace

## Database Schema

### webhook_subscriptions

Stores user-configured webhook endpoints.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| workspace_id | UUID | FOREIGN KEY → workspaces (CASCADE) | Workspace owner |
| name | VARCHAR(255) | NOT NULL | Subscription name |
| url | VARCHAR(2048) | NOT NULL, CHECK (HTTPS or localhost) | Endpoint URL |
| events | TEXT[] | NOT NULL | Event types to subscribe to |
| secret | VARCHAR(128) | NOT NULL | HMAC signing secret (32 chars) |
| is_active | BOOLEAN | DEFAULT TRUE | Enable/disable subscription |
| meta | JSONB | | Extensible metadata |
| created_at | TIMESTAMP | NOT NULL | Creation timestamp |
| updated_at | TIMESTAMP | NOT NULL | Last update timestamp |
| created_by_id | UUID | FOREIGN KEY → users (SET NULL) | Creator user |
| archived_at | TIMESTAMP | | Soft delete marker |

**Index**: `ix_webhook_subscriptions_workspace_id` (filtered on `archived_at IS NULL`)

### webhook_events

Event outbox/audit log implementing the outbox pattern.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| workspace_id | UUID | NOT NULL | Workspace context |
| event_type | VARCHAR(100) | NOT NULL | Event type identifier |
| payload | JSONB | NOT NULL | Event data |
| created_at | TIMESTAMP | NOT NULL | Event creation time |
| processed | BOOLEAN | DEFAULT FALSE | Processing status |
| processed_at | TIMESTAMP | | Processing completion time |

**Index**: `ix_webhook_events_unprocessed` (filtered on `processed = false`)

### webhook_deliveries

Delivery attempt history and status tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| subscription_id | UUID | FOREIGN KEY → subscriptions (CASCADE) | Target subscription |
| event_id | UUID | FOREIGN KEY → events (SET NULL) | Source event |
| event_type | VARCHAR(100) | NOT NULL | Event type |
| payload | JSONB | NOT NULL | Delivered payload |
| status | VARCHAR(20) | NOT NULL | pending/success/failed/retrying |
| attempts | INTEGER | NOT NULL | Delivery attempt count (0-based) |
| max_attempts | INTEGER | NOT NULL | Maximum retry attempts |
| next_retry_at | TIMESTAMP | | Scheduled retry time |
| response_status_code | INTEGER | | HTTP response code |
| response_body | TEXT | MAX 2000 chars | Response body (truncated) |
| error_message | TEXT | | Error details |
| duration_ms | INTEGER | | Request duration |
| created_at | TIMESTAMP | NOT NULL | Delivery creation time |
| delivered_at | TIMESTAMP | | Successful delivery time |
| failed_at | TIMESTAMP | | Final failure time |

**Indexes**:
- `ix_webhook_deliveries_subscription_id` on (subscription_id, created_at)
- `ix_webhook_deliveries_retry` on (next_retry_at) WHERE status='retrying'

## Available Events

| Event Type | Description | Payload Fields |
|------------|-------------|----------------|
| `config.deployed` | Configuration deployed to environment | `variant_id`, `environment_name`, `deployed_by`, `timestamp`, `version` |

## Webhook Request Format

### Headers

```
Content-Type: application/json
X-Agenta-Signature: t=<timestamp>,v1=<hmac_sha256_hex>
X-Agenta-Event-ID: <uuid>
User-Agent: Agenta-Webhook/1.0
```

### Signature Verification

The signature is computed as:
```
HMAC-SHA256(secret, "<timestamp>.<json_payload>")
```

Where `json_payload` is the request body with sorted keys and no whitespace.

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

## Retry Behavior

Failed webhook deliveries are automatically retried with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | ~1 second |
| 2 | ~5 seconds |
| 3 | ~25 seconds |
| 4 | ~125 seconds |
| 5 | ~625 seconds (capped at 10 minutes) |

Delays include ±20% jitter to prevent thundering herd effects. After 5 failed attempts, the delivery is marked as failed.

## Circuit Breaker

If a webhook endpoint fails repeatedly (5 failures within 60 seconds), the circuit breaker opens and stops delivery attempts for 5 minutes. After cooldown, one test delivery is attempted. If successful, normal delivery resumes. If failed, the circuit reopens.

Circuit breaker status is per-subscription.

## Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| WEBHOOK_MAX_RETRIES | 5 | Total delivery attempts |
| WEBHOOK_RETRY_BASE_DELAY | 1.0s | Initial retry delay |
| WEBHOOK_RETRY_MULTIPLIER | 5.0 | Exponential backoff multiplier |
| WEBHOOK_RETRY_MAX_DELAY | 600s | Maximum retry delay (10 min) |
| WEBHOOK_RETRY_JITTER_FACTOR | 0.2 | ±20% jitter |
| WEBHOOK_TIMEOUT | 10s | Request timeout per attempt |
| Circuit breaker threshold | 5 failures / 60s | Opens circuit |
| Circuit breaker cooldown | 300s | Cooldown period (5 min) |
| Max concurrent deliveries | 50 | Worker concurrency |

## Limitations

### Current Implementation

- **Single event type**: Only `config.deployed` is implemented
- **No filtering**: All matching events trigger webhooks
- **Limited metadata**: Basic subscription metadata only
- **No replay**: Failed deliveries cannot be manually replayed
- **No bulk operations**: One-by-one CRUD operations only
- **No subscription groups**: Each subscription is independent
- **No rate limiting**: No per-subscription throttling
- **No observability**: No metrics/traces for webhook operations
- **No advanced analytics**: No delivery success rate dashboards

### Missing Features

#### Filtering System
- Event field filters (e.g., only deployments to production)
- Conditional triggers based on payload content
- Environment-specific subscriptions

#### Observability Integration
- OpenTelemetry tracing for delivery lifecycle
- Prometheus metrics (delivery rate, success rate, latency)
- Structured logging with correlation IDs
- Real-time delivery monitoring dashboard

#### Advanced Analytics
- Delivery success/failure rates over time
- Endpoint health metrics
- Event volume by type
- Retry pattern analysis
- Circuit breaker activation frequency

#### Management Features
- Webhook templates
- Subscription groups with shared configuration
- Bulk enable/disable operations
- Delivery replay for failed events
- Scheduled maintenance windows

#### Security Enhancements
- IP allowlisting for endpoints
- Custom header injection
- Mutual TLS support
- Webhook secret rotation

## Risks and Considerations

### Performance Risks

- **Database growth**: Delivery history accumulates indefinitely (no retention policy)
- **Worker saturation**: High event volume can saturate worker pool (max 50 concurrent)
- **Circuit breaker memory**: In-memory state lost on worker restart
- **Retry storms**: Multiple subscriptions with synchronized retries can create load spikes

### Security Risks

- **Secret exposure**: Secrets stored in plaintext in database
- **No IP validation**: Any endpoint can be registered (including internal networks)
- **Replay attacks**: No timestamp validation window (stale signatures accepted)
- **DoS potential**: Malicious endpoints can slow retry indefinitely

### Operational Risks

- **No alerting**: Failed deliveries have no automatic notifications
- **Silent failures**: Non-breaking error handling may hide issues
- **No audit trail**: Subscription changes not logged
- **Migration dependency**: Schema changes require downtime

### Data Risks

- **Unbounded storage**: No cleanup policy for old deliveries/events
- **Soft delete accumulation**: Archived subscriptions remain in database
- **Response body storage**: 2KB response bodies stored per delivery
- **No PII handling**: Payload content not sanitized or encrypted

## URL Requirements

- Must use HTTPS protocol (except localhost for testing)
- Localhost and 127.0.0.1 are allowed for development
- Maximum URL length: 2048 characters

## Workspace Scoping

Webhooks are strictly scoped to workspaces:
- Subscriptions belong to a single workspace
- Events are filtered by workspace_id
- No cross-workspace event delivery
- Workspace deletion cascades to subscriptions
- Workspace isolation enforced at database level
