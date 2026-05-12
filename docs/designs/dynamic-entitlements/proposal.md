# Proposal: Env-Backed Billing Catalog and Entitlements

## Summary

Add a typed access controls layer that loads code defaults, optionally applies environment overrides, validates the result, and exposes accessor functions to billing, entitlement checks, throttling, and usage reporting.

This keeps the current behavior as the fallback while letting operators change plans, plan copy, and entitlement values by changing environment variables and restarting the API process.

The first structural cleanup is to stop treating `Plan` as a closed enum owned by subscriptions. Subscriptions use plans, but access controls define the effective plan domain. Runtime plan slugs should come from the effective plans map loaded from code defaults or `AGENTA_ACCESS_PLANS`.

## Proposed Controls

Add fields to `api/oss/src/utils/env.py`:

```python
class AccessControls(BaseModel):
    plans: str | None = os.getenv("AGENTA_ACCESS_PLANS") or None
    roles: str | None = os.getenv("AGENTA_ACCESS_ROLES") or None
```

Then add `access_controls: AccessControls = AccessControls()` to `EnvironSettings`.

The onboarding/payment mechanics are separate from access controls:

```python
class BillingSettings(BaseModel):
    catalog: str | None = os.getenv("AGENTA_BILLING_CATALOG") or None
    pricing: str | None = os.getenv("AGENTA_BILLING_PRICING") or None
    trial_plan: str | None = os.getenv("AGENTA_BILLING_TRIAL_PLAN") or None
    trial_days: int | None = (
        int(os.getenv("AGENTA_BILLING_TRIAL_DAYS"))
        if os.getenv("AGENTA_BILLING_TRIAL_DAYS")
        else None
    )
```

Then add `billing: BillingSettings = BillingSettings()` to `EnvironSettings`. `catalog` is billing/product presentation; `pricing` is billing/Stripe mechanics; the trial fields are paid subscription defaults.

Keep the existing default-plan loading in `env.agenta.default_plan` via `AGENTA_DEFAULT_PLAN`. It is already a raw optional string in `env.py`, with plan validation happening later in `get_default_plan()`.

`AGENTA_ACCESS_PLANS` defines the effective plan slugs and maps each plan to its entitlement controls. Plan entries may include an optional internal `description` for operators. `AGENTA_BILLING_CATALOG` decorates those plan slugs for billing/product display, including user-facing descriptions. `AGENTA_BILLING_PRICING` defines billing mechanics for those plan slugs. If billing catalog or pricing is supplied, it must be consistent with the effective access-control plans.

Abbreviated examples:

`AGENTA_BILLING_CATALOG`
```json
[
  {
    "plan": "cloud_v0_pro",
    "title": "Team",
    "description": "For production teams.",
    "price": {
      "base": {"type": "flat", "currency": "USD", "amount": 49.0},
      "users": {
        "type": "tiered",
        "currency": "USD",
        "tiers": [{"limit": 3, "amount": 0.0}, {"limit": 10, "amount": 20.0, "rate": 1}]
      }
    },
    "features": ["Unlimited prompts", "50k traces/month", "5 seats included"]
  }
]
```

`AGENTA_BILLING_PRICING`
```json
{
  "cloud_v0_hobby": {
    "free": true
  },
  "cloud_v0_pro": {
    "stripe": {
      "line_items": [
        {"price": "price_123", "quantity": 1}
      ]
    }
  }
}
```

`AGENTA_ACCESS_PLANS`
```json
{
  "cloud_v0_pro": {
    "description": "Production team plan with paid tracing and seat limits.",
    "counters": {
      "traces": {"free": 50000, "monthly": true, "retention": 131040},
      "credits": {"limit": 500, "free": 500, "monthly": true, "strict": true}
    },
    "gauges": {
      "users": {"limit": 5, "free": 5, "strict": true}
    }
  }
}
```

The effective plan set is `AGENTA_ACCESS_PLANS.keys()`. The catalog should include an entry for every displayable plan in that effective plan set. The examples only show the relevant shape.

The scalar env vars are validated against the effective plan set:

- existing `AGENTA_DEFAULT_PLAN`
- free/downgrade plan: derived from the `AGENTA_BILLING_PRICING` entry marked `"free": true`
- `AGENTA_BILLING_TRIAL_PLAN`
- `AGENTA_BILLING_TRIAL_DAYS`

`AGENTA_ACCESS_ROLES` is separate from the plan/catalog/entitlement group. If absent or empty, code-default roles apply. If present, it defines scoped role catalogs while permissions remain code-defined.

Example:

```json
{
  "organization": [
    {
      "role": "owner",
      "description": "Can manage the organization.",
      "permissions": ["*"]
    }
  ],
  "workspace": [
    {
      "role": "admin",
      "description": "Can manage workspace settings and members.",
      "permissions": ["view_api_keys", "edit_api_keys", "modify_user_roles"]
    }
  ],
  "project": [
    {
      "role": "reviewer",
      "description": "Can inspect runs and annotate traces.",
      "permissions": ["read_system", "view_evaluation_runs", "edit_annotations"]
    }
  ]
}
```

