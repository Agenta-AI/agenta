# Codex Review: `feature/webhooks`

## Scope
- Branch diff reviewed against `origin/main`
- Design docs reviewed:
  - `docs/designs/webhooks/README.md`
  - `docs/designs/webhooks/DESIGN.md`

## Merge Readiness
- **Not ready to merge**. There are blocking correctness and reliability issues.

## Findings (ordered by severity)

### P0 — API import crash (`publish_span` does not exist)
- **Evidence**
  - `api/oss/src/apis/fastapi/otlp/router.py:26` imports `publish_span`
  - `api/oss/src/apis/fastapi/tracing/router.py:41` imports `publish_span`
  - `api/oss/src/core/tracing/streaming.py:73` defines `publish_spans` (plural), not `publish_span`
  - Runtime confirmation: `python -c "import oss.src.apis.fastapi.otlp.router"` fails with `ImportError`
- **Impact**
  - Tracing/OTLP router modules fail to import; this is a startup/runtime blocker.
- **Recommendation**
  - Replace imports/calls with `publish_spans` (or add a compatible alias) and add a module import smoke test.

### P0 — Events ingestion cannot persist due schema/model mismatch
- **Evidence**
  - Migration requires non-null `created_by_id`:
    - `api/oss/databases/postgres/migrations/tracing/versions/d1e2f3a4b5c6_add_events_table.py:39`
    - `api/ee/databases/postgres/migrations/tracing/versions/d1e2f3a4b5c6_add_events_table.py:39`
  - ORM/mapping writes `created_by_id=None`:
    - `api/oss/src/dbs/postgres/events/dbes.py:17`
    - `api/oss/src/dbs/postgres/events/mappings.py:10`
  - DAO inserts all columns as-is:
    - `api/oss/src/dbs/postgres/events/dao.py:44`
- **Impact**
  - Event ingestion is expected to fail on insert for null `created_by_id`.
- **Recommendation**
  - Align schema and model (make migration nullable or always provide actor ID).

### P1 — Editing a subscription can unintentionally deactivate it
- **Evidence**
  - `flags` is optional in edit DTO: `api/oss/src/core/webhooks/dtos.py:51`
  - Edit mapping replaces flags with only `is_valid` when `flags` is omitted:
    - `api/oss/src/dbs/postgres/webhooks/mappings.py:103`
- **Impact**
  - Any edit request without `flags` can clear `is_active`, silently stopping deliveries.
- **Recommendation**
  - Preserve existing `is_active` when edit payload omits flags.

### P1 — Events are ACKed even when webhook dispatch enqueue fails
- **Evidence**
  - Dispatch errors are caught/logged:
    - `api/oss/src/tasks/asyncio/events/worker.py:150`
    - `api/oss/src/tasks/asyncio/webhooks/dispatcher.py:193`
  - Messages are still ACK+DEL afterward:
    - `api/oss/src/tasks/asyncio/events/worker.py:156`
  - Design expects ACK after successful ingestion + dispatch:
    - `docs/designs/webhooks/README.md:55`
- **Impact**
  - Failed enqueues can be dropped permanently (no replay from `streams:events`).
- **Recommendation**
  - Fail the batch (no ACK) on enqueue failures, or track/retry failed dispatches before ACK.

### P1 — “Exactly one delivery row per (subscription,event)” is not enforced
- **Evidence**
  - Design requires one final row per pair:
    - `docs/designs/webhooks/README.md:10`
    - `docs/designs/webhooks/DESIGN.md:29`
  - DB has no unique constraint on `(subscription_id, event_id)`:
    - `api/oss/databases/postgres/migrations/core/versions/cdb813cbb0e3_add_webhook_deliveries.py:82` (`unique=False`)
  - DAO does plain insert (no conflict handling):
    - `api/oss/src/dbs/postgres/webhooks/dao.py:311`
- **Impact**
  - Duplicate deliveries can occur under retries/replays/duplicate task execution.
- **Recommendation**
  - Add unique constraint and idempotent insert/upsert strategy.

### P1 — Delivery recording errors are swallowed
- **Evidence**
  - `_record_delivery` logs and suppresses exceptions:
    - `api/oss/src/core/webhooks/tasks.py:49`
- **Impact**
  - Final delivery rows can be silently missing while task appears successful.
- **Recommendation**
  - Propagate/persist record-write failures (or queue compensating retry) to preserve audit integrity.

### P2 — `test_webhook` writes malformed delivery payload and inaccurate status code
- **Evidence**
  - Persists `status.code` as `200`/`500` based on success boolean instead of actual response code:
    - `api/oss/src/core/webhooks/service.py:444`
  - Persists `data` keys `status_code` and `response_body` that are not in `WebhookDeliveryData` schema:
    - `api/oss/src/core/webhooks/service.py:452`
    - `api/oss/src/core/webhooks/dtos.py:69`
- **Impact**
  - Stored test-delivery records lose/incorrectly represent response details.
- **Recommendation**
  - Use canonical `WebhookDeliveryData.response = {status_code, body}` and actual HTTP response code.

### P2 — Delivery query cache can be stale for up to TTL
- **Evidence**
  - Delivery query responses are cached:
    - `api/oss/src/apis/fastapi/webhooks/router.py:465`
  - No invalidation on `create_delivery` path:
    - `api/oss/src/apis/fastapi/webhooks/router.py:384`
  - Worker writes deliveries directly via DAO (bypasses router invalidation entirely):
    - `api/oss/src/core/webhooks/tasks.py:51`
- **Impact**
  - `POST /webhooks/deliveries/query` can return stale results despite new deliveries.
- **Recommendation**
  - Disable cache for deliveries query or invalidate on every delivery insert.

### P2 — `status.message` filter is accepted but not applied
- **Evidence**
  - API/cache key includes `status_message`:
    - `api/oss/src/apis/fastapi/webhooks/router.py:429`
  - DAO only filters `status.code`:
    - `api/oss/src/dbs/postgres/webhooks/dao.py:383`
- **Impact**
  - Query behavior is inconsistent with request model and cache key.
- **Recommendation**
  - Implement status-message filtering or remove it from request/caching contract.

### P2 — Weak default encryption key is accepted for webhook secret-at-rest encryption
- **Evidence**
  - Default key is `"replace-me"`:
    - `api/oss/src/utils/env.py:511`
  - Validation only checks non-empty value:
    - `api/oss/src/utils/helpers.py:175`
- **Impact**
  - If env is not explicitly set in production, Redis-cached encrypted secrets are weakly protected.
- **Recommendation**
  - Fail startup on insecure defaults for `AGENTA_CRYPT_KEY`.

## Completeness / Test Gaps
- No new tests found for:
  - webhook dispatch reliability semantics
  - TaskIQ retry/final-write behavior
  - events ingestion migration compatibility
  - router import smoke/boot checks
- Suggested minimum additions:
  - import smoke tests for tracing/otlp routers
  - integration test: event -> dispatch -> final delivery record semantics
  - migration + ingest test covering `events.created_by_id` nullability

## Summary
- The PR introduces major functionality but currently has blockers in startup correctness, persistence compatibility, and delivery reliability guarantees relative to the design docs.
