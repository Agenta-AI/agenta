# Proposal: Env-Backed Access Controls, Billing Settings, and Retention Split

## Summary

A typed access-controls layer loads code defaults, optionally applies
environment overrides, validates the result, and exposes accessor functions
to billing, entitlement checks, throttling, retention, and usage reporting.

Code defaults remain the fallback. Operators change plans, plan copy,
entitlement values, roles, and per-domain retention periods by setting
environment variables and restarting the API process. Self-hosted operators
who only want a small tweak on the default plan use a partial overlay.

This document was revised after implementation to reflect what shipped.
Code samples match the actual `env.py` field types (decoded JSON, not raw
strings).

## Env Layout

`env.py` carries the env-driven JSON decoded into Pydantic-typed dicts /
lists at startup. Downstream modules consume already-decoded structures and
never re-parse strings.

```python
class AccessControls(BaseModel):
    plans: dict | None = _load_json_env_dict("AGENTA_ACCESS_PLANS")
    roles: dict | None = _load_json_env_dict("AGENTA_ACCESS_ROLES")
    default_plan: str | None = (
        os.getenv("AGENTA_ACCESS_DEFAULT_PLAN")
        or os.getenv("AGENTA_DEFAULT_PLAN")
        or None
    )
    default_plan_overlay: dict | None = _load_json_env_dict(
        "AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY"
    )

    model_config = ConfigDict(extra="ignore")


class BillingSettings(BaseModel):
    catalog: list | None = _load_json_env_list("AGENTA_BILLING_CATALOG")
    pricing: dict | None = _load_json_env_dict("AGENTA_BILLING_PRICING")
    trial_plan: str | None = os.getenv("AGENTA_BILLING_TRIAL_PLAN") or None
    trial_days: int | None = _load_int_env("AGENTA_BILLING_TRIAL_DAYS")

    model_config = ConfigDict(extra="ignore")
```

`EnvironSettings` adds:

```python
access_controls: AccessControls = AccessControls()
billing: BillingSettings = BillingSettings()
```

**Default plan location.** `AGENTA_ACCESS_DEFAULT_PLAN` lives under
`access_controls`, not `agenta`. The legacy `AGENTA_DEFAULT_PLAN` reads
through as a fallback — canonical name wins when both are set. Rationale:
the default plan is part of the access-controls surface (used at signup
even when Stripe is disabled).

## Access Controls

### `AGENTA_ACCESS_PLANS`

JSON object keyed by plan slug. The set of keys is the effective plan
domain — every other plan reference (catalog, pricing, trial plan, default
plan, subscription rows) must point to one of these slugs.

Each plan entry may define any subset of `flags`, `counters`, `gauges`,
`throttles`. A plan with no entitlements (or only a `description`) is
allowed; it represents a display-only / custom plan that enforces nothing
server-side. `fetch_usage` distinguishes "unknown plan" (404) from "plan
exists but enforces nothing" (empty usage map).

Abbreviated example:

```json
{
  "cloud_v0_pro": {
    "description": "Production team plan.",
    "counters": {
      "traces_ingested":  {"free": 50000, "period": "monthly", "retention": 131040},
      "traces_retrieved": {"strict": true, "period": "daily", "scope": "user"},
      "evaluations_run":  {"period": "monthly", "strict": true},
      "credits_consumed": {"limit": 500, "free": 500, "period": "monthly", "strict": true},
      "events_ingested":  {"period": "monthly", "retention": 131040}
    },
    "gauges": {
      "users": {"limit": 5, "free": 5, "strict": true}
    }
  }
}
```

### `AGENTA_ACCESS_ROLES`

JSON object keyed by scope (`organization`, `workspace`, `project`). Each
scope is a non-empty list of role entries. The `owner` and `viewer` minima
are platform-synthesized for every scope — overrides may add roles but
cannot redefine the minima.

Example:

```json
{
  "project": [
    {
      "role": "reviewer",
      "description": "Can inspect runs and annotate traces.",
      "permissions": ["read_system", "view_evaluation_runs", "edit_annotations"]
    }
  ]
}
```

Project scope inherits the code-default `WorkspaceRole` extras
(`admin`/`developer`/`editor`/`annotator`) by default so existing
`project_members.role` values keep resolving to their historical permission
sets. Overriding the project scope replaces those extras (minima always
re-applied).

