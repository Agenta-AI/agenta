# Consolidated Code Review: Events & Webhooks Feature

**Branch:** `feature/webhooks`  
**Consolidated on:** 2026-02-27  
**Source reviews:** `claude-CR.md`, `codex-CR.md`  
**Primary reviewed head in source docs:** `3f2e8ee92` (after merge commit `3524b9004`)  
**Scope:** Completeness, soundness, correctness, security, reliability, compatibility, and consistency

---

## Executive Summary

The feature introduces an event-driven webhook pipeline:
- events are published to Redis Streams
- an events worker consumes and matches webhook subscriptions
- deliveries are enqueued to TaskIQ and sent by a dedicated webhook worker

The architecture is directionally strong. This consolidated review identified **blocking P0 issues** (import crash, SSRF, crypto integrity gap, header override, and DB/migration mismatches) plus a set of P1/P2 issues that materially impact correctness, reliability, and production safety. **All findings (P0 through P3) have been resolved** — see `CR.status.md` for the full checklist.

---

## Merge Readiness

**Status: READY** — All P0, P1, P2, and P3 findings have been addressed.

---

## Findings by Severity

### P0 (Blockers)

| ID | Category | Location | Description |
|----|----------|----------|-------------|
| P0-1 | Correctness | `apis/fastapi/otlp/router.py:26`, `apis/fastapi/tracing/router.py:41`, `core/tracing/streaming.py:73` | **Import crash:** routers import `publish_span`, but only `publish_spans` exists. Causes `ImportError` and breaks startup/import of tracing/OTLP routers. |
| P0-2 | Security | `core/webhooks/tasks.py:109`, `core/webhooks/service.py:418` | **SSRF vulnerability:** user-supplied webhook URLs are posted to with no destination validation. Allows access to metadata/internal network services. |
| P0-3 | Security | `utils/crypting.py:24-53`, `utils/env.py:511`, `utils/helpers.py:175` | **Unauthenticated encryption and weak default key acceptance:** XOR stream has no integrity protection and default `"replace-me"` key is allowed. |
| P0-4 | Security | `core/webhooks/tasks.py:100` | **User headers can override system/security headers:** `request_headers.update(headers)` after system headers lets users override signature/content headers. |
| P0-5 | Correctness | `dbs/postgres/events/dbas.py:33` vs `d1e2f3a4b5c6_add_events_table.py` | **Events schema type mismatch:** `status_code`/`request_type` model and migration disagree (string/enums and enum values), causing ORM/runtime issues. |
| P0-6 | Correctness | `dbs/postgres/events/dbes.py:17`, `events/mappings.py:10` vs migration line 39 | **`created_by_id` nullability mismatch:** ORM/mapping writes `None`, migration is `nullable=False`; inserts can fail with NOT NULL violations. |

### P1 (High)

