# Codex Review Update: `feature/webhooks`

## Scope
- Re-reviewed after merge commit `3524b9004` (`main` -> `feature/webhooks`)
- Current head reviewed: `3f2e8ee92`
- Revalidated against:
  - `docs/designs/webhooks/README.md`
  - `docs/designs/webhooks/DESIGN.md`

## Merge Readiness
- **Not ready to merge**. Blocking correctness and security issues remain.

## Findings (ordered by severity)

### P0 — API import crash (`publish_span` does not exist)
- **Evidence**
  - `api/oss/src/apis/fastapi/otlp/router.py:26` imports `publish_span`
  - `api/oss/src/apis/fastapi/tracing/router.py:41` imports `publish_span`
  - `api/oss/src/core/tracing/streaming.py:73` defines `publish_spans` only
  - Repro: `cd api && python -c "import oss.src.apis.fastapi.otlp.router"` fails with `ImportError`
- **Impact**
  - Tracing/OTLP router modules fail to import.
- **Recommendation**
  - Rename calls/imports to `publish_spans` (or add a compatibility alias) and add import smoke tests.

### P0 — Events ingestion schema/model mismatch (`created_by_id`)
- **Evidence**
  - Migration sets non-null `created_by_id`:
    - `api/oss/databases/postgres/migrations/tracing/versions/d1e2f3a4b5c6_add_events_table.py:39`
    - `api/ee/databases/postgres/migrations/tracing/versions/d1e2f3a4b5c6_add_events_table.py:39`
  - Model/mapping writes null:
    - `api/oss/src/dbs/postgres/events/dbes.py:17`
    - `api/oss/src/dbs/postgres/events/mappings.py:10`
- **Impact**
  - Event ingestion is likely to fail on insert.
- **Recommendation**
  - Align migration and ORM nullability and add migration+ingest test coverage.

### P0 — SSRF risk in webhook/test delivery
- **Evidence**
  - Production worker posts to subscription URL without destination restrictions:
    - `api/oss/src/core/webhooks/tasks.py:111`
  - Test endpoint posts to provided URL without destination restrictions:
    - `api/oss/src/core/webhooks/service.py:420`
- **Impact**
  - Internal network endpoints/metadata services can be targeted from webhook config.
- **Recommendation**
  - Add outbound URL/IP validation and explicit denylist for local/private/link-local ranges.

### P1 — User headers can override signature and system headers
- **Evidence**
  - System headers are set, then overridden by subscription headers:
    - `api/oss/src/core/webhooks/tasks.py:94`
    - `api/oss/src/core/webhooks/tasks.py:100`
- **Impact**
  - A subscription can override `X-Agenta-Signature`, `Content-Type`, etc.
- **Recommendation**
  - Apply user headers first, then enforce immutable system headers (or blocklist override keys).

### P1 — Event-type matching bug in dispatcher (`str(enum)`)
- **Evidence**
  - Dispatcher uses `str(event.event_type)`:
    - `api/oss/src/tasks/asyncio/webhooks/dispatcher.py:159`
  - Matching compares that string against subscribed enum values:
    - `api/oss/src/tasks/asyncio/webhooks/dispatcher.py:161`
- **Impact**
  - Event-type-filtered subscriptions may not match correctly.
- **Recommendation**
  - Use `event.event_type.value` for matching.

### P1 — Editing a subscription can unintentionally clear `is_active`
- **Evidence**
  - Edit mapping rebuilds flags from incoming payload and preserves only `is_valid` from existing flags:
    - `api/oss/src/dbs/postgres/webhooks/mappings.py:104`
    - `api/oss/src/dbs/postgres/webhooks/mappings.py:108`
- **Impact**
  - Edits without explicit flags can silently deactivate subscriptions.
- **Recommendation**
  - Preserve existing `is_active` when omitted in edit payload.

### P1 — Events are ACKed even when webhook dispatch enqueue fails
- **Evidence**
  - Dispatch errors are swallowed:
    - `api/oss/src/tasks/asyncio/events/worker.py:150`
    - `api/oss/src/tasks/asyncio/webhooks/dispatcher.py:193`
  - Messages are ACK+DEL regardless:
    - `api/oss/src/tasks/asyncio/events/worker.py:156`
  - Design expects ack after ingestion + dispatch:
    - `docs/designs/webhooks/README.md:55`