## New Module

Create `api/ee/src/core/entitlements/controls.py` with:

- code defaults imported from `types.py`;
- Pydantic models for override validation;
- code-default roles imported from `ee.src.models.shared_models`;
- a complete effective access-controls builder for plans with optional descriptions, entitlement mappings, and scoped roles;
- public access-control accessors:
  - `get_plans()`
  - `get_plan(slug: str)`
  - `get_plan_entitlements(slug: str)`
  - `get_plan_description(slug: str)`
  - `get_roles(scope: str)`
  - `get_role(scope: str, slug: str)`
  - `get_role_permissions(scope: str, slug: str)`
  - `get_role_description(scope: str, slug: str)`

Create billing settings accessors in `api/ee/src/core/subscriptions/`:

- `get_catalog()`
- `get_catalog_plan(slug: str)`
- `get_pricing()`
- `get_pricing_plan(slug: str)`
- `get_stripe_line_items(slug: str)`
- `get_free_plan()`
- `get_trial_plan()`
- `get_trial_days()`

Keep `get_default_plan()` wherever it is today, preserving the existing loading path through `env.agenta.default_plan`.

Both modules should parse once at process startup/import time. That matches current env behavior and avoids re-parsing JSON on every entitlement, billing, or role check.

## Refactor Imports

Replace direct imports of `CATALOG`, `ENTITLEMENTS`, `FREE_PLAN`, `REVERSE_TRIAL_PLAN`, and `REVERSE_TRIAL_DAYS` in runtime code with access-control or billing-settings accessors. The old constants can remain as code defaults during migration, but runtime consumers should go through the accessor layer.

Primary files:

- `api/ee/src/apis/fastapi/billing/router.py`
- `api/ee/src/utils/entitlements.py`
- `api/ee/src/services/throttling_service.py`
- `api/ee/src/core/tracing/service.py`
- `api/ee/src/core/entitlements/service.py`
- `api/ee/src/core/subscriptions/service.py`
- `api/ee/src/core/subscriptions/types.py`
- `api/ee/src/models/shared_models.py`
- `api/ee/src/services/converters.py`
- `api/ee/src/services/db_manager_ee.py`

Move plan identity out of `api/ee/src/core/subscriptions/types.py`. Prefer a string-based `PlanId`/`Plan` type in `api/ee/src/core/entitlements/types.py` over a closed enum. Keep existing plan slugs as code defaults, but stop treating the enum as the runtime source of truth.

Move role identity out of the closed `WorkspaceRole` enum for runtime paths. Keep code-default role slugs and descriptions as fallback data, but make role validation use `get_roles()` from access controls. Permissions stay as the code-defined `Permission` enum.

## Fallback and Consistency Rules

Use conservative rules:

- `AGENTA_ACCESS_PLANS`, `AGENTA_BILLING_CATALOG`, and `AGENTA_BILLING_PRICING` all absent or empty: use code defaults.
- If `AGENTA_ACCESS_PLANS` is present, billing catalog/pricing must reference only effective plan slugs.
- If `AGENTA_BILLING_CATALOG` is present, every catalog plan must exist in the effective plans map.
- If `AGENTA_BILLING_PRICING` is present, every pricing plan must exist in the effective plans map.
- Effective plan slugs are the keys of the plans map.
- Plan descriptions in `AGENTA_ACCESS_PLANS` are internal/operator-facing. User-facing plan names, descriptions, feature text, and display prices come from `AGENTA_BILLING_CATALOG`.
- Paid checkout/switch plans must have Stripe line items in billing pricing.
- Paid deployments should have exactly one pricing entry marked `"free": true` for downgrade/cancel fallback.
- Every non-self-hosted/default plan used by subscription defaults must exist in the effective plan set.
- Subscription plan values read from DB or Stripe metadata must exist in the effective plan set before they are used for entitlements.
- Lists are replaced as supplied.
- `null` means an explicit null value for fields like `limit`.
- Unknown fields fail validation.
- `AGENTA_ACCESS_ROLES` absent or empty: use code-default roles and default role permissions.
- `AGENTA_ACCESS_ROLES` present: it may define `organization`, `workspace`, and `project` role lists.
- Every role permission must exist in the code-defined `Permission` enum, except the special `"*"` permission where the current owner behavior requires it.
- Required platform role behavior must remain explicit per scope. `owner` should either be required or synthesized with all permissions where ownership has special handling.

This avoids a dangerous middle state where the UI comes from env but enforcement silently falls back to code, or enforcement comes from env while the UI still advertises code defaults.

## Failure Behavior

Invalid controls should fail startup with a clear message. Running with silently ignored access controls is risky because the UI, Stripe behavior, and enforcement can drift.

