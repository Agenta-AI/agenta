# Extend Meters — As Shipped

This document describes what landed on the branch. The historical pre-PR analysis lives in [research.md](./research.md) and [gap.md](./gap.md); the original execution checklist lives in [tasks.md](./tasks.md).

## What this PR did

1. Reshape the `meters` table from `(organization_id, key, year, month)` to a deterministic `meter_id` PK, with optional `workspace_id` / `project_id` / `user_id` / `day` columns and `year` / `month` relaxed to nullable.
2. Reshape `Quota` to carry `period: Optional[Period]` and `scope: Optional[Scope]`. Drop `monthly: bool`.
3. Clean up the catalog (drop `Flag.HOOKS`, drop `Gauge.APPLICATIONS`, drop `Counter.EVALUATORS` / `Counter.ANNOTATIONS`).
4. Rename counters to their verb-explicit form (`TRACES → TRACES_INGESTED`, `CREDITS → CREDITS_CONSUMED`, `EVALUATIONS → EVALUATIONS_RUN`). Add the new `TRACES_RETRIEVED`.
5. Wire `EVALUATIONS_RUN` +1/-1 at evaluation-run creation sites (`/evaluations/runs`, `/simple/evaluations`, `/simple/queues`) — router-layer enforcement that mirrors how `TRACES_INGESTED` is checked at OTLP and tracing-ingest sites.
6. Wire `TRACES_RETRIEVED` soft-check at every trace/span fetch/query handler. Router-layer, not service-layer — same pattern as ingestion.
7. Expose `period` and `scope` additively in `/billing/usage`; frontend usage card renders them.

Limits for `TRACES_RETRIEVED` are declared `None` (unlimited) in every plan. The structural plumbing is in place; setting a real number per plan is a follow-up product decision.

## Locked decisions (as implemented)

1. **Counter set.** Final `Counter` enum: `EVALUATIONS_RUN`, `TRACES_INGESTED`, `TRACES_RETRIEVED`, `CREDITS_CONSUMED`. Final `Gauge` enum: `USERS`.
2. **`TRACES_RETRIEVED` delta semantics.** Distinct traces retrieved. Trace-shaped responses use `len(traces)`; span-shaped responses use `len({s.trace_id for s in spans})`. Singletons (`fetch_trace`, `fetch_span`) use `1` when a result was returned, else `0`.
3. **`Quota` shape.** `free`, `limit`, `strict`, `retention`, `scope`, `period`. All `Optional`. `strict=None` is treated as `False`. `scope=None` is treated as `Scope.ORGANIZATION`. `period=None` means non-periodic (gauge).
4. **`Probe.delta` and `Probe.period`.** Both `Optional`. `delta=None` means absolute value (not a delta). Replaces the old `Probe.monthly`.
5. **`Retention` (singular, int-valued).** Was `Periods(str, Enum)` of minute counts; renamed to `Retention(int, Enum)` so values flow directly into `Quota.retention: Optional[Retention]`. `Period(str, Enum) = {DAILY, MONTHLY, YEARLY}` is the new quota-bucket enum.
6. **Limit semantics.** `TRACES_RETRIEVED` is `strict=True` on every plan. The DAO's strict-mode predicate rejects any request whose `current + delta` would cross `limit` — there is no "one free overshoot". With `limit=None` everywhere today the check is a no-op, but flipping a real limit immediately starts producing 429s on the exact request that would push the meter past. The `strict` field on `Quota` controls the predicate shape: strict uses `greatest(value + delta, 0) <= limit` (clamps refunds to zero, rejects any overshoot); non-strict uses `value < limit AND delta <= limit` (the same "predictable self-overshoot is always rejected" rule, but allows the request that crosses the line once from below).
7. **Visibility and billing.** `TRACES_RETRIEVED` is in `/billing/usage` like any other counter. It is **not** in `REPORTS`, so Stripe does not see it.

