# CR Status

Status values: `todo`, `in_progress`, `done`, `blocked`.

## Findings Checklist

- [x] P0-1 | category: Correctness | severity: P0 | action: Rename `publish_span` imports/calls to `publish_spans` in tracing + OTLP routers | status: done
- [x] P0-2 | category: Security | severity: P0 | action: Apply existing SDK-style webhook URL validation to both delivery and test paths | status: done
- [x] P0-3 | category: Security | severity: P0 | action: Accept any provided `AGENTA_CRYPT_KEY`, fail if missing, and use Fernet authenticated encryption | status: done
- [x] P0-4 | category: Security | severity: P0 | action: Add non-overwritable header list and drop blocked user headers before merge | status: done
- [x] P0-5 | category: Correctness | severity: P0 | action: Align events migration column type: `status_code` -> `String` (OSS + EE) | status: done
- [x] P0-6 | category: Correctness | severity: P0 | action: Align events migration nullability: `created_by_id` -> `nullable=True` (OSS + EE) | status: done
- [x] P1-1 | category: Security | severity: P1 | action: Intentional — secret returned on all responses by design | status: done
- [x] P1-2 | category: Security | severity: P1 | action: Remove `docker.sock` mounts from untrusted outbound webhook/event workers | status: done
- [x] P1-3 | category: Correctness | severity: P1 | action: Use `event.event_type.value` for subscription matching in dispatcher | status: done
- [x] P1-4 | category: Correctness | severity: P1 | action: Remove deprecated test request model with invalid default and use path-param test route | status: done
- [x] P1-5 | category: Correctness | severity: P1 | action: Use canonical `WebhookDeliveryData` shape in test delivery flow | status: done
- [x] P1-6 | category: Correctness | severity: P1 | action: Align webhook delivery composite index definition between DBE and migrations | status: done
- [x] P1-7 | category: Correctness | severity: P1 | action: Remove unused `flags`/`tags`/`meta` columns from webhook deliveries migrations | status: done
- [x] P1-8 | category: Correctness | severity: P1 | action: Not a bug — oldest/newest are window boundaries, logic is correct | status: done
- [x] P1-9 | category: Correctness | severity: P1 | action: Parse TaskIQ retry labels defensively as int before retry comparisons | status: done
- [x] P1-10 | category: Correctness | severity: P1 | action: Normalize `request.state.user_id` to `UUID` before service calls in webhooks router | status: done
- [x] P1-11 | category: Correctness | severity: P1 | action: Make `publish_event` require non-optional `project_id` | status: done
- [x] P1-12 | category: Reliability | severity: P1 | action: ACK unprocessable messages to prevent PEL buildup (matching tracing worker pattern) | status: done
- [x] P1-13 | category: Reliability | severity: P1 | action: Skip ACK/DEL when webhook dispatch fails; propagate enqueue/load failures | status: done
- [x] P1-14 | category: Reliability | severity: P1 | action: Consistent with tracing worker pattern — project-wide, not webhooks-specific | status: done
- [x] P1-15 | category: Reliability | severity: P1 | action: Consistent with evaluations worker pattern — project-wide, not webhooks-specific | status: done
- [x] P1-16 | category: Completeness | severity: P1 | action: Add EE webhook-subscriptions indexes to match OSS migration | status: done
- [x] P1-17 | category: Completeness | severity: P1 | action: Add EE permission gate to events query endpoint | status: done
- [x] P1-18 | category: Completeness | severity: P1 | action: Add health checks for webhook/event workers in compose files | status: done
- [x] P1-19 | category: Consistency | severity: P1 | action: Use project-standard `FORBIDDEN_EXCEPTION` in webhooks router EE checks | status: done
- [x] P1-20 | category: Consistency | severity: P1 | action: Inject `VaultService` via entrypoint wiring (service + dispatcher), remove inline construction | status: done
- [x] P1-21 | category: Reliability | severity: P1 | action: Stop swallowing delivery persistence errors in webhook task path | status: done
- [x] P1-22 | category: Correctness/Reliability | severity: P1 | action: Enforce delivery idempotency with unique `(project_id, subscription_id, event_id)` and DAO upsert | status: done
- [x] P1-23 | category: Correctness | severity: P1 | action: Preserve existing flags on edit when incoming flags are omitted | status: done
- [x] P2-1 | category: Security | severity: P2 | action: Added `WEBHOOK_PROVIDER` to `SecretKind` with dedicated `WebhookProviderDTO`; removed `WEBHOOK` from `StandardProviderKind` | status: done
- [x] P2-2 | category: Security | severity: P2 | action: Already fixed — `test_webhook` returns `WebhookDelivery` DTO, no secret | status: done
- [x] P2-3 | category: Correctness | severity: P2 | action: Removed `UUID(int=0)` sentinel; `created_by_id` now nullable in delivery DBA + mapping | status: done
- [x] P2-4 | category: Correctness | severity: P2 | action: Already fixed — `user_id` explicitly discarded in `deserialize_event` | status: done
- [x] P2-5 | category: Correctness | severity: P2 | action: Simplified `_resolve_secret` in service + dispatcher; direct `secret_dto.data.provider.key` access | status: done
- [x] P2-6 | category: Completeness | severity: P2 | action: Make `organization_id` optional in `publish_event` (callers don't have it in OSS) | status: done
- [x] P2-7 | category: Completeness | severity: P2 | action: Already fixed — typed domain exceptions in `core/webhooks/exceptions.py` | status: done
- [x] P2-8 | category: Completeness | severity: P2 | action: Exposed `fetch_delivery` through service + router (`GET /deliveries/{delivery_id}`) | status: done
- [x] P2-9 | category: Completeness | severity: P2 | action: Already fixed — `test_webhook` returns typed `WebhookDelivery` DTO | status: done
- [x] P2-10 | category: Completeness | severity: P2 | action: Not applicable — events are system-generated, archival not relevant | status: done
- [x] P2-11 | category: Completeness | severity: P2 | action: Removed dead `circuit_breaker.py` (never wired into delivery pipeline) | status: done
- [x] P2-12 | category: Completeness | severity: P2 | action: Removed unused retry scheduling constants from config and `calculate_next_retry_at` from utils | status: done
- [x] P2-13 | category: Consistency | severity: P2 | action: Added `status_code` and `response_model_exclude_none` to all route registrations | status: done
- [x] P2-14 | category: Consistency | severity: P2 | action: Added `*` keyword-only separator to all router handler signatures | status: done
- [x] P2-15 | category: Consistency | severity: P2 | action: Webhooks DAO uses shared `apply_windowing`; events DAO uses custom logic by design (P1-8) | status: done
- [x] P2-16 | category: Consistency | severity: P2 | action: Already fixed — single header path uses `X-Agenta-Event-Type` consistently | status: done
- [x] P2-17 | category: Consistency | severity: P2 | action: Added `ix_webhook_subscriptions_project_id_deleted_at` index to DBE | status: done
- [x] P2-18 | category: Consistency | severity: P2 | action: Not a bug — standalone `project_id` indexes exist in evaluations + tracing DBEs (established pattern) | status: done
- [x] P2-19 | category: Consistency | severity: P2 | action: Rewrote events interface from `Protocol` to `NotImplementedError` style (project convention) | status: done
- [x] P2-20 | category: Quality | severity: P2 | action: By design — inline cache key construction is the project-wide pattern | status: done
- [x] P2-21 | category: Quality | severity: P2 | action: Removed delivery query caching entirely (worker writes bypass cache) | status: done
- [x] P2-22 | category: Correctness | severity: P2 | action: Kept `status: Optional[Status]` in query contract; DAO filters on `status.code` consistently | status: done
- [x] P3-1 | category: Quality/Nit | severity: P3 | action: Wontfix — hardcoded config values are acceptable | status: done
- [x] P3-2 | category: Quality/Nit | severity: P3 | action: Removed — circuit breaker was dead code (P2-11) | status: done
- [x] P3-3 | category: Quality/Nit | severity: P3 | action: Made `WebhookDeliveryData.url` required (`HttpUrl` not optional) | status: done
- [x] P3-4 | category: Quality/Nit | severity: P3 | action: Changed `WebhookSubscriptionFlags.is_active` default to `True` | status: done
- [x] P3-5 | category: Quality/Nit | severity: P3 | action: Removed — `calculate_next_retry_at` was dead code (P2-12) | status: done
- [x] P3-6 | category: Quality/Nit | severity: P3 | action: Removed `type: ignore[arg-type]` (url is now required `HttpUrl`) | status: done
- [x] P3-7 | category: Quality/Nit | severity: P3 | action: Fixed typo in worker comment section header | status: done
- [x] P3-8 | category: Quality/Nit | severity: P3 | action: Replaced `EventKey` tuple with plain `Dict[str, Any]` batches; removed `ProjectEventBatch` | status: done
- [x] P3-9 | category: Quality/Nit | severity: P3 | action: Normalized `include_router` to use `router=` keyword arg (secrets + webhooks) | status: done
- [x] P3-10 | category: Quality/Nit | severity: P3 | action: By design — EE/OSS event migrations are intentionally near-identical | status: done

## PR Comment Findings (Non-duplicated)

- [x] PR-1 | category: Architecture/Layering | severity: P1 | action: Verified — no layering violations in webhooks/events domains | status: done
- [x] PR-2 | category: Architecture/DB Structure | severity: P1 | action: Verified — DBEs correctly placed in `dbs/postgres/webhooks/dbes.py` | status: done
- [x] PR-3 | category: Contract Design | severity: P1 | action: Verified — all services/DAOs return typed DTOs via mappings layer | status: done
- [x] PR-4 | category: API Conventions | severity: P1 | action: Use nested request/response envelopes for webhook subscription/delivery payloads and return singular responses with `count` | status: done
- [x] PR-5 | category: Migration Seam/Coupling | severity: P2 | action: Deferred — Redis/Postgres IoC will be handled in a separate PR | status: done
- [x] PR-6 | category: Style/Consistency | severity: P3 | action: Normalized `*` placement, service attr names, `__init__` keyword-only, merged config+events+dtos into types.py, moved tasks.py to tasks layer | status: done

PR finding notes:
- `PR-1`: Core/DB import API schemas and core imports entrypoints; violates Router -> Service -> DAO Interface -> DAO Impl -> DB direction.
- `PR-2`: Webhook DB models placed in legacy monolithic models file instead of `dbs/postgres/webhooks/dbes.py`.
- `PR-3`: Services/routers return DBE objects instead of typed DTO contracts.
- `PR-4`: Endpoints diverge from project conventions (`POST /query`, archive/unarchive routes, response envelopes with `count`).
- `PR-5`: New webhook trigger path added through legacy router seam; should remain minimal and not force core->entrypoint coupling.
- `PR-6`: Lower-priority style drift (`schemas.py` naming and signature style vs local conventions).

## PR Inline Comment Mapping

- `2863230926`, `2863230977` -> `P0-1`
- `2863231009`, `2863231044` -> `P0-2`
- `2863230905` -> `P0-3`
- `2863230989` -> `P0-4`
- `2863230936`, `2863231060` -> `P0-6`
- `2863230952` -> `P1-1`
- `2863230962`, `2863231029` -> `P1-13`
- `2863231077` -> `P1-12`
