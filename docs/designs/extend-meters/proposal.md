# Query Limits Proposal

## Proposed direction

Introduce `Counter.TRACES_RETRIEVED` as a first-class EE counter, declared on plans like any other entitlement, with two new dimensions on `Quota`: `scope` (organization / workspace / project / user) and `period` (daily / monthly / yearly). Reshape the `meters` table to store scope+period rows keyed by a deterministic `meter_id`. The limit is **declared `None`** (unlimited) in the catalog at this stage — the entitlement is structurally present but a no-op until a follow-up PR gives it a real number.

The same PR renames the existing `Counter.TRACES` to `Counter.TRACES_INGESTED` and `Counter.CREDITS` to `Counter.CREDITS_CONSUMED`, so all counters carry their verb in the name. Counters now read `noun_verb-past-participle`: `traces_ingested`, `traces_retrieved`, `credits_consumed`. No more implicit-verb convention.

See [tasks.md](./tasks.md) for the execution checklist. This document captures the design decisions and the rationale behind them.

## Locked decisions

1. **Counter key.** `Counter.TRACES_RETRIEVED`. Counts **distinct traces** retrieved — not spans. For span-shaped responses, delta is `len({span.trace_id for span in spans})`. For trace-shaped responses, delta is `len(traces)`. Symmetric with `Counter.TRACES_INGESTED` (also trace-counted, via root spans on the ingest side).
2. **No environment-driven activation in this PR.** Limits are declared on the plan (as a `Quota`), not injected from env vars. Env-driven overrides are out of scope and tracked as a follow-up PR.
3. **`Quota` grows two new fields.** `period: Optional[Period]` and `scope: Optional[Scope]`. Both are part of every plan's entitlement declaration; both default to `None`.
4. **`Quota.monthly` is replaced by `Quota.period`.** `monthly=True` → `period=Period.MONTHLY` everywhere. `monthly=False` (today's gauges) → `period=None`. This is a code rename + mechanical migration of every call site; the runtime behavior is unchanged. The new enum gives us `DAILY` and `YEARLY` as first-class values rather than a new boolean axis. (Terminology note: `period` matches the existing `PeriodDBA` and `compute_billing_period`. "Window" was considered and rejected as too sliding-window-flavored for a fixed calendar bucket.)
5. **Defaults match today's behavior.** `Quota.scope = None` is interpreted as `Scope.ORGANIZATION` by consumers. `Quota.period = None` means "non-periodic" (a gauge). `Quota.limit = None` means "no limit". Every existing entitlement is converted by mechanical rename — no semantic change.
6. **`Counter.TRACES_RETRIEVED` declaration shape.** `Quota(limit=None, strict=False, period=Period.DAILY, scope=Scope.USER)`. Structurally present, defaults to unlimited.
7. **Supported scope hierarchy.** `organization`, `workspace`, `project`, `user`. Enforced by the canonicalizer ([Database changes: meters table](#database-changes-meters-table)).
8. **Supported periods.** `daily`, `monthly`, `yearly`, and `None` (gauge).
9. **What counts as a read** (when enforcement lands in a follow-up PR). Every endpoint that fetches, retrieves, or queries traces or spans. Excluded: sessions, users, analytics.
10. **Delta semantics** (same caveat). Count **distinct traces** retrieved. For trace-shaped responses, delta is `len(traces)`. For span-shaped responses, delta is `len({span.trace_id for span in spans})` — the count of distinct trace IDs in the returned spans, not the span count. "Retrieved" covers both `/fetch` and `/query` shapes — the meter is about data leaving the system, not about which router shape produced it.
11. **Soft-limit semantics.** Match existing trace-ingestion entitlement semantics with `strict=False`.
12. **Visibility and billing.** `TRACES_RETRIEVED` is exposed in `/billing/usage` and on the frontend usage card alongside `TRACES_INGESTED` and `CREDITS_CONSUMED` — no exclusion mechanism, no internal flag. It is **not** added to the Stripe `REPORTS` allowlist, so it's tracked and surfaced internally + to customers, but not billed.

## `Quota` shape

```python
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
    strict: Optional[bool] = False
    retention: Optional[int] = None   # minutes; existing field, see Retentions enum
    period: Optional[Period] = None   # None = non-periodic (gauge)
    scope: Optional[Scope] = None     # None = ORGANIZATION
```

`retention` is unchanged from today (minute-valued retention window for the resource the quota guards, e.g. how long traces are kept). It is *not* the same concept as the new `period` field — `retention` answers "how long does the data live"; `period` answers "what bucket does the quota reset on". They co-exist.

Interpretation rules — the single discipline rule callers must respect:

- `limit = None` → no limit. Entitlement is structurally present but never bites.
- `period = None` → non-periodic (gauge). `monthly=False` callers map here.
- `scope = None` → `Scope.ORGANIZATION`. Today's entitlements all map here.

Why optional with `None` defaults instead of explicit `ORGANIZATION` / `MONTHLY` defaults: every existing `Quota(...)` construction in the codebase keeps working with zero edits — the mechanical migration is `monthly=True → period=Period.MONTHLY`, and every other field stays at its `None` default. No call site needs to think about scope.

### Existing catalog inventory (what this PR is reshaping)

For context, what already exists in `api/ee/src/core/entitlements/types.py`:

**`Tracker`** — top-level grouping in each plan: `FLAGS`, `COUNTERS`, `GAUGES`, `THROTTLES`. Unchanged.

**`Flag`** (boolean feature gates):

- `RBAC` — when `False`, the permission machinery short-circuits and grants full access (`api/ee/src/utils/permissions.py:367`).
- `ACCESS` — gates org-level access-flag edits and event ingestion (`api/ee/src/routers/organization_router.py:185`, `api/oss/src/tasks/asyncio/events/worker.py:208`).
- `DOMAINS` — gates the six custom-domain endpoints (`api/ee/src/apis/fastapi/organizations/router.py`).
- `SSO` — gates the five SSO config endpoints (same file).

This PR drops `HOOKS` (declared on every plan, no runtime gate, never used) and removes the commented-out `HISTORY` placeholder. Cleanup, not a feature change.

**`Counter`** (periodic consumables) — surviving names after this PR's rename:

- `TRACES_INGESTED` (was `TRACES`) — monthly, counted by root spans. Incremented across sync ingest, OTLP, and the async tracing worker. **Reported to Stripe** (in `REPORTS`).
- `CREDITS_CONSUMED` (was `CREDITS`) — monthly internal credit ledger for AI service calls; strict everywhere; not reported to Stripe.
- `TRACES_RETRIEVED` (new) — counts **distinct traces** retrieved through fetch and query endpoints. Per-user, per-day, soft-limit, `limit=None` for now. Not reported to Stripe. See [Locked decisions](#locked-decisions) for the delta-counting rule.

The rename makes the verb explicit: a reader can tell at the call site whether a counter is about data going in (`_INGESTED`), data going out (`_RETRIEVED`), or internal balance (`_CONSUMED`). The old `TRACES` / `CREDITS` names relied on an implicit-verb convention that was about to break the moment we added a second tracing meter.

This PR also drops `EVALUATIONS`, `EVALUATORS`, and `ANNOTATIONS`:

- `EVALUATIONS` is declared on every plan and has two call sites (`api/oss/src/core/evaluations/tasks/legacy.py:1287` and `:1653`), but both are `delta=-1` rollbacks on failure. There is no matching positive increment anywhere — the counter is never charged, so rolling it back is a no-op. Also referenced in `CONSTRAINTS[READ_ONLY][COUNTERS]` but with no actual enforcement around incrementing, the constraint is academic.
- `EVALUATORS` and `ANNOTATIONS` are declared in the `Counter` enum, declared in no plan, and incremented/decremented nowhere. Dead enum values.

Removing all three keeps the catalog honest. If any of these counters needs to come back later, it should land *with* its increment and enforcement, not as a placeholder.

**`Gauge`** (non-periodic level meters):

- `USERS` — current member count per org. Written on member join/leave. **Reported to Stripe** (in `REPORTS`).

This PR drops `APPLICATIONS` — every plan declares it as `Quota(strict=True)` with no limit, no enforcement, and the value is tracked but never consulted by any product surface. Cleanup, not a feature change.

**`Throttle`** — token-bucket rate limits, declared per-plan and applied per `Category` of endpoints. Distinct mechanism from `Quota`. Tracing reads are already in `Category.TRACING_SLOW`. The query-limits feature is cumulative usage, not rate-per-minute, so this is orthogonal and untouched by this PR.

**`REPORTS`** — the existing allowlist `[Counter.TRACES.value, Gauge.USERS.value]` today, becoming `[Counter.TRACES_INGESTED.value, Gauge.USERS.value]` after the rename. `Counter.TRACES_RETRIEVED` simply does not appear in `REPORTS`. That is the entire "keep internal-only" mechanism.

**`Constraint` / `CONSTRAINTS`** — `BLOCKED` and `READ_ONLY` constraint sets applied when a subscription is in a restricted state. Unchanged by this PR.

### `Periods` → `Retentions` rename

The file already declares an enum named `Periods` whose values are **minute counts** used by `Quota.retention` and by entries in `CATALOG`. It is a *retention-duration* enum, not a *quota-bucket* enum. Its values:

- `EPHEMERAL = 0`
- `HOURLY = 60`
- `DAILY = 1440`
- `MONTHLY = 44640`
- `QUARTERLY = 131040`
- `YEARLY = 525600`

To free the cleanest name for the new quota-bucket enum, this PR **renames `Periods` to `Retentions`** (the values and semantics are unchanged), and introduces our new bucket enum as `Period` (singular). The two end up clearly distinguishable:

- `Retentions` — minute-valued duration. Used only by `Quota.retention` and `CATALOG[*].retention`.
- `Period` — bucket kind (`DAILY` / `MONTHLY` / `YEARLY`). Used only by `Quota.period` and the DAO's bucket-normalization logic.

Call sites to update for the rename:

- The enum definition itself.
- `Quota.retention` field references (the doc-string/type comment, the value is still `Optional[int]`).
- Every `CATALOG[*]["retention"]` entry (3 sites: Hobby/Pro/Business).
- Every `Quota(retention=Periods.X.value, ...)` construction (1 site: Hobby's `Counter.TRACES`).
- Anywhere a `Periods.X` value flows through tests.

The rename does not touch the existing `PeriodDBA` SQLAlchemy mixin — that name correctly describes the year/month columns and remains accurate as those columns become nullable.

## Plan declarations

Existing plans (mechanical rename, no semantic change):

```python
Counter.TRACES:     Quota(limit=10_000, strict=False, period=Period.MONTHLY)  # was monthly=True
Counter.EVALUATIONS: Quota(limit=1_000,  strict=False, period=Period.MONTHLY)
Gauge.USERS:        Quota(limit=5)                                             # period=None, gauge
```

New entitlement added by this PR:

```python
Counter.TRACES_RETRIEVED:      Quota(limit=None, strict=False, period=Period.DAILY, scope=Scope.USER)
```

The `Counter.TRACES_RETRIEVED` declaration says "this counter exists, ticks per user per day, is soft-limit, and currently has no upper bound." A follow-up PR can set `limit` to a real number, per plan, without any other change.

## Endpoint coverage (for the future enforcement PR, captured here so the design holds together)

Metering covers only the trace/span fetch and query service methods:

- `query_spans`, `fetch_spans`, `fetch_span`
- `query_traces`, `fetch_traces`, `fetch_trace`

Sessions, users, and analytics endpoints are explicitly excluded.

Enforcement is wired up in this PR via a service-layer helper that mirrors the existing trace-ingestion soft-check (`api/oss/src/apis/fastapi/tracing/router.py:201-224`): compute delta from the known result, call `check_entitlements(..., key=Counter.TRACES_RETRIEVED, use_cache=True)`, log a warning on overshoot, never block, never refund. With `limit=None` in every plan today the helper is a no-op; the moment an operator sets a real `limit` the meter starts to bite without any further code change.

## Database changes: meters table

This section is the focus of the design. Everything else (the builder, the service-layer enforcement) is shaped around the constraints the database imposes.

### Current state

Today, `meters` is structurally **organization-scoped, year+month-perioded**:

- Table: `api/ee/src/dbs/postgres/meters/dbes.py`
- Mixins: `api/ee/src/dbs/postgres/meters/dbas.py` (`PeriodDBA` adds `year`, `month`; `OrganizationScopeDBA` adds `organization_id`)
- Initial migration: `api/ee/databases/postgres/migrations/core/versions/12f477990f1e_add_meters.py`

Effective columns:

- `organization_id UUID NOT NULL`
- `key meters_type NOT NULL` (Postgres enum: `USERS`, `APPLICATIONS`, `EVALUATIONS`, `TRACES`, plus `CREDITS` added later)
- `year SMALLINT` — created `nullable=True DEFAULT 0` in `12f477990f1e`, but the ORM (`PeriodDBA`) declares `nullable=False`. The PK column is in practice never null.
- `month SMALLINT` — same caveat as `year`.
- `value BIGINT NOT NULL`
- `synced BIGINT NOT NULL`

Composite primary key: `(organization_id, key, year, month)`.
Secondary index: `(synced, value)` (used by the reporting worker `dump()`).
Foreign key: `organization_id → subscriptions.organization_id`.

How rows are interpreted today:

- **Gauge rows** (e.g. `USERS`, `APPLICATIONS`) use `year = 0`, `month = 0` and act as non-periodic singletons per organization. Billing usage code identifies them via `meter.month == 0` (`api/ee/src/apis/fastapi/billing/router.py:893-895`).
- **Counter rows** (e.g. `TRACES`, `EVALUATIONS`, `CREDITS`) use the current billing year + month and roll over monthly. The DAO normalizes `(year, month)` to the current billing period via `compute_billing_period(anchor=...)` inside `check()` and `adjust()` (`api/ee/src/dbs/postgres/meters/dao.py:288, 330`).

### Proposed columns

We add five columns:

- `meter_id UUID NOT NULL` — deterministic UUIDv5 derived from the full canonical scope+window tuple. Becomes the new primary key.
- `workspace_id UUID NULL` — real `NULL` when not scoped to a workspace.
- `project_id UUID NULL` — real `NULL` when not scoped to a project.
- `user_id UUID NULL` — real `NULL` when not scoped to a user.
- `day SMALLINT NULL` — real `NULL` when the meter is not daily-granular.

We also normalize the existing period columns:

- `year SMALLINT NULL` — `NULL` when the meter is non-periodic (today's gauges). Drops the misleading server-default of `0`.
- `month SMALLINT NULL` — same.

The scope and period columns become pure metadata: human-readable, queryable, but **not** the source of row identity. Identity lives in `meter_id`.

### Uniqueness strategy

PostgreSQL treats `NULL` as not equal to itself, so nullable PK columns are impossible and nullable composite unique indexes don't enforce "one row per scope". We sidestep this by hashing the canonical scope+window tuple into a single deterministic UUID and making **that** the primary key.

```text
meter_id = uuidv5(
  namespace = AGENTA_METERS_NAMESPACE_UUID,
  name      = canonical_string(non-None fields of:
    organization_id, workspace_id, project_id, user_id,
    key, year, month, day
  ),
)
```

Rules for `canonical_string`:

- **Exclude `None` fields before hashing.** Build a dict of `{field_name: stringified_value}` for every field that is not `None`, then emit. Absent dimensions contribute nothing to the canonical string. This is what makes future schema growth additive: adding a new dimension where every existing row has `None` produces the same canonical string for those rows, the same `uuid5`, the same `meter_id` — no backfill required.
- **`None` means "this dimension does not apply to this meter". Never "default."** If a future field has a default value, write the default explicitly; do not let `None` masquerade as "use the default". Violating this rule is the one way to create silent duplicate-row aliases under exclude-nones semantics. Document it at the top of `compute_meter_id`.
- **Field-name keys are part of the canonical form.** A row produces `"key=TRACES_RETRIEVED|month=3|org=…|year=2026"`, not `"TRACES_RETRIEVED|3|…|2026"`. The keys disambiguate scopes that would otherwise collide on value alone.
- **Alphabetical sort by field name.** A new field slots into its alphabetical position without disturbing existing canonical strings. Positional ordering would be more fragile — appending a new field "at the end" can silently re-order if alphabetical sort is later introduced anywhere else in the toolchain.
- **Lower-cased UUID hex** in canonical 8-4-4-4-12 form (no braces, no `urn:uuid:` prefix). **Integers as plain decimal**, no zero-padding. **Separator `"|"`** between `key=value` pairs.
- **`uuid5` is computed in Python — never in SQL — in exactly one function**, `compute_meter_id(...)`, exported from the meters DAO module (`api/ee/src/dbs/postgres/meters/dao.py` or a sibling). Every caller goes through it: the DAO, every helper, and the Alembic data migration that backfills existing rows. The DB never has its own copy of the canonicalizer (no `pgcrypto` recipe, no SQL function, no inline `UPDATE … SET meter_id = …` expression). One implementation, period.
- The format spec (field names, separator, value encoding, alphabetical order, exclude-nones rule, namespace UUID) is the stable contract — changing any of it changes every existing `meter_id` and requires a re-backfill migration.

Example canonical strings:

- Existing org-monthly counter row (`organization_id=A`, `key=TRACES`, `year=2026`, `month=3`, everything else `None`):
  `"key=TRACES|month=3|org=a…|year=2026"`
- Existing org-only gauge row (`organization_id=A`, `key=USERS`, all period/scope `None`):
  `"key=USERS|org=a…"`
- New per-user daily retrieval counter (`organization_id=A`, `workspace_id=W`, `project_id=P`, `user_id=U`, `key=TRACES_RETRIEVED`, `year=2026`, `month=3`, `day=17`):
  `"day=17|key=TRACES_RETRIEVED|month=3|org=a…|proj=p…|user=u…|ws=w…|year=2026"`

Why this works:

- `INSERT … ON CONFLICT (meter_id) DO UPDATE` is an atomic, single-column upsert. No `NULLS NOT DISTINCT`, no partial unique indexes per shape.
- The scope and period columns can be honest `NULL`s, which is what a person inspecting the table actually expects.
- **Additive schema growth is free.** A future scope dimension (e.g. `team_id`, `region`) only needs the new column plus the new alphabetical entry in `compute_meter_id`. Existing rows keep their `meter_id`s because their `team_id` is `None` and contributes nothing to the canonical string. No re-backfill, no migration of `meter_id` values.

Trust model: the canonicalizer is the bottleneck. If two callers produce different `canonical_string`s for the same logical scope, the table gets duplicate rows that the DB cannot detect. Mitigations:

- Every writer routes through the DAO; every DAO call computes `meter_id` exactly once via `compute_meter_id`.
- Hierarchy validity is enforced by the same helper before hashing — callers pass a `MeterScope` value object, and the helper rejects invalid shapes (e.g. `user_id` set with `project_id NULL`).
- The "`None` means not-applicable, never default" rule is documented at the top of `compute_meter_id` and is the only `None`-handling discipline a future contributor needs to internalize.

Alternatives we considered and rejected:

- **Sentinel-backed wide PK** (`(organization_id, workspace_id, project_id, user_id, key, year, month, day)` with nil-UUID / `0` for "not applicable"). Hierarchy is DB-enforced via CHECKs, but the schema reads with magic constants, every existing row needs the four new columns backfilled to sentinels, and adding a new scope dimension later requires a PK migration. Rejected for `meter_id`'s cleaner schema and migration story.
- **Nullable composite PK with `NULLS NOT DISTINCT`** (Postgres 15+). Works, but ties us to PG15+ across all environments and the conflict target is still an 8-column tuple. `meter_id` is simpler.
- **Surrogate auto-increment `id` + nullable unique index per shape.** Multiple partial indexes, conflict target depends on which scope shape is active. The DAO becomes a switch statement.

Belt-and-braces option, not required: add a CHECK constraint set over the nullable scope and period columns (`(workspace_id IS NULL) OR (project_id IS NULL) = FALSE`-style) so a stray ad-hoc INSERT can't slip a malformed shape past the canonicalizer. This is independent of the choice of PK and could be added later without disruption.

### Migration plan

The migration is more invasive than the sentinel approach because every existing row needs a `meter_id` computed and stored. On the current `meters` table size this is fast; the steps below describe the safe ordering.

Schema steps (one Alembic revision unless noted):

1. Add the four new scope/period columns as **nullable** (no server default):
   - `workspace_id UUID NULL`, `project_id UUID NULL`, `user_id UUID NULL`, `day SMALLINT NULL`
2. Add `meter_id UUID NULL` (temporarily nullable).
3. Relax `year` and `month` to nullable, dropping their `DEFAULT 0`. Existing rows with `0` keep `0` for now — the data migration in step 5 handles them.
4. Backfill scope/period semantics for existing rows:
   - For existing gauge rows where `year = 0 AND month = 0`: set `year = NULL`, `month = NULL`.
   - Leave existing monthly counter rows as-is (real `year`, real `month`, `day = NULL`, all three scope columns `NULL`).
5. Backfill `meter_id` for every existing row by **importing `compute_meter_id` from the DAO module and calling it in Python** inside the Alembic revision. The migration does not reimplement the canonicalizer, does not call any SQL-side hashing, and does not maintain a parallel copy of the format spec — it loads rows, calls the same helper the DAO calls, and writes the result back. If the canonicalizer's format ever changes, the migration is automatically aligned.
6. `ALTER COLUMN meter_id SET NOT NULL`.
7. Drop the old PK `(organization_id, key, year, month)`. **Recreate it as a non-unique index** (see Index strategy) — the org-rollup read path depends on it.
8. Create the new PK on `(meter_id)`.
9. Add the new `traces_retrieved` value to the `meters_type` enum in a **separate** revision (Postgres requires `ALTER TYPE … ADD VALUE` to run outside a transaction).

Data migration behavior — every existing row gets a `meter_id`:

| Existing row type | After migration |
| ----------------- | --------------- |
| Org-level gauge (e.g. `USERS`, `month=0`) | `year = NULL`, `month = NULL`, scope columns `NULL`, `meter_id = uuidv5(org, null,null,null, USERS, null,null,null)` |
| Org-level monthly counter (e.g. `TRACES`) | `year`/`month` unchanged, `day = NULL`, scope columns `NULL`, `meter_id = uuidv5(org, null,null,null, TRACES, year, month, null)` |

Downgrade: drop the new PK on `meter_id`, drop `meter_id`, drop the four new scope/period columns, restore `year`/`month` to `NOT NULL DEFAULT 0` (filling any new `NULL`s with `0`), recreate the old PK. Old-shape rows roundtrip; new-shape rows (with non-null scope or `day`) are lost — document this explicitly in the downgrade docstring.

Risk and concurrency notes:

- Dropping and recreating the PK requires an `ACCESS EXCLUSIVE` lock. On the current table size this is sub-second.
- The backfill in step 5 rewrites every row's `meter_id`. On a small table this is fine; if `meters` ever grew large, this would need batching with a per-batch commit.
- The reporting worker should be paused for the duration of steps 7–8 to avoid `dump()` racing the PK swap.
- `ALTER TYPE meters_type ADD VALUE 'traces_retrieved'` is non-blocking but must run outside a transaction (separate revision).
- The new PK is narrow (16 bytes per entry vs. ~33 bytes for the current 4-column PK), so the index shrinks slightly.

### Index strategy

`meter_id` is great for keyed upserts but useless for scans. Every existing scan path is by scope, not by `meter_id`, so we keep an explicit scope-prefixed index.

| Index | Purpose | Status |
| ----- | ------- | ------ |
| PK `(meter_id)` | upserts, point lookups when caller already has the id | new |
| `(organization_id, key, year, month)` | `MetersService.fetch(organization_id=...)` and the billing/usage scan that filters by `key` / period in Python | **keep as a non-unique index** — it was the old PK; recreate explicitly after dropping the PK constraint |
| `(synced, value)` | the reporting worker's `dump()` filter `synced != value` | keep, unchanged |

We do **not** add per-scope indexes up front (e.g. `(workspace_id, key, year, month)`). The write/read pattern is keyed upserts plus org-rollup scans; we have no use case yet that benefits from a workspace-prefixed index. Add one only when a future report needs it.

### DAO surface changes

The DAO methods all currently hard-code the `(organization_id, key, year, month)` tuple (`api/ee/src/dbs/postgres/meters/dao.py`):

- `dump()` ordering at line 40–45
- `bump()` sort/dedupe at line 105–112
- `_bump_commit_chunk()` `WHERE` at line 211–215 and log key at line 226
- `fetch()` filters at line 252–263
- `check()` filter at line 292–297
- `adjust()` insert values + `on_conflict_do_update` index elements at line 382–396

All of these change shape with the new scope/window dimensions:

- Writers compute `meter_id` once via `compute_meter_id(...)` and use `ON CONFLICT (meter_id) DO UPDATE` — a single-column conflict target replaces the old four-column one.
- Readers either look up by `meter_id` (when they already have the canonical scope) or scan with the `(organization_id, key, year, month)` non-unique index (for org-rollup paths like `MetersService.fetch(organization_id=...)`).
- `dump()` and `bump()` carry `meter_id` and the new scope/period columns through to the DTO.

A `MeterScope` value object (carrying `workspace_id`, `project_id`, `user_id`, `day` — each nullable) keeps method signatures stable as we add the new dimensions. `compute_meter_id` accepts `(organization_id, MeterScope, key, year, month)` and is the only place that produces a `meter_id`.

### Query patterns this enables

- **Point upsert by scope+window.** The intended access pattern for the new `TRACES_RETRIEVED` counter — the read path computes the normalized scope tuple once and either reads or upserts a single row.
- **Org-rollup scan unchanged.** `MetersService.fetch(organization_id=...)` continues to return all rows for an org and the billing-usage code at `billing/router.py:891-898` continues to filter in Python (`meter.month == 0` for gauges, `(year, month) == (anchor_year, anchor_month)` for counters). Once `TRACES_RETRIEVED` is excluded by key, the new rows are invisible to billing usage by construction.
- **Daily rollups.** With `day` part of identity, future per-day reports become a straightforward index-supported scan, but we are not building one now.
- **Per-user / per-project debugging.** Operators can answer "which user/project consumed the most spans yesterday?" with a direct SQL query, even though we are not yet exposing it through the API.

### What this unlocks beyond `TRACES_RETRIEVED`

The same shape is reusable for any future meter that needs finer scope or finer time granularity without another schema change:

- Per-workspace evaluation cost or credit caps.
- Per-project rate-style usage that resets daily.
- Per-user feature gates (e.g. number of trace exports per day).

In other words, this migration moves `meters` from "one quota per org, monthly" to a general scope×window meter store. We keep the table internal and gate any customer-facing visibility behind explicit choices in the `controls` builder.

### What this explicitly does **not** change

- Billing usage response shape (`/billing/usage`) — additive only: `period` and `scope` are exposed alongside the existing `monthly` field. Existing clients ignore the new fields. See [Usage exposure](#usage-exposure).
- Stripe reporting — `TRACES_RETRIEVED` is not added to `REPORTS`, so Stripe sees the same set of counters it sees today.
- Throttling — orthogonal; throttling stays request-rate based.
- Subscription / plan tables — untouched.
- The `meters_type` enum values other than adding `traces_retrieved`.

Every existing row is rewritten exactly once during the migration: scope columns set to `NULL`, `year`/`month` left as-is for monthly counters and set to `NULL` for the existing `(year=0, month=0)` gauges, `meter_id` populated via `compute_meter_id`.

## DAO and entitlement helper generalization

- `MeterDTO` carries `meter_id`, `workspace_id`, `project_id`, `user_id`, `day` — each nullable except `meter_id`.
- `MetersDAO.fetch()`, `check()`, `adjust()`, `dump()`, `bump()` thread the new dimensions through; `adjust()` upserts with `ON CONFLICT (meter_id) DO UPDATE`.
- `MetersDAO.adjust()` and `MetersDAO.check()` consume `Quota.period` (not `Quota.monthly`) when normalizing `year`/`month`/`day`. `compute_billing_period(anchor=...)` generalizes from "current `(year, month)`" to "current bucket for `period`" — `DAILY` returns `(year, month, day)`, `MONTHLY` returns `(year, month, None)`, `YEARLY` returns `(year, None, None)`, `None` (gauge) returns `(None, None, None)`.
- `check_entitlements()` accepts an optional `MeterScope`; soft-check cache keys are keyed on `meter_id` (which already encodes the full scope+period identity).
- A `MeterScope` value object groups the new scope fields rather than passing many loose optional parameters.
- Existing callers stay backwards-compatible: they construct a `MeterScope` with all-`None` fields, which canonicalizes to the same `meter_id` that the migration backfilled for legacy rows.

## `monthly` → `period` migration

Replacing `Quota.monthly: bool` with `Quota.period: Optional[Period]` is a mechanical rename across every call site. The runtime behavior is identical for converted call sites; the new enum simply makes `DAILY` and `YEARLY` first-class.

Call sites to update (all in EE):

- `Quota` definition itself (`api/ee/src/core/entitlements/types.py`).
- Every plan declaration in the `ENTITLEMENTS` map (same file, line ~297+) that currently uses `monthly=True`.
- `MetersDAO.check()` at `api/ee/src/dbs/postgres/meters/dao.py:287-289` (`if quota.monthly: ...`).
- `MetersDAO.adjust()` at `api/ee/src/dbs/postgres/meters/dao.py:328-331` (same pattern).
- `compute_billing_period(anchor=...)` — generalize to take a `period` argument and return the appropriate `(year, month, day)` tuple.
- Billing usage at `api/ee/src/apis/fastapi/billing/router.py:893-898` — the gauge match condition `meter.month == 0` is already changing to `meter.month is None` as part of the meters migration; that change is independent of the `monthly` rename but lands in the same PR.
- Any test or fixture that constructs a `Quota(monthly=...)` — search-and-replace.

The migration is invisible to billing, Stripe, and throttling: they observe `Quota.period == Period.MONTHLY` exactly where they observed `Quota.monthly == True` before.

## Usage exposure

`Counter.TRACES_RETRIEVED` is treated like any other counter for visibility: it shows up in `/billing/usage` and on the frontend usage card. No exclusion mechanism, no internal flag. The visibility decisions per surface:

- **`/billing/usage` response** — automatic. The handler at `api/ee/src/apis/fastapi/billing/router.py:880-908` iterates `entitlements[Tracker.COUNTERS]`, so adding `TRACES_RETRIEVED` to every plan (which this PR does) puts it in the response with no additional code. One small additive change: expose `period` and `scope` in the response shape alongside `monthly` (which becomes `monthly = (quota.period == Period.MONTHLY)`), so the frontend can render "X traces retrieved per user, today" correctly rather than misclassifying a daily quota as non-monthly.
- **Frontend usage card** — render the new counter next to ingestion and credits. Copy is product-owned; flag the wording in the PR description.
- **Stripe reporting** — `TRACES_RETRIEVED` is **not** added to `REPORTS` (`api/ee/src/core/entitlements/types.py:656-659`). The allowlist is the existing mechanism; absence from it is the entire "not billed" story.

The catalog surface (`CATALOG[*].features`) is hand-written user-facing copy. `TRACES_RETRIEVED` doesn't need an entry there for this PR — the visibility is via the usage card, not the marketing-style feature list.

## Service-layer read enforcement

A helper on `TracingService` performs a soft entitlement check after the read result is known. It mirrors the existing trace-ingestion soft-check at `api/oss/src/apis/fastapi/tracing/router.py:201-224`:

- `use_cache=True` for low-latency reads against a potentially stale meter.
- Delta is computed from the known result (`len(traces)` for trace-shaped responses, `len({s.trace_id for s in spans})` for span-shaped).
- On `not allowed`: log a warning, do not raise. Soft semantics — overshoot is acceptable.
- Exceptions inside the check are caught and logged; a meter glitch must not break a read.
- No refund path. Reads are observe-only against the meter (unlike ingestion's `delta=-1` rollback on failure).

The helper is called from `TracingService.query_spans`, `fetch_spans`, `fetch_span`, `query_traces`, `fetch_traces`, `fetch_trace`. Sessions, users, and analytics service methods are not instrumented — they retrieve metadata, not traces.

With `limit=None` in every plan today the helper is a no-op. Setting a real limit on any plan flips the meter on without further code change.

## Testing scope

- DAO upsert / fetch with the new scope and `day` granularity.
- `compute_meter_id` regression tests (the canonicalizer drift safety net).
- `compute_billing_period(period=...)` returns the right `(year, month, day)` tuple for each period kind.
- Existing `Counter.TRACES_INGESTED` ingestion behaves unchanged after the `monthly` → `period` rename (regression).
- `/billing/usage` JSON shape unchanged for existing counters/gauges (modulo the additive `period`/`scope` fields).
- Stripe reporting unchanged for existing entitlements after the rename.
- Service-layer read enforcement: soft-check fires with correct delta for each of the six service methods; with `limit=None` the helper is a no-op; with a synthesized `limit`, overshoot logs a warning but does not raise.

## Out of scope (deferred to follow-up PRs)

Two pieces are intentionally not in this PR. Each is independently shippable on top of what this PR lands.

1. **Env-driven quota overrides.** A general mechanism (e.g. `AGENTA_QUOTA_OVERRIDES`) for operators to override `limit` per plan per counter via environment without editing the catalog. Belongs in the "entitlements via env" PR, not here. Operators today who want non-`None` limits for `TRACES_RETRIEVED` edit the plan directly.
2. **Effective access controls builder.** Replacing the module-level `ENTITLEMENTS` constant with `get_access_controls()` and narrower accessors. Orthogonal to this PR; best landed alongside the env-override work since both touch the same seam.
