# Extend Meters Tasks

Scope of this PR:

- Reshape `meters` (the database table + `meter_id` canonicalizer + scope/period columns).
- Reshape `Quota` (`monthly` → `period`, add `scope`).
- Catalog cleanup (drop unused flags, counters, gauges).
- Counter rename (`TRACES` → `TRACES_INGESTED`, `CREDITS` → `CREDITS_CONSUMED`, new `TRACES_RETRIEVED`).
- Service-layer read enforcement that mirrors the existing trace-ingestion soft-check.
- Expose `TRACES_RETRIEVED` in `/billing/usage` and frontend like any other counter.

Rationale and design context: see [proposal.md](./proposal.md). Code references: see [research.md](./research.md) and [gap.md](./gap.md).

## 1. Pre-flight

Confirm current state on disk matches what the rest of this checklist assumes. Fail fast if any of these are surprising.

- [ ] Current PK is `(organization_id, key, year, month)` (`api/ee/src/dbs/postgres/meters/dbes.py:12-17`).
- [ ] ORM declares `year`, `month` as `nullable=False` (`api/ee/src/dbs/postgres/meters/dbas.py:11-12`); the initial migration `12f477990f1e_add_meters.py:39-40` declared them `nullable=True DEFAULT 0`. The migration to write tightens the ORM and migration to be consistent (nullable, with explicit semantics).
- [ ] No row in production has `year IS NULL` or `month IS NULL`. (Run `SELECT count(*) FROM meters WHERE year IS NULL OR month IS NULL;` before writing the migration.)
- [ ] Capture pre-migration row counts per key: `SELECT key, count(*) FROM meters GROUP BY key;`. The output is copied into the migration docstring.
- [ ] Current `meters_type` Postgres enum values: `users`, `applications`, `evaluations`, `traces`, `credits`. After this PR the live values used are `users`, `traces_ingested`, `credits_consumed`, `traces_retrieved`. (`applications` and `evaluations` enum *values* stay dormant — no `ALTER TYPE … DROP VALUE` — but their rows are deleted.)
- [ ] Alembic config wraps revisions in a transaction by default — that is why the enum-add lives in its own non-transactional revision (§3.1).

## 2. Canonicalizer: `compute_meter_id`

The single most important piece of correctness — every writer goes through it, the table's integrity depends on it never drifting.

**Hard rule:** `uuid5` is computed in Python only, in this function, in this module. The DAO, the DAO helpers, the Alembic backfill migration, and any future code that produces a `meter_id` all `import compute_meter_id` from here. The database never has its own copy — no `pgcrypto` recipe, no SQL function, no inline UPDATE expression that mirrors the canonical format. One implementation, no exceptions.

- [ ] Pin a project-wide namespace UUID for meters (`AGENTA_METERS_NAMESPACE_UUID = uuid.UUID("…")`), checked in as a code constant. Never change it.
- [ ] Write `compute_meter_id(*, organization_id: UUID, scope: MeterScope, key: Meters, year: Optional[int], month: Optional[int]) -> UUID` in the meters DAO module (`api/ee/src/dbs/postgres/meters/dao.py` or a sibling file imported by it).
- [ ] Canonical string format, fixed and documented at the top of the function:
  - **Exclude `None` fields before hashing.** Build a dict of `{field_name: stringified_value}` containing only non-`None` fields, then emit. Absent dimensions contribute nothing. Adding a future column where every existing row has `None` for it produces the same canonical string → same `uuid5` → same `meter_id`. No re-backfill on additive schema growth.
  - **`None` means "this dimension does not apply to this meter". Never "default".** State this at the top of `compute_meter_id` as a docstring invariant.
  - **Field-name keys are part of the form**, e.g. `"key=traces_retrieved|month=3|org=…|year=2026"` — never the bare values.
  - **Sort by field name alphabetically** (Python `sorted()` over the dict keys).
  - UUIDs: lowercase 8-4-4-4-12, no braces, no `urn:uuid:` prefix.
  - Integers: plain decimal, no zero-padding.
  - Separator: `"|"` between `key=value` pairs.
  - Worked examples:
    - Legacy org-only gauge: `"key=users|org=a…"`.
    - Legacy org-monthly counter: `"key=traces_ingested|month=3|org=a…|year=2026"`.
    - New per-user daily retrieval counter: `"day=17|key=traces_retrieved|month=3|org=a…|proj=p…|user=u…|ws=w…|year=2026"`.
