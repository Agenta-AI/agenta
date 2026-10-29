# Extend Meters — Findings

- **Sources**: deep scan of code + docs at 2026-05-18; sync against [PR #4347](https://github.com/Agenta-AI/agenta/pull/4347) review comments
- **Branch**: `feat/clean-up-meters`
- **Path**: `docs/designs/extend-meters`
- **Depth**: `deep`

## Summary

Sync pulled in 11 inline review comments from two Copilot review passes on PR #4347, all closed. A third Copilot pass on 2026-05-18 09:24Z surfaced 6 more threads (3 distinct findings — PR-12, PR-13, PR-14; the 4 worker-import comments are duplicates of PR-13). All three closed. A fourth Copilot pass on 2026-05-18 09:56Z surfaced 8 more threads → 7 distinct findings (PR-15 through PR-21). All seven closed. A fifth pass on 2026-05-18 09:57Z from CodeRabbit (different reviewer bot) surfaced 13 more threads → 10 new distinct findings (PR-22 through PR-31), plus 3 duplicates (PR-16/PR-20/PR-21 — CodeRabbit was running against a pre-fix HEAD). All ten closed: PR-22 (hoisted `text` import), PR-23 (canonicalizer trust model documented), PR-24 (downgrade deletes scoped/daily rows), PR-25 (audited + documented), PR-26 (boundary flake documented), PR-27 (verified by `run-tests.py` — `ValidationError` subclasses `ValueError`, tests pass), PR-28/PR-30 (OSS Gauge.USERS scopes target org from path), PR-29 (wontfix — trust the auth middleware contract, reply on the thread), PR-31 (findings.md doc reconcile).

A sixth Copilot pass on 2026-05-18 11:30Z surfaced 9 new distinct findings (PR-32 through PR-40). All nine closed: PR-32 (intentional — CLOUD_V0_AGENTA_AI is meant to be unlimited on credits, no change); PR-33 (`workspace_router.remove_user_from_workspace` now loads owner from target workspace's org); PR-34 (re-added `if delta > 0:` guard around both `tracing/router.py` ingest soft checks); PR-35 (`MetersDAO.adjust` strict/non-strict predicates rewritten per user-defined truth table — strict denies any predictable overshoot; non-strict denies predictable self-overshoot but permits the one cross-the-line request from below; seven new unit tests pin the table); PR-36 (`AuthContext` model now `frozen=True`); PR-37/PR-38/PR-39/PR-40 (proposal.md + summary.md aligned with shipped semantics — `strict=True` everywhere on `TRACES_RETRIEVED`, hard-check on reads, broad refund on writes). All eighteen `test_meters_dao_strict_soft.py` unit tests pass.

A seventh Copilot pass on 2026-05-18 12:53Z surfaced 3 new distinct findings (PR-41 through PR-43). Plus PR-44 — an internal staging incident discovered during deployment of the pass-6 fixes. All four closed: PR-41 (`/billing/usage` rewritten to per-caller scoped read — same projection `check_entitlements` uses; no more aggregation against a per-user limit; `organization_id` path/wrapper param dropped, identity reads ambient `AuthScope`); PR-42 (`MetersDAO.fetch.key` and the service/interface tightened to `Optional[Meters]`, with the one runtime caller converting `Counter`/`Gauge` → `Meters[key.name]` at the boundary — closes the silent soft-check fail-open without a DB migration); PR-43 (`check_entitlements` cache preflight now mirrors the DAO's strict/non-strict split so Layer 1 is never stricter than Layer 2); PR-44 (staging migration crashed on 2 corrupt `(year=2025, month=0)` rows that the new calendar validator correctly rejected — operator-fixed the rows, audited prod clean, no code change). 69/69 EE unit tests still pass.

An eighth Copilot pass on 2026-05-18 14:52Z surfaced 1 new finding (PR-45) — a regression introduced by PR-41: the rewrite called `scope_from(scope=None)` which had been deliberately raising since PR-15, so `/billing/usage` crashed on the first org-scoped quota. Closed: PR-45 collapsed the public/private split — `scope_from` is now the single helper (ambient by default, `scope=None` means `Scope.ORGANIZATION`, explicit `organization_id` still supported, both-args still raises). `_scope_from` removed. `check_entitlements` and `/billing/usage` now share the same call shape. `test_scope_from.py` rewritten for the unified contract; 68/68 EE unit tests pass.

A ninth Copilot pass on 2026-05-18 16:01Z surfaced 1 new finding (PR-46): the three `EVALUATIONS_RUN` write handlers (`create_runs`, `create_evaluation`, `create_simple_queue`) charged the meter before the service call but only refunded on `except Exception`. Each service path can fail silently — the DAO's `suppress_exceptions(default=[])` for `create_runs`, the early-guard `return None` paths in `simple_evaluations.create` and `simple_queues.create` — so the meter kept the full charge while the handler returned `count=0`. Closed: added a post-call shortfall refund (`shortfall = charged - actual; if shortfall > 0: refund -shortfall`) at all three sites. Exception refund paths unchanged. 68/68 EE unit tests pass.

A tenth Copilot pass on 2026-05-18 16:35Z surfaced 1 doc-only finding (PR-47): the `tasks.md` Usage-exposure checklist still claimed `/billing/usage` "DAILY branch sums across rows" — stale relative to the pass-7 per-caller rewrite that already landed in `proposal.md` and `summary.md`. Closed: rewrote the checklist item to describe the per-caller projected-scope read. No code change.

An eleventh Copilot pass on 2026-05-19 07:08Z surfaced 1 new finding (PR-48): `MetersDAO.fetch` treated `None` dimensions on a supplied `MeterScope`/`MeterPeriod` as wildcards, so an org-scoped monthly read could also match finer-scoped or DAILY rows for the same `(org, key, year, month)`. Today the bug was masked because no quota mixed "org-grain + DAILY" or "workspace-grain + MONTHLY", but the contract was broken. Closed: `fetch` now binds `workspace_id`, `project_id`, `user_id`, `year`, `month`, `day` unconditionally (SQLAlchemy compiles `filter_by(col=None)` to `col IS NULL`); `organization_id` stays conditional to preserve the `MeterScope()` admin escape hatch; `scope=None` / `period=None` still skip the respective family. 10 new unit tests in `test_meters_dao_fetch.py` pin the per-dimension `IS NULL` binding and the escape hatches. 78/78 EE unit tests pass.

A twelfth Copilot pass on 2026-05-19 12:17Z surfaced 2 new in-scope findings (PR-49, PR-50) plus 4 out-of-scope comments against `docs/designs/support-fields/*` (tracked separately). Both new findings are **open / `needs-user-decision`**:
- **PR-49** (P1, high) — PR-48 shipped a contract mismatch. `MetersDAO.fetch` binds `organization_id` unconditionally (line 324), so `fetch(scope=MeterScope())` now returns only globally-unscoped rows (`organization_id IS NULL AND workspace_id IS NULL AND …`), not "every row" as the audit warning at lines 308-316 suggests. The PR-48 changelog explicitly claimed "`organization_id` stays conditional to preserve the `MeterScope()` admin escape hatch" — that text is stale w.r.t. shipped code. Either the code or the contract needs to move; see open finding below.
- **PR-50** (P3, high) — docstring typo `roWRK` → `rows` at three lines in `api/ee/tests/pytest/unit/test_meters_dao_fetch.py` (lines 121, 175, 205). Trivial.

## Rules

- Findings cite `file:Lstart-Lend` against the current working tree.
- PR comments are quoted with their `discussion_rNNN` ID for traceability.
- Confidence `high` only when directly read from current code.

## Notes

- Sync runs: 2026-05-18, ten passes. PR HEADs: `d21c76bd70b31a144a455cd986ce5c016c63dbc6` (pass 1), `a54e99803c365c9c57d418b1ee7368e694c6db88` (pass 2 — PR-12/13/14), and post-PR-12/13/14 fix commits (pass 3 — PR-15..PR-21, awaiting commit). Pass 6 (2026-05-18 11:30Z): Copilot reviewed `75e7b8472` ("final CR") → PR-32..PR-40. Pass 7 (2026-05-18 12:53Z): Copilot reviewed the post-pass-6 tree → PR-41..PR-43. PR-44 is an internal staging-deployment incident. Pass 8 (2026-05-18 14:52Z): Copilot reviewed the post-pass-7 tree → PR-45. Pass 9 (2026-05-18 16:01Z): Copilot reviewed the post-pass-8 tree → PR-46. Pass 10 (2026-05-18 16:35Z): Copilot reviewed the post-pass-9 tree → PR-47. Pass 11 (2026-05-19 07:08Z): Copilot reviewed the post-pass-10 tree → PR-48.
- Resolve queue priority order: P0 → P1 → P2 → P3.
- **Rule (from user 2026-05-18):** sync's first step is ALWAYS to save new findings to this file, before any code change or proposed-fix discussion.

## Open Findings

### [CLOSED] PR-49 — `MetersDAO.fetch(scope=MeterScope())` now treated as the admin escape, equivalent to `scope=None` (P1, high)

- **Category**: Correctness / Contract clarity
- **Files**: `api/ee/src/dbs/postgres/meters/dao.py:286-336`; `api/ee/tests/pytest/unit/test_meters_dao_fetch.py` (+1 test).
- **PR comment**: [discussion_r3266168998](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3266168998) — Copilot, 2026-05-19T12:17:31Z
- **Background**: PR-48 normalized `fetch` so a structured `MeterScope`/`MeterPeriod` binds every `None` dim to `IS NULL` (canonical-identity semantics). The PR-48 changelog claimed `MeterScope()` survived as an admin escape; the shipped code instead bound `organization_id` unconditionally, so `fetch(scope=MeterScope())` compiled to `organization_id IS NULL AND workspace_id IS NULL AND project_id IS NULL AND user_id IS NULL`. A row with no org/workspace/project/user is meaningless as a quota target, so matching only "globally-unscoped rows" is not a useful canonical identity.
- **Decision (user, 2026-05-19)**: Option A — `MeterScope()` is the admin escape, same as `scope=None`. (Asymmetric with periods: `MeterPeriod()` *is* a real canonical identity — the lifetime/gauge-sentinel grain — so it keeps the `IS NULL × 3` binding.)
- **Fix shipped**: Added a `scope is not None and any(dim is not None for dim in …)` guard around the scope binding in `MetersDAO.fetch`. Period binding unchanged. Trimmed the docstring to spell out the asymmetry: `scope=None` and `MeterScope()` both skip the scope filter; `period=None` skips the period filter but `MeterPeriod()` pins the lifetime/gauge-sentinel rows. New unit test `test_empty_scope_is_equivalent_to_scope_none` pins the new contract. Test module docstring updated to match. 79/79 EE unit tests pass (was 78, +1 new). `ruff format` / `ruff check` clean.
- **Action**: GitHub thread replied to ([discussion_r3266277146](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3266277146)) and resolved.

### [CLOSED] PR-50 — Docstring typo `roWRK` → `rows` in `test_meters_dao_fetch.py` (P3, high)

- **Category**: Documentation / Test hygiene
- **Files**: `api/ee/tests/pytest/unit/test_meters_dao_fetch.py:121, 175, 205`
- **PR comment**: [discussion_r3266169123](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3266169123) — Copilot, 2026-05-19T12:17:33Z
- **Fix shipped**: All three docstrings now read `rows` (verified by grep on 2026-05-19). Line 6 was already correct (Copilot mis-listed it).
- **Action**: GitHub thread replied to ([discussion_r3266279318](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3266279318)) and resolved.

> The same 12th Copilot pass surfaced 4 more findings against `docs/designs/support-fields/*` files (also touched by this PR). They are saved under `docs/designs/support-fields/findings.md` as F-011..F-014.

## Closed Findings

### [CLOSED] PR-48 — `MetersDAO.fetch` now treats `None` dimensions on a supplied `MeterScope`/`MeterPeriod` as `IS NULL`, not wildcards (P1, high)

- **Category**: Correctness / Read isolation
- **Files**: `api/ee/src/dbs/postgres/meters/dao.py:286-340`; new tests `api/ee/tests/pytest/unit/test_meters_dao_fetch.py`.
- **PR comment**: [discussion_r3266…](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3266) — Copilot, 2026-05-19T07:08:14Z
- **Background**: For a structured `MeterScope` / `MeterPeriod` the `None` dimensions are part of the canonical meter identity ("not applicable at this grain"). The DAO previously skipped the filter when each dim was `None`, so an org-scoped monthly read also matched finer-scoped or DAILY rows for the same `(org, key, year, month)`. Today the bug was masked because no quota mixes "org-scoped + DAILY" or "workspace-scoped + MONTHLY", but the contract was broken and the next per-org DAILY counter would silently aggregate.
- **Fix shipped**: When a `MeterScope` / `MeterPeriod` object is supplied, `MetersDAO.fetch` now binds every dimension uniformly — `organization_id`, `workspace_id`, `project_id`, `user_id`, `year`, `month`, `day` — with SQLAlchemy compiling `filter_by(col=None)` to `col IS NULL`. The "all meters" admin case is reached by `scope=None` (no scope filter at all) rather than `MeterScope()`. `scope=None` / `period=None` still apply no filter on the respective family. Docstring rewritten. 10 new unit tests in `test_meters_dao_fetch.py` pin: org-scoped reads do not match workspace/project/user rows; workspace-scoped reads do not match finer; MONTHLY reads bind `day IS NULL`; DAILY reads bind every dim; `scope=None` / `period=None` / `MeterPeriod()` escape hatches preserved. 78/78 EE unit tests pass (was 68, +10 new).
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-47 — `tasks.md` Usage-exposure checklist item updated to reflect per-caller read (P3, medium)

- **Category**: Documentation drift
- **Files**: `docs/designs/extend-meters/tasks.md:109`
- **PR comment**: [discussion_r3260514845](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3260514845)
- **Background**: The pass-7 PR-41 fix rewrote `/billing/usage` to per-caller scoped read and propagated the change to `proposal.md` and `summary.md`, but the corresponding `tasks.md` checklist item still described the old "DAILY branch sums across rows" behavior.
- **Fix shipped**: Replaced the checklist line with "Per-caller read: for each quota the response returns the single meter row matching the caller's ambient `AuthScope` projected to `quota.scope`'s granularity ... No org-wide aggregation. No `organization_id` path/query/wrapper param — identity comes from the ambient `AuthContext`." Matches the shipped code and the rest of the design docs.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-46 — Three `EVALUATIONS_RUN` write handlers now refund the shortfall when the service returns empty/None silently (P1, high)

- **Category**: Correctness / Quota accounting
- **Files**: `api/oss/src/apis/fastapi/evaluations/router.py` — `EvaluationsRouter.create_runs` (~L617), `SimpleEvaluationsRouter.create_evaluation` (~L1972), `SimpleQueuesRouter.create_simple_queue` (~L2347).
- **PR comment**: [discussion_r3260318614](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3260318614)
- **Background**: The `try/except Exception:` refund only fires when the service raises. `evaluations_service.create_runs` returns `[]` silently when the DAO swallows non-conflict exceptions; `simple_evaluations.create` / `simple_queues.create` return `None` on early-guard malformed-input paths. In every silent-failure case the meter kept the full charge while the handler returned `count=0`.
- **Fix shipped**: Added a shortfall-refund branch after each service call:
  - `create_runs`: `shortfall = len(runs_create_request.runs) - len(runs); if shortfall > 0: refund -shortfall`.
  - `create_evaluation`: `if evaluation is None: refund -1`.
  - `create_simple_queue`: `if queue is None: refund -1`.
  Existing exception refund paths unchanged for the genuine-exception case. 68/68 EE unit tests pass.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-45 — `scope_from` unified: ambient by default, `scope=None` means ORGANIZATION; private `_scope_from` removed (P0, high)

- **Category**: Correctness / API contract
- **Files**: `api/ee/src/utils/entitlements.py` (rewrote `scope_from`, deleted `_scope_from`); `api/ee/src/apis/fastapi/billing/router.py` (kept `scope_from(scope=quota.scope)`, dropped private-helper import); `api/ee/tests/pytest/unit/test_scope_from.py` (rewrote to exercise the public helper only)
- **PR comment**: [discussion_r3259844430](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3259844430)
- **Background**: The original `scope_from(scope=None)` raised by design (PR-15) to prevent the silent-fail-open path inside `check_entitlements`. That precaution worked but pushed `check_entitlements` onto a private `_scope_from` helper that took `(auth_scope, scope)` directly. The pass-7 `/billing/usage` rewrite (PR-41) reached for the public `scope_from(scope=quota.scope)` and crashed on every org-scoped quota.
- **Fix shipped**: Collapsed the public/private split. `scope_from` is now the single public helper:
  - `scope_from()` / `scope_from(scope=None)` → ambient `AuthScope` at `Scope.ORGANIZATION` granularity.
  - `scope_from(scope=Scope.X)` → ambient at granularity X.
  - `scope_from(organization_id=UUID(...))` → explicit org-only, no ambient lookup (workers / bootstrap).
  - `scope_from(scope=X, organization_id=Y)` → `ValueError` (ambiguous).
  Removed `_scope_from`. `check_entitlements` now uses `scope_from(scope=quota.scope)` directly. `billing/router.py` was already calling the same shape; one import line tidied. The PR-15 safety against silent fail-open is preserved: `get_auth_scope()` raises `AuthContextMissing` when no auth context is published, so no caller can accidentally read a half-populated scope.
- **Tests**: `test_scope_from.py` rewritten to exercise only the public `scope_from`. Pins the new contract (no-args/None/ORGANIZATION are equivalent), the explicit-org-id branch, ambient projection at every granularity, and the both-args rejection. 68/68 EE unit tests pass.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-41 — `/billing/usage` now reads the single meter row at the caller's projected scope; no aggregation, no path-param (P1, high)

- **Category**: Correctness / UX consistency
- **Files**: `api/ee/src/apis/fastapi/billing/router.py` — `fetch_usage` rewritten; route wrapper `fetch_usage_user_route` no longer threads `organization_id`.
- **PR comment**: [discussion_r3259033683](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3259033683)
- **Fix shipped**: Per-caller usage. For each quota, scope is projected via `scope_from(scope=quota.scope)` from the ambient `AuthScope` (same projection `check_entitlements` uses), period via `period_from(period=quota.period, anchor=subscription.anchor)`. `meters_service.fetch(scope=_scope, key=Meters[key.name], period=_period)` returns 0 or 1 row; `value` is that row's `value`. Numerator and denominator now sit at the same scope (per-user `value` vs per-user `limit` for `TRACES_RETRIEVED`). The DAILY summing branch is gone; the `organization_id` path/wrapper param was dropped — `fetch_usage()` reads ambient identity via `get_auth_scope()`. No more sum-across-users-with-per-user-limit displays.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-42 — `MetersDAO.fetch` typed `Optional[Meters]`; call sites convert `Counter`/`Gauge` via `Meters[name]` (P0, high)

- **Category**: Correctness / Fail-open security
- **Files**: `api/ee/src/core/meters/interfaces.py`, `api/ee/src/dbs/postgres/meters/dao.py`, `api/ee/src/core/meters/service.py`, `api/ee/src/utils/entitlements.py`
- **PR comment**: [discussion_r3259033736](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3259033736)
- **Fix shipped**: Tightened the API surface. `MetersDAOInterface.fetch.key`, `MetersDAO.fetch.key`, and `MetersService.fetch.key` are now `Optional[Meters]`. The one runtime caller passing a `Counter`/`Gauge` (`entitlements.py:489`) converts at the boundary with `Meters[key.name]` — by-name lookup that matches the column's name-binding (uppercase). DB column stays `SQLEnum(Meters, name="meters_type")` without `values_callable`; no DB migration. The soft-check DB fallback now finds the row on cache miss; the silent fail-open is closed. 69/69 EE unit tests pass.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-43 — `check_entitlements` cache-mode preflight mirrors the DAO's strict/non-strict predicate (P1, medium)

- **Category**: Correctness / Strict-vs-non-strict parity
- **Files**: `api/ee/src/utils/entitlements.py:508-522`
- **PR comment**: [discussion_r3259033762](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3259033762)
- **Fix shipped**: Cache preflight rewritten so Layer 1 is never stricter than Layer 2. `quota.limit is None` → allow; `quota.strict` → `current + delta <= limit`; non-strict → `delta <= limit and current < limit` (mirrors the DAO's predicate per PR-35's truth table). Non-strict counters can now cross the line once from below in cache mode, matching the authoritative DAO call.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-44 — Migration crashed on staging on corrupt `(year=2025, month=0)` rows; operator healed (P0, high)

- **Category**: Migration / Data quality
- **Files**: data only — `meters` on `agenta_demo_core_v0_96_0` (staging) had 2 corrupt rows for org `019542f2-e0e9-7fd2-9866-0639d88fa929` (`EVALUATIONS | 2025/0`, `TRACES | 2025/0`).
- **Trigger**: `alembic upgrade head` on staging, 2026-05-18 12:59:51Z. The backfill loop in `9d3e8f0a1b2c_reshape_meters_table.py:237` constructed `MeterPeriod(year=2025, month=0, day=None)`, which the new (correctly strict) calendar validator rejected with `invalid date 2025-00-01: month must be in 1..12`.
- **Resolution**: Operator-fixed the corrupt rows in staging (and audited prod — clean). Pre-PR code only ever wrote `(0, 0)` gauge sentinels or `(year>0, month in 1..12)` periodic counters via `compute_billing_period`, so the partial-sentinel rows came from external manual edits or a deleted legacy code path. The migration is unchanged — validator behavior is correct; the input was the problem. Audit query for future re-runs:

  ```sql
  SELECT ctid, organization_id, key::text AS key, year, month, value, synced
  FROM meters
  WHERE NOT (
      (year = 0 AND month = 0)
      OR (year > 0 AND month BETWEEN 1 AND 12)
  )
  ORDER BY organization_id, key, year, month;
  ```

- **Action**: No GitHub thread (internal incident). Documented for future migration re-runs on other environments.

### [CLOSED] PR-33 — `workspace_router.remove_user_from_workspace` now loads `owner` from target workspace's org (P1, medium)

- **Category**: Correctness / Cross-org consistency
- **Files**: `api/oss/src/routers/workspace_router.py:129-148`
- **PR comment**: [discussion_r3258523782](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523782)
- **Fix shipped**: `owner = await db_manager.get_organization_owner(project.organization_id)` (target workspace's org), replacing the prior `request.state.organization_id` (caller's ambient org). `skip_meter` exemption and the `Gauge.USERS -1` decrement now agree on the same organization. Comment block documents the cross-org rationale.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-34 — Tracing-router ingest soft check re-gated by `if delta > 0:` to match OTLP / worker (P1, medium)

- **Category**: Correctness / Soft-check parity
- **Files**: `api/oss/src/apis/fastapi/tracing/router.py` — `SpansRouter.ingest_spans` and `TracesRouter.ingest_traces`
- **PR comment**: [discussion_r3258523832](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523832)
- **Fix shipped**: Both `check_entitlements` calls wrapped in `if delta > 0:`, mirroring `api/oss/src/apis/fastapi/otlp/router.py:220` (`if delta > 0:`) and `api/oss/src/tasks/asyncio/tracing/worker.py:261` (`if is_ee() and delta > 0:`). Zero-count ingest requests no longer 429 on an existing overage. Inline comment names the parity rationale at both sites.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-35 — `MetersDAO.adjust` strict and non-strict predicates rewritten per user-defined semantics (P1, high)

- **Category**: Correctness / Limit semantics
- **Files**: `api/ee/src/dbs/postgres/meters/dao.py:376-446`; tests: `api/ee/tests/pytest/unit/test_meters_dao_strict_soft.py`
- **PR comment**: [discussion_r3258523750](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523750)
- **User-defined truth table (2026-05-18)** (`current + delta` against `limit=10`):

  | Case                   | Strict | Non-strict |
  |------------------------|--------|------------|
  | 0 + 12 (huge delta)    | deny   | deny       |
  | 10 + 2 (at limit)      | deny   | deny       |
  | 9 + 2 (1-over)         | deny   | allow      |
  | 8 + 2 (exactly fills)  | allow  | allow      |

  Rule: predictable self-overshoot (`delta > limit`) is rejected by both modes. The modes diverge on already-at-or-over-limit rows: strict denies, non-strict permits the one cross-the-line request from below.

- **Fix shipped**:
  1. Python-side fast-path rewritten to reject predictable self-overshoot in both modes: absolute writes (`meter.value > limit`) and delta writes (`meter.delta > limit`) early-return `(False, ...)` with no DB call.
  2. Strict-mode SQL predicate unchanged — already matched the spec: `greatest(value + delta, 0) <= limit` (delta path), `greatest(meter.value, 0) <= limit` (absolute path).
  3. Non-strict SQL predicate changed from `MeterDBE.value <= quota.limit` to `MeterDBE.value < quota.limit` for the delta path (the shared `delta <= limit` is enforced Python-side; the SQL clause is the cross-the-line-once gate). Absolute non-strict path emits `literal(meter.value <= quota.limit)`.
  4. `desired_value` rebuilt as a local (used by the upsert insert seed and the deny-path fallback) — no longer the gate for rejection.
- **Tests**: replaced `test_soft_emits_value_only_predicate` (pinned the old `value <= limit` behavior) with `test_nonstrict_emits_value_strictly_less_than_limit_predicate`. Added the user's truth table as seven new cases: `test_huge_delta_denied_in_{strict,nonstrict}`, `test_at_limit_denied_in_{strict,nonstrict}`, `test_one_over_denied_in_strict`, `test_one_over_allowed_in_nonstrict`, `test_fills_exactly_allowed_in_both_modes`. 18/18 tests pass (`uv run pytest ee/tests/pytest/unit/test_meters_dao_strict_soft.py`).
- **Action**: Reply on the GitHub thread quoting the truth table and resolve.

### [CLOSED] PR-36 — `AuthContext` now `frozen=True` (P2, medium)

- **Category**: API hardening / Defensive design
- **Files**: `api/oss/src/utils/context.py:96-97`
- **PR comment**: [discussion_r3258523931](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523931)
- **Fix shipped**: `model_config = ConfigDict(arbitrary_types_allowed=True, frozen=True)`. Top-level `AuthContext` now matches its already-frozen `AuthScope` / `ApiKeyCredentials` / `SecretCredentials` fields. Reinforces the PR-29 contract that the ambient `AuthContext` is either fully populated or absent and never mutated mid-request.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-37 — `proposal.md` "Limit semantics" item 6 rewritten to match the catalog and the user-defined predicate table (P2, high)

- **Category**: Documentation drift
- **Files**: `docs/designs/extend-meters/proposal.md` item 6 in "Locked decisions"
- **PR comment**: [discussion_r3258523640](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523640)
- **Fix shipped**: Item 6 retitled "Limit semantics" and rewritten to spell out `TRACES_RETRIEVED` is `strict=True` on every plan; describes the strict-vs-non-strict predicate split per the PR-35 user-defined table. Removes the stale `strict=False` / "overshoot is allowed" claim.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-38 — `proposal.md` "Write-side enforcement" paragraph aligned with the broad-refund implementation (P3, high)

- **Category**: Documentation drift
- **Files**: `docs/designs/extend-meters/proposal.md` — "Write-side enforcement" pattern paragraph
- **PR comment**: [discussion_r3258523682](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523682)
- **Fix shipped**: Pattern paragraph rewritten — "on **any** exception, refund with `delta=-N` and re-raise. Domain exceptions therefore also refund (broad-safety trade-off — the conservative choice for an in-flight quota write, so a failed create never leaves a counted-but-not-created row)." Matches the PR description and the actual handler code.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-39 — `summary.md` `TRACES_RETRIEVED` wording aligned with hard-adjust + strict=True semantics (P3, medium)

- **Category**: Documentation drift
- **Files**: `docs/designs/extend-meters/summary.md:13`
- **PR comment**: [discussion_r3258523719](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523719)
- **Fix shipped**: "soft-check fires after every span/trace fetch or query" replaced with "hard-check fires after every span/trace fetch or query (...); declared `strict=True` everywhere, so the request that would cross a real limit is itself rejected." Also rephrased the evaluation-run refund clause to "broad refund on any exception" to align with the PR-38 fix.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-40 — `proposal.md` "Read-side enforcement" trailing paragraph rewritten to match the strict-everywhere catalog (P3, high)

- **Category**: Documentation drift / Contract clarity
- **Files**: `docs/designs/extend-meters/proposal.md` — last paragraph of "Read-side enforcement"
- **PR comment**: [discussion_r3258523892](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523892)
- **Fix shipped**: Last paragraph replaced — the stale "`strict=False` (default) lets the row commit but `allowed` still flips to `False` on overshoot" sentence is gone. Replacement: "`TRACES_RETRIEVED` is declared `strict=True` on every plan, so the DAO predicate is `greatest(value + delta, 0) <= limit` — the request that crosses the line is itself rejected (no 'one free overshoot'). See locked-decision item 6 above for the strict/non-strict predicate split." Coherent with PR-35 / PR-37 / PR-39.
- **Action**: Reply on the GitHub thread and resolve.

### [CLOSED] PR-32 — `CLOUD_V0_AGENTA_AI.CREDITS_CONSUMED` drop of `free=100_000` / `limit=100_000` was intentional (P1, high)

- **Category**: Correctness / Plan semantics
- **Files**: `api/ee/src/core/entitlements/types.py:647-650`
- **PR comment**: [discussion_r3258523869](https://github.com/Agenta-AI/agenta/pull/4347#discussion_r3258523869) — Copilot, 2026-05-18 11:30Z
- **Resolution**: Confirmed by user (2026-05-18) — the drop was desired. CLOUD_V0_AGENTA_AI is the internal Agenta plan and is meant to be unlimited on credits. No code change.
- **Action**: Reply on the GitHub thread explaining the intentional change and resolve.

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