| ID | Category | Location | Description |
|----|----------|----------|-------------|
| P1-1 | Security | `webhooks/models.py:25`, `core/webhooks/dtos.py:41`, `service.py:123,179` | **Signing secret exposed in API responses** because response shape aliases DTO containing `secret`. |
| P1-2 | Security | `docker-compose.gh.ssl.yml:176,214` | `docker.sock` mounted on workers that perform untrusted outbound HTTP; violates least privilege. |
| P1-3 | Correctness | `tasks/asyncio/webhooks/dispatcher.py:159` | Uses `str(event.event_type)` for matching; should use `.value` to avoid enum string mismatch. |
| P1-4 | Correctness | `apis/fastapi/webhooks/models.py:56` | Invalid default `event_type` (`config.deployed`) in test request model. |
| P1-5 | Correctness | `core/webhooks/service.py:448-455`, `core/webhooks/dtos.py:69` | `test_webhook` persists malformed delivery payload (non-canonical keys/shape). |
| P1-6 | Correctness | `dbs/postgres/webhooks/dbes.py:68` vs `cdb813cbb0e3` | Delivery index definition mismatch between DBE and migration (column set drift). |
| P1-7 | Correctness | `cdb813cbb0e3:35-37` vs `webhooks/dbas.py:35-41` | Migration contains `flags/tags/meta` columns not modeled in DBA. |
| P1-8 | Correctness | `dbs/postgres/events/dao.py:107-124` | Cursor pagination WHERE logic is conflicting/redundant and can include wrong rows. |
| P1-9 | Correctness | `tasks/taskiq/webhooks/worker.py:54` | Retry count may be string; comparing string to int can raise `TypeError`. |
| P1-10 | Correctness | `apis/fastapi/webhooks/router.py:119,288,321,353,386,517` | `request.state.user_id` passed as string; should be wrapped as `UUID(...)`. |
| P1-11 | Correctness | `core/events/streaming.py:57` | `publish_event` allows `project_id: Optional[UUID]` while message model requires UUID. |
| P1-12 | Reliability | `tasks/asyncio/events/worker.py:86-94` | Poison-pill messages on deserialization failures are never properly handled/cleared. |
| P1-13 | Reliability | `tasks/asyncio/events/worker.py:106-110,150-156`, `dispatcher.py:193` | ACK/DEL can happen even when dispatch/enqueue fails, causing permanent event loss. |
| P1-14 | Reliability | `tasks/asyncio/events/worker.py:136-163` | No graceful shutdown or pending message recovery (`XPENDING`/`XCLAIM`). |
| P1-15 | Reliability | `entrypoints/worker_webhooks.py:15-38` | Module-level initialization can break worker startup/import if dependencies are unavailable. |
| P1-16 | Completeness | EE migration `fb4159648e40` | Missing indexes that OSS migration creates. |
| P1-17 | Completeness | `apis/fastapi/events/router.py:29-45` | Missing EE permission check on events query path. |
| P1-18 | Completeness | compose files | Missing health checks for `worker-events` and `worker-webhooks`. |
| P1-19 | Consistency | `apis/fastapi/webhooks/router.py` (permission checks) | Uses `JSONResponse(403)` instead of project-standard `raise FORBIDDEN_EXCEPTION`. |
| P1-20 | Consistency | `core/webhooks/service.py:63,96`, `dispatcher.py:58` | `VaultService(SecretsDAO())` instantiated inline instead of DI at entrypoint wiring layer. |
| P1-21 | Reliability | `core/webhooks/tasks.py:41-50` | Delivery write errors are swallowed in `_record_delivery`, silently losing audit records. |
| P1-22 | Correctness/Reliability | `cdb813cbb0e3_add_webhook_deliveries.py:82`, `dbs/postgres/webhooks/dao.py:311` | No enforced uniqueness/idempotency for `(subscription_id, event_id)` despite design intent of single final row. |
| P1-23 | Correctness | `dbs/postgres/webhooks/mappings.py:104-108` | Edit flow can unintentionally clear `is_active` when flags are omitted. |

### P2 (Medium)

| ID | Category | Location | Description |
|----|----------|----------|-------------|
| P2-1 | Security | `core/webhooks/service.py:107` | Secret stored as `StandardProviderKind.OPENAI`; semantically incorrect provider kind. |
| P2-2 | Security | `core/webhooks/service.py:412-414` | `test_webhook` response includes raw secret and payload; should be masked/minimized. |
| P2-3 | Correctness | `dbs/postgres/webhooks/mappings.py:135` | Uses sentinel `UUID(int=0)` for system-generated `created_by_id`; fragile for FK constraints. |
| P2-4 | Correctness | `core/events/streaming.py:68-74` | Serialized fields (`workspace_id`, `user_id`) are not consumed by event message model. |
| P2-5 | Correctness | `core/webhooks/service.py:68-74` | `_resolve_secret` fallback logic is fragile; missing secret should fail explicitly. |
| P2-6 | Completeness | `core/environments/service.py:740-741` | `organization_id` not passed to `publish_event`; EE entitlement gate can be skipped. |
| P2-7 | Completeness | `core/webhooks/` | Missing typed domain exceptions (service leaks HTTP concerns/silent `None`s). |
| P2-8 | Completeness | `core/webhooks/interfaces.py:106-111` | `fetch_delivery` exists in interface but not implemented in service. |
| P2-9 | Completeness | `core/webhooks/service.py:364` | `test_webhook` returns raw `dict`; should return typed DTO per project conventions. |
| P2-10 | Completeness | `apis/fastapi/events/models.py:9-12` | `EventQueryRequest` lacks archival flags if archival behavior is supported. |
| P2-11 | Completeness | `core/webhooks/circuit_breaker.py` | Circuit breaker is implemented but never wired into the delivery path (dead code). |
| P2-12 | Completeness | `core/webhooks/config.py:5-8` | Retry delay constants defined but effectively unused by active retry mechanism. |
| P2-13 | Consistency | `apis/fastapi/webhooks/router.py` | Route registration omits `status_code` / `response_model_exclude_none` used in peer routers. |
| P2-14 | Consistency | `apis/fastapi/webhooks/router.py` handlers | Missing keyword-only `*` separator and some return annotations compared with local conventions. |
| P2-15 | Consistency | `dbs/postgres/events/dao.py:105-152` | Custom windowing behavior diverges from shared `apply_windowing` utilities. |
| P2-16 | Consistency | `core/webhooks/service.py:402`, `core/webhooks/tasks.py:97` | Header naming mismatch: `X-Agenta-Event` vs `X-Agenta-Event-Type`. |
| P2-17 | Consistency | `dbs/postgres/webhooks/dbes.py:14` vs migration | DBE missing `ix_webhook_subscriptions_project_id_deleted_at` declared in migration. |
| P2-18 | Consistency | `dbs/postgres/events/dbes.py:27-29` | Redundant index `ix_events_project_id` duplicates composite-index prefix behavior. |
| P2-19 | Consistency | `core/webhooks/interfaces.py:18` vs `core/events/interfaces.py` | Mixed interface style (`NotImplementedError` base class vs `Protocol`) across domains. |
| P2-20 | Quality | `apis/fastapi/webhooks/router.py:147-198,408-463` | Cache key construction duplicated and should be extracted. |
| P2-21 | Quality | `router.py:124-127`, `service.py:125-136`, worker insert path | Multi-layer caching without full invalidation path risks stale reads. |
| P2-22 | Correctness | `apis/fastapi/webhooks/router.py:429`, `dbs/postgres/webhooks/dao.py:383` | API accepts `status.message` filter but DAO only applies `status.code`. |

