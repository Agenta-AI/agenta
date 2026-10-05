# Research: Environment-Configured Plans and Entitlements

## Goal

Make plan slugs, entitlement limits, catalog copy, and role permissions
configurable without rebuilding the API/frontend image. If no environment
override exists, the product keeps using the code-defined defaults that
match prior behavior.

A secondary goal that emerged during implementation: self-hosted operators
should be able to tweak individual values on the default plan (trace
retention, a throttle rate, one flag) without having to restate the entire
plan. That goal is served by `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY`.

## Pre-existing System

Before this work, plan and entitlement controls were split across a few EE
modules with no env-driven layer:

- `api/ee/src/core/subscriptions/types.py`
  - Defined the `Plan` enum and the hard-coded constants
    `FREE_PLAN = Plan.CLOUD_V0_HOBBY`, `REVERSE_TRIAL_PLAN = Plan.CLOUD_V0_PRO`,
    `REVERSE_TRIAL_DAYS = 14`.
  - Defined `get_default_plan()`, backed by `env.agenta.default_plan` /
    `AGENTA_DEFAULT_PLAN`.
- `api/ee/src/core/entitlements/types.py`
  - Defined typed entitlement keys: `Flag`, `Counter`, `Gauge`, `Tracker`,
    `Quota`, `Throttle`.
  - Defined `CATALOG` (now `DEFAULT_CATALOG`) and `ENTITLEMENTS`
    (now `DEFAULT_ENTITLEMENTS`).
- `api/ee/src/apis/fastapi/billing/router.py`
  - Imported `CATALOG` and `ENTITLEMENTS` directly.
  - `GET /billing/plans` filtered `CATALOG`; `GET /billing/usage` read
    limits from `ENTITLEMENTS`.
  - Checkout and switching used the `Plan` enum and `env.stripe.pricing`.
- `api/ee/src/utils/entitlements.py`, `services/throttling_service.py`,
  `core/tracing/service.py` — all imported `ENTITLEMENTS` directly.
- `api/ee/src/models/shared_models.py`
  - Defined `WorkspaceRole` as a closed enum.
  - Defined `Permission.default_permissions(role)` as the static
    role-to-permission map.
- `web/ee/src/state/billing/atoms.ts`
  - Fetched `/billing/plans` (cached 10 minutes). Frontend plan cards
    already API-driven for title, description, price, features.

Span retention ran via a single admin endpoint at
`POST /admin/billing/usage/flush` triggered by `crons/spans.sh`.

## Environment Pattern

The API centralizes environment settings in `api/oss/src/utils/env.py` via
the shared `env` object. The contributor guide requires new API env
variables to be added there; feature code avoids direct `os.getenv(...)`.

Relevant existing nesting on `EnvironSettings`:

- `env.stripe.*` (Stripe credentials)
- `env.agenta.*` (general Agenta config)
- new: `env.access_controls.*` (this work)
- new: `env.billing.*` (this work)

All env-driven JSON is parsed at the env layer at process startup; downstream
modules consume already-decoded dicts/lists.

## Important Distinctions

There are three control surfaces:

1. **Display catalog** (`/billing/plans` shape) — titles, descriptions,
   feature bullets, prices, retention copy, `standard` vs `custom`.
   Owned by **billing**.
2. **Enforced entitlements** — flags, counters, gauges, quotas, retention,
   throttles. Owned by **access controls**.
3. **Workspace/project/organization roles** — slugs, descriptions, and
   role-to-permission mappings. Owned by **access controls**. Permissions
   themselves remain code-defined.

Catalog and plans must agree on the effective plan slug set (otherwise the
UI advertises plans the server cannot enforce). Roles and plans are
independent: changing one does not affect the other.

## Coupling and Constraints

Plan identifiers were code-defined through the `Plan` enum living in
subscription types. That conflicted with the goal of runtime-defined plan
slugs. The shipped solution:

- Plan identity moved to a string-based slug type in
  `api/ee/src/core/entitlements/types.py` (with `DefaultPlan` enum kept as
  code-default fallback).
- `AGENTA_ACCESS_PLANS` defines the effective plan set; validation checks
  catalog and pricing references against that set, not against a Python enum.
- `subscriptions.types.SubscriptionDTO.plan: str` (no enum constraint),
  validated at API boundaries against `get_plans()`.

`env.stripe.pricing` (legacy `STRIPE_PRICING` / `AGENTA_PRICING`) was
dropped. Stripe line items now live under `AGENTA_BILLING_PRICING` next to
the display catalog. A converter script (`migrate_stripe_pricing.py` in
this folder) translates legacy values to the new shape.

The frontend already consumes `/billing/plans`, so no rebuild is needed
for catalog changes. The 10-minute cache is unchanged; running browsers
catch up after at most one cache cycle.

