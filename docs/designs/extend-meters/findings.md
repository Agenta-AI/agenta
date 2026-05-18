# Extend Meters — Findings

- **Sources**: deep scan of code + docs at 2026-05-18
- **Branch**: `feat/clean-up-meters`
- **Path**: `docs/designs/extend-meters`
- **Depth**: `deep`

## Summary

Fresh-context scan against the rewritten [proposal.md](./proposal.md) and [tasks.md](./tasks.md). Most of the shipped surface lines up with the docs. One real bug was hit at migration time (PK / NOT NULL ordering) and has been fixed in [9d3e8f0a1b2c_reshape_meters_table.py](../../../api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py). Two open items remain, both low-impact: legacy `/tracing/spans/analytics` is not metered, and the meter namespace UUID is frozen at import time (test-only concern).

## Rules

- Findings cite `file:Lstart-Lend` against the current working tree.
- Confidence only `high` when directly read from current code.

## Open Findings

(none)

## Closed Findings

### [CLOSED] F-12 — `AGENTA_METERS_NAMESPACE_UUID` is frozen at module import time (P3, low)

- **Category**: Testing
- **Files**: `api/ee/src/core/meters/types.py:L15-L17`
- **Evidence**: `AGENTA_METERS_NAMESPACE_UUID = uuid5(env.agenta.uuid_namespace, "meters")` runs once at import. If a test mocks `env.agenta.uuid_namespace` after the module is imported, the canonicalizer keeps the import-time value.
- **Decision**: Documented inline with a comment at the site so future test authors mocking env see the constraint. No code restructuring needed — existing `test_compute_meter_id.py` does not re-mock env between cases.

### [CLOSED] F-00 — Migration crashes on `ALTER COLUMN year DROP NOT NULL` while column is in PK (P0, high)

- **Category**: Migration / Correctness
- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py:L136-L165`
- **Evidence**: Migration runtime log:

  ```text
  ALTER TABLE meters ALTER COLUMN year DROP NOT NULL
  asyncpg.exceptions.InvalidTableDefinitionError: column "year" is in a primary key
  ```

- **Cause**: Step "Relax year/month to nullable" ran before step "Drop the old PK". Postgres requires every PK column to stay `NOT NULL`.
- **Fix shipped**: Step ordering swapped — `op.drop_constraint("meters_pkey", ...)` now runs immediately after the column additions (step 4) and *before* the `alter_column` calls on `year`/`month` (step 5). Backfill, NOT NULL on `meter_id`, secondary index, and new PK follow. Downgrade is the mirror: drop new PK + index → drop new columns → backfill `year`/`month` zeros → `NOT NULL DEFAULT 0` → reverse the enum type-swap → recreate the legacy composite PK last (after `key` is back to the old enum and `year`/`month` are NOT NULL again). Migration docstring also reordered to describe the actual step order.
- **Status**: fixed in the current revision (upgrade + downgrade).

### [CLOSED] F-01 — All four counters declared on every plan (high)

- **Category**: Completeness
- **Files**: `api/ee/src/core/entitlements/types.py:L312-L682`
- **Evidence**: Each of the seven plan blocks declares `EVALUATIONS_RUN`, `TRACES_INGESTED`, `TRACES_RETRIEVED`, `CREDITS_CONSUMED` under `Tracker.COUNTERS` and `USERS` under `Tracker.GAUGES`. `TRACES_RETRIEVED` is `Quota(scope=Scope.USER, period=Period.DAILY)` on every plan.

### [CLOSED] F-02 — `EVALUATIONS_RUN` +1/-1 wiring correct in all three handlers (high)

- **Files**: `api/oss/src/apis/fastapi/evaluations/router.py`
- **Evidence**: `EvaluationsRouter.create_runs`, `SimpleEvaluationsRouter.create_evaluation`, `SimpleQueuesRouter.create_simple_queue` each: `check_entitlements(key=Counter.EVALUATIONS_RUN, delta=N)` → `HTTPException(429)` on `not allowed` → `try/except Exception:` around the service call with `delta=-N` refund.
- **Note**: refund triggers on any `Exception`, not narrowed to "internal errors". Acceptable broad-safety trade-off — domain exceptions (validation, conflict) will also refund. Worth a sentence in [proposal.md](./proposal.md) under "Write-side enforcement" so the breadth is explicit.

### [CLOSED] F-03 — `TRACES_RETRIEVED` soft-check on all six read paths (high)

- **Files**: `api/oss/src/apis/fastapi/tracing/router.py:L476, L863, L915, L954, L1250, L1460, L1503`
- **Evidence**: All six paths call `check_entitlements(key=Counter.TRACES_RETRIEVED, cache=True, delta=...)` with the correct delta shape (`len(traces)` / `len({s.trace_id for s in spans})` / `1 or 0` for singletons).

### [CLOSED] F-04 — Analytics / users / sessions endpoints intentionally excluded from `TRACES_RETRIEVED` (medium)

- **Category**: Completeness
- **Files**: `api/oss/src/apis/fastapi/tracing/router.py` — `fetch_legacy_analytics` (`/tracing/spans/analytics`, L187-L234), `query_analytics` / `query_sessions` / `query_users` (`/spans/analytics/query`, `/spans/sessions/query`, `/spans/users/query`).
- **Evidence**: None of these handlers call `check_entitlements(key=Counter.TRACES_RETRIEVED, ...)` and none should. `TRACES_RETRIEVED` counts traces *leaving the system as traces or spans*. Analytics endpoints return aggregates; users/sessions endpoints return IDs. They are not trace/span retrieval surfaces.
- **Decision**: Exclusion is intentional and consistent across new and legacy mounts. Documented in [proposal.md](./proposal.md) under "Read-side enforcement".

### [CLOSED] F-05 — `query_spans_or_traces` direct callers (low, theoretical)

- **Files**: `api/oss/src/apis/fastapi/tracing/router.py:L263-L268`
- **Evidence**: Only HTTP-bound callers reach this method; billing usage reads the meters table directly via DAO. No real gap.

### [CLOSED] F-06 — `adjust()` `ON CONFLICT (meter_id)` uses the PK (high)

- **Files**: `api/ee/src/dbs/postgres/meters/dao.py:L421-L434`, `api/ee/src/dbs/postgres/meters/dbes.py:L11-L37`
- **Evidence**: Conflict target is `[MeterDBE.meter_id]`; `PrimaryKeyConstraint("meter_id")` in `__table_args__`. PK satisfies the uniqueness requirement; no additional unique index needed.

### [CLOSED] F-07 — Soft-check cache invalidation policy is consistent with intent (high)

- **Files**: `api/ee/src/utils/entitlements.py:L424-L509`
- **Evidence**: Soft check (`cache=True`) never rejects (returns `allowed=True` on overshoot warning); hard check (`cache=False`) invalidates on rejection and updates on success. Cache invalidation policy is correct for the two modes.

### [CLOSED] F-08 — Migration backfill order is correct relative to the enum swap (high)

- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py`
- **Evidence**: Enum type-swap completes (step 2) before the meter_id backfill loop (step 7), so `key::text` already holds the renamed values when the loop reads it. `WHERE organization_id = :org AND key::text = :key AND year IS NOT DISTINCT FROM :year ...` correctly matches on the renamed key.

