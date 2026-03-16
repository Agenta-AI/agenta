# Query Limits Implementation Plan

## Proposed direction

Implement tracing read limits as an EE counter named `spans`, enforced in the tracing service layer after a read result is known, and enabled only when the query-limit environment variables are configured.

The plan below is intentionally split into design-first increments because the meters schema change is the highest-risk part.

## Locked decisions

These decisions are now fixed for implementation.

1. Meter key name.
   Use `spans`.
2. Scope, window, and quota are env-driven.
   Use:
   - `AGENTA_QUERY_LIMITS_SCOPE`
   - `AGENTA_QUERY_LIMITS_WINDOW`
   - `AGENTA_QUERY_LIMITS_QUOTA`
3. Env defaults when only quota is set.
   If `AGENTA_QUERY_LIMITS_QUOTA` is defined and the others are not:
   - scope defaults to `user`
   - window defaults to `daily`
4. Supported scope hierarchy.
   Support all scopes, not a reduced rollout:
   - organization
   - workspace
   - project
   - user
5. Supported window hierarchy.
   Support:
   - yearly
   - monthly
   - daily
6. What counts as a read.
   Every endpoint that fetches, retrieves, or queries traces or spans.
   Exclude:
   - sessions
   - users
   - analytics
7. Delta semantics.
   Count spans, not traces. For trace-shaped responses, delta is the total number of spans returned.
8. Soft-limit semantics.
   Match the existing trace-ingestion entitlement semantics with `strict=False`.
   This means slight overshoot is acceptable when the returned result is larger than the remaining quota.
9. Visibility and billing.
   The meter is internal-only:
   - not visible in customer-facing usage
   - not billable
   - not reportable to Stripe

## Phase 1: Finalize the schema and env contract

Implementation details to lock before coding:

1. Allowed values for `AGENTA_QUERY_LIMITS_SCOPE`.
   Recommendation:
   - `organization`
   - `workspace`
   - `project`
   - `user`
2. Allowed values for `AGENTA_QUERY_LIMITS_WINDOW`.
   Recommendation:
   - `yearly`
   - `monthly`
   - `daily`
3. Parsing behavior.
   Recommendation:
   - if `AGENTA_QUERY_LIMITS_QUOTA` is absent, feature is disabled
   - if `AGENTA_QUERY_LIMITS_QUOTA` is present but invalid, feature is disabled
   - if scope/window are absent, use defaults described above
   - if scope/window are invalid, feature is disabled
4. Endpoint coverage.
   Meter only the trace/span fetch/query endpoints:
   - `query_spans`
   - `fetch_spans`
   - `fetch_span`
   - `query_traces`
   - `fetch_traces`
   - `fetch_trace`

## Phase 2: Refactor entitlements into a builder

Goal: make the new entitlement appear only when the env var is set and valid.

Steps:

1. Replace direct module-level usage of `ENTITLEMENTS` with a small builder API.
2. Keep the existing static defaults as the base catalog.
3. Add env parsing/validation for:
   - `AGENTA_QUERY_LIMITS_SCOPE`
   - `AGENTA_QUERY_LIMITS_WINDOW`
   - `AGENTA_QUERY_LIMITS_QUOTA`
4. Inject the new `Counter.SPANS` quota only when `AGENTA_QUERY_LIMITS_QUOTA` is enabled.
5. Ensure consumers (`check_entitlements()`, throttling, billing usage, retention jobs) read from the builder result rather than a frozen constant.

Notes:

- This should preserve existing behavior when the env var is absent.
- The env parsing should fail closed: invalid values mean "feature disabled", not partial activation.
- The resulting `Quota` should use `strict=False`.

## Phase 3: Extend the meter model safely

Goal: make the schema capable of richer scopes without breaking current organization-level meters.

Recommended implementation path:

1. Add non-null scope and period columns using sentinels for missing hierarchy levels:
   - `workspace_id`
   - `project_id`
   - `user_id`
   - `day`
2. Use sentinel values for missing dimensions:
   - missing `workspace_id` -> nil UUID `00000000-0000-0000-0000-000000000000`
   - missing `project_id` -> nil UUID
   - missing `user_id` -> nil UUID
   - missing `year` -> `0`
   - missing `month` -> `0`
   - missing `day` -> `0`
3. Expand the composite primary key so row identity becomes:
   - `organization_id`
   - `workspace_id`
   - `project_id`
   - `user_id`
   - `key`
   - `year`
   - `month`
   - `day`
4. Add `CHECK` constraints to enforce only valid hierarchy shapes:
   - `year == 0` implies `month == 0` and `day == 0`
   - `workspace_id == nil` implies `project_id == nil` and `user_id == nil`
   - `project_id == nil` implies `user_id == nil`
   - `month > 0` implies `year > 0`
   - `month == 0` implies `day == 0`
    - `day > 0` implies `month > 0`
5. Keep or revisit secondary indexes for the expected query patterns:
   - organization + key + year + month
   - organization + workspace + project + user + key + year + month + day
   - `(synced, value)` for reporting workers
6. Update SQLAlchemy models and DTOs to carry the new fields.

7. Normalize scope into the sentinel-backed hierarchy based on env-selected scope:
   - `organization` -> only `organization_id` is real; workspace/project/user use nil UUID
   - `workspace` -> `organization_id` and `workspace_id` are real; project/user use nil UUID
   - `project` -> `organization_id`, `workspace_id`, `project_id` are real; user uses nil UUID
   - `user` -> all four are real