If an operator wants the smaller "tweak one role" case without restating
the whole scope catalog, use `AGENTA_ACCESS_ROLES_OVERLAY` (below) instead.

### `AGENTA_ACCESS_ROLES_OVERLAY`

Partial role-catalog patch. Symmetric to
`AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` for plans.

Today the overlay accepts only the `project` scope key, and the patch is
applied to both `workspace` and `project` because they share the same
default role set in the code defaults. Setting `workspace` or
`organization` as a top-level key fails startup — silent ignore would
mislead operators.

Each role-slug entry may set `permissions`, `description`, or both:

- Slug exists on the scope: per-field replace (`permissions` swaps the
  array; `description` swaps the string; fields not set are preserved).
- Slug does not exist: appended as a new role; both `permissions` and
  `description` must be supplied.
- `owner` and `viewer` minima: rejected at startup (platform-managed).

Example — add one new role to both scopes:

```json
{
  "project": {
    "auditor": {
      "description": "Audit-only access.",
      "permissions": ["read_system"]
    }
  }
}
```

### `AGENTA_ACCESS_DEFAULT_PLAN`

Plan slug used at signup. Must be in the effective plan set if specified.
Validated at startup in `_build_settings()`.

If unset:

- Stripe enabled → `cloud_v0_hobby`.
- Stripe disabled → `self_hosted_enterprise`.

Legacy `AGENTA_DEFAULT_PLAN` is still honored as a fallback read at the env
layer.

### `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY`

Partial entitlement patch applied to the default plan only. Same top-level
keys and units as a plan entry in `AGENTA_ACCESS_PLANS`, with one
divergence: `throttles` is a map keyed by category slug (`"standard"`,
`"core_fast"`, …) instead of a list, so per-category patches don't require
restating the whole throttle list.

Merge semantics:

- `description` replaces.
- `flags` per-key replace.
- `counters` / `gauges` per-quota field merge (overlay keeps existing
  `free`/`limit`/`period`/`scope`/`strict`/`retention` if not specified).
  Pass `null` to clear. Unknown fields fail startup (`Quota` has
  `extra="forbid"`, so legacy `monthly` would be rejected).
- `throttles[category]` looks up the existing single-category throttle on
  the base plan and field-merges its `bucket`. Multi-category or
  endpoint-keyed throttles can't be addressed via overlay — operators who
  need that should use `AGENTA_ACCESS_PLANS`.

Example — bump trace retention to monthly (44640 minutes, one of the
canonical `Retention` enum values) and raise the standard throttle rate
without touching capacity:

```json
{"counters": {"traces_ingested": {"retention": 44640}}, "throttles": {"standard": {"bucket": {"rate": 7200}}}}
```

## Billing Settings

### `AGENTA_BILLING_CATALOG`

JSON array of catalog entries served by `/billing/plans`. Each entry is
validated via the `_CatalogEntry` Pydantic model with `extra="allow"` —
operators may add fields that the frontend renders, but the required
fields (`title`, `description`, `type`, `features`) are enforced.

`type` must be `"standard"` or `"custom"`. Entries with a `plan` field
must reference a slug in the effective plan set.

### `AGENTA_BILLING_PRICING`

JSON object keyed by plan slug. Each slug must be in the effective plan
set. At most one entry may carry `"free": true` (the downgrade/cancel
fallback). `stripe.line_items` is what Stripe checkout/subscription create
sees; `stripe.meters` maps `Counter`/`Gauge` slugs to per-meter price IDs
for usage reporting.

Meter keys must be valid `Counter` or `Gauge` slugs (`users`, `traces`,
…) — typos fail startup.

Example:

```json
{
  "cloud_v0_hobby": {"free": true},
  "cloud_v0_pro": {
    "stripe": {
      "line_items": [{"price": "price_123", "quantity": 1}],
      "meters": {"users": {"price": "price_users"}}
    }
  }
}
```

### Trial vars

`AGENTA_BILLING_TRIAL_PLAN` and `AGENTA_BILLING_TRIAL_DAYS` must be set
together (or neither). Trial plan must be in the effective plan set; days
must be a positive integer.

## Modules

### `api/ee/src/core/entitlements/controls.py`

