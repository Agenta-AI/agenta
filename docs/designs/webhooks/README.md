# Webhooks (Current Design)

## Overview
Webhooks are project-scoped subscriptions stored in core Postgres. Delivery records are stored in core Postgres (`webhook_deliveries`).

Current flow:
1. Internal events land in `streams:events` (Redis durable stream).
2. `worker_events` ingests events into Postgres and, in the same batch loop, fans out TaskIQ tasks to `streams:webhooks` — one task per matching `(event, subscription)` pair.
3. `worker_webhooks` (TaskIQ) picks up each task and attempts HTTP delivery with automatic retries.
4. Exactly one `webhook_deliveries` row is written per `(subscription_id, event_id)` — on the **final outcome** (success or failure after retries). No intermediate records are created.

## Data Model

### `webhook_subscriptions` (core)
- `id` (UUID, PK)
- `project_id` (FK -> projects)
- `name`, `description` (header fields)
- `data` (JSON): `url`, `event_types`, `headers`
- `flags` (JSONB): `is_active`, `is_valid`
- `meta` (JSON), `tags` (JSONB)
- lifecycle: `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id`
- `secret_id` (FK -> secrets): signing secret reference

### `webhook_deliveries` (core)
- `id` (UUID, PK)
- `subscription_id` (UUID)
- `event_id` (UUID)
- `status` (JSONB, shared Status shape: `{code, message}`)
- `data` (JSON): `url`, `event_type`, `payload`, `duration_ms`, `response` (code + body), `error`
- lifecycle: `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id`

## Signing
- Subscription creation generates a vault secret and stores its `secret_id`.
- The resolved secret is encrypted (`HMAC-SHA256 keystream XOR`, stdlib-only) and cached in Redis alongside the subscription.
- The TaskIQ delivery task carries `encrypted_secret` inline — no vault round-trip during delivery.
- Worker decrypts the secret locally and signs the body with HMAC SHA-256:
  - `X-Agenta-Signature: t=<timestamp>,v1=<hex_digest>`
  - `X-Agenta-Event-Type`

No secret identifiers or secret values are sent to webhook receivers.

## Retry Semantics
- Retries are handled by TaskIQ (`worker_webhooks`).
- Retry count is read from `_taskiq_retry_count` in TaskIQ's internal task labels.
- **2xx** — success delivery record written, task completes.
- **1xx / 3xx / 4xx** — failure delivery record written, no retry (permanent error).
- **5xx / timeout / error** — exception raised so TaskIQ retries; on the last attempt, failure record written before re-raising.

## Workers

### `worker_events` (asyncio)
- Consumes `streams:events` (Redis durable stream, consumer group `worker-events`).
- Ingests events into Postgres.
- Runs a **dispatch parenthesis** per batch: fetches/caches subscriptions per project, enqueues one TaskIQ task per `(event, subscription)` match onto `streams:webhooks` (consumer group `worker-events-webhooks-dispatcher`).
- Acks messages after both ingestion and dispatch complete.

### `worker_webhooks` (TaskIQ)
- Consumes `streams:webhooks` (TaskIQ Redis Stream broker).
- Executes HTTP delivery with automatic retries (`max_retries` from config).
- Writes exactly one `webhook_deliveries` record per task on its final outcome.

## Worker Topology Options

Three deployment topologies were considered. **Option C is implemented.**

### Option A — Single container
The asyncio events worker and TaskIQ delivery worker share the same process/event loop.

- Simpler to deploy (one container).
- Cannot scale delivery independently from ingestion.
- Mixing asyncio and TaskIQ lifecycles is fragile.

### Option B — Two separate containers
A standalone asyncio dispatcher process reads `streams:events` and fans out to `streams:webhooks`. A separate TaskIQ worker handles HTTP delivery.

- Clean separation; each scales independently.
- More operational surface area for early-stage feature.

### Option C — Augmented events worker (implemented)
The events worker runs webhook dispatch as a parenthesis in its batch loop. Dispatch logic is isolated in `tasks/asyncio/webhooks/dispatcher.py` (`WebhooksDispatcher`), importable standalone.

- One fewer process to operate today.
- Migration to Option B requires only removing the import and standing up a second asyncio loop — no logic changes.

## API
- `/webhooks` — subscription CRUD, query, and test endpoints.
- `/events` — event query endpoints (project-scoped).