### P3 (Low / Nits)

| ID | Location | Description |
|----|----------|-------------|
| P3-1 | `core/webhooks/config.py:4-11` | Webhook runtime config is hardcoded; should be env-configurable. |
| P3-2 | `core/webhooks/circuit_breaker.py:200-205` | In-memory breaker state not shared across workers and grows unbounded. |
| P3-3 | `core/webhooks/dtos.py:70` | `WebhookDeliveryData.url` is optional though delivery records should always have URL. |
| P3-4 | `core/webhooks/dtos.py:46-48` | `WebhookSubscriptionCreate` defaults `is_active=False` (surprising default). |
| P3-5 | `core/webhooks/utils.py:39` | `calculate_next_retry_at` appears unused. |
| P3-6 | `core/webhooks/tasks.py:103` | `type: ignore[arg-type]` hints avoidable URL typing mismatch. |
| P3-7 | `tasks/asyncio/events/worker.py:146` | Log text typo (“parenthesis”). |
| P3-8 | `dispatcher.py:29`, `events/worker.py:21` | Duplicate `EventKey` type alias across files. |
| P3-9 | `entrypoints/routers.py:479,513` | Mixed positional/keyword style for `include_router`. |
| P3-10 | EE/OSS events migrations | Migrations are near-identical; verify duplication is intentional. |

---

## Priority Fix Order

### Phase 1 (must fix before merge)

1. Fix `publish_span` import crash (`P0-1`).
2. Add SSRF protections (URL/IP validation + network segmentation) (`P0-2`).
3. Replace unauthenticated crypto and reject insecure default key (`P0-3`).
4. Prevent user override of system/security headers (`P0-4`).
5. Align events DB models and migrations (`P0-5`, `P0-6`).
6. Stop exposing secrets in webhook response shapes (`P1-1`).
7. Enforce delivery idempotency at DB layer (`P1-22`).

### Phase 2 (before production rollout)

1. Fix enum matching, default event type, malformed test delivery persistence (`P1-3`, `P1-4`, `P1-5`).
2. Fix worker reliability paths: retry counter typing, poison-pill handling, dispatch ACK semantics, graceful shutdown/recovery (`P1-9`, `P1-12`, `P1-13`, `P1-14`).
3. Remove privileged `docker.sock` mounts from webhook/event workers (`P1-2`).
4. Add missing permission checks and health checks (`P1-17`, `P1-18`).
5. Ensure delivery write errors are not silently swallowed (`P1-21`).

### Phase 3 (cleanup and consistency)

1. Resolve P2 consistency/completeness items and remove dead code.
2. Tighten caching behavior and query/filter parity (`P2-21`, `P2-22`).
3. Apply P3 cleanup items.

---

## Architecture Notes (Consolidated)

### Strengths

1. Clear separation between ingestion (`worker-events`) and HTTP dispatch (`worker-webhooks`).
2. Use of Redis Streams and consumer groups for durable asynchronous ingestion.
3. Delivery-path isolation supports future extraction/scaling.
4. Secret caching at rest is conceptually correct (implementation requires hardening).
5. Domain folder layout generally follows expected API/core/db layering.

### Gaps

1. Security hardening is incomplete (SSRF controls + authenticated crypto are mandatory).
2. Exactly-once-like delivery expectation is not enforced at DB level.
3. Stream lifecycle and pending recovery strategy are incomplete.
4. Several migration/model mismatches create runtime failure risk.
5. Significant dead or partially wired code paths increase maintenance cost.