## Final enum surface

```python
# api/ee/src/core/entitlements/types.py
class Counter(str, Enum):
    EVALUATIONS_RUN = "evaluations_run"
    TRACES_INGESTED = "traces_ingested"
    TRACES_RETRIEVED = "traces_retrieved"
    CREDITS_CONSUMED = "credits_consumed"

class Gauge(str, Enum):
    USERS = "users"

class Retention(int, Enum):
    EPHEMERAL = 0
    HOURLY = 60
    DAILY = 1440
    MONTHLY = 44640
    QUARTERLY = 131040
    YEARLY = 525600

class Period(str, Enum):
    DAILY = "daily"
    MONTHLY = "monthly"
    YEARLY = "yearly"

class Scope(str, Enum):
    ORGANIZATION = "organization"
    WORKSPACE = "workspace"
    PROJECT = "project"
    USER = "user"

class Quota(BaseModel):
    free: Optional[int] = None
    limit: Optional[int] = None
    strict: Optional[bool] = None       # None means False
    retention: Optional[Retention] = None
    scope: Optional[Scope] = None       # None means ORGANIZATION
    period: Optional[Period] = None     # None means non-periodic (gauge)
```

```python
# api/ee/src/core/meters/types.py
class Meters(str, Enum):
    # COUNTERS
    EVALUATIONS_RUN  = Counter.EVALUATIONS_RUN.value
    TRACES_INGESTED  = Counter.TRACES_INGESTED.value
    TRACES_RETRIEVED = Counter.TRACES_RETRIEVED.value
    CREDITS_CONSUMED = Counter.CREDITS_CONSUMED.value
    # GAUGES
    USERS            = Gauge.USERS.value
```

## Plan declarations (post-rename)

Every plan declares `EVALUATIONS_RUN`, `TRACES_INGESTED`, `TRACES_RETRIEVED`, `CREDITS_CONSUMED` under `Tracker.COUNTERS` and `USERS` under `Tracker.GAUGES`. `TRACES_RETRIEVED` is `Quota(scope=Scope.USER, period=Period.DAILY)` everywhere — `limit` defaults to `None` (unlimited). Hobby's `EVALUATIONS_RUN` is `Quota(free=20, limit=20, strict=True, period=Period.MONTHLY)`; every other plan declares it `Quota(strict=True, period=Period.MONTHLY)` (unlimited).

`REPORTS` (Stripe allowlist) is `[Counter.TRACES_INGESTED.value, Gauge.USERS.value]`.

`CONSTRAINTS[Constraint.READ_ONLY][Tracker.COUNTERS]` includes all four counters — a blocked org cannot drain history.

## Database changes

### Final shape

`meters` columns after migration:

- `meter_id UUID NOT NULL` — primary key, deterministic UUIDv5 of the canonical scope+period tuple.
- `organization_id UUID NULL` — formerly NOT NULL (relaxed via the shared `ScopeDBA` mixin).
- `workspace_id UUID NULL`, `project_id UUID NULL`, `user_id UUID NULL` — new.
- `year SMALLINT NULL`, `month SMALLINT NULL`, `day SMALLINT NULL` — all nullable (was NOT NULL DEFAULT 0).
- `key meters_type NOT NULL` — enum reshaped (see below).
- `value BIGINT NOT NULL`, `synced BIGINT NOT NULL` — unchanged.

Indexes:

- PK on `(meter_id)` — for keyed upserts.
- `idx_meters_org_key_period` on `(organization_id, key, year, month, day)` — non-unique; serves the org-rollup read path used by `/billing/usage`. Extended with `day` so the DAILY-rollup branch is index-supported.
- `idx_synced_value` on `(synced, value)` — for the reporting worker's `dump()`.

Foreign keys: only `organization_id → subscriptions.organization_id`. No FKs to `workspaces` / `projects` / `users` — deliberate, since meters can legitimately outlive the entities they were scoped to.

