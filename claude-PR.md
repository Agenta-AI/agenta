# Code Review: Events & Webhooks Feature

**Branch:** `feature/webhooks`
**Reviewed:** 2026-02-26
**Scope:** Full code review — completeness, soundness, consistency, correctness, security, functionality, compatibility

---

## Executive Summary

The feature introduces an event-driven webhook delivery pipeline: internal events are published to a Redis durable stream, consumed by an asyncio events worker, matched against project-scoped webhook subscriptions, and dispatched via TaskIQ to a separate HTTP delivery worker. The architecture is sound — clean separation between event ingestion and webhook delivery, correct use of Redis Streams for durability, and a pragmatic "Option C" topology that can evolve to fully independent workers.

**However, there are blocking issues that must be resolved before merge**, primarily around SSRF, unauthenticated encryption, secret exposure in API responses, and several DBE/migration mismatches that will cause runtime errors.

---

## Findings by Severity

### CRITICAL (5) — Must fix before merge

| ID | Category | Location | Description |
|----|----------|----------|-------------|
| C-1 | Security | `core/webhooks/tasks.py:109`, `service.py:418` | **SSRF vulnerability.** Outbound HTTP POST to user-supplied URL with zero validation. Attacker can target `http://169.254.169.254/` (cloud metadata), `http://redis-durable:6381/`, or any internal service. Both `test_webhook` and production delivery are affected. `worker-webhooks` sits on the same Docker network as all internal services. |
| C-2 | Security | `utils/crypting.py:24-53` | **Unauthenticated encryption.** Custom XOR stream cipher has no integrity/authentication tag. Attacker with Redis write access can flip ciphertext bits to predictably alter webhook signing secrets (bit-flipping attack). Default key is `"replace-me"` with no startup validation. |
| C-3 | Security | `core/webhooks/tasks.py:100` | **User-supplied headers override security headers.** `request_headers.update(headers)` is called *after* setting `X-Agenta-Signature`, allowing a malicious user to spoof the HMAC signature, `Content-Type`, or `Host` header. |
| C-4 | Correctness | `dbs/postgres/events/dbas.py:33` vs migration | **`status_code` column type mismatch.** DBA defines `Column(String)`, migration creates `sa.Enum("STATUS_CODE_UNSET", ...)`. SQLAlchemy will fail at runtime when reading/writing events. Same for `request_type` enum value mismatch (DBA uses lowercase values; migration uses uppercase names). |
| C-5 | Correctness | `dbs/postgres/events/dbes.py:17` vs migration | **`created_by_id` nullability mismatch.** DBE overrides to `nullable=True` (events are system-generated), but migration creates column as `nullable=False`. DAO hardcodes `created_by_id=None`. Every event insert will hit a NOT NULL constraint violation. |

### MAJOR (20) — Should fix before merge

