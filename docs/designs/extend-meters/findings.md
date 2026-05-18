# Extend Meters — Findings

- **Sources**: deep scan of code + docs at 2026-05-18; sync against [PR #4347](https://github.com/Agenta-AI/agenta/pull/4347) review comments
- **Branch**: `feat/clean-up-meters`
- **Path**: `docs/designs/extend-meters`
- **Depth**: `deep`

## Summary

Sync pulled in 11 inline review comments from two Copilot review passes on PR #4347, all closed. A third Copilot pass on 2026-05-18 09:24Z surfaced 6 more threads (3 distinct findings — PR-12, PR-13, PR-14; the 4 worker-import comments are duplicates of PR-13). All three closed. A fourth Copilot pass on 2026-05-18 09:56Z surfaced 8 more threads → 7 distinct findings (PR-15 through PR-21). All seven closed. A fifth pass on 2026-05-18 09:57Z from CodeRabbit (different reviewer bot) surfaced 13 more threads → 10 new distinct findings (PR-22 through PR-31), plus 3 duplicates (PR-16/PR-20/PR-21 — CodeRabbit was running against a pre-fix HEAD). All ten closed: PR-22 (hoisted `text` import), PR-23 (canonicalizer trust model documented), PR-24 (downgrade deletes scoped/daily rows), PR-25 (audited + documented), PR-26 (boundary flake documented), PR-27 (verified by `run-tests.py` — `ValidationError` subclasses `ValueError`, tests pass), PR-28/PR-30 (OSS Gauge.USERS scopes target org from path), PR-29 (wontfix — trust the auth middleware contract, reply on the thread), PR-31 (findings.md doc reconcile).

## Rules

- Findings cite `file:Lstart-Lend` against the current working tree.
- PR comments are quoted with their `discussion_rNNN` ID for traceability.
- Confidence `high` only when directly read from current code.

## Notes

- Sync runs: 2026-05-18, three passes. PR HEADs: `d21c76bd70b31a144a455cd986ce5c016c63dbc6` (pass 1), `a54e99803c365c9c57d418b1ee7368e694c6db88` (pass 2 — PR-12/13/14), and post-PR-12/13/14 fix commits (pass 3 — PR-15..PR-21, awaiting commit).
- Resolve queue priority order: P0 → P1 → P2 → P3.
- **Rule (from user 2026-05-18):** sync's first step is ALWAYS to save new findings to this file, before any code change or proposed-fix discussion.

## Open Findings

(none)

## Closed Findings

### [CLOSED] PR-27 — Unit tests catching `ValueError` are correct; `pydantic.ValidationError` subclasses `ValueError` (P2, high)

- **Category**: Testing / Correctness
- **Files**: `api/ee/tests/pytest/unit/test_compute_meter_id.py`
- **PR comment**: [discussion_r3257956251](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956251)
- **Resolution**: CodeRabbit's claim was wrong. Verified two ways: (1) the full test suite passes (`uv run python run-tests.py` → 1042 passed, 7 skipped — none of the skips related). (2) a direct repro confirms `pydantic.ValidationError` is a subclass of `ValueError` (`issubclass(ValidationError, ValueError) == True`), and the message from a raised `ValueError` inside `@model_validator(mode="after")` is rendered into the `ValidationError`'s string form. `pytest.raises(ValueError, match="user_id requires project_id")` therefore catches it cleanly via the subclass relationship and matches the inner message via the regex. No code change.
- **Action**: GitHub thread replied to and resolved.

### [CLOSED] PR-29 — `permissions_router.verify_permissions` `ctx` access — wontfix, trust the middleware contract (P2, medium)

- **Category**: Correctness / Robustness
- **Files**: `api/oss/src/routers/permissions_router.py:L52-L60`, `api/oss/src/utils/context.py:L96-L102`
- **PR comment**: [discussion_r3257956292](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956292)
- **Resolution (wontfix)**: `get_auth_context()` either returns a fully-populated `AuthContext` or raises `AuthContextMissing` (caught upstream by middleware). `AuthContext` is a frozen Pydantic model with `credentials` and `scope` both required and discriminator-validated; the only constructor in `auth_service._build_auth_context_from_state` either builds the complete shape or returns `None`, in which case the middleware never publishes it on the ContextVar. There is no partial-context state the handler can observe. Adding null guards would create the impression that those failure modes are reachable, which they aren't, and would mask any future contract regression behind a silent fallback rather than the loud `AttributeError` we'd want.
- **Action**: GitHub thread replied to ([discussion_r3258213153](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258213153)) and resolved.

### [CLOSED] PR-22 — `text` import hoisted to module scope in `7990f1e12f47` (P3, high)

- **Category**: Code Quality
- **Files**: `api/ee/databases/postgres/migrations/core/versions/7990f1e12f47_create_free_plans.py`
- **PR comment**: [discussion_r3257956166](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956166)
- **Fix shipped**: `from sqlalchemy import ..., text, ...` at module top; both inline `from sqlalchemy import text as _sa_text` re-imports removed; both call sites now use `text(...)` directly. Single import, no per-iteration overhead, no static-analysis redefinition warning.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-23 — Reshape migration's runtime canonicalizer import is documented as a deliberate trust-model choice (P2, medium)

- **Category**: Migration / Maintainability
- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py`
- **PR comment**: [discussion_r3257956178](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956178)
- **Fix shipped**: Replaced the brief "importing here keeps canonical form in one place" comment with an explicit doc block citing the canonicalizer trust model in `proposal.md` and naming PR-02 as the precedent — dual-source-of-truth produces drift; if the canonical form ever changes, the change requires a re-backfill migration anyway, at which point both sides move together.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-24 — Downgrade now deletes scoped/daily rows before recreating legacy PK (P1, high)

- **Category**: Migration / Correctness
- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py`
- **PR comment**: [discussion_r3257956182](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956182)
- **Fix shipped**: Downgrade now has a new step 1b — `DELETE FROM meters WHERE workspace_id IS NOT NULL OR project_id IS NOT NULL OR user_id IS NOT NULL OR day IS NOT NULL` — that removes every row whose identity depends on dimensions the legacy schema has no representation for, before the new columns are dropped and the legacy composite PK is recreated. Top-of-file docstring documents the lossy semantics. Org-level monthly/gauge rows roundtrip cleanly.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-25 — `MetersDAO.fetch` audited and documented; left optional (P1, high)

- **Category**: Correctness / Security
- **Files**: `api/ee/src/dbs/postgres/meters/dao.py:L286-L321`
- **PR comment**: [discussion_r3257956234](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956234)
- **Fix shipped**: Audited every `MetersDAO.fetch`/`MetersService.fetch` caller — three sites (`api/ee/src/apis/fastapi/billing/router.py:900`, `api/ee/src/core/meters/service.py:51`, `api/ee/src/utils/entitlements.py:486`), all pass a non-`None` scope. No caller currently relies on the unbounded behavior. Added a WARNING docstring at the top of `fetch` calling out the full-table-scan behavior of `scope=None`, naming the three current callers, and instructing future contributors to audit before broadening the surface. Signature unchanged (`Optional[MeterScope] = None`).
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-26 — `test_defaults_to_utcnow_when_no_now` boundary flake documented (P3, high)

- **Category**: Testing
- **Files**: `api/ee/tests/manual/test_billing_period.py:L66-L84`
- **PR comment**: [discussion_r3257956245](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956245)
- **Fix shipped**: Expanded the test's docstring to call out the known boundary flake at month/year rollover, explain why pre-capturing `now` would defeat the test's purpose ("the helper actually calls `datetime.now()` by default"), and note it's accepted because the suite is `tests/manual/` (not CI). No behavior change.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-28 — OSS workspace invite handler now scopes `Gauge.USERS +1` to path-param org (P1, medium)

- **Category**: Correctness / Security
- **Files**: `api/oss/src/routers/organization_router.py:L240-L252`
- **PR comment**: [discussion_r3257956269](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956269)
- **Fix shipped**: Added `scope=scope_from(organization_id=UUID(organization_id))` to the `check_entitlements(key=Gauge.USERS, delta=1)` call. `scope_from` and `UUID` added to imports. Inline comment names the cross-org rationale. Pattern matches PR-18/PR-19 (now extended to gauges, not just flags).
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-30 — OSS user-removal handler now scopes `Gauge.USERS -1` to target workspace's org (P1, medium)

- **Category**: Correctness / Security
- **Files**: `api/oss/src/routers/workspace_router.py:L135-L143`
- **PR comment**: [discussion_r3257956302](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956302)
- **Fix shipped**: Added `scope=scope_from(organization_id=project.organization_id)` to the `check_entitlements(key=Gauge.USERS, delta=-1)` call (project is loaded above from the path-param workspace_id). `scope_from` added to imports. Inline comment names the cross-org rationale. Paired with PR-28.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-31 — `findings.md` PR-02 status text reconciled (P3, high)

- **Category**: Documentation
- **Files**: `docs/designs/extend-meters/findings.md`
- **PR comment**: [discussion_r3257956311](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257956311)
- **Fix shipped**: Rewrote the PR-09 entry to say both halves (ordering + key-case) are closed under PR-01 and PR-02 respectively, and replaced the stale "F-00..F-16" summary at the bottom to reflect the current state (PR-01 through PR-21 closed, PR-22..PR-31 in flight).
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-18 — `Flag.ACCESS` check in `ee.src.routers.organization_router.update_organization` now uses target org from path (P1, medium)

- **Category**: Correctness / Security
- **Files**: `api/ee/src/routers/organization_router.py:L186-L196`
- **PR comment**: [discussion_r3257948995](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257948995)
- **Fix shipped**: Added `scope=scope_from(organization_id=UUID(organization_id))` to the `check_entitlements(key=Flag.ACCESS)` call, where `organization_id` is the path-param the handler is mutating. `scope_from` added to the module imports. Inline comment documents why ambient default would be wrong here. Audit (recorded above) confirmed this is the only path-param-org site for `Flag.ACCESS` — the 11 sites in `api/ee/src/apis/fastapi/organizations/router.py` use `request.state.organization_id` (= ambient) and the async events worker passes `scope=` explicitly already.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-19 — `Flag.RBAC` check in `ee.src.utils.permissions.check_project_has_role_or_permission` now uses target project's org (P1, medium)

- **Category**: Correctness / Security
- **Files**: `api/ee/src/utils/permissions.py:L367-L376`
- **PR comment**: [discussion_r3257949055](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257949055)
- **Fix shipped**: Added `scope=scope_from(organization_id=project.organization_id)` to the `check_entitlements(key=Flag.RBAC)` call. `scope_from` added to the module imports. Inline comment documents the per-org semantics. Cross-org permission checks now read the target project's org plan instead of the ambient caller's plan.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-15 — Migration now relaxes `meters.organization_id` to NULL (P1, high)

- **Category**: Migration / Correctness
- **Files**: `api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py`
- **PR comment**: [discussion_r3257948645](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257948645)
- **Fix shipped**: Upgrade now calls `op.alter_column(TABLE_NAME, "organization_id", existing_type=PG_UUID(as_uuid=True), nullable=True)` after the legacy PK is dropped (new step 5b). Downgrade symmetric: delete any `organization_id IS NULL` rows, then `nullable=False` before the legacy composite PK is recreated. Schema and ORM now agree.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-16 — `MeterPeriod` calendar validator now formats with the effective day (P2, high)

- **Category**: Correctness
- **Files**: `api/ee/src/core/meters/types.py:L80-L90`
- **PR comment**: [discussion_r3257948866](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257948866)
- **Fix shipped**: Replaced `f"{self.day:02d}"` in the error message with `f"{_day:02d}"`, where `_day = self.day if self.day is not None else 1` (the same value passed to `date(...)`). `MeterPeriod(year=2026, month=13)` now raises `ValueError` with a sensible message instead of `TypeError`.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-20 — `proposal.md` "Read-side enforcement" section now matches shipped behavior (P3, high)

- **Category**: Documentation
- **Files**: `docs/designs/extend-meters/proposal.md` — Read-side enforcement section
- **PR comment**: [discussion_r3257948745](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257948745)
- **Fix shipped**: Rewrote the section: hard adjust at every read site (no `cache=`), legacy `TracingRouter.query_spans` + `fetch_trace` covered, eight call sites total. Documents that the handler captures `allowed` and raises 429 on denial, that `strict` is a separate per-plan dial for the meter row (not the handler's 429 contract), and that usage is persisted even with `limit=None`.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-21 — `tasks.md` checklist item now matches shipped behavior (P3, high)

- **Category**: Documentation
- **Files**: `docs/designs/extend-meters/tasks.md` — Read-side enforcement checklist
- **PR comment**: [discussion_r3257948810](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257948810)
- **Fix shipped**: Rewrote the checklist bullets to describe hard-adjust mode (no `cache=` kwarg), eight call sites including the deprecated `TracingRouter`, capture-and-429 contract independent of `strict`, and persistent usage at `limit=None`.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-17 — `TRACES_RETRIEVED` read sites now capture `allowed` and return 429 on denial (P0, high)

- **Category**: Correctness / Functionality
- **Files**: `api/oss/src/apis/fastapi/tracing/router.py` — all 8 sites (3 in `TracingRouter`, 3 in `SpansRouter`, 3 in `TracesRouter`)
- **PR comments**: [discussion_r3257948899](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257948899), [discussion_r3257948945](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257948945)
- **Fix shipped**: Every `TRACES_RETRIEVED` call site now reads `allowed, _, _ = await check_entitlements(...)` and raises `HTTPException(429, detail="You have reached your trace retrieval quota for this period.")` when `allowed is False`. The meter is still upserted (the hard adjust commits in both modes), but the handler respects the entitlement system's verdict. The 429 path is independent of `strict` — `strict` only controls whether the meter row stops committing past the limit, while the handler's contract is to refuse the response on `False`.
- **Action**: Reply on the two GitHub threads and resolve.

### [CLOSED] PR-12 — `check_entitlements` hard adjust now honors explicit `period` end-to-end (P2, high)

- **Category**: Correctness
- **Files**: `api/ee/src/utils/entitlements.py:L515-L527`, `api/ee/src/dbs/postgres/meters/dao.py:L55-L78`
- **PR comment**: [discussion_r3257749819](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257749819)
- **Fix shipped**: Two-pronged. (1) In `check_entitlements`, the `MeterDTO` built for the hard adjust now carries `year=_period.year, month=_period.month, day=_period.day` so the validator computes a `meter_id` consistent with the cache key. (2) `_normalize_period_on_meter` in the DAO now early-returns when the meter already has any of `year`/`month`/`day` set — the normalizer only snaps to the current bucket when the caller did not specify one. Together, an explicit `period=` argument flows through the cache, the DTO's `meter_id`, and the DB upsert without rewrite. Updated docstring documents the contract.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-14 — `MeterDTO` now validates supplied `meter_id` against canonical, recomputes on mismatch (P2, medium)

- **Category**: Correctness / Soundness
- **Files**: `api/ee/src/core/meters/types.py:L159-L200`
- **PR comment**: [discussion_r3257750100](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257750100)
- **Fix shipped**: `_populate_meter_id` always computes `canonical = compute_meter_id(scope, period, key)`. If the caller supplied a `meter_id` that differs from canonical, the module-level `log` (matching the codebase pattern — `log = get_module_logger(__name__)` at the top of the module) emits a warning and the canonical value is written back. No raise, no silent override: mismatches are recoverable but loud, which makes `compute_meter_id` the real single source of truth.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-13 — EE imports in worker entrypoints not guarded by `is_ee()` (P1, high)

- **Category**: Compatibility
- **Files**: `api/entrypoints/worker_tracing.py`, `api/entrypoints/worker_events.py`, `api/entrypoints/worker_evaluations.py`, `api/entrypoints/worker_webhooks.py`
- **PR comments**: [discussion_r3257749892](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257749892), [discussion_r3257749928](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257749928), [discussion_r3257749968](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257749968), [discussion_r3257750016](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257750016)
- **Fix shipped**: Wrapped `from ee.src.utils.entitlements import bootstrap_entitlements_services` in `if is_ee():` at module load time in all four worker entrypoints, and guarded the call site the same way. OSS-only builds where the `ee.*` package isn't on the path no longer crash at worker startup. Matches the existing `if is_ee(): import ...` pattern in `api/entrypoints/routers.py:319`.
- **Action**: Reply on all four GitHub threads and resolve.

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

- **PR comment**: [discussion_r3257428423](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3257428423) flagged migration ordering as a duplicate concern alongside the key-case bug. The ordering half was fixed under PR-01; the key-case half was fixed under PR-02. Both are closed.
- **Action**: GitHub thread replied to and resolved.

### [CLOSED] F-00 through F-16 — pre-sync scan findings

All 17 internal scan findings were triaged in the pre-sync pass and either closed pre-sync or rolled into the PR-NN series. By this point in the ledger, every PR-01 through PR-21 has shipped fixes and the latest PR-22..PR-31 batch is in flight (some applied, some pending verification).