### Postgres enum changes

The `meters_type` Postgres enum was reshaped via a type-swap (transactional, atomic) rather than the additive `ALTER TYPE ADD VALUE` (which is non-transactional and rename-incapable).

Final enum values: `USERS`, `EVALUATIONS_RUN`, `TRACES_INGESTED`, `TRACES_RETRIEVED`, `CREDITS_CONSUMED`. The legacy `APPLICATIONS` value is gone (its rows were `DELETE`d). `TRACES`, `CREDITS`, `EVALUATIONS` rows were mapped to their verb-explicit successors via a `CASE` clause inside the `USING` clause of the type swap.

### `meter_id` canonicalization

`compute_meter_id(*, scope: MeterScope, period: MeterPeriod, key)` in `api/ee/src/core/meters/types.py` is the **single** source of truth. Every writer — DAO, helpers, Alembic backfill — calls it. The DB has no SQL-side mirror.

Canonical form rules:

- `None` means "this dimension does not apply"; never "default". `None` fields are excluded from the canonical string.
- Short field-name keys: `org`, `wrk`, `prj`, `usr`, `y`, `m`, `d`, `key`. Pairs sorted alphabetically. Separator `"|"`.
- UUIDs lowercased 8-4-4-4-12. Integers plain decimal.
- Namespace: `AGENTA_METERS_NAMESPACE_UUID = uuid5(env.agenta.uuid_namespace, "meters")`, where `env.agenta.uuid_namespace = uuid5(NAMESPACE_DNS, "agenta")`. Stable across auth-key rotations.

Examples:

- Legacy org-only gauge (USERS): `"key=users|org=a…"`.
- Legacy org-monthly counter (TRACES_INGESTED, 2026-03): `"key=traces_ingested|m=3|org=a…|y=2026"`.
- New per-user daily retrieval (TRACES_RETRIEVED, full hierarchy, 2026-03-17): `"d=17|key=traces_retrieved|m=3|org=a…|prj=p…|usr=u…|wrk=w…|y=2026"`.

`MeterScope` validates hierarchy (`workspace_id` requires `organization_id`, etc.). `MeterPeriod` validates hierarchy *and* calendar (`day=30` in February raises). `MeterDTO` constructs both internally, so any invalid shape fails at DTO construction — there is no way to bypass canonicalization.

### Migration

Single Alembic revision `9d3e8f0a1b2c_reshape_meters_table` (down-revision `e6f7a8b9c0d1`). Wraps every step in a transaction. The separate enum-add revision the original plan called for was dropped — the type-swap absorbs both the rename and the additions.

Upgrade order:

1. `DELETE FROM meters WHERE key::text IN ('APPLICATIONS', 'applications')`.
2. Type-swap with `CASE` in `USING`: maps `TRACES → TRACES_INGESTED`, `CREDITS → CREDITS_CONSUMED`, `EVALUATIONS → EVALUATIONS_RUN`. Drops the legacy `APPLICATIONS` value as a side effect.
3. Add `workspace_id`, `project_id`, `user_id`, `day`, `meter_id` (all nullable).
4. **Drop the legacy composite PK** before relaxing `year`/`month`. Postgres refuses `DROP NOT NULL` on a column while it's still part of a primary key, so the PK has to go first.
5. Relax `year`, `month` to nullable, drop the `DEFAULT 0`.
6. Promote the `(year=0, month=0)` gauge sentinel rows to real NULLs.
7. Backfill `meter_id` by importing `compute_meter_id`, `MeterScope`, `MeterPeriod` from `ee.src.core.meters.types` and computing per-row in Python.
8. `meter_id SET NOT NULL`. Create `idx_meters_org_key_period`. Create new PK on `meter_id`.

Downgrade reverses every step, including deleting `TRACES_RETRIEVED` rows before the type narrows back.