## Runtime Behavior

JSON env vars are read once at process startup and validated immediately.
Restarting the API container picks up changes; no image rebuild needed.

`controls.py` and `settings.py` parse env at import time. Mutating
`env.access_controls.*` / `env.billing.*` after import has no effect —
this is why tests use subprocesses to exercise overrides.

If live mutation without process restart were ever required, env vars are
the wrong storage; a database or remote config service would be needed.

## Shipped Override Surface

### Access controls (`env.access_controls`)

| Variable | Type | Purpose |
| --- | --- | --- |
| `AGENTA_ACCESS_PLANS` | JSON object | Plan slugs → entitlements (flags/counters/gauges/throttles). Effective plan set is the keys. |
| `AGENTA_ACCESS_ROLES` | JSON object | Scope → list of custom roles. `owner` and `viewer` minima always present. |
| `AGENTA_ACCESS_ROLES_OVERLAY` | JSON object | Per-role patch applied to workspace + project scopes (only `project` key accepted today). Add a single role or tweak an existing role's permissions/description without restating the catalog. |
| `AGENTA_ACCESS_DEFAULT_PLAN` | string | Plan slug assigned to new orgs on signup. Falls back to legacy `AGENTA_DEFAULT_PLAN`, then to a code default. |
| `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` | JSON object | Partial entitlement patch applied to the default plan only. Same shape as a plan entry except `throttles` is a category-keyed map. |

### Billing settings (`env.billing`)

| Variable | Type | Purpose |
| --- | --- | --- |
| `AGENTA_BILLING_CATALOG` | JSON array | Per-plan display metadata for `/billing/plans`. |
| `AGENTA_BILLING_PRICING` | JSON object | Flat pricing entries per plan slug: `{slug: {free?: bool, trial?: int_days, <stripe_slot>: {price, quantity?}}}`. At most one entry may carry `free: true`; at most one may carry `trial: N` (positive int days). |

### Pydantic representation

`env.access_controls.plans` is `dict | None`, `env.access_controls.roles`
is `dict | None`, `env.access_controls.default_plan_overlay` is
`dict | None`, `env.billing.catalog` is `list | None`, `env.billing.pricing`
is `dict | None`. JSON is decoded at the env layer; downstream modules
never re-parse strings.

`AGENTA_ACCESS_DEFAULT_PLAN` reads canonical → legacy fallback:

```python
default_plan: str | None = (
    os.getenv("AGENTA_ACCESS_DEFAULT_PLAN")
    or os.getenv("AGENTA_DEFAULT_PLAN")
    or None
)
```

Canonical wins if both are set.

### Default-plan overlay

Targets whatever `get_default_plan()` resolves to. Shape mirrors a plan
entry with one divergence: `throttles` is a map keyed by category slug so
per-category patches don't require restating the whole throttle list.

Merge semantics:

- `description` replaces.
- `flags` per-key replace.
- `counters` / `gauges` per-quota field merge (overlay keeps existing
  `free`/`limit`/`monthly`/`strict` if not specified).
- `throttles[category]` looks up the existing single-category throttle and
  field-merges its `bucket`. Multi-category or endpoint-keyed throttles
  cannot be addressed via overlay — operators who need that use
  `AGENTA_ACCESS_PLANS`.

## Retention Job Split

The original system had a single admin endpoint
(`POST /admin/billing/usage/flush`) that flushed spans only. As `events`
joined the entitlement system as a retainable counter, the endpoint moved
out of `billing` because retention is not a billing concern.

Shipped layout:

- `POST /admin/spans/flush` — calls `TracingService.flush_spans()`.
  Triggered by `crons/spans.sh` at `0,30 * * * *`. Lock namespace
  `spans:flush`.
- `POST /admin/events/flush` — calls
  `EventsRetentionService.flush_events()`. Triggered by `crons/events.sh`
  at `7,37 * * * *`. Lock namespace `events:flush`.

Spans and events are completely independent retention domains: separate
DAOs, separate services, separate endpoints, separate crons, separate
Redis locks. The two flushes can run concurrently without blocking each
other.

## Validation (Shipped Behavior)

All validation runs at API startup; failures are fail-fast.

### `AGENTA_ACCESS_PLANS`

- Must be a non-empty JSON object.
- Plan map keys are non-empty unique slugs.
- Plan entries may be empty (display-only plans with no enforced
  entitlements are allowed).
- Tracker names: `flags`, `counters`, `gauges`, `throttles`.
- Flag / counter / gauge keys must be valid `Flag` / `Counter` / `Gauge`
  enum members.
- Throttles validated via Pydantic `Throttle` model (categories ∈
  `Category` enum; modes ∈ `Mode` enum).
