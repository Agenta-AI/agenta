# Webhooks Design Notes

## Scope
This document reflects the implemented OSS/EE webhook architecture.

## Architecture
- Subscriptions live in core DB (`webhook_subscriptions`).
- Deliveries live in core DB (`webhook_deliveries`).
- Delivery execution is async through TaskIQ (`worker_webhooks`).
- Event ingestion and webhook dispatch fan-out runs in `worker_events`.

## Subscription Representation
Subscription-specific fields are normalized through shared DBAs:
- Identifier: `id`
- Header: `name`, `description`
- Project scope: `project_id`
- Data: `url`, `events`, optional request `headers`
- Flags: `is_active`, `is_valid`
- Meta/Tags: `meta`, `tags`
- Lifecycle: created/updated/deleted fields
- Secret linkage: `secret_id` (vault secret)

## Delivery Representation
Each delivery row captures the **final outcome** of a single `(subscription_id, event_id)` delivery attempt:
- `id`, `subscription_id`, `event_id`, `status`, `data`, lifecycle

`data` carries response code, response body, duration, and error text.

No intermediate states are persisted. Exactly one delivery record is written per (subscription, event) pair — on final success or final failure after all retries.

## Reliability
- Queueing and retries are delegated to TaskIQ.
- DB does not store retry-attempt counters.
- Retry count is read from `_taskiq_retry_count` in TaskIQ's internal task labels via `Context = TaskiqDepends()`.
- **Single delivery record per outcome**: the record is created once, on the final attempt.
  - 2xx → success record written, task completes.
  - 1xx / 3xx / 4xx → failure record written, task completes without retry (the receiver understood; retrying would not help).
  - 5xx / timeout / unexpected error → if retries remain, raise exception (TaskIQ retries); on last attempt, write failure record then re-raise.

## Security
- Secrets are stored in the Vault/Secrets subsystem.
- The subscription cache stores the resolved secret **encrypted** (HMAC-SHA256 keystream XOR, stdlib only) using `AGENTA_CRYPT_KEY`.
- The TaskIQ delivery task carries the `encrypted_secret` inline in its payload — no vault round-trip during delivery.
- The worker decrypts the secret locally, signs the payload with HMAC SHA-256, and sends:
  - `X-Agenta-Signature: t=<timestamp>,v1=<hex_digest>`
  - `X-Agenta-Event-Type`
- Secret identifiers and secret values are never forwarded to webhook receivers.

## Subscription Cache
- Subscriptions (with encrypted secrets) are cached in Redis per `project_id` (list) and per `subscription_id` (single).
- Cache is backed by a local TTL cache (60 s) + Redis (5 min) using the existing `utils/caching.py` infrastructure.
- Cache is invalidated on every subscription mutation: create, edit, archive, unarchive.
- Both cache keys (list and single) are invalidated together on any mutation.

## Events Integration
Internal events are ingested by `worker_events` from the Redis durable stream `streams:events`.

The events worker augments its processing loop with a **webhook dispatch parenthesis**:

```
for each batch from streams:events:
    1. ingest events into Postgres
    2. [dispatch parenthesis]
       for each (project_id, event_type) in the batch:
         - fetch/cache active subscriptions matching the event type
         - for each matching subscription:
             enqueue one TaskIQ task onto streams:webhooks
    3. ack + delete messages from streams:events
```

This produces an M:N fan-out: one event → N subscriptions → N independent TaskIQ tasks, each retrying independently.

## Worker Topology Options

Three deployment topologies were evaluated when designing the pipeline. Option C is implemented.

### Option A — Single container
The asyncio events worker and the TaskIQ webhook worker share the same process. The TaskIQ poller and the asyncio stream consumer run concurrently in the same event loop (or via threading).

**Trade-offs:**
- Simpler deployment (one image, one container).
- Hard to scale webhook delivery independently from event ingestion.
- Mixing asyncio event loop with TaskIQ's own lifecycle is fragile.

### Option B — Two separate containers
A standalone asyncio dispatcher process reads `streams:events`, resolves subscriptions, and publishes to `streams:webhooks`. A separate TaskIQ worker consumes `streams:webhooks` and handles HTTP delivery with retries.

**Trade-offs:**
- Clean separation; each container scales independently.
- Requires standing up a second consumer process that does nothing but dispatch.
- More operational surface area for a feature that may not need independent scaling yet.

### Option C — Augmented events worker (implemented)
The webhook dispatch logic lives in `tasks/asyncio/webhooks/dispatcher.py` as an extractable `WebhooksDispatcher` class. The events worker imports it and runs dispatch as a "parenthesis" inside its batch loop, before acknowledging messages.

A separate `worker_webhooks` (TaskIQ) handles HTTP delivery with retries.

**Trade-offs:**
- One fewer process to operate today.
- Dispatch logic is already isolated in `dispatcher.py` — migration to Option B is a matter of removing the import and standing up a second asyncio loop.
- Webhook dispatch shares the events worker's event loop; heavy dispatch backpressure could delay acks (acceptable at current scale).

**Implementation files:**
- `api/entrypoints/worker_events.py` — composition root
- `api/oss/src/tasks/asyncio/events/worker.py` — batch loop with dispatch parenthesis
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` — extractable dispatcher
- `api/oss/src/tasks/taskiq/webhooks/worker.py` — TaskIQ delivery task
- `api/oss/src/core/webhooks/tasks.py` — HTTP delivery + signing + record writing