Historical migration cleanup: `7990f1e12f47_create_free_plans.py` was edited to use raw SQL with a `_LEGACY_APPLICATIONS_KEY = "APPLICATIONS"` string constant and `CAST(:key AS meters_type)`, so it no longer depends on the (now-removed) `Gauge.APPLICATIONS` Python enum member at import time.

## DAO surface

`MetersDAO` (`api/ee/src/dbs/postgres/meters/dao.py`):

- All methods key on `meter_id`. Helpers `_dbe_to_dto`, `_normalize_period_on_meter`, `_format_meter_for_log` keep the call sites readable.
- `dump()` orders by `(organization_id, workspace_id, project_id, user_id, key, year, month, day)`.
- `bump()` sorts/dedupes by `meter_id`. Per-chunk `UPDATE ... WHERE meter_id = :id`.
- `fetch(*, scope: Optional[MeterScope], key, period: Optional[MeterPeriod])` applies `filter_by` per non-None dim.
- `check()` filters by `meter_id`; calls `_normalize_period_on_meter` first so the same `meter_id` is computed whether the caller passes a scoped MeterDTO or not.
- `adjust()` upserts with `ON CONFLICT (meter_id) DO UPDATE` (single-column conflict target).

`MetersDAO.adjust()` and `MetersDAO.check()` dispatch by `Quota.period` (DAILY / MONTHLY / YEARLY / None). `compute_billing_period(anchor=...)` is gone; replaced by two helpers in `api/ee/src/utils/entitlements.py`:

- `monthly_period_from(now, anchor)` returns `(year, month)`, honoring a Stripe-style anchor day.
- `period_from(*, period, anchor) -> MeterPeriod` returns a `MeterPeriod` for the current moment at the requested granularity (anchor honored only for `MONTHLY`).

## Entitlement helper

`check_entitlements()` in `api/ee/src/utils/entitlements.py`:

```python
async def check_entitlements(
    *,
    key: Union[Flag, Counter, Gauge],
    delta: Optional[int] = None,
    cache: Optional[bool] = False,
    scope: Optional[MeterScope] = None,
    period: Optional[MeterPeriod] = None,
) -> tuple[bool, Optional[MeterDTO], Optional[Callable]]:
```

Behavior:

- If `scope` is omitted, the function projects the ambient `AuthScope` ContextVar down to the granularity declared by `quota.scope` (using `scope_from(scope=quota.scope)`).
- If `period` is omitted, it computes the current bucket via `period_from(period=quota.period, anchor=...)`.
- Soft mode (`cache=True`): Redis-first read with two-tier cache (60s local, 24h Redis). DB fallback when cold. Never writes. The cache-mode preflight mirrors the DAO's strict/non-strict predicate exactly — strict uses `current + delta <= limit`, non-strict uses `delta <= limit and current < limit` — so Layer 1 (cache) is never stricter than Layer 2 (the authoritative DAO upsert).
- Hard mode (`cache=False`): atomic DAO `adjust()` upsert with returning.
- Cache key: `{scope, period, key}` projected via `model_dump(mode="json")`.
- DB-fallback key binding: the soft-check DB fallback converts the inbound `Counter`/`Gauge` to a `Meters` member by name (`Meters[key.name]`) before calling `MetersDAO.fetch`. The DAO column is `SQLEnum(Meters, name="meters_type")` with name-binding (uppercase Python enum names); passing a `Counter` raw would bind the lowercase `.value` and silently miss every row. `MetersDAO.fetch.key` and `MetersService.fetch.key` are typed `Optional[Meters]` so the type system catches future drift.

Error policy:

- `EntitlementsException` (config bugs — invalid key, missing plan, no subscription) propagates.
- Everything else fails open. A meter glitch never blocks a request.

### Service injection

`MetersService` and `SubscriptionsService` are wired at the composition root, not imported into the entitlements module (which would create a circular dependency through the meters DAO):