- `description` is optional and operator-facing; user-facing descriptions
  belong to the catalog.

### `AGENTA_ACCESS_ROLES`

- Must be a non-empty JSON object.
- Scopes ∈ `{organization, workspace, project}`.
- Each scope is a non-empty list of roles.
- Role slugs are non-empty and unique within a scope.
- Cannot redefine `owner` or `viewer` (platform synthesizes them).
- Each permission slug must exist in `Permission` (or be the wildcard `*`).

### `AGENTA_ACCESS_DEFAULT_PLAN`

- If set, must reference a slug in the effective plan map. Validated in
  `subscriptions/settings.py` at startup.

### `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY`

- Non-empty JSON object.
- Target plan slug must exist in the effective plan map.
- Each flag / counter / gauge / throttle category key validated upfront.
- Throttle overlay must match a single-category throttle on the base plan
  (multi-category not supported via overlay).

### `AGENTA_BILLING_CATALOG`

- JSON array of entries.
- Each entry validated via Pydantic `_CatalogEntry`: required `title`,
  `description`, `type`, `features`; optional `plan`, `price`, `retention`.
- `type` ∈ `{standard, custom}`.
- `extra="allow"` — operators may add fields the frontend renders directly.
- If `entry.plan` is set, it must exist in the effective plan map.

### `AGENTA_BILLING_PRICING`

- JSON object keyed by plan slug; every slug must be in the effective plan
  map.
- At most one entry marked `"free": true`.
- `stripe.line_items` must be a list.
- `stripe.meters` keys must be valid `Counter` or `Gauge` slugs.
- Free plan derivation: pricing's `"free": true` entry → fallback to
  `cloud_v0_hobby` only if it exists in the effective plan map (otherwise
  startup fails).

### Trial marker

- Trial config lives inline on the pricing entry as `{trial: N}` (positive
  int days). At most one entry across the whole pricing map may carry it.
- The trial plan slug is the pricing-entry key carrying the marker; it must
  exist in the effective plan map.

## Decisions Made During Implementation

These weren't in the original research but emerged from `scan-codebase` /
`resolve-findings`:

- **Project scope inherits the workspace role default extras.** The closed
  `WorkspaceRole` enum used to be the read-side source for project member
  permissions. After the refactor, `controls._default_roles()["project"]`
  exposes the same set so existing `project_members.role` values
  (`admin`/`developer`/`editor`/`annotator`) keep resolving to their
  historical permission sets. Env overrides on the project scope replace
  those extras (preserving the minima).
- **Description-only plans allowed.** `_PlanOverride` does not require any
  of `flags`/`counters`/`gauges`/`throttles`. Display-only plans (custom /
  self-hosted) with empty entitlement maps are valid. `fetch_usage`
  distinguishes "unknown plan" (`None` → 404) from "plan exists but
  enforces nothing" (`{}` → empty usage object).
- **Free-plan fallback validated.** When `AGENTA_BILLING_PRICING` has no
  `"free": true` entry, `get_free_plan()` falls back to `cloud_v0_hobby`
  only if it exists in the effective plan map; otherwise the API refuses
  to start (FIND-005).
- **`get_default_plan()` validated against effective plan set** at startup
  (FIND-006).
- **Default plan moved out of `env.agenta`.** Previously
  `env.agenta.default_plan`; now `env.access_controls.default_plan` since
  it's part of the access-controls surface (used even when Stripe is
  disabled).
- **`Counter.EVENTS_INGESTED` added.** Events now have an independent
  usage counter as well as a retention dimension: the publish path runs
  a soft quota check and the events worker performs the authoritative
  meter adjustment. Per-plan defaults align with each plan's
  `Counter.TRACES_INGESTED` retention: `Quota(period=Period.MONTHLY,
  retention=Retention.MONTHLY)` on Hobby, `QUARTERLY` on Pro, `YEARLY`
  on Business, and `retention=None` (unlimited) on Agenta and
  Self-hosted Enterprise.
- **Throttle middleware falls back to free-plan throttles** for unknown
  plans instead of letting requests through unthrottled (FIND-013).

## Frontend Implications

No frontend rebuild required for catalog or plan-slug changes. The
runtime `Plan` union widened to `string` ([web/ee/src/services/billing/types.d.ts](../../../web/ee/src/services/billing/types.d.ts));
the `DefaultPlan` enum is preserved only for code-side conditionals
(`plan === DefaultPlan.Hobby` etc.).

Role serialization widened too: response models use `str` instead of the
closed `WorkspaceRole` enum, so env-defined custom roles serialize
cleanly.

The browser-side 10-minute cache on `/billing/plans` means catalog changes
take up to that long to appear in running tabs.