- **Impact**
  - Dispatch failures can lead to permanent event loss.
- **Recommendation**
  - Fail batch/withhold ACK on enqueue errors or implement retryable dispatch tracking.

### P1 — “Exactly one delivery row per (subscription,event)” is not enforced
- **Evidence**
  - Design states one final row per pair:
    - `docs/designs/webhooks/README.md:10`
    - `docs/designs/webhooks/DESIGN.md:29`
  - No uniqueness constraint:
    - `api/oss/databases/postgres/migrations/core/versions/cdb813cbb0e3_add_webhook_deliveries.py:82` (`unique=False`)
  - DAO uses plain insert:
    - `api/oss/src/dbs/postgres/webhooks/dao.py:311`
- **Impact**
  - Duplicate delivery rows can occur under replay/retry conditions.
- **Recommendation**
  - Add unique constraint + idempotent insert/upsert behavior.

### P1 — Signing secret is in webhook subscription response shape
- **Evidence**
  - DTO includes `secret`:
    - `api/oss/src/core/webhooks/dtos.py:42`
  - API response model aliases directly to that DTO:
    - `api/oss/src/apis/fastapi/webhooks/models.py:25`
  - Service sets secret on returned subscription objects:
    - `api/oss/src/core/webhooks/service.py:123`
    - `api/oss/src/core/webhooks/service.py:179`
- **Impact**
  - Plaintext secret can be returned by create/fetch/edit/archive flows.
- **Recommendation**
  - Split internal DTO from API response model and exclude secret from normal responses.

### P1 — Delivery write failures are swallowed
- **Evidence**
  - `_record_delivery` catches and logs errors without surfacing failure:
    - `api/oss/src/core/webhooks/tasks.py:49`
- **Impact**
  - Final delivery audit records can be silently dropped.
- **Recommendation**
  - Propagate, retry, or compensate failed delivery-record writes.

### P2 — `test_webhook` persists malformed delivery data and synthetic status code
- **Evidence**
  - Uses success boolean to write `200/500` instead of actual response code:
    - `api/oss/src/core/webhooks/service.py:445`
  - Writes non-canonical data keys (`status_code`, `response_body`) instead of `response` object:
    - `api/oss/src/core/webhooks/service.py:448`
    - `api/oss/src/core/webhooks/dtos.py:69`
- **Impact**
  - Persisted test deliveries are inconsistent with delivery schema.
- **Recommendation**
  - Persist canonical `WebhookDeliveryData.response` and actual HTTP status.

### P2 — Delivery query cache can be stale
- **Evidence**
  - Query endpoint caches responses:
    - `api/oss/src/apis/fastapi/webhooks/router.py:465`
  - No invalidation on create-delivery path:
    - `api/oss/src/apis/fastapi/webhooks/router.py:384`
  - Worker inserts bypass router invalidation:
    - `api/oss/src/core/webhooks/tasks.py:51`
- **Impact**
  - Recent deliveries can be absent from query results until TTL expiration.
- **Recommendation**
  - Disable caching for deliveries query or invalidate on every delivery write.

### P2 — `status.message` is accepted in API filter but not applied in DAO
- **Evidence**
  - API cache key includes `status_message`:
    - `api/oss/src/apis/fastapi/webhooks/router.py:429`
  - DAO filters only `status.code`:
    - `api/oss/src/dbs/postgres/webhooks/dao.py:383`
- **Impact**
  - API contract and DB filtering behavior are inconsistent.
- **Recommendation**
  - Implement message filtering or remove it from query contract.

### P2 — Weak default crypt key remains allowed
- **Evidence**
  - Default `AGENTA_CRYPT_KEY` is `"replace-me"`:
    - `api/oss/src/utils/env.py:511`
  - Required-env validation checks presence, not secure value:
    - `api/oss/src/utils/helpers.py:175`
- **Impact**
  - Secret-at-rest encryption can be weak in misconfigured environments.
- **Recommendation**
  - Reject insecure default in non-local environments.

## Completeness / Test Gaps
- No tests were added for these high-risk paths:
  - tracing/otlp import smoke
  - events ingestion compatibility with new migration
  - webhook dispatch reliability under enqueue failures
  - delivery idempotency and final-write guarantees

## Post-merge Status
- After merging `main`, previously identified blockers still reproduce.
- Additional confirmed issues were added here (SSRF, header override, enum-string matching, secret exposure).
