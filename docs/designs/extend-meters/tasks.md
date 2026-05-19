# Extend Meters — Shipped Checklist

The original execution plan included two follow-up PRs (env-driven quota overrides; effective access controls builder). Both remain out of scope and tracked separately.

For design context, see [proposal.md](./proposal.md). Pre-PR analysis: [research.md](./research.md), [gap.md](./gap.md).

## Catalog

- [x] Drop `Flag.HOOKS` (dead — declared on every plan, no runtime gate).
- [x] Drop `Counter.EVALUATORS` and `Counter.ANNOTATIONS` (dead enum values).
- [x] Drop `Gauge.APPLICATIONS` (declared with no runtime consumer).
- [x] Keep `Counter.EVALUATIONS_RUN` (renamed from `EVALUATIONS`) — wired with proper +1/-1 at every evaluation-run creation site.
- [x] Rename `Counter.TRACES → TRACES_INGESTED`, `Counter.CREDITS → CREDITS_CONSUMED`. Add `Counter.TRACES_RETRIEVED`.
- [x] Mirror in `Meters` enum.
- [x] `REPORTS` updated: `[Counter.TRACES_INGESTED.value, Gauge.USERS.value]`. `TRACES_RETRIEVED` deliberately absent.
- [x] `CONSTRAINTS[READ_ONLY][COUNTERS]` carries all four counters.

## `Quota` reshape

- [x] `class Period(str, Enum) = {DAILY, MONTHLY, YEARLY}`.
- [x] `class Scope(str, Enum) = {ORGANIZATION, WORKSPACE, PROJECT, USER}`.
- [x] `class Retention(int, Enum)` (singular, int-valued — was `Periods(str, Enum)`).
- [x] `Quota.monthly: bool` → `Quota.period: Optional[Period] = None`. Mechanical migration of every call site.
- [x] `Quota.scope: Optional[Scope] = None` added.
- [x] `Quota.strict: Optional[bool] = None` (None means False).
- [x] `Quota.retention: Optional[Retention] = None`.
- [x] `Probe.monthly` → `Probe.period`. `Probe.delta: Optional[bool] = None` (None means absolute).

## Plan declarations

- [x] Every plan declares `EVALUATIONS_RUN`, `TRACES_INGESTED`, `TRACES_RETRIEVED`, `CREDITS_CONSUMED` under `Tracker.COUNTERS` and `USERS` under `Tracker.GAUGES`.
- [x] `TRACES_RETRIEVED` is `Quota(scope=Scope.USER, period=Period.DAILY)` on every plan (limit defaults to None — structurally present, currently unlimited).

## Canonicalizer

- [x] `compute_meter_id(*, scope: MeterScope, period: MeterPeriod, key)` in `api/ee/src/core/meters/types.py`. Single source of truth for `meter_id`.
- [x] `AGENTA_METERS_NAMESPACE_UUID = uuid5(env.agenta.uuid_namespace, "meters")`. Rotation-proof — derived from the literal `"agenta"` string via `env.agenta.uuid_namespace = uuid5(NAMESPACE_DNS, "agenta")`.
- [x] Canonical labels: short — `org`, `wrk`, `prj`, `usr`, `y`, `m`, `d`, `key`. Sorted alphabetically. `"|"` separator. None excluded.
- [x] `MeterScope` validates hierarchy (workspace requires organization, etc.).
- [x] `MeterPeriod` validates hierarchy *and* calendar (Feb 30 rejected).
- [x] `MeterDTO._populate_meter_id` constructs `MeterScope` + `MeterPeriod` internally so any invalid shape fails at DTO construction.
- [x] Unit tests at `api/ee/tests/pytest/unit/test_compute_meter_id.py`.

## Meters table

- [x] New columns: `meter_id UUID NOT NULL`, `workspace_id`, `project_id`, `user_id` (UUID NULL), `day SMALLINT NULL`.
- [x] `year`, `month` relaxed to NULL (dropped `DEFAULT 0`).
- [x] `organization_id` relaxed to NULL via the shared `ScopeDBA` (only `MeterDBA` consumes the composed version; strict tenant tables still use the individual `*ScopeDBA` mixins).
- [x] PK on `(meter_id)`. Old composite PK dropped.
- [x] `idx_meters_org_key_period` on `(organization_id, key, year, month, day)` — non-unique. Extended with `day` so DAILY rollups are index-supported.
- [x] `idx_synced_value` on `(synced, value)` kept.
- [x] FK only on `organization_id → subscriptions.organization_id`. No FKs to workspaces/projects/users (meters may outlive scoped entities).

## Migration

- [x] Single revision `9d3e8f0a1b2c_reshape_meters_table` (down-revision `e6f7a8b9c0d1`). Transactional.
- [x] Order matters: drop the legacy composite PK **before** relaxing `year`/`month` to nullable — Postgres refuses `DROP NOT NULL` on a PK column. Downgrade restores `NOT NULL DEFAULT 0` on `year`/`month` **before** recreating the composite PK.
- [x] Postgres `meters_type` enum reshaped via type-swap with `CASE` in `USING`:
  - `TRACES → TRACES_INGESTED`
  - `CREDITS → CREDITS_CONSUMED`
  - `EVALUATIONS → EVALUATIONS_RUN`
  - `APPLICATIONS` dropped (rows deleted first).
  - `TRACES_RETRIEVED` added.
