# Webhooks (Current Design)

## Overview
Webhooks are project-scoped subscriptions stored in core Postgres. Delivery records are stored in tracing Postgres.

Current flow:
1. API/service resolves active subscriptions for an event type.
2. Service creates one `webhook_deliveries` row with `status="pending"`.
3. TaskIQ worker executes delivery with retries.
4. Worker updates the same delivery row status (`pending` -> `retrying` -> `success`/`failed`).

## Data Model

### `webhook_subscriptions` (core)
- `id` (UUID, PK)
- `project_id` (FK -> projects)
- `name`, `description` (header fields)
- `data` (JSON): `url`, `events`, `headers`
- `flags` (JSONB): includes `is_active`
- `meta` (JSON), `tags` (JSONB)
- lifecycle: `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id`
- `secret_id` (FK -> secrets): signing secret reference

### `webhook_deliveries` (tracing)
- `id` (UUID, PK)
- `subscription_id` (UUID, cross-db reference)
- `event_id` (UUID)
- `status` (string)
- `data` (JSON): event payload + delivery metadata (duration, response, errors)
- lifecycle: `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id`

## Signing
- Subscription creation creates a vault secret and stores its `secret_id`.
- Worker fetches the secret from vault at delivery time.
- Worker signs body with HMAC SHA-256 and sends:
  - `X-Agenta-Signature: t=<timestamp>,v1=<hex_digest>`
  - `X-Agenta-Delivery-ID`
  - `X-Agenta-Event-Type`

No secret identifiers are sent to webhook receivers.

## Retry Semantics
- Retries are handled by TaskIQ (`worker_webhooks`), not by DB attempt columns.
- Delivery status is updated in-place on each attempt.

## Workers
- `worker_webhooks`: TaskIQ consumer for endpoint deliveries.
- `worker_events`: Redis Stream consumer that ingests internal events into Postgres.

## API
- `/webhooks` for subscription CRUD/query/test.
- `/events/query` for event querying (project-scoped).
