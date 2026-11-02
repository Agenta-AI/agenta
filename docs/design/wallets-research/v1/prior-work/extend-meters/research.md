# Extend Meters Research

> **Historical baseline.** This document captures the pre-PR state of the codebase as of 2026-03-16. It is not maintained against the shipped code — see [proposal.md](./proposal.md) and the source tree for the current shape. Kept here so the gap analysis ([gap.md](./gap.md)) has something to refer to.

## Scope of this research

This document describes the current state of metering, entitlements, and tracing read paths in the codebase as of 2026-03-16. It focuses on what already exists for usage tracking and what would need to change to support a soft global tracing read limit measured in spans read.

## Current meters model

The EE meters table is organization-scoped and period-aware only at the `year` / `month` level.

- `MeterDBE` uses a composite primary key of `organization_id`, `key`, `year`, `month` and only declares one extra index on `(synced, value)`. There is no workspace, project, user, or day dimension in the schema today. See `api/ee/src/dbs/postgres/meters/dbes.py:8-29`.
- `MeterDBA` inherits `OrganizationScopeDBA` and `PeriodDBA`. `PeriodDBA` defines only `year` and `month`. See `api/ee/src/dbs/postgres/meters/dbas.py:1-21`.
- `MeterDTO` mirrors that shape: `organization_id`, `year`, `month`, `key`, `value`, `synced`, `delta`, plus optional `subscription`. There are no optional scope fields beyond organization. See `api/ee/src/core/meters/types.py:22-33`.
- The original meters migration created the table with enum values `USERS`, `APPLICATIONS`, `EVALUATIONS`, `TRACES` and the same `(organization_id, key, year, month)` primary key. See `api/ee/databases/postgres/migrations/core/versions/12f477990f1e_add_meters.py:20-43`.
- The only later enum extension found is `CREDITS`; no tracing-read meter exists. See `api/ee/databases/postgres/migrations/core/versions/79f40f71e912_extend_meters.py:1-61`.

## Current entitlement catalog

Entitlements are statically defined at import time.

- `Counter` currently contains `TRACES`, `EVALUATIONS`, `EVALUATORS`, `ANNOTATIONS`, and `CREDITS`. There is no `SPANS_READ`, `QUERIED_SPANS`, or similar meter key. See `api/ee/src/core/entitlements/types.py:24-29`.
- `ENTITLEMENTS` is a module-level dictionary keyed by plan. It is not generated dynamically from environment variables. See `api/ee/src/core/entitlements/types.py:297+`.
- Existing commercial quota examples are monthly trace ingestion quotas (`Counter.TRACES`) and monthly evaluation/credit quotas. Gauges are `USERS` and `APPLICATIONS`. See `api/ee/src/core/entitlements/types.py:297-335`.
- Throttling is configured separately from metering and is path/category based, not cumulative usage based. Tracing query endpoints are currently categorized as `TRACING_SLOW`. See `api/ee/src/core/entitlements/types.py:104-133`.

## Current entitlement check flow

`check_entitlements()` is built around organization-scoped counters/gauges and monthly billing periods.

- It resolves the organization subscription, reads plan + anchor, and then selects the matching entry from the static `ENTITLEMENTS` map. See `api/ee/src/utils/entitlements.py:100-180`.
- In soft-check mode (`use_cache=True`), it reads cache or DB using a cache key composed of `organization_id`, `key`, `year`, `month`. No other dimensions participate in the cache key. See `api/ee/src/utils/entitlements.py:183-228`.
- In hard-check mode, it constructs a `MeterDTO` with only `organization_id`, `key`, and `delta`, then delegates to `meters_service.adjust()`. See `api/ee/src/utils/entitlements.py:230-277`.
- There is no way today to pass workspace, project, or user scope into entitlement checks.

## Current meters DAO behavior

The DAO also assumes a single organization-scoped row per `(key, year, month)`.

- `dump()` orders unsynced rows by `organization_id`, `key`, `year`, `month`. See `api/ee/src/dbs/postgres/meters/dao.py:28-89`.
- `bump()` and `_bump_commit_chunk()` deduplicate and update rows using exactly `(organization_id, key, year, month)`. See `api/ee/src/dbs/postgres/meters/dao.py:95-242`.
- `fetch()` only filters on `organization_id`, `key`, `year`, `month`. See `api/ee/src/dbs/postgres/meters/dao.py:244-278`.
- `check()` and `adjust()` normalize monthly quotas to the current billing year/month and then query/upsert by `(organization_id, key, year, month)`. See `api/ee/src/dbs/postgres/meters/dao.py:280-320` and `api/ee/src/dbs/postgres/meters/dao.py:321+`.
- `adjust()` uses `insert(...).on_conflict_do_update(index_elements=[organization_id, key, year, month])`, so any additional scoping dimensions would need corresponding conflict target changes.

## Current usage/reporting surfaces

- Billing usage fetch reads all organization meters, then matches gauges by `month == 0` and counters by current billing `year/month`. This code assumes at most one relevant row per key for the organization. See `api/ee/src/apis/fastapi/billing/router.py:809-860`.
- Stripe reporting also assumes reportable counters/gauges are organization-level and perioded by month, using identifiers built from `organization_id`, `key`, `year`, `month`, `synced`. See `api/ee/src/core/meters/service.py` and `api/ee/src/dbs/postgres/meters/dao.py:28-242`.