| ID | Category | Location | Description |
|----|----------|----------|-------------|
| M-1 | Security | `webhooks/models.py:25`, `dtos.py:41` | **Signing secret exposed in all API responses.** `WebhookSubscriptionResponse = WebhookSubscription` which includes `secret: Optional[str]`. Every fetch/query/edit/archive response returns the plaintext signing secret. Should only be returned once at creation time. |
| M-2 | Security | `docker-compose.gh.ssl.yml:176,214` | **`docker.sock` mounted on webhook/event workers.** Workers that make outbound HTTP to arbitrary URLs should have least privilege. Other compose files correctly omit this. |
| M-3 | Correctness | `dispatcher.py:159` | **`str(event.event_type)` may break webhook matching.** In Python 3.11+, `str()` on a `StrEnum` returns `"EventType.X"` not the value. Use `event.event_type.value` instead. This would cause no subscriptions with specific event_type filters to ever match. |
| M-4 | Correctness | `models.py:56` | **Invalid default `event_type` in `TestWebhookRequest`.** Default is `"config.deployed"` which doesn't exist in any enum. Only valid value is `"environments.revisions.committed"`. |
| M-5 | Correctness | `service.py:448-455` | **`test_webhook` passes raw dict instead of `WebhookDeliveryData`.** Keys (`status_code`, `response_body`) don't match the DTO schema (`response: WebhookDeliveryResponseInfo`). Will fail Pydantic validation or silently lose data. |
| M-6 | Correctness | `webhooks/dbes.py:68` vs migration `cdb813cbb0e3` | **Delivery index column count mismatch.** DBE defines 3 columns (`subscription_id`, `event_id`, `created_at`); migration creates 2 (`subscription_id`, `event_id`). Alembic autogenerate will see drift. |
| M-7 | Correctness | Migration `cdb813cbb0e3:35-37` vs `webhooks/dbas.py:35-41` | **Delivery migration has `flags`, `tags`, `meta` columns not in DBA.** SQLAlchemy won't know about these columns — dead schema bloat. |
| M-8 | Correctness | `events/dao.py:107-124` | **Conflicting WHERE clauses in cursor pagination.** `timestamp <= newest` clause is redundant with the OR clause and permits rows that cursor pagination should exclude. Same issue in ascending branch. |
| M-9 | Correctness | `taskiq/webhooks/worker.py:54` | **`retry_count` may be a string.** `labels.get("_taskiq_retry_count", 0)` returns string from TaskIQ labels. `"0" >= 5` raises `TypeError` in Python 3. Must cast with `int()`. |
| M-10 | Correctness | `router.py:119,288,321,353,386,517` | **`user_id` not wrapped with `UUID()`.** `request.state.user_id` (string) passed directly while `project_id` is correctly wrapped with `UUID()`. |
| M-11 | Correctness | `streaming.py:57` | **`publish_event` accepts `project_id: Optional[UUID]` but `EventMessage.project_id` is required `UUID`.** Passing `None` will fail deserialization in the events worker. |
| M-12 | Reliability | `events/worker.py:86-94` | **Poison-pill messages on deserialization failure.** Failed messages never added to `processed_ids`, never ACKed, stuck in pending entries list forever. Should dead-letter them. |
| M-13 | Reliability | `events/worker.py:106-110` | **Entitlement check failure causes permanent message loss.** Message IDs already in `processed_ids` but `continue` skips processing. ACK still happens — events permanently lost on transient failures. |
| M-14 | Reliability | `events/worker.py:136-163` | **No graceful shutdown.** `while True` loop with no shutdown mechanism. `KeyboardInterrupt` during batch processing leaves messages unACKed. No pending message recovery (XPENDING/XCLAIM). |
| M-15 | Reliability | `worker_webhooks.py:15-38` | **Module-level initialization.** Broker, DAO, and Agenta SDK init at import time. If Redis/DB is unavailable, module fails to import entirely, preventing TaskIQ from discovering tasks. |
| M-16 | Completeness | EE migration `fb4159648e40` | **EE subscription migration missing all indexes.** OSS migration creates `ix_webhook_subscriptions_project_id_created_at` and `_deleted_at`; EE migration has zero indexes. |
| M-17 | Completeness | `events/router.py:29-45` | **No EE permission check on events query.** Webhooks router checks `Permission.VIEW_WEBHOOKS`; events router has no permission check at all. |
| M-18 | Completeness | All compose files | **No health checks for `worker-events` or `worker-webhooks`.** Docker cannot distinguish healthy from crashed workers. |
| M-19 | Consistency | `router.py:106-116` (×9) | **Permission pattern diverges from project convention.** Uses `return JSONResponse(403)` instead of `raise FORBIDDEN_EXCEPTION`. Every other modern router uses the raise pattern. |
| M-20 | Consistency | `service.py:63,96`, `dispatcher.py:58` | **`VaultService(SecretsDAO())` instantiated inline.** Violates project's "wire concrete dependencies in entrypoints only" rule. Should be constructor-injected. |

### MINOR (22) — Should fix, lower priority