The single runtime source of truth for plans + roles. Parses env at import
time and exposes:

- `get_plans() / get_plan(slug) / get_plan_entitlements(slug) / get_plan_description(slug)`
- `get_roles(scope) / get_role(scope, slug) / get_role_permissions(scope, slug) / get_role_description(scope, slug)`
- `get_controls_hash()` — short hash of the effective controls, logged at
  startup so multi-worker deployments can verify consistency.

The overlay merge is applied here after the base plan map is built, before
the public dicts are frozen.

### `api/ee/src/core/subscriptions/settings.py`

Billing-mechanics accessors:

- `get_catalog() / get_catalog_plan(slug)`
- `get_pricing() / get_pricing_plan(slug) / get_stripe_line_items(slug) / get_stripe_meter_price(plan, meter)`
- `get_free_plan() / get_trial_plan() / get_trial_days() / trial_enabled()`

`_build_settings()` performs cross-cutting validation: catalog ⊆
effective plans, pricing ⊆ effective plans, default plan ∈ effective plans,
free-plan fallback resolvable.

### `api/ee/src/core/subscriptions/types.py`

`get_default_plan()` reads `env.access_controls.default_plan` and falls
back to the Stripe-on/off code default.

## Refactored Imports

Direct imports of `CATALOG`, `ENTITLEMENTS`, `FREE_PLAN`,
`REVERSE_TRIAL_PLAN`, `REVERSE_TRIAL_DAYS` are gone from runtime code.
Constants in `entitlements/types.py` were renamed to `DEFAULT_CATALOG` /
`DEFAULT_ENTITLEMENTS` to signal their fallback role.

The closed `Plan` enum is gone from subscription types; `SubscriptionDTO.plan`
is `str`. `WorkspaceRole` remains as a code-default seed but is no longer
used at API boundaries — response models use `str`, validation uses
`controls.get_role`.

## Failure Behavior

Invalid controls fail startup with a clear message:

- Invalid JSON → fail.
- Empty object where non-empty required → fail.
- Unknown enum slugs (flag/counter/gauge/throttle category/permission) →
  fail.
- Catalog or pricing referencing a plan not in the effective plan map →
  fail.
- Multiple `"free": true` plans → fail.
- Trial: only one of `_TRIAL_PLAN`/`_TRIAL_DAYS` set → fail.
- Default plan not in effective set → fail.
- Free-plan fallback unreachable (no `"free": true` and `cloud_v0_hobby`
  not in effective set) → fail.
- Overlay targeting a plan not in the effective set → fail.
- Overlay throttle category with no matching single-category throttle on
  the base plan → fail.
- Reserved role slugs (`owner`, `viewer`) redefined → fail.
- Roles overlay with a top-level key other than `project` → fail.
- Roles overlay adding a new role without `permissions` → fail.
- Pricing entry that defines neither `free` nor `stripe` (empty `{}`) →
  fail. Without this guard a typo'd entry would silently 400 at checkout;
  the slug-pointing startup error makes the cause obvious.
- Quota / Throttle / Bucket / Probe model with unknown fields (most
  commonly a leftover `"monthly": true` from the pre-reshape config) →
  fail. Pydantic `extra="forbid"` rejects the typo at parse time with a
  field-pointing error.

Trial-checkout path (`SubscriptionsService.start_reverse_trial`) uses an
explicit `if trial_days is None or trial_plan is None: raise EventException(...)`
guard rather than `assert`, so the runtime invariant survives `python -O`
/ `PYTHONOPTIMIZE` and a misconfigured trial state fails loudly at the
domain boundary rather than silently sending `None` values into Stripe
metadata.

## Retention Split

Span retention used to live at `POST /admin/billing/usage/flush`. Billing
is not the right owner once events become retainable. Hard cut shipped:

| Domain | Endpoint | Cron | Lock namespace |
| --- | --- | --- | --- |
| Spans | `POST /admin/spans/flush` | `crons/spans.sh` at `0,30 * * * *` | `spans:flush` |
| Events | `POST /admin/events/flush` | `crons/events.sh` at `7,37 * * * *` | `events:flush` |

Spans and events are completely independent: separate DAOs
(`TracingDAO`, `EventsRetentionDAO`), separate services (`TracingService.flush_spans`,
`EventsRetentionService.flush_events`), separate routers
(`SpansAdminRouter`, `EventsAdminRouter`), separate cron files, separate
Redis locks. The two flushes can run concurrently.

