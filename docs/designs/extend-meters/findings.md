# Extend Meters — Findings

- **Sources**: deep scan of code + docs at 2026-05-18; sync against [PR #4347](https://github.com/Agenta-AI/agenta/pull/4347) review comments
- **Branch**: `feat/clean-up-meters`
- **Path**: `docs/designs/extend-meters`
- **Depth**: `deep`

## Summary

Sync pulled in 11 inline review comments from two Copilot review passes on PR #4347. All resolved. Three (PR-01, PR-04, PR-09) were already fixed pre-sync. Resolve passes closed PR-02 + PR-07 (P0 — migration key-case backfill bug and silent fail-open on org-scoped quotas), PR-05 + PR-06 + PR-03 / PR-08 (P1 — worker entitlement bootstrap, legacy migration USERS-meter block, `cache=True` reads never persisting), and PR-10 + PR-11 (P2 — manual billing-period test + new helper tests, deprecated `TracingRouter.query_spans` metering).

## Rules

- Findings cite `file:Lstart-Lend` against the current working tree.
- PR comments are quoted with their `discussion_rNNN` ID for traceability.
- Confidence `high` only when directly read from current code.

## Notes

- Sync run: 2026-05-18. PR HEAD: `d21c76bd70b31a144a455cd986ce5c016c63dbc6`.
- Resolve queue priority order: P0 → P1 → P2 → P3.

## Open Findings

(none)

## Closed Findings

### [CLOSED] PR-11 — Deprecated `TracingRouter.query_spans` now metered (P2, medium)

- **Category**: Completeness
- **Files**: `api/oss/src/apis/fastapi/tracing/router.py` — `TracingRouter.query_spans`
- **PR comment**: [discussion_r3257069425](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257069425)
- **Fix shipped**: Added a `check_entitlements(key=Counter.TRACES_RETRIEVED, delta=trace_count)` call to the deprecated `TracingRouter.query_spans` handler, after the result is materialized. Delta is computed by response shape: distinct trace IDs when the response is span-flat, `len(traces)` when it's the trace-tree map. Same pattern as the new `SpansRouter` / `TracesRouter` handlers. `fetch_trace` on the legacy router was already metered. Other legacy handlers (`fetch_legacy_analytics`, `list_sessions`, `list_users`) deliberately stay unmetered — analytics returns aggregates, sessions/users return IDs, none of them are trace-retrieval surfaces. Total `TRACES_RETRIEVED` call sites: 8 (7 new routers + 1 legacy).
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-03 / PR-08 — `TRACES_RETRIEVED` now persisted via single hard-check (P1, high)

- **Category**: Correctness / Completeness
- **Files**: `api/oss/src/apis/fastapi/tracing/router.py` (7 call sites)
- **PR comments**: [discussion_r3257069401](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257069401), [discussion_r3257428444](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428444)
- **Fix shipped**: Dropped `cache=True` from every `TRACES_RETRIEVED` call site. `cache=False` is the default in `check_entitlements`, so the kwarg simply goes away — each read path is now a single synchronous hard-check that calls `MetersDAO.adjust()` and atomically upserts `meter_id` row + increments value. No async worker for reads; the request-path adjust is the source of accounting. The six `TRACES_INGESTED` soft-checks (OTLP gate + other ingest sites) keep `cache=True` — they're paired with the authoritative hard-check in the async tracing worker, which is the intended two-layer ingestion pattern.
- **Action**: Reply on the two GitHub threads and resolve.

### [CLOSED] PR-05 — Worker entrypoints don't register entitlement services (P1, high)

- **Category**: Completeness
- **Files**: `api/ee/src/utils/entitlements.py` (`bootstrap_entitlements_services`), `api/ee/src/main.py`, `api/entrypoints/worker_{tracing,events,evaluations,webhooks}.py`
- **PR comments**: [discussion_r3257428520](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428520), [discussion_r3257428551](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428551)
- **Fix shipped**: New `bootstrap_entitlements_services(*, meters_service=None, subscriptions_service=None)` helper in `entitlements.py`. When services are not passed, it constructs default `MetersService` + `SubscriptionsService` against fresh DAOs and registers them; when passed (the HTTP entrypoint case), it uses the caller's instances so `BillingRouter` and the entitlements helper share one each. No-op when EE is not enabled, so OSS-only entrypoints can call it unconditionally without dragging EE imports into startup. All four worker entrypoints (`worker_tracing`, `worker_events`, `worker_evaluations`, `worker_webhooks`) now call `bootstrap_entitlements_services()` after `validate_required_env_vars()`. `api/ee/src/main.py` switched from `register_entitlement_services` to `bootstrap_entitlements_services` for symmetry.
- **Action**: Reply on the two GitHub threads and resolve.

### [CLOSED] PR-06 — Historical migration `7990f1e12f47` USERS-meter block converted to raw SQL (P1, high)

- **Category**: Migration / Compatibility
- **Files**: `api/ee/databases/postgres/migrations/core/versions/7990f1e12f47_create_free_plans.py`
- **PR comments**: [discussion_r3257069460](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257069460), [discussion_r3257428499](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428499)
- **Fix shipped**: Removed the `MeterDBE` import and the `Gauge` import. Added `_LEGACY_USERS_KEY = "USERS"` constant alongside `_LEGACY_APPLICATIONS_KEY`. Replaced the `select/insert/update(MeterDBE)` branch with a single raw `INSERT … ON CONFLICT (organization_id, key, year, month) DO UPDATE SET value = EXCLUDED.value, synced = EXCLUDED.synced` using `CAST(:key AS meters_type)` — same pattern as the APPLICATIONS block. The block-level comment now spells out the rationale: live `MeterDBE` columns don't exist at this revision's point in the migration chain, so raw SQL pins the schema as it stood when the migration was authored.
- **Action**: Reply on the two GitHub threads and resolve.

### [CLOSED] PR-10 — Manual billing-period test updated; new unit tests added (P2, high)

- **Category**: Testing
- **Files**: `api/ee/tests/manual/test_billing_period.py`, new: `api/ee/tests/pytest/unit/test_period_from.py`, new: `api/ee/tests/pytest/unit/test_scope_from.py`
- **PR comment**: [discussion_r3257428482](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428482)
- **Fix shipped**: Updated import from `from ee.src.utils.billing import compute_billing_period` → `from ee.src.utils.entitlements import monthly_period_from`. All 30 call sites switched from 3-tuple unpacking `year, month, _ =` to 2-tuple `year, month =`. Test function names left in place since the semantic coverage (anchor day rollover, December year-boundary, February edge cases, exhaustive parametric grid) still applies to the new helper.
- **New tests added** to cover helpers that had no regression net:
  - `test_period_from.py` — `period_from` shape per `Period` enum (None / YEARLY / MONTHLY / DAILY), anchor handling on MONTHLY (year rollover included), anchor ignored on DAILY, parametric "granularity sets exactly the expected dims".
  - `test_scope_from.py` — `scope_from` exclusivity contract (no source / both sources / `scope=None` all raise), ambient-projection equivalence at each granularity, regression net for the silent fail-open bug (the `scope_from(scope=None)` raise is now explicitly asserted), `_scope_from(None) == _scope_from(Scope.ORGANIZATION)` invariant that backs the default fallback.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-07 — `check_entitlements` silently fails open for org-scoped quotas (P0, high)

- **Category**: Correctness / Security
- **Files**: `api/ee/src/utils/entitlements.py:L405-L414`
- **PR comment**: [discussion_r3257428393](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428393)
- **Fix shipped**: Replaced `scope_from(scope=quota.scope)` with `_scope_from(get_auth_scope(), quota.scope)` when the caller didn't pass an explicit scope. `_scope_from` already maps `None` / `Scope.ORGANIZATION` to an org-only `MeterScope`; `scope_from`'s "exactly one source keyword" contract stays as-is for callers that need explicit projection. Inline comment documents the rationale.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-02 — Migration `meter_id` backfill key-case mismatch (P0, high)

- **Category**: Migration / Correctness
- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py:L165-L222`
- **PR comment**: [discussion_r3257428423](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428423)
- **Fix shipped**: Backfill now reads `db_label = row["key"]` (uppercase Postgres enum member name, e.g. `"TRACES_INGESTED"`) and translates to the Python enum value `key_value = Meters[db_label].value` (lowercase `"traces_ingested"`) before calling `compute_meter_id`. The SQL `WHERE` keeps the database label form to avoid cast surprises. Migration imports now include `Meters`. Inline comment documents why. Canonicalizer contract unchanged — it still hashes what it's given verbatim.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-01 — Migration relaxes `year`/`month` to NULL while still in PK (P0, high)

- **Category**: Migration / Correctness
- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py:L141-L157`
- **PR comment**: [discussion_r3257069353](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257069353)
- **Status**: Fixed in current tree (drop PK at step 4, before alter_column at step 5). Same fix on downgrade (recreate composite PK last, after enum + NOT NULL restored).
- **Action**: Reply on the GitHub thread with the resolution and mark resolved.

### [CLOSED] PR-04 — Downgrade recreates legacy PK before deleting `TRACES_RETRIEVED` / scope-dim rows (P1, high)

- **Category**: Migration / Correctness
- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py:L237-L305`
- **PR comment**: [discussion_r3257069353](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257069353) (second site)
- **Status**: Fixed in current tree. Downgrade now: drop new PK + index → drop new columns → restore year/month NOT NULL DEFAULT 0 → reverse enum type-swap (which includes deleting TRACES_RETRIEVED rows) → recreate composite PK last.
- **Action**: Reply and resolve on GitHub.

### [CLOSED] PR-09 — Same as PR-01, duplicate flag (P0, high)

- **PR comment**: [discussion_r3257428423](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428423) flagged migration ordering as a duplicate concern alongside the key-case bug. The ordering half is fixed (PR-01); the key-case half is PR-02 (open).
- **Action**: Reply pointing to PR-02 for the open key-case issue and noting the ordering fix.

### [CLOSED] F-00 through F-16 — pre-sync scan findings

All 17 internal scan findings were already triaged in the prior pass. The PR review comments don't introduce new ones not covered here; they re-flag PR-01 (was F-00, fixed) and surface the new items captured as PR-02 through PR-11.