```python
register_entitlements_services(
    meters_service=...,
    subscriptions_service=...,
)
```

Called once from the EE entrypoint at startup. Module-level singletons hold the references. This is the only sanctioned way to wire entitlements; the helper raises `RuntimeError` if called before registration.

### Scope helpers

`scope_from(*, scope=None, organization_id=None) -> MeterScope` — single public entrypoint with two modes:

- **Ambient projection** (no `organization_id`): projects the ambient `AuthScope` (ContextVar) at `scope`'s granularity. `scope=None` is treated as `Scope.ORGANIZATION` — the common case where `quota.scope=None` flows through unchanged. Raises `AuthContextMissing` if no auth context is published. Used by HTTP-bound callers (`check_entitlements`, `/billing/usage`, handlers).
- **Explicit org-only** (`organization_id=UUID(...)`, `scope` omitted/None): minimal org-only `MeterScope` with no ambient lookup. Used by bootstrap and background workers without a request context.
- Passing both `scope` and `organization_id` raises `ValueError` — ambiguous.

The previous private `_scope_from(auth_scope, scope)` helper is gone; the contract above lives entirely in `scope_from`. Callers pass `quota.scope` through directly without a `None → ORGANIZATION` branch at the call site.

`period_from(*, period=None, anchor=None) -> MeterPeriod`: builds a `MeterPeriod` for the current moment at the requested granularity.

## `ScopeDBA` was relaxed in shared DBAs

`oss/src/dbs/postgres/shared/dbas.py` carries two flavors:

- The strict, single-scope mixins (`OrganizationScopeDBA`, `WorkspaceScopeDBA`, `ProjectScopeDBA`, `UserScopeDBA`) — still `nullable=False`. Other tables that are strictly tenant-bound continue using these.
- The composed `ScopeDBA` (used only by `MeterDBA`) — relaxed inline to `nullable=True` for all four columns.

`PeriodDBA` (year/month/day SmallInteger) is also `nullable=True` across the board. Only `MeterDBA` consumes it.

## Read-side enforcement (`TRACES_RETRIEVED`)

Wired at the **router** boundary, not the service layer. Mirrors the existing `TRACES_INGESTED` soft-check at OTLP / tracing-ingest sites. Service-layer wiring was the original plan, but pivoted to router-layer for consistency with how other counter checks land in the codebase.

Call sites in `api/oss/src/apis/fastapi/tracing/router.py`:

- `SpansRouter.query_spans` (line ~476): `delta = len({s.trace_id for s in spans})`.
- `SpansRouter.fetch_spans` (~863).
- `SpansRouter.fetch_span` (~915, ~954): `delta = 1` if a result was returned, else `0`.
- `TracesRouter.query_traces` (~1250): `delta = len(traces)`.
- `TracesRouter.fetch_traces` (~1460).
- `TracesRouter.fetch_trace` (~1503).

Deprecated `/preview/spans/*` and `/preview/traces/*` mounts resolve through the same router instances, so the check fires there too. The legacy `TracingRouter` at `/tracing/*` is a separate class but its trace/span retrieval handlers (`query_spans`, `fetch_trace`) are also wired with the same `TRACES_RETRIEVED` check — eight call sites total across the three router classes.

**Explicitly excluded** from `TRACES_RETRIEVED`: analytics, sessions, and users endpoints (`/spans/analytics/query`, `/spans/sessions/query`, `/spans/users/query`, and the legacy `/tracing/spans/analytics`). `TRACES_RETRIEVED` counts traces leaving the system as traces or spans; analytics surfaces return aggregates and the session/user surfaces return IDs, so they are not retrieval paths. If you ever add a new surface that *does* return trace/span data, wire the check; analytics aggregates stay out.