- [ ] Validate hierarchy before hashing. Reject (raise `ValueError`) shapes that violate:
  - `user_id` set requires `project_id` set
  - `project_id` set requires `workspace_id` set
  - `month` set requires `year` set
  - `day` set requires `month` set
- [ ] Return `uuid.uuid5(AGENTA_METERS_NAMESPACE_UUID, canonical_string)`.
- [ ] Unit tests: a fixed `(scope, key, year, month) → expected_meter_id` table. This is the regression net for canonicalizer drift — any change to format, order, or absence-handling fails these tests.

## 3. Alembic migrations

Two revisions, in this order. The enum revision runs first so that when the schema revision writes `'traces_ingested'`, `'credits_consumed'`, `'traces_retrieved'` into the `key` column (via `UPDATE`), the enum values already exist.

### 3.1 Revision A: enum additions (non-transactional, no rollback)

`ALTER TYPE … ADD VALUE` cannot run inside a transaction.

- [ ] Mark the revision as non-transactional in Alembic.
- [ ] `ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'traces_ingested';`
- [ ] `ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'credits_consumed';`
- [ ] `ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'traces_retrieved';`
- [ ] Downgrade is a no-op (Postgres has no `DROP VALUE`). Document in the revision docstring.

### 3.2 Revision B: schema + row migration (transactional, atomic)

One revision that wraps every row-touching change in a single transaction. If it crashes, nothing partial lands.

Schema changes:

- [ ] Add the four new scope/period columns as nullable, no server default:
  - `workspace_id UUID NULL`
  - `project_id UUID NULL`
  - `user_id UUID NULL`
  - `day SMALLINT NULL`
- [ ] Add `meter_id UUID NULL` (temporarily nullable).
- [ ] Relax `year` and `month` to `NULL`, dropping their `DEFAULT 0`.

Row migration (in this order):