| ID | Category | Location | Description |
|----|----------|----------|-------------|
| m-1 | Security | `service.py:107` | Webhook secret stored as `StandardProviderKind.OPENAI` — semantically wrong; should have dedicated kind. |
| m-2 | Security | `service.py:412-414` | `test_webhook` returns raw signing secret and payload in response. Consider masking. |
| m-3 | Correctness | `webhooks/mappings.py:135` | Sentinel `UUID(int=0)` for `created_by_id` on system-generated deliveries. Could violate FK if constraint added later. |
| m-4 | Correctness | `streaming.py:68-74` | `workspace_id` and `user_id` serialized into Redis message but never consumed (`EventMessage` has no such fields). |
| m-5 | Correctness | `service.py:68-74` | `_resolve_secret` fragile with multiple `getattr`/`isinstance` fallbacks. Missing secret should error, not silently return `None`. |
| m-6 | Correctness | `webhooks/mappings.py:100-119` | `edit_subscription` unconditionally overwrites all fields including `None` — full-replacement not partial-update. May surprise callers. |
| m-7 | Completeness | `environments/service.py:740-741` | `organization_id` never passed to `publish_event`. EE entitlements check always skipped. |
| m-8 | Completeness | `core/webhooks/` | No domain exceptions defined. AGENTS.md requires typed exceptions per domain. Currently uses `HTTPException` directly or silent `None` returns. |
| m-9 | Completeness | `interfaces.py:106-111` | `fetch_delivery` defined in interface but not implemented in service. |
| m-10 | Completeness | `service.py:364` | `test_webhook` returns `dict` — AGENTS.md requires typed DTO returns from services. |
| m-11 | Completeness | `events/models.py:9-12` | No `include_archived` field in `EventQueryRequest` if events support archival. |
| m-12 | Completeness | `circuit_breaker.py` (entire file) | Circuit breaker fully implemented (206 lines) but **never called** from delivery pipeline. Dead code. |
| m-13 | Completeness | `config.py:5-8` | `WEBHOOK_RETRY_BASE_DELAY` and related constants defined but never used. TaskIQ handles retry timing. |
| m-14 | Consistency | `router.py:36-100` | Missing `status_code` and `response_model_exclude_none` on all route registrations. Other routers include both. |
| m-15 | Consistency | `router.py:103,261,304...` | Missing `*` keyword-only separator and return type annotations on handler signatures. |
| m-16 | Consistency | `events/dao.py:105-152` | Custom windowing logic instead of shared `apply_windowing` utility. Subtle behavioral differences. |
| m-17 | Consistency | `service.py:402` vs `tasks.py:97` | `X-Agenta-Event` (test) vs `X-Agenta-Event-Type` (production) header name inconsistency. |
| m-18 | Consistency | `webhooks/dbes.py:14` vs migration | `ix_webhook_subscriptions_project_id_deleted_at` in migration but not in DBE `__table_args__`. |
| m-19 | Consistency | `events/dbes.py:27-29` | Redundant standalone `ix_events_project_id` index — already a prefix of every composite index. |
| m-20 | Consistency | `interfaces.py:18` vs `events/interfaces.py` | `WebhooksDAOInterface` uses `raise NotImplementedError`; `EventsDAOInterface` uses `Protocol`. Should use same pattern. |
| m-21 | Quality | `router.py:147-198,408-463` | 50-line cache key construction duplicated. Should extract to `utils.py`. |
| m-22 | Quality | `router.py:124-127` vs `service.py:125-136` | Dual cache layers with different namespaces. Router caches query results; service caches individual subs. Stale data risk. |

### NIT (10)

| ID | Location | Description |
|----|----------|-------------|
| n-1 | `config.py:4-11` | All webhook config hardcoded — should be env-configurable. |
| n-2 | `circuit_breaker.py:200-205` | In-memory state not shared across workers. `states` dict grows unboundedly. |
| n-3 | `dtos.py:70` | `WebhookDeliveryData.url` typed `Optional[HttpUrl]` but delivery always has a URL. |
| n-4 | `dtos.py:46-48` | `WebhookSubscriptionCreate` defaults `is_active=False` — subscriptions inactive on creation. |
| n-5 | `utils.py:39` | `calculate_next_retry_at` appears unused (TaskIQ handles scheduling). |
| n-6 | `tasks.py:103` | `type: ignore[arg-type]` suggests `url: str` vs `HttpUrl` type mismatch. |
| n-7 | `events/worker.py:146` | "parenthesis" should be "phase" or "step". |
| n-8 | `dispatcher.py:29`, `events/worker.py:21` | `EventKey` type alias duplicated in two files. |
| n-9 | `routers.py:479` vs `513` | Positional vs keyword arg style for `include_router`. |
| n-10 | EE/OSS events migrations | Byte-for-byte identical — consider if EE migration is needed. |

---

## Architecture Observations

### What's Good

1. **Clean separation of concerns.** Event ingestion (`worker-events`) and webhook delivery (`worker-webhooks`) are independent processes with clear boundaries.
2. **Redis Streams for durability.** Using `xadd`/`xreadgroup` with consumer groups provides at-least-once delivery guarantees.
3. **Option C topology.** Pragmatic choice — dispatch logic is isolated in `dispatcher.py` and can be extracted to a standalone worker later with no logic changes.
4. **Encrypted secret caching.** Secrets are encrypted at rest in Redis, not stored in plaintext. The *implementation* needs hardening (see C-2), but the pattern is correct.
5. **Single delivery record per outcome.** No intermediate state bloat — exactly one `webhook_deliveries` row per (subscription, event) on final success or failure.
6. **Consistent domain folder structure.** `core/webhooks/`, `dbs/postgres/webhooks/`, `apis/fastapi/webhooks/` follows the AGENTS.md pattern.

### What Needs Work

1. **SSRF is the #1 security gap.** The webhook delivery worker sits on the same network as all internal services and makes HTTP requests to arbitrary user-supplied URLs. This needs both URL validation *and* network segmentation.
2. **No idempotency for webhook deliveries.** No unique constraint on `(event_id, subscription_id)`. Crash between dispatch and ACK causes duplicate deliveries with no deduplication.
3. **No stream trimming.** `xadd` in `publish_event` has no `maxlen`. If the consumer falls behind, the stream grows unboundedly.
4. **No pending message recovery.** No `XPENDING`/`XCLAIM` loop — any unACKed messages after a worker crash are permanently lost.
5. **Dead code.** Circuit breaker (206 lines), retry delay constants, and `calculate_next_retry_at` are implemented but never wired. Either integrate or remove.