`Counter.EVENTS_INGESTED` is part of the entitlement system as an
enforced event-usage counter with an independent retention dimension.
Event publishing performs the L1 soft check and the events worker applies
the authoritative L2 meter adjustment; operators may configure both
`limit` and `retention` per plan. The events flush job walks the effective plan map and respects each plan's
`Counter.EVENTS_INGESTED.retention`. Per-plan defaults align with each
plan's `Counter.TRACES_INGESTED` retention:
`Quota(period=Period.MONTHLY, retention=Retention.MONTHLY)` on Hobby,
`QUARTERLY` on Pro, `YEARLY` on Business, and `retention=None`
(unlimited) on Agenta and Self-hosted Enterprise — so events on the
three standard cloud plans roll over on the same schedule as traces,
and self-hosted deployments retain events indefinitely unless an
operator opts in via `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` or a full
plan override.

## Stripe Implications

- `AGENTA_BILLING_CATALOG[].price` remains display/product pricing for
  `/billing/plans`.
- `AGENTA_BILLING_PRICING[plan].stripe.line_items` drives Stripe checkout
  and subscription switching.
- Stripe line items are optional for plans that aren't directly
  purchasable (custom / self-hosted).
- Paid checkout/switch fails clearly if the selected plan has no Stripe
  line items.
- Legacy `STRIPE_PRICING` / `AGENTA_PRICING` were removed. A converter
  script (`migrate_stripe_pricing.py` in this folder) translates legacy
  values to the new shape.

## Organization Onboarding

`AGENTA_ACCESS_DEFAULT_PLAN`, `AGENTA_BILLING_PRICING`,
`AGENTA_BILLING_TRIAL_PLAN`, and `AGENTA_BILLING_TRIAL_DAYS` are not
access definitions; they choose which effective plan slug is used during
signup, cancellation, and payment/trial flows.

| Stripe enabled? | Trial configured? | Onboarding plan |
| --- | --- | --- |
| Yes | Yes | Reverse-trial on `AGENTA_BILLING_TRIAL_PLAN` for `_TRIAL_DAYS` days, then downgrade to free. |
| Yes | No | Direct onboarding on the free plan (`AGENTA_BILLING_PRICING` entry marked `"free": true`). |
| No | (ignored) | Direct onboarding on `get_default_plan()`. |

## Security and Operations

Treat `AGENTA_ACCESS_*` and `AGENTA_BILLING_*` as privileged deployment
controls — they affect enforcement and payment behavior, not just copy.

- Store JSON in deployment secret management, not source-controlled env
  files.
- Validate in staging before production.
- Restart all API workers and background workers after changes — each
  process parses env at import time.
- Logs at startup include `[access-controls] plans=… roles=… overlay=…
  hash=…` and `[billing-settings] catalog=… pricing=… free_plan=…
  trial=…`. Grep across worker logs to verify all processes loaded the
  same config.

## Frontend Implications

No frontend rebuild required for plan / catalog / role changes.

- Runtime `Plan = string` in `web/ee/src/services/billing/types.d.ts`.
  `DefaultPlan` enum kept for code-side conditionals only
  (`plan === DefaultPlan.Hobby`).
- Role serialization widened to `str`; env-defined roles serialize cleanly
  through `WorkspacePermission.role_name: str` and `InviteRequest.roles:
  List[str]`.
- `/billing/plans` is cached for 10 minutes browser-side; expected
  catch-up window after deployment.

## Testing Strategy

Implemented:

- `test_access_controls.py` — parser-level unit tests for plans, roles,
  and overlay merge.
- `test_controls_env_override.py` — subprocess-driven end-to-end env
  override tests (plans, roles, catalog, pricing, trial, default plan,
  overlay).
- `test_billing_settings.py` — catalog + pricing parsers, accessors in
  defaults state.
- `test_billing_router.py` — billing handler behavior.
- `test_events_retention.py` — events flush service (plan iteration,
  pagination, per-plan failure isolation).
- `test_admin_retention_routers.py` — spans + events admin endpoints
  (lock namespaces, busy-lock skip, handler shape).

EE unit suite: 133 tests, all passing.