- [x] Backfill `meter_id` by importing `compute_meter_id`, `MeterScope`, `MeterPeriod` from `ee.src.core.meters.types`. Migration does not maintain a parallel canonicalizer.
- [x] `(year=0, month=0)` gauge sentinel rows promoted to real NULLs.
- [x] Downgrade reverses every step. `TRACES_RETRIEVED` rows are deleted before the enum narrows back.
- [x] Standalone enum-extend revision `8c4f1d2e9a7b` was rolled into the reshape revision (was originally planned as two revisions for `ALTER TYPE ADD VALUE`; the transactional type-swap makes that split unnecessary).
- [x] Historical migration `7990f1e12f47_create_free_plans.py` updated: uses raw SQL with `_LEGACY_APPLICATIONS_KEY = "APPLICATIONS"` constant and `CAST(:key AS meters_type)` so module import does not depend on the (now-removed) `Gauge.APPLICATIONS` Python enum member.

## DAO surface

- [x] `MetersDAO` methods all key on `meter_id`.
- [x] Helpers extracted: `_dbe_to_dto`, `_normalize_period_on_meter`, `_format_meter_for_log`.
- [x] `MeterDTO.with_period(...)` returns a copy with normalized period and recomputed `meter_id`.
- [x] `fetch(*, scope, key, period)` applies `filter_by` per non-None dim.
- [x] `adjust()` upserts with `ON CONFLICT (meter_id) DO UPDATE`.
- [x] `compute_billing_period` replaced by `monthly_period_from(now, anchor) -> (year, month)` and `period_from(*, period, anchor) -> MeterPeriod` (in `api/ee/src/utils/entitlements.py`).

## Entitlements

- [x] `check_entitlements(*, key, delta=None, cache=False, scope=None, period=None)`.
- [x] Composition-root injection: `register_entitlements_services(meters_service=..., subscriptions_service=...)` wires the dependencies once at EE startup. Module-level singletons hold the references.
- [x] `scope_from(*, scope=None, organization_id=None)` projects the ambient `AuthScope` or builds an org-only `MeterScope`.
- [x] `period_from(*, period=None, anchor=None)` returns a `MeterPeriod` for the current moment.
- [x] Cache key includes scope + period + key (`model_dump(mode="json")`).
- [x] Error policy: `EntitlementsException` (config bugs) propagates; everything else fails open.

## Write-side enforcement (`EVALUATIONS_RUN`)

- [x] +1/-1 at the router layer (not service layer) in `api/oss/src/apis/fastapi/evaluations/router.py`:
  - `EvaluationsRouter.create_runs`
  - `SimpleEvaluationsRouter.create_evaluation`
  - `SimpleQueuesRouter.create_simple_queue`
- [x] Permission check first → entitlement check → service call wrapped in `try/except Exception:` with `-N` refund on internal failure.
- [x] On `not allowed`: `HTTPException(429)`.
- [x] No `EvaluationQuotaExceeded` domain exception (router translates boolean directly to HTTP — the domain-exception scaffolding was removed during the pivot to router-layer enforcement).

## Read-side enforcement (`TRACES_RETRIEVED`)

- [x] Wired at the router layer in `api/oss/src/apis/fastapi/tracing/router.py` — 8 call sites across `SpansRouter`, `TracesRouter`, and the deprecated `TracingRouter` (`query_spans` + `fetch_trace`), so legacy `/tracing/*` and `/preview/*` mounts are both covered.
- [x] Delta: `len(traces)` for trace-shaped responses, `len({s.trace_id for s in spans})` for span-shaped responses, `1`/`0` for singletons.
- [x] Hard adjust at each site (no `cache=` — `cache=False` is the default). Atomically upserts the meter row, so usage is persisted whether or not a limit is set.
- [x] Capture `allowed` and raise `HTTPException(429, "You have reached your trace retrieval quota for this period.")` on `False`. Independent of the `strict` quota field — `strict` controls whether the meter row commits past the limit, the handler's 429 is on the boolean either way.
- [x] Sessions / users / analytics are not instrumented (metadata, not traces).

## Usage exposure

- [x] `/billing/usage` exposes `period` and `scope` additively alongside `value`, `limit`, `free`, `strict`.
- [x] Per-caller read: for each quota the response returns the single meter row matching the caller's ambient `AuthScope` projected to `quota.scope`'s granularity (same projection `check_entitlements` uses, so numerator and denominator stay at the same scope). No org-wide aggregation. No `organization_id` path/query/wrapper param — identity comes from the ambient `AuthContext`.
- [x] Frontend types `UsagePeriod`, `UsageScope` carry the new fields. Usage card renders them.

## Out of scope (follow-up PRs)

- Env-driven quota overrides (`AGENTA_QUOTA_OVERRIDES`).
- Replacing the module-level `ENTITLEMENTS` constant with `get_access_controls()` and narrower accessors.
- Per-workspace / per-project plan declarations for `TRACES_RETRIEVED`.
- Daily / per-user reporting surfaces beyond `/billing/usage`.
