# Webhooks Design Notes

## Scope
This document reflects the implemented OSS/EE webhook architecture.

## Architecture
- Subscriptions live in core DB (`webhook_subscriptions`).
- Deliveries live in tracing DB (`webhook_deliveries`).
- Delivery execution is async through TaskIQ (`worker_webhooks`).

## Subscription Representation
Subscription-specific fields are normalized through shared DBAs:
- Identifier: `id`
- Header: `name`, `description`
- Project scope: `project_id`
- Data: `url`, `events`, optional request `headers`
- Flags: `is_active`
- Meta/Tags: `meta`, `tags`
- Lifecycle: created/updated/deleted fields
- Secret linkage: `secret_id` (vault secret)

## Delivery Representation
Each delivery row tracks the current delivery lifecycle for a single `(subscription_id, event_id)` operation:
- `id`, `subscription_id`, `event_id`, `status`, `data`, lifecycle

`data` can carry metadata such as response code, response body, duration, and error text.

## Reliability
- Queueing and retries are delegated to TaskIQ.
- DB does not store retry-attempt counters.
- Worker transitions status: `pending` -> `retrying` -> `success`/`failed`.

## Security
- Secrets are stored in Vault/Secrets subsystem.
- Worker resolves secret by `secret_id` and signs payload with HMAC SHA-256.
- Secret IDs and secret values are never forwarded to webhook receivers.

## Events Integration
Global internal events are ingested by `worker_events` from Redis durable streams and can independently trigger webhooks through service/trigger utilities.