## Current tracing ingestion metering

Tracing ingestion already uses the entitlement system, but only for monthly trace ingestion quotas.

- Synchronous ingest increments `Counter.TRACES` using the number of root spans (`parent_id is None`), effectively counting traces ingested. See `api/oss/src/core/tracing/service.py:103-154`.
- OTLP ingestion performs a soft check before queueing using the same trace-root delta. See `api/oss/src/apis/fastapi/otlp/router.py:177-230`.
- The async tracing worker performs the authoritative hard check before inserting spans. See `api/oss/src/tasks/asyncio/tracing/worker.py:244-289`.

This is the closest existing pattern to reuse, but it meters writes, not reads.

## Current tracing read paths

Tracing reads are exposed through multiple routers, and none of them currently increment a meter.

Router mounting (see `api/entrypoints/routers.py:720-774`):

- The full `TracingRouter` (the old monolithic router defined at the top of `api/oss/src/apis/fastapi/tracing/router.py`) is mounted at both `/tracing` and `/preview/tracing` and tagged **Deprecated**. The `/preview/tracing` mount is hidden from the schema (`include_in_schema=False`). Its `legacy_router` is still mounted at `/tracing` and tagged **Legacy** (it exposes only `POST /tracing/spans/analytics`).
- `SpansRouter` is mounted at `/spans` (current, **Traces** tag) and at `/preview/spans` (deprecated, hidden from schema).
- `TracesRouter` is mounted at `/traces` (current, **Traces** tag) and at `/preview/traces` (deprecated, hidden from schema). Its `deprecated_router` is mounted at `/traces` and exposes the deprecated `POST /traces/ingest`.

Current, non-deprecated, non-legacy read endpoints — these are the ones the limit must cover:

Spans router (`SpansRouter`, prefix `/spans`, `api/oss/src/apis/fastapi/tracing/router.py:710-768`):

- `GET /spans/` → `fetch_spans()` → `TracingService.fetch_spans()` (`router.py:881-924`).
- `POST /spans/query` → `query_spans()` → resolves an optional saved query revision, then `TracingService.query_spans()` (`router.py:811-877`).
- `POST /spans/analytics/query` → `query_analytics()` (analytics only — out of scope).
- `POST /spans/sessions/query`, `POST /spans/users/query` (return IDs, not spans — out of scope).
- `GET /spans/{trace_id}/{span_id}` → `fetch_span()` → `TracingService.fetch_span()`.

Traces router (`TracesRouter`, prefix `/traces`, `api/oss/src/apis/fastapi/tracing/router.py:1074-1143`):

- `GET /traces/` → `fetch_traces()` → `TracingService.fetch_traces()`.
- `POST /traces/query` → `query_traces()` → resolves an optional saved query revision, then `TracingService.query_traces()` (`router.py:1174-1237`).
- `GET /traces/{trace_id}` → `fetch_trace()` → `TracingService.fetch_trace()`.
- The rest of the routes on `TracesRouter` (`POST /traces/`, `PUT /traces/{trace_id}`, `DELETE /traces/{trace_id}`) are mutations and out of scope.

Deprecated / legacy duplicates that resolve to the same service methods (still callable, should remain in sync if the limit is enforced at the service layer):

- Everything mounted under `/preview/spans/*` and `/preview/traces/*` (deprecated, schema-hidden but reachable).
- The old `TracingRouter` at `/tracing/*` (deprecated) — including `POST /tracing/spans/query` which calls `TracingService.query_spans_or_traces()`, and `GET /tracing/traces/{trace_id}` which calls `TracingService.fetch_trace()`.

At the service layer:

- `query_spans_or_traces()` runs a query and formats the result; it does not meter. See `api/oss/src/core/tracing/service.py:584-609`.
- `query_spans()`, `fetch_spans()`, `fetch_span()`, `query_traces()`, `fetch_traces()`, and `fetch_trace()` do not meter. See `api/oss/src/core/tracing/service.py:611-784`.

## Existing enforcement on tracing reads

Tracing reads are protected by permissions and throttling, but not by usage limits.

- Read endpoints consistently check `Permission.VIEW_SPANS` and sometimes `Permission.VIEW_QUERIES` for saved query refs. See `api/oss/src/apis/fastapi/tracing/router.py:811-877` (spans `query`) and `1174-1237` (traces `query`); the deprecated `TracingRouter.query_spans` at `247-...` performs the same check.
- Throttling middleware classifies tracing query endpoints under `TRACING_SLOW`, which is request-rate based only. See `api/ee/src/core/entitlements/types.py:112-119` and `api/ee/src/services/throttling_service.py:1-220`.
- No read endpoint currently calls `check_entitlements()` for a tracing-read counter.

## Key current-state conclusions

1. The current metering system is structurally organization-only plus `year/month`.
2. The entitlement cache keys, DAO queries, primary key, upsert conflict target, usage reporting, and Stripe sync logic all depend on that shape.
3. The only tracing meter in production today is `Counter.TRACES`, which counts ingested traces via root spans.
4. There is no existing read-side tracing usage meter, no env-driven optional entitlement injection, and no service abstraction for scoped read-meter increments.
