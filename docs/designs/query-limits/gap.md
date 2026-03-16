# Query Limits Gap Analysis

## Target capability

The requested capability is a soft global tracing read limit, likely expressed as "spans read", optionally enabled by environment variable, and potentially tracked at finer scopes than organization alone (`workspace_id`, `project_id`, `user_id`, `day`).

## Gaps in the current codebase

### 1. No meter key for tracing reads

- The enum surface has no meter key for read usage. `Counter` only includes `TRACES`, `EVALUATIONS`, `EVALUATORS`, `ANNOTATIONS`, and `CREDITS`. `Meters` mirrors that. See `api/ee/src/core/entitlements/types.py:24-29` and `api/ee/src/core/meters/types.py:12-19`.
- A new enum value will require both Python enum changes and an Alembic enum migration.

### 2. Meter schema cannot represent the requested dimensions

- The table cannot currently store `workspace_id`, `project_id`, `user_id`, or `day`.
- The primary key and upsert conflict target currently assume one row per `(organization_id, key, year, month)`. See `api/ee/src/dbs/postgres/meters/dbes.py:11-27` and `api/ee/src/dbs/postgres/meters/dao.py:321+`.
- Adding nullable dimensions creates a design decision around uniqueness with `NULL` values. PostgreSQL unique/PK semantics will not let a primary key column be nullable, so "all optional" is incompatible with simply extending the existing primary key.

Implication: the desired "all optional" shape needs a different uniqueness strategy, for example:

- keep non-null sentinels/defaults instead of true nulls for PK columns,
- introduce a surrogate `id` plus a separate unique index strategy,
- use generated scope keys/hashes,
- or define multiple partial unique indexes for different scope combinations.

This needs an explicit design choice before implementation.

### 3. Meter DTOs, DAO methods, and cache keys are not scope-aware

- `MeterDTO` has nowhere to carry workspace/project/user/day. See `api/ee/src/core/meters/types.py:22-33`.
- `check_entitlements()` only accepts `organization_id`, `key`, `delta`, `use_cache`. See `api/ee/src/utils/entitlements.py:60-66`.
- Soft-check cache keys only include `organization_id`, `key`, `year`, `month`. See `api/ee/src/utils/entitlements.py:187-192` and `246-251`.
- DAO `fetch()`, `check()`, `adjust()`, `dump()`, `bump()` all assume the current dimensions. See `api/ee/src/dbs/postgres/meters/dao.py:28-320`.

### 4. Entitlements are static, not env-driven

- `ENTITLEMENTS` is a plain module-level constant. See `api/ee/src/core/entitlements/types.py:297+`.
- There is no mechanism today to add or remove a quota dynamically based on an environment variable.

Implication: to make the new entitlement optional, the entitlement catalog likely needs to become a function or builder layer rather than a static dictionary.

### 5. No tracing read endpoint increments usage

- None of the tracing fetch/query endpoints call `check_entitlements()` or otherwise adjust a read counter. See `api/oss/src/apis/fastapi/tracing/router.py:217-282`, `422-452`, `813-956`, `1049-1264`.
- None of the corresponding service methods meter their results. See `api/oss/src/core/tracing/service.py:577-784`.

Implication: adding read metering only at router level would be repetitive and easy to miss. A service-layer or cross-cutting helper is missing.

### 6. The system does not yet define what "delta" means for each read path

The request direction is to meter spans read, not traces read. Current code does not have a single place that defines that delta.

Open design decisions:

- `fetch_trace()` and `fetch_traces()` return traces but internally materialize spans. Should delta be total spans returned? This seems aligned with the requirement.
- `query_traces()` also returns traces built from spans. Same question.
- `fetch_spans()` and `query_spans()` naturally map to span count.
- Analytics/session/user endpoints do not return spans directly. It is unclear whether they should count as read usage at all.
- Query endpoints with `windowing.limit` limit traces, not spans, when `focus=trace`, so the returned span count can be much larger than requested.

### 7. No current support for "soft global limit" behavior on read paths

The existing entitlement system supports:

- soft check with cache for writes before enqueue,
- hard check with DB adjust during authoritative ingest.

For reads, there is no equivalent policy decision yet:

- Should reads use hard-check-and-increment inline in the request path?
- Should reads be allowed past the limit but logged as over-limit because the limit is "soft"?
- Should "soft" mean non-blocking, or does it mean block only when the optional env var is enabled but still use non-strict meter semantics?

The codebase does not currently encode this behavior.

### 8. Usage fetch/reporting assumes one organization-level row per key

- Billing usage fetch iterates all org meters and picks one value per key based on `month == 0` or current `year/month`. See `api/ee/src/apis/fastapi/billing/router.py:837-860`.
- Stripe/reporting code also uses organization + monthly identity. See `api/ee/src/dbs/postgres/meters/dao.py:28-242`.

Implication: if the new meter is internal-only and environment-gated, it probably should not automatically flow into Stripe reporting or the existing `/usage` response without an explicit product decision.

### 9. Migration risk around existing data and indexes

- Existing rows already rely on the current PK and enum values.
- Extending the table in place will require careful migration ordering if changing PK/index structure.
- Backward compatibility matters because billing/reporting code and subscription relations already reference `meters`.

### 10. Testing coverage does not exist for this feature area

There is coverage for tracing reads and for billing/entitlement flows independently, but no tests that combine:

- tracing query/fetch endpoints,
- entitlement checks,
- scoped meter increments,
- env-driven enable/disable behavior.

## Main design risks

1. Nullable scope columns plus uniqueness are the hardest schema problem.
2. Metering at the wrong layer will either miss endpoints or double-count.
3. Counting spans on trace-shaped responses can surprise consumers if not documented.
4. Reusing the existing billing usage/reporting machinery without separating internal-only meters could leak implementation details into customer-facing billing.
5. Dynamic entitlements via env var are easy to implement incorrectly if the result is cached too aggressively at import time.