### [CLOSED] F-09 — `MeterDTO._populate_meter_id` re-validates on every construct (low)

- **Files**: `api/ee/src/core/meters/types.py:L157-L180`
- **Evidence**: The validator instantiates `MeterScope` and `MeterPeriod` to delegate validation. This is intentional (single source of truth) and the overhead is negligible at runtime volume. Not a finding to act on; recorded for future readers.

### [CLOSED] F-10 — `MeterDTO.with_period` recomputes `meter_id` correctly (high)

- **Files**: `api/ee/src/core/meters/types.py:L182-L199`
- **Evidence**: Sets `meter_id = None` in the dump before `MeterDTO(**data)`, so the validator re-runs `compute_meter_id`.

### [CLOSED] F-11 — `monthly_period_from` anchor semantics (medium)

- **Files**: `api/ee/src/utils/entitlements.py:L175-L203`
- **Evidence**: `if not anchor or now.day < anchor: return (now.year, now.month)` else advance one month. Matches Stripe's inclusive-on-anchor-day semantics used elsewhere in the codebase. No off-by-one.

### [CLOSED] F-13 — Enum rename deployment window (medium)

- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py`
- **Evidence**: The transactional type-swap is atomic. Application code uses `Counter.TRACES_INGESTED` / `Counter.EVALUATIONS_RUN` only; there is no `Counter.TRACES` reference left to bind to the old enum value. Deployment ordering is operational, not a code-level gap.

### [CLOSED] F-14 — DAILY rollup sum in `/billing/usage` (high)

- **Files**: `api/ee/src/apis/fastapi/billing/router.py:L943-L957`
- **Evidence**: `value += meter.value or 0` across all rows matching `(key, year, month, day)` — correct, because `TRACES_RETRIEVED` is `scope=Scope.USER` and the org-rollup card sums across users.

### [CLOSED] F-15 — `test_compute_meter_id.py` coverage (high)

- **Files**: `api/ee/tests/pytest/unit/test_compute_meter_id.py`
- **Evidence**: Namespace derivation, determinism, str/enum key equivalence, None semantics, distinct scope/period shapes, UUID case insensitivity, and hierarchy validation for both `MeterScope` and `MeterPeriod`. No DAO upsert integration tests — possible future addition, not a blocker.

### [CLOSED] F-16 — Frontend usage card consumes `period` / `scope` (high)

- **Files**: `web/ee/src/services/billing/types.d.ts:L15-L23`, `web/ee/src/components/pages/settings/Billing/index.tsx:L170-L171`, `web/ee/src/components/pages/settings/Billing/assets/types.d.ts:L12-L15`
- **Evidence**: `UsagePeriod = "yearly" | "monthly" | "daily" | null`, `UsageScope` typed. Billing page passes `info.period` and `info.scope` to the per-card component. Backend `/billing/usage` already returns both fields. End-to-end aligned.