8. Normalize the time bucket based on env-selected window:
   - `yearly` -> real `year`, `month=0`, `day=0`
   - `monthly` -> real `year` and `month`, `day=0`
   - `daily` -> real `year`, `month`, and `day`
   - non-periodic / not-windowed rows -> `year=0`, `month=0`, `day=0`

## Phase 3a: Migration design

Goal: make the migration explicit and low-risk.

Schema migration steps:

1. Add new columns to `meters` with temporary server defaults:
   - `workspace_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'`
   - `project_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'`
   - `user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'`
   - keep `year SMALLINT NOT NULL DEFAULT 0`
   - keep `month SMALLINT NOT NULL DEFAULT 0`
   - `day SMALLINT NOT NULL DEFAULT 0`
2. Backfill existing rows implicitly via those defaults.
3. Drop the old primary key on `(organization_id, key, year, month)`.
4. Create the new primary key on:
   - `(organization_id, workspace_id, project_id, user_id, key, year, month, day)`
5. Recreate or adjust any affected indexes.
6. Add the hierarchy `CHECK` constraints.
7. Add the new meter enum value for the tracing read counter in the same migration series or an adjacent migration.
8. Optionally remove server defaults afterward if application code will always populate sentinels explicitly.

Data migration behavior:

1. Existing organization-level rows become:
   - `workspace_id = nil UUID`
   - `project_id = nil UUID`
   - `user_id = nil UUID`
   - `day = 0`
2. Existing non-periodic gauge rows remain valid with:
   - `year = 0`
   - `month = 0`
   - `day = 0`
3. Existing monthly counter rows remain valid with:
   - `year = current stored value`
   - `month = current stored value`
   - `day = 0`
4. Future yearly rows will use:
   - `year = real value`
   - `month = 0`
   - `day = 0`
5. Future daily rows will use:
   - `year = real value`
   - `month = real value`
   - `day = real value`

Result:

- no semantic data rewrite is needed for existing rows beyond filling the new columns with sentinels;
- old rows continue to mean "organization-scoped meter for this yearly/monthly bucket";
- new rows can represent deeper scopes without introducing nullable PK columns.

## Phase 4: Generalize the meters DAO and entitlement helper

Goal: allow meter adjustments with optional extra scope while preserving current callers.

Steps:

1. Extend `MeterDTO` with `workspace_id`, `project_id`, `user_id`, `day`.
2. Normalize missing scope values to nil UUID and missing period levels to `0` before any DAO call.
3. Update `MetersDAO.fetch()`, `check()`, `adjust()`, `dump()`, and `bump()` to include the new dimensions.
4. Update upsert conflict handling to use the expanded primary key identity.
5. Extend `check_entitlements()` signature to accept optional scope fields.
6. Extend soft-check cache keys to include all scope and period dimensions that participate in identity.
7. Add normalization helpers that derive:
   - effective scope fields from the env-selected scope
   - effective `year/month/day` from the env-selected window
8. Preserve compatibility for current callers by defaulting extra scope fields to sentinel-normalized organization-level values.

Recommendation:

- Add a small `MeterScope` DTO or helper rather than passing many loose optional parameters everywhere.

## Phase 5: Add tracing read metering in the service layer

Goal: meter read usage once per request, in one place, after the result size is known.

Recommended implementation pattern:

1. Add a private helper in `TracingService`, for example `enforce_read_limit(...)`.
2. Call it from:
   - `query_spans()`
   - `fetch_spans()`
   - `query_traces()`
   - `fetch_traces()`
   - `fetch_trace()`
3. Compute delta from the returned spans:
   - span-shaped responses: `len(spans)`
   - trace-shaped responses: total spans across returned traces
4. Pass organization/workspace/project/user scope from the request path into the service call chain.
5. Skip the check entirely when the env-driven entitlement is absent.

Why service layer:

- It avoids duplicating logic across legacy and preview routers.
- It ensures saved-query resolution paths and direct fetch paths share the same enforcement.
- It reduces the risk of missing one endpoint.

## Phase 6: Keep billing/reporting behavior explicit

Goal: avoid accidentally treating internal read meters as billable Stripe usage.

Steps:

1. Exclude the new read meter from `/billing/usage`.
2. Exclude the new read meter from Stripe reporting.
3. Keep it out of `REPORTS` and document it as an internal entitlement meter.

## Phase 7: Testing

Add targeted tests in this order:

1. Unit tests for env parsing and dynamic entitlement catalog generation.
2. Unit tests for meter identity/caching with optional scope fields.
3. DAO tests for upsert/fetch with nullable scope columns and day granularity.
4. Acceptance tests for tracing reads:
   - below limit succeeds
   - exact limit boundary behaves with `strict=False` semantics
   - env var absent disables enforcement
   - trace query counts spans, not traces
   - direct fetch endpoints also increment usage
   - scope normalization works for organization/workspace/project/user
   - window normalization works for yearly/monthly/daily
5. Regression tests to ensure existing ingestion quotas still work unchanged.

## Suggested delivery order

1. Refactor entitlement catalog behind a builder without behavior change.
2. Add the new counter enum and disabled-by-default env parsing.
3. Land the meter schema migration and DAO/DTO generalization.
4. Add tracing service read-meter helper and wire the read endpoints through service methods.
5. Add tests.
6. Ensure billing/reporting excludes the internal `spans` meter.