`check_entitlements` calls on the read side run in hard-adjust mode (no `cache=` kwarg — `cache=False` is the default). Each call atomically upserts the meter row via `MetersDAO.adjust()` and returns `(allowed, meter, rollback)`. The router captures `allowed` and raises `HTTPException(429, "You have reached your trace retrieval quota for this period.")` when `False`. With `limit=None` everywhere today every call returns `allowed=True`, but usage is persisted regardless — `/billing/usage` shows the right counter values immediately. Setting a real limit on any plan starts producing 429s without further code change. `TRACES_RETRIEVED` is declared `strict=True` on every plan, so the DAO predicate is `greatest(value + delta, 0) <= limit` — the request that crosses the line is itself rejected (no "one free overshoot"). See locked-decision item 6 above for the strict/non-strict predicate split.

## Write-side enforcement (`EVALUATIONS_RUN`)

Three handlers in `api/oss/src/apis/fastapi/evaluations/router.py`:

- `EvaluationsRouter.create_runs`
- `SimpleEvaluationsRouter.create_evaluation`
- `SimpleQueuesRouter.create_simple_queue`

Pattern: after the permission check, call `check_entitlements(key=Counter.EVALUATIONS_RUN, delta=N)`. On `not allowed`, raise `HTTPException(429)`. Then wrap `service.create_*` in `try/except Exception:` — on **any** exception, refund with `delta=-N` and re-raise. Domain exceptions therefore also refund (broad-safety trade-off — the conservative choice for an in-flight quota write, so a failed create never leaves a counted-but-not-created row). After the call returns, refund the *shortfall* between charged `N` and actual creations: `create_runs` refunds `N - len(runs)` if `len(runs) < N`; the single-create handlers refund `1` when the service returned `None`. This covers silent-failure paths where the DAO's `suppress_exceptions(default=[])` decorator or the service's early `return None` guards swallow what would otherwise be an exception.

There is no `EvaluationQuotaExceeded` domain exception or HTTP-exception subclass — the original design had one, but the pivot to router-layer enforcement removed the need for it (the router translates the boolean directly to HTTP).

## Usage exposure

`/billing/usage` (`api/ee/src/apis/fastapi/billing/router.py`) iterates `entitlements[Tracker.COUNTERS] | entitlements[Tracker.GAUGES]` and emits one row per quota. The response includes `period` and `scope` (both nullable strings) alongside `value`, `limit`, `free`, `strict`.

The endpoint reads **per-caller**, not org-rollup. For each quota, the scope is projected via `scope_from(scope=quota.scope)` from the ambient `AuthScope` (same projection `check_entitlements` uses) and the period via `period_from(period=quota.period, anchor=subscription.anchor)`. `MetersService.fetch(scope=_scope, key=Meters[key.name], period=_period)` returns 0 or 1 row; `value` is that row's `value`. Numerator and denominator therefore always sit at the same scope: a per-user limit pairs with a per-user value, never an org-summed value. The route has no path/query/wrapper `organization_id` param — identity comes from the ambient context via `get_auth_scope()`.

Frontend types in `web/ee/src/services/billing/types.d.ts` carry `period?: UsagePeriod` and `scope?: UsageScope`. The usage card renders the descriptors.

## Compatibility verification

- `Counter.TRACES_INGESTED` ingestion behaves identically to pre-PR `Counter.TRACES`. The rename + `monthly=True → period=Period.MONTHLY` migration is mechanical.
- `Counter.CREDITS_CONSUMED` same.
- `/billing/usage` JSON shape: additive only (`period`, `scope` new fields). Existing clients ignore them.
- Stripe reporting: unchanged (`TRACES_RETRIEVED` not in `REPORTS`).
- `compute_meter_id` has unit tests under `api/ee/tests/pytest/unit/`.

## Out of scope

- Env-driven quota overrides (e.g. `AGENTA_QUOTA_OVERRIDES`).
- Per-workspace / per-project meters declared in additional plans.
- Daily / per-user reporting surfaces beyond `/billing/usage`.

These can land on top of what this PR shipped without further schema or DAO work.