Acceptable fallback behavior:

- Access/billing JSON env vars absent: use code defaults.
- Catalog/pricing/plans env vars empty: use code defaults.
- Catalog/pricing/plans env var invalid JSON, invalid schema, unknown plan slug, missing paid Stripe line items, or internally inconsistent: fail startup.
- Roles env invalid JSON, invalid schema, unknown permission, duplicate role slug in a scope, unknown scope, or missing required platform role behavior: fail startup.

## API and Frontend Implications

No frontend rebuild is required for plan copy/pricing/feature bullet changes because the pricing modal already fetches `/billing/plans`.

The frontend should avoid closed plan unions for runtime billing data. It can keep named constants for known/default plans, but API responses and mutation payloads should accept `string` plan slugs.

- UI logic still assumes `Plan.Hobby` has special downgrade/checkout behavior. Env overrides should not change the semantic meaning of `cloud_v0_hobby` without reviewing that flow.
- Frontend role checks should also avoid closed role unions for runtime data. It can keep constants for known defaults, but member roles and role picker options should come from the API.
- The current frontend fallback role permissions should remain only as a degraded-mode fallback. Server-returned role permissions from access controls should be the source of truth.

## Stripe Implications

Catalog prices and Stripe prices are separate today. The target design should keep them separate but under the billing namespace:

- `AGENTA_BILLING_CATALOG`: product/display metadata, including display prices and feature text.
- `AGENTA_BILLING_PRICING`: billing mechanics, including Stripe line items and the free-plan marker.

Checkout and switching should resolve Stripe line items from effective billing pricing instead of `env.stripe.pricing`.

Target behavior:

- `AGENTA_BILLING_CATALOG[].price` remains display/product pricing for `/billing/plans`.
- `AGENTA_BILLING_PRICING[plan].stripe.line_items` drives Stripe checkout and subscription switching.
- Stripe line items are optional for plans that are not directly purchasable, such as custom/self-hosted plans.
- Paid checkout/switch flows must fail clearly if the selected plan has no Stripe line items.

Remove the standalone pricing env path from the target design:

- Drop `STRIPE_PRICING`.
- Drop `AGENTA_PRICING`.
- Use `AGENTA_BILLING_PRICING`.

The migration can be intentionally breaking if no deployments are expected to use those legacy variables. If we want a softer rollout, log a startup warning when legacy vars are present and ignore them.

## Organization Onboarding

`AGENTA_DEFAULT_PLAN`, `AGENTA_BILLING_PRICING`, `AGENTA_BILLING_TRIAL_PLAN`, and `AGENTA_BILLING_TRIAL_DAYS` are not access definitions. They choose or describe which effective plan slugs are used during signup, cancellation, and payment/trial flows.

These settings only matter when the deployment uses subscription onboarding mechanics:

- `default_plan`: keep current behavior. `AGENTA_DEFAULT_PLAN` is read as a raw optional string at `env.agenta.default_plan`; `get_default_plan()` validates it against the effective plan set, then falls back to current code behavior: Hobby when Stripe is enabled, self-hosted Enterprise when Stripe is disabled.
- free/downgrade plan: pricing entry marked `"free": true`, used as the downgrade/cancel fallback in paid deployments.
- `trial_plan`: plan used during paid signup trials.
- `trial_days`: duration of the trial flow.

If Stripe/payment is disabled, `trial_plan` and `trial_days` should usually be ignored or rejected unless the code has a non-payment trial concept. All referenced plans must exist in the effective plans map.

## Security and Operations

Entitlements and billing pricing affect enforcement and payment behavior, not just product copy. Operators should treat `AGENTA_ACCESS_PLANS`, `AGENTA_ACCESS_ROLES`, `AGENTA_BILLING_CATALOG`, and `AGENTA_BILLING_PRICING` as privileged deployment controls.

Operational guidance:

- Store JSON in deployment secret management, not in source-controlled plain env files for production.
- Validate in staging before production.
- Restart API instances after changing the variable.
- Restart all API/worker processes that import entitlement controls, otherwise instances may enforce different limits.

## Testing Strategy

Add focused API tests around controls loading:

- no env override returns current defaults;
- catalog/plans override changes `/billing/plans`;
- catalog/plans override changes `/billing/usage`;
- billing pricing Stripe line items drive checkout/switching;
- paid checkout fails when billing pricing has no Stripe line items for the selected plan;
- partial override with only catalog fails validation;
- partial override with only plans fails validation when billing catalog/pricing is required;
- catalog/entitlement references to unknown plan slugs fail validation;
- invalid quota shape fails validation;
- trial/free plan env overrides are respected;
- throttling reads the configured entitlements.
- roles env override changes returned workspace roles and member role permissions;
- roles env override rejects unknown permission IDs.

Prefer unit tests for the controls and billing settings modules, plus small router tests for `/billing/plans` and checkout/switching.