---

## Reviewed Files (from source reviews)

- `api/oss/src/core/webhooks/*`
- `api/oss/src/core/events/*`
- `api/oss/src/dbs/postgres/webhooks/*`
- `api/oss/src/dbs/postgres/events/*`
- `api/oss/src/apis/fastapi/webhooks/*`
- `api/oss/src/apis/fastapi/events/*`
- `api/oss/src/tasks/asyncio/events/worker.py`
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py`
- `api/oss/src/tasks/taskiq/webhooks/worker.py`
- `api/entrypoints/worker_events.py`
- `api/entrypoints/worker_webhooks.py`
- `api/oss/src/utils/crypting.py`
- relevant OSS/EE migrations:
  - `fb4159648e40_add_webhook_subscriptions*`
  - `cdb813cbb0e3_add_webhook_deliveries*`
  - `d1e2f3a4b5c6_add_events_table*`
- relevant compose/infrastructure and entrypoint wiring files.

---

## Notes on Consolidation

- Duplicated findings across `claude-CR.md` and `codex-CR.md` were merged and severity-normalized.
- Codex-only findings explicitly preserved in this document include:
  - `publish_span` import crash (`P0-1`)
  - explicit uniqueness/idempotency enforcement gap (`P1-22`)
  - swallowed delivery-write failures (`P1-21`)
  - API/DAO status-message filter mismatch (`P2-22`)
  - sharper evidence for edit-time `is_active` loss (`P1-23`)


---


---

## Appendix A — Verbatim Source: claude-CR.md

<!-- BEGIN VERBATIM: claude-CR.md -->
# Code Review: Events & Webhooks Feature

**Branch:** `feature/webhooks`
**Initial review:** 2026-02-26
**Post-merge revalidation:** 2026-02-26 (after `3524b9004` merge from `main`, head `3f2e8ee92`)
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

## Post-Merge Revalidation (main → feature/webhooks)

All findings were re-verified against the current head (`3f2e8ee92`) after merging main.

### Merge Status
- Merge was clean — no conflict markers found in any files
- Commit `3f2e8ee92` ("fix duplicates from merge") cleaned up a duplicate `StatusDBA` from merge
- No new issues introduced by the merge itself

### Finding Status Changes
- **All CRITICAL findings (C-1 through C-5):** Still valid, line numbers unchanged
- **All MAJOR findings (M-1 through M-20):** Still valid, line numbers unchanged
- **All MINOR findings:** Still valid
- **All NIT findings:** Still valid

### Alignment with codex-PR.md

The `codex-PR.md` (curated review) introduces an additional P0 not in this review:

| codex-PR.md Finding | claude-PR.md Equivalent | Notes |
|----------------------|-------------------------|-------|
| P0 — `publish_span` import crash | Not originally listed | **Confirmed valid.** `otlp/router.py:26` and `tracing/router.py:41` import `publish_span` (singular) but `streaming.py:73` defines only `publish_spans` (plural). API startup will fail with `ImportError`. |
| P0 — Events `created_by_id` mismatch | C-5 | Same finding |
| P0 — SSRF risk | C-1 | Same finding |
| P1 — Header override | C-3 (upgraded to CRITICAL here) | Same finding, different severity |
| P1 — `str(enum)` matching | M-3 | Same finding |
| P1 — Edit clears `is_active` | m-6 (related) | codex-PR.md has sharper evidence: `mappings.py:108` merges `{**incoming_flags, "is_valid": existing}` which drops `is_active` when flags omitted |
| P1 — ACK on dispatch failure | M-12/M-13 (related) | Same concern |
| P1 — No unique delivery constraint | Not originally listed as MAJOR | **Confirmed valid.** `cdb813cbb0e3:82` has `unique=False` |
| P1 — Secret in response | M-1 | Same finding |
| P1 — Delivery write swallowed | Not originally listed as P1 | **Confirmed valid.** `tasks.py:41-50` catches all exceptions |
| P2 — Malformed test delivery | M-5 | Same finding |
| P2 — Stale delivery cache | Not originally listed | **Confirmed valid.** No invalidation on `create_delivery` path or worker writes |
| P2 — `status.message` not applied | Not originally listed | **Confirmed valid.** `dao.py:383` only filters `status.code` |
| P2 — Weak default crypt key | C-2 (partially) | Same underlying issue |

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
<!-- END VERBATIM: claude-CR.md -->

---

## Appendix B — Verbatim Source: codex-CR.md

<!-- BEGIN VERBATIM: codex-CR.md -->
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
<!-- END VERBATIM: codex-CR.md -->