- [ ] `DELETE FROM meters WHERE key IN ('evaluations', 'applications');` — these counter/gauge values are being removed from the Python catalog (§4) and their rows have no remaining consumer. The Postgres enum values themselves stay (we can't drop them).
- [ ] `UPDATE meters SET key = 'traces_ingested' WHERE key = 'traces';`
- [ ] `UPDATE meters SET key = 'credits_consumed' WHERE key = 'credits';`
- [ ] `UPDATE meters SET year = NULL, month = NULL WHERE year = 0 AND month = 0;` — the existing non-periodic gauge rows.
- [ ] Backfill `meter_id` for every row by **importing `compute_meter_id` from the DAO module** and calling it on each row in a Python data-migration block. The migration does not reimplement the canonicalizer, does not call any SQL-side hashing function, and does not copy the canonical format string locally. Load rows → call the helper → write back.

Constraint changes (after row migration so the backfill happens before the new PK enforces non-null):

- [ ] `ALTER COLUMN meter_id SET NOT NULL`.
- [ ] Drop the old PK on `(organization_id, key, year, month)`.
- [ ] **Recreate the same shape as a non-unique index** `idx_meters_org_key_year_month` — `MetersService.fetch(organization_id=...)` and the billing-usage scan depend on org-prefixed scans.
- [ ] Add the new PK on `(meter_id)`.

Docstring requirements:

- [ ] Pre-migration row counts per key (from §1's pre-flight query).
- [ ] Post-`DELETE` and post-`UPDATE` row counts as a sanity-check trace for code review.
- [ ] Downgrade behavior: drop new PK and `meter_id`, drop the four new columns, restore `year`/`month` to `NOT NULL DEFAULT 0` (filling new `NULL`s with `0` first), restore old PK. **Row keys are not restored** — once renamed to `traces_ingested`, they stay renamed. Document this explicitly: downgrade preserves the old SCHEMA, not the old VALUES.

## 4. Catalog cleanup: drop unused flags, counters, gauges

Pure Python deletions. The corresponding meters-table row deletes happen in §3.2.

- [ ] Remove `Flag.HOOKS` from the `Flag` enum (`api/ee/src/core/entitlements/types.py:15-21`). Remove `Flag.HOOKS: …` from every plan's `Tracker.FLAGS` block (7 plans). `grep -rn 'Flag\.HOOKS' api/ --include='*.py'` should be empty outside `entitlements/types.py`.
- [ ] Remove the commented `# HISTORY = "history"` line. Dead placeholder.
- [ ] Remove `Counter.EVALUATIONS`. Drop the two `delta=-1` rollback call sites in `api/oss/src/core/evaluations/tasks/legacy.py:1283-1289` and `:1650-1655` (both inside `if run_status == EvaluationStatus.FAILURE:` blocks; removing the call collapses or simplifies the block). Drop `Counter.EVALUATIONS: …` from every plan (7 sites). Drop from `CONSTRAINTS[READ_ONLY][COUNTERS]` (line 675). Drop `Meters.EVALUATIONS` from `api/ee/src/core/meters/types.py:15`.
- [ ] Remove `Counter.EVALUATORS`. Confirm zero runtime references via `grep -rn 'Counter\.EVALUATORS' api/ --include='*.py'`. No plan declares it; no `Meters` enum entry.
- [ ] Remove `Counter.ANNOTATIONS`. Same as `EVALUATORS`.
- [ ] Remove `Gauge.APPLICATIONS`. Find every runtime site via `grep -rn 'Gauge\.APPLICATIONS\|Meters\.APPLICATIONS' api/ --include='*.py'` and drop them. Remove `Gauge.APPLICATIONS: Quota(...)` from every plan (7 sites). Remove from `CONSTRAINTS[BLOCKED][GAUGES]` (line 669). Remove `Meters.APPLICATIONS = Gauge.APPLICATIONS.value` from `api/ee/src/core/meters/types.py:19`.
- [ ] Run the test suite — no import-time errors from dangling references.

## 5. `Periods` → `Retentions` rename

Free the name `Period` for the new quota-bucket enum without semantic change to the existing minute-valued retention enum.

- [ ] Rename `class Periods(str, Enum)` → `class Retentions(str, Enum)` in `api/ee/src/core/entitlements/types.py:42-48`. Values unchanged.
- [ ] Update `CATALOG` retention references (Hobby, Pro, Business — three sites).
- [ ] Update plan-declaration `retention=Periods.X.value` references (one site: Hobby's `Counter.TRACES`).
- [ ] `grep -rn 'Periods\.' api/ --include='*.py'` and update every match.
- [ ] No DB migration required — `retention` is an integer column, the rename is purely Python-side.

## 6. `Quota` reshape: `monthly` → `period`, add `scope`

`Quota.monthly: Optional[bool]` is replaced by `Quota.period: Optional[Period]`. New `Quota.scope: Optional[Scope]` field. All existing call sites convert mechanically; runtime behavior is unchanged for them. The new fields default to `None`, which means "use today's behavior" (`period=None` ⇒ gauge, `scope=None` ⇒ `ORGANIZATION`).

- [ ] Define `Period(str, Enum)` (`DAILY`, `MONTHLY`, `YEARLY`) and `Scope(str, Enum)` (`ORGANIZATION`, `WORKSPACE`, `PROJECT`, `USER`) in `api/ee/src/core/entitlements/types.py`. (Adding `Period` only works after §5's rename frees the name.)
- [ ] Replace `Quota.monthly: Optional[bool] = None` with `Quota.period: Optional[Period] = None`. Add `Quota.scope: Optional[Scope] = None`. Keep `free`, `limit`, `strict`, and `retention` unchanged.
- [ ] Convert `Probe.monthly` analogously (`api/ee/src/core/entitlements/types.py:59-61`). Update every `Probe(monthly=...)` construction.
- [ ] Convert every remaining `monthly=True` site in `ENTITLEMENTS` to `period=Period.MONTHLY`. After §4's cleanup drops `EVALUATIONS`, the surviving sites are `TRACES_INGESTED` and `CREDITS_CONSUMED` per plan (and only `TRACES_INGESTED` for `HUMANITY_LABS` / `X_LABS` since they don't declare `CREDITS_CONSUMED`):

  | Plan | Counter | File:line (pre-rename) |
  | ---- | ------- | ---------------------- |
  | `CLOUD_V0_HOBBY` | `TRACES_INGESTED` | `api/ee/src/core/entitlements/types.py:309` |
  | `CLOUD_V0_HOBBY` | `CREDITS_CONSUMED` | `…:321` |
  | `CLOUD_V0_PRO` | `TRACES_INGESTED` | `…:393` |
  | `CLOUD_V0_PRO` | `CREDITS_CONSUMED` | `…:403` |
  | `CLOUD_V0_BUSINESS` | `TRACES_INGESTED` | `…:475` |
  | `CLOUD_V0_BUSINESS` | `CREDITS_CONSUMED` | `…:485` |
  | `CLOUD_V0_HUMANITY_LABS` | `TRACES_INGESTED` | `…:555` |
  | `CLOUD_V0_X_LABS` | `TRACES_INGESTED` | `…:581` |
  | `CLOUD_V0_AGENTA_AI` | `TRACES_INGESTED` | `…:607` |
  | `CLOUD_V0_AGENTA_AI` | `CREDITS_CONSUMED` | `…:615` |
  | `SELF_HOSTED_ENTERPRISE` | `TRACES_INGESTED` | `…:639` |
  | `SELF_HOSTED_ENTERPRISE` | `CREDITS_CONSUMED` | `…:645` |

- [ ] Do not set `scope` on any existing entitlement (defaults to `None` = `ORGANIZATION`).
- [ ] Search-and-replace `monthly=` in tests and fixtures: `grep -rn 'monthly\s*=' api/`. Verify each match.

## 7. Counter rename + add `TRACES_RETRIEVED`

Make the verb explicit in the name. `noun_verb-past-participle`.

- [ ] `Counter.TRACES` → `Counter.TRACES_INGESTED` (value: `"traces"` → `"traces_ingested"`). Update the enum at `api/ee/src/core/entitlements/types.py:24-29` and `Meters.TRACES` in `api/ee/src/core/meters/types.py:14`.
- [ ] `Counter.CREDITS` → `Counter.CREDITS_CONSUMED` (value: `"credits"` → `"credits_consumed"`). Same two files.
- [ ] Add `Counter.TRACES_RETRIEVED = "traces_retrieved"` to the `Counter` enum.
- [ ] Add `Meters.TRACES_RETRIEVED = Counter.TRACES_RETRIEVED.value` to the `Meters` enum.
- [ ] Update every runtime reference. Expected sites for `Counter.TRACES`:
  - `api/ee/src/core/tracing/service.py:45`
  - `api/oss/src/apis/fastapi/tracing/router.py:212, 432, 518, 1256, 1312, 1366`
  - `api/oss/src/apis/fastapi/otlp/router.py:188`
  - `api/oss/src/tasks/asyncio/tracing/worker.py:266`
  Expected site for `Counter.CREDITS`:
  - `api/oss/src/routers/permissions_router.py:223`
  After the rename, `grep -rn 'Counter\.TRACES\b\|Counter\.CREDITS\b' api/ --include='*.py'` should be empty.
- [ ] Update plan declarations in `ENTITLEMENTS` — every `Counter.TRACES:` / `Counter.CREDITS:` block becomes `Counter.TRACES_INGESTED:` / `Counter.CREDITS_CONSUMED:`. The 12 sites enumerated in §6's table.
- [ ] Add `Counter.TRACES_RETRIEVED: Quota(limit=None, strict=False, period=Period.DAILY, scope=Scope.USER)` to every plan's `Tracker.COUNTERS` block (7 plans). `limit` is `None` for now — operators set real limits per plan as a follow-up product decision; the structure is in place.
- [ ] Update `REPORTS` (`api/ee/src/core/entitlements/types.py:656-659`): `Counter.TRACES.value` → `Counter.TRACES_INGESTED.value`. `TRACES_RETRIEVED` is **not** added to `REPORTS` (not billed via Stripe).
- [ ] Update `CONSTRAINTS` (line 670+) where `Counter.TRACES` appears under `READ_ONLY`. Consider whether `TRACES_RETRIEVED` should also be `READ_ONLY` under constrained subscriptions — recommendation: **yes**, add it. A blocked org should not be able to drain its history.
- [ ] **Stripe price keys** (`api/ee/src/core/entitlements/types.py`, `CATALOG[*].price.traces` at lines 186 and 222) stay as the literal string `"traces"`. They are external Stripe identifiers, not Python enum references. The price key is unrelated to the meter key rename.
- [ ] Update any test fixtures that hard-code `'traces'` or `'credits'` as the meter key string.

## 8. Meters layer (DTO / DBE / DBA / DAO)

Everything below the Quota/Catalog level — the data types and the access layer.

### 8.1 DTO

- [ ] Extend `MeterDTO` (`api/ee/src/core/meters/types.py:22-33`) with `meter_id: UUID`, `workspace_id: Optional[UUID]`, `project_id: Optional[UUID]`, `user_id: Optional[UUID]`, `day: Optional[int]`. Relax `year` and `month` to `Optional[int]`.
- [ ] Decide where `meter_id` is computed: **recommendation: in a Pydantic `model_validator` on `MeterDTO` that calls `compute_meter_id` from the inputs**. That makes it impossible to construct a `MeterDTO` without a consistent `meter_id`. Alternative: keep `MeterDTO` dumb and require the DAO to set `meter_id`. Pick one and stick with it.
- [ ] Add a `MeterScope` value object (Pydantic model) in the same module: `workspace_id`, `project_id`, `user_id`, `day` — all `Optional`, all defaulting to `None`. Used to group the new dimensions when threading through DAO method signatures. Mirror the hierarchy validator from `compute_meter_id` so invalid shapes are caught at DTO construction.

### 8.2 DBA / DBE

- [ ] Extend `MeterDBA` (`api/ee/src/dbs/postgres/meters/dbas.py`):
  - Add `meter_id` — `UUID NOT NULL`.
  - Add `workspace_id`, `project_id`, `user_id` — `UUID NULL`.
  - Add `day` — `SmallInteger NULL`.
  - Relax `year`, `month` from `nullable=False` to `nullable=True`.
- [ ] Update `MeterDBE.__table_args__` (`api/ee/src/dbs/postgres/meters/dbes.py:11-27`):
  - Replace `PrimaryKeyConstraint` with `PrimaryKeyConstraint("meter_id")`.
  - Keep `Index("idx_synced_value", "synced", "value")` unchanged.
  - Add `Index("idx_meters_org_key_year_month", "organization_id", "key", "year", "month")` for the org-rollup scan path.

### 8.3 DAO

Every method currently keys on `(organization_id, key, year, month)`. They all change to compute `meter_id` once and key on it.

- [ ] `dump()` (`api/ee/src/dbs/postgres/meters/dao.py:28-93`) — extend the `MeterDTO` construction (line 70-78) with the new columns. The `order_by` can stay on the old shape or switch to `meter_id`; either is fine for a report.
- [ ] `bump()` (line 95-195) — sort/dedupe by `meter_id` (line 105-112). Update the missing-row log key (line 156, 226) to include `meter_id`.
- [ ] `_bump_commit_chunk()` (line 197-242) — `UPDATE … WHERE meter_id = …` (line 211-215). Update the log key (line 225-227, 230-232).
- [ ] `fetch()` (line 244-278) — accept an optional `MeterScope`; forward each non-`None` field as a `filter_by`. Carry the new columns and `meter_id` into the returned `MeterDTO` (line 268-277). The scan still uses the secondary index `idx_meters_org_key_year_month`, not the PK — that is intentional for the org-rollup path.
- [ ] `check()` (line 280-319) — accept new dimensions on the input `MeterDTO`. Compute `meter_id` via `compute_meter_id` and filter by it (line 292-297).
- [ ] `adjust()` (line 321-428):
  - Compute `meter_id` once at the top.
  - Include the new columns in `insert(...).values(...)` (line 382-389).
  - **Critical**: change `on_conflict_do_update(index_elements=[...])` (line 391-396) to `[MeterDBE.meter_id]`. If this stays as the old four-column tuple, the upsert silently uses the secondary index instead of the new PK and creates duplicate rows.
- [ ] Update `MetersDAO.check()` and `adjust()` to consume `Quota.period` (not `Quota.monthly`) when normalizing the time bucket (lines 287-289 and 328-331). Dispatch by period kind: `DAILY` / `MONTHLY` / `YEARLY` / `None`.
- [ ] Generalize `compute_billing_period(anchor=...)` (`api/ee/src/utils/billing.py`) to `compute_billing_period(period=..., anchor=...)`:
  - `MONTHLY` → `(year, month, None)` (current behavior).
  - `DAILY` → `(year, month, day)`.
  - `YEARLY` → `(year, None, None)`.
  - `None` → `(None, None, None)` (gauges; no normalization).

## 9. Service-layer read enforcement

Mirror the existing trace-ingestion soft-check pattern from `api/oss/src/apis/fastapi/tracing/router.py:201-224`. The shape is: compute delta from a known result, soft-check entitlements with `use_cache=True`, allow + log warning on overshoot, never block. Reads do not have a refund path (unlike ingestion's `delta=-1` on failure) — they are observe-only against the meter.

### 9.1 Service helper

- [ ] Add `TracingService.enforce_read_limit(self, *, organization_id, workspace_id, project_id, user_id, delta)` in `api/oss/src/core/tracing/service.py`.
- [ ] Behavior:
  - Early-return if not `is_ee()`.
  - Early-return if `delta <= 0`.
  - Call `check_entitlements(organization_id=…, key=Counter.TRACES_RETRIEVED, scope=…, delta=delta, use_cache=True)`. The `check_entitlements` signature widens in §8 to accept a `MeterScope`.
  - On `not allowed`: log a warning ("trace retrieval soft-quota overshoot, allowing"), do not raise. Soft semantics.
  - Wrap in `try/except`: a meter glitch should never break a read. Same pattern as the ingestion site (line 221-224): re-raise `HTTPException`, swallow everything else with `log.warning(..., exc_info=True)`.
- [ ] The helper is called **after** the result is known, so delta is exact:
  - `len(traces)` for trace-shaped responses.
  - `len({s.trace_id for s in spans})` for span-shaped responses — count of distinct trace IDs.

### 9.2 Wire into service methods

Service-layer, not router-layer. Service is the single point that all three router mounts (`/spans`, `/traces`, and the deprecated `/preview/spans`, `/preview/traces`, `/tracing/*`) share.

- [ ] `TracingService.query_spans()` (`api/oss/src/core/tracing/service.py:611+`) — call `enforce_read_limit(delta=len({s.trace_id for s in spans}))`.
- [ ] `TracingService.fetch_spans()` (`:626+`) — same delta computation.
- [ ] `TracingService.fetch_span()` (`:665+`) — delta is `1` if a span was returned, else `0`. (One trace_id.)
- [ ] `TracingService.query_traces()` (`:679+`) — delta is `len(traces)`.
- [ ] `TracingService.fetch_traces()` (`:748+`) — delta is `len(traces)`.
- [ ] `TracingService.fetch_trace()` (`:771+`) — delta is `1` if a trace was returned, else `0`.
- [ ] Plumb `organization_id`, `workspace_id`, `project_id`, `user_id` from the request state through to each service call. `organization_id` is already on `request.state`; the others come from the request context the same way they do for permission checks (`request.state.workspace_id`, etc.). If any of these are not on `request.state` for a given mount, leave them `None` — the canonicalizer handles that.
- [ ] Sessions/users/analytics service methods are **not** wired up. They retrieve metadata, not traces.

### 9.3 Cache behavior

`use_cache=True` mirrors ingestion. Soft-check semantics mean a brief cache lag at the start of a new period is acceptable. The cache key is keyed on `meter_id` (§8 establishes that), which already encodes scope+period — no extra plumbing needed.

## 10. Usage exposure

`TRACES_RETRIEVED` is exposed in `/billing/usage` like any other counter — no exclusion mechanism, no internal flag. Operators and customers can see exactly how many traces have been retrieved this period, alongside ingestion. Stripe reporting is unaffected (`TRACES_RETRIEVED` is not in `REPORTS`).

### 10.1 Backend (`/billing/usage`)

- [ ] Confirm no code change required in `api/ee/src/apis/fastapi/billing/router.py:880-908`. The handler iterates `entitlements[Tracker.COUNTERS]` and emits a `{value, limit, free, monthly, strict}` row for each counter. `TRACES_RETRIEVED` shows up automatically once it's declared in every plan (§7).
- [ ] One nuance: the response field is named `monthly` (a boolean) and is derived from the old `Quota.monthly`. After §6's rename, this becomes `monthly = (quota.period == Period.MONTHLY)` at the response-construction site. For `TRACES_RETRIEVED` which has `period=Period.DAILY`, `monthly` will be `False` in the response. Verify whether the frontend keys off `monthly` or off a richer period descriptor — if just `monthly`, the daily quota will render as "non-monthly" which is misleading. If so, expose `period` in the response alongside `monthly` (additive, doesn't break existing clients) and update the frontend accordingly (§10.2).
- [ ] `scope` is similarly not in the current `/billing/usage` response. Expose it additively so the frontend can render "5,000 traces retrieved per user per day".

### 10.2 Frontend

- [ ] Update the usage card / table to display `TRACES_RETRIEVED` next to `TRACES_INGESTED` and `CREDITS_CONSUMED`.
- [ ] Render the per-scope + per-period descriptor — "X traces retrieved per user, today" — distinct from "X traces ingested this month". The exact copy is product-owned; flag in the PR description that the frontend team needs to confirm wording.
- [ ] If the backend response now exposes `period` and/or `scope`, render them. If only `monthly` is exposed, fall back to inferring from the counter name (`TRACES_RETRIEVED` → daily/per-user) — but the additive response shape from §10.1 is the cleaner path.

### 10.3 What's explicitly **not** excluded

This PR does not introduce any "internal counter" mechanism. Every counter declared in `ENTITLEMENTS[Tracker.COUNTERS]` shows up in `/billing/usage`. The only way a counter is excluded from a downstream surface is the existing `REPORTS` allowlist for Stripe (which `TRACES_RETRIEVED` is intentionally absent from).

## 11. Compatibility verification

- [ ] `Counter.TRACES_INGESTED` (post-rename) ingestion is bit-identical to pre-PR `Counter.TRACES` ingestion. Add a regression test that drives `MetersDAO.adjust()` with `Quota(period=Period.MONTHLY)` and asserts the same upsert that pre-PR `Quota(monthly=True)` produced.
- [ ] Same for `Counter.CREDITS_CONSUMED`.
- [ ] `/billing/usage` JSON shape is unchanged for existing counters/gauges (modulo the additive `period` / `scope` fields from §10.1, which existing clients ignore).
- [ ] Stripe reporting is unchanged.
- [ ] Reporting worker (`dump()` / `bump()`) handles renamed-key rows correctly.
- [ ] `compute_meter_id` regression tests pass for the fixed input-output table.
- [ ] DAO tests for each scope level and each period kind.
- [ ] Concurrent upsert on the same `meter_id` produces exactly one row.

## 12. Out of scope for this PR

- **Env-driven quota overrides.** No `AGENTA_QUERY_LIMITS_*`, no general `AGENTA_QUOTA_OVERRIDES`. Limits stay declared on the plan; operators who want to set non-`None` limits for `TRACES_RETRIEVED` edit the plan today.
- **Effective access controls builder.** Replacing the module-level `ENTITLEMENTS` constant with `get_access_controls()` and narrower accessors. Orthogonal to this PR; best landed alongside the env-override work.