---

## Priority Fix Order

### Phase 1 — Blocking (must fix before merge)

1. **SSRF protection** (C-1): Add URL validation rejecting private/loopback/link-local IPs. Consider network segmentation for `worker-webhooks`.
2. **Fix encryption** (C-2): Add ciphertext authentication (MAC tag). Add startup validation that `AGENTA_CRYPT_KEY` is not the default.
3. **Fix header override** (C-3): Apply user headers *before* system headers, or blocklist `X-Agenta-*` / `Content-Type` / `Host`.
4. **Fix DBE/migration mismatches** (C-4, C-5, M-6, M-7, M-16): Align `status_code` type, `request_type` enum values, `created_by_id` nullability, index definitions, and dead columns.
5. **Stop exposing secrets** (M-1): Create separate response model that excludes `secret` and `secret_id`.

### Phase 2 — High priority (fix before production)

6. Fix `str(enum)` → `.value` in dispatcher (M-3)
7. Fix invalid default event_type (M-4)
8. Fix `test_webhook` delivery data DTO (M-5)
9. Fix `retry_count` string→int cast (M-9)
10. Fix `user_id` UUID wrapping (M-10)
11. Fix `publish_event` signature to require `project_id` (M-11)
12. Fix poison-pill / message-loss bugs in events worker (M-12, M-13)
13. Add graceful shutdown to events worker (M-14)
14. Move module-level init to lazy/guarded pattern (M-15)
15. Add EE permission check on events router (M-17)
16. Align permission check pattern with project convention (M-19)
17. Remove `docker.sock` from SSL compose (M-2)

### Phase 3 — Polish (can follow up)

18. Add health checks to workers (M-18)
19. Inject VaultService via constructor (M-20)
20. Define domain exceptions (m-8)
21. Fix all minor findings (m-1 through m-22)
22. Remove dead code: circuit breaker, unused config, unused retry util (m-12, m-13, n-5)
23. Add idempotency key / unique constraint on deliveries
24. Add stream trimming (`maxlen`) to `xadd`
25. Add pending message recovery (`XPENDING`/`XCLAIM`)

---

## Files Reviewed

### New files (webhooks + events core)
- `api/oss/src/core/webhooks/` — service, dtos, interfaces, tasks, config, circuit_breaker, events, utils
- `api/oss/src/core/events/` — service, dtos, interfaces, streaming, types
- `api/oss/src/dbs/postgres/webhooks/` — dao, dbas, dbes, mappings
- `api/oss/src/dbs/postgres/events/` — dao, dbas, dbes, mappings
- `api/oss/src/apis/fastapi/webhooks/` — router, models
- `api/oss/src/apis/fastapi/events/` — router, models
- `api/oss/src/tasks/asyncio/events/worker.py`
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py`
- `api/oss/src/tasks/taskiq/webhooks/worker.py`
- `api/entrypoints/worker_events.py`
- `api/entrypoints/worker_webhooks.py`
- `api/oss/src/utils/crypting.py`

### Migrations
- `api/oss/databases/postgres/migrations/core/versions/fb4159648e40_add_webhook_subscriptions.py`
- `api/oss/databases/postgres/migrations/core/versions/cdb813cbb0e3_add_webhook_deliveries.py`
- `api/oss/databases/postgres/migrations/tracing/versions/d1e2f3a4b5c6_add_events_table.py`
- `api/ee/databases/postgres/migrations/core/versions/fb4159648e40_add_webhook_tables_with_project_scope.py`
- `api/ee/databases/postgres/migrations/core/versions/cdb813cbb0e3_add_webhook_deliveries.py`
- `api/ee/databases/postgres/migrations/tracing/versions/d1e2f3a4b5c6_add_events_table.py`

### Infrastructure
- `hosting/docker-compose/oss/docker-compose.dev.yml`
- `hosting/docker-compose/oss/docker-compose.gh.yml`
- `hosting/docker-compose/oss/docker-compose.gh.local.yml`
- `hosting/docker-compose/oss/docker-compose.gh.ssl.yml`
- `hosting/docker-compose/ee/docker-compose.dev.yml`
- `hosting/docker-compose/ee/docker-compose.gh.local.yml`
- `api/oss/docker/Dockerfile.gh`
- `api/pyproject.toml`

### Modified files
- `api/entrypoints/routers.py`
- `api/oss/src/core/environments/service.py`
- `api/oss/src/dbs/postgres/shared/dbas.py`
- `api/oss/src/dbs/postgres/tracing/dbas.py`
- `api/oss/src/dbs/postgres/tracing/dbes.py`
- `api/oss/src/core/tracing/streaming.py`

### Design docs
- `docs/designs/webhooks/README.md`
- `docs/designs/webhooks/DESIGN.md`
- `docs/designs/events/event-bus.initial.specs.md`
