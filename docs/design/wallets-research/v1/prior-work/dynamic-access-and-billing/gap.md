# Gap Analysis: Env-Backed Plans and Entitlements

This document records the gaps the work set out to close. Each gap is
annotated with a Resolution line pointing at the shipped fix. The gaps
section freezes the pre-change state of the system.

## Functional Gaps

- Runtime source of truth was hard-coded constants.
  - `CATALOG` and `ENTITLEMENTS` were imported directly in multiple modules.
  - There was no single accessor layer where env overrides could be
    applied safely.
  - **Resolution:** introduced `ee.src.core.entitlements.controls` and
    `ee.src.core.subscriptions.settings` as the accessor surfaces;
    `CATALOG`/`ENTITLEMENTS` renamed to `DEFAULT_CATALOG`/
    `DEFAULT_ENTITLEMENTS` and routed exclusively through accessors at
    runtime.

- Subscription defaults were only partially configurable.
  - `AGENTA_DEFAULT_PLAN` existed.
  - `FREE_PLAN`, `REVERSE_TRIAL_PLAN`, `REVERSE_TRIAL_DAYS` were
    hard-coded.
  - **Resolution:** free plan now derived from `AGENTA_BILLING_PRICING`'s
    `"free": true` marker; trial driven by `AGENTA_BILLING_TRIAL_PLAN` +
    `AGENTA_BILLING_TRIAL_DAYS` (both required together).
    `AGENTA_DEFAULT_PLAN` renamed canonically to
    `AGENTA_ACCESS_DEFAULT_PLAN`, moved from `env.agenta` to
    `env.access_controls`, legacy name still honored.

- Plan identity was too static.
  - Backend `Plan` enum in subscription types prevented env-defined slugs.
  - **Resolution:** `SubscriptionDTO.plan: str`; runtime validation
    against `get_plans()` at API boundaries; `DefaultPlan` enum retained
    as code-default fallback only.

- No effective access-controls consistency check existed.
  - Catalog/pricing/plans needed to agree but nothing enforced it.
  - **Resolution:** `settings._build_settings()` validates that every
    `AGENTA_BILLING_CATALOG[*].plan` and `AGENTA_BILLING_PRICING[slug]`
    exists in the effective plan map; startup fails on mismatch.

- Display pricing and Stripe pricing were separate.
  - `CATALOG.price` (UI) and `env.stripe.pricing` (Stripe) could diverge.
  - **Resolution:** `STRIPE_PRICING` / `AGENTA_PRICING` removed from
    `StripeConfig`. Stripe line items now live under
    `AGENTA_BILLING_PRICING`. Conversion script
    `migrate_stripe_pricing.py` ships in this folder.

- Frontend plan typing was inconsistent.
  - The `Plan` union included `cloud_v0_enterprise`.
  - **Resolution:** runtime `Plan = string` in
    `web/ee/src/services/billing/types.d.ts`; `DefaultPlan` enum kept
    only as a labeled constant set for code conditionals.

- Workspace roles were too static.
  - `WorkspaceRole` was a closed enum.
  - `get_all_workspace_roles()` returned `list(WorkspaceRole)`.
  - **Resolution:** role identity surfaced via `controls.get_roles(scope)`;
    response models (`WorkspacePermission.role_name`, `InviteRequest.roles`)
    widened to `str`; assignment validation uses
    `controls.get_role("workspace", slug)`; `db_manager_ee` and
    `workspace_manager` role-discovery functions return the effective
    catalog. **Project scope inherits the workspace default extras** so
    existing `project_members.role` values keep resolving to their
    historical permission sets.

- Span retention lived under `/admin/billing/usage/flush`.
  - Billing is not the right owner; events were not retainable at all.
  - **Resolution:** old endpoint removed (hard cut). Two independent
    admin endpoints: `POST /admin/spans/flush` and
    `POST /admin/events/flush`. Each owns its own service, DAO, cron,
    and Redis lock namespace. `Counter.EVENTS_INGESTED` added to the
    entitlement system as an independent events usage + retention counter;
    the event publisher performs the soft quota check and the worker applies
    the authoritative meter adjustment. Per-plan retention defaults align
    with each plan's trace-retention window —
    `Quota(period=Period.MONTHLY, retention=Retention.MONTHLY)` on Hobby,
    `QUARTERLY` on Pro, `YEARLY` on Business, and `retention=None`
    (unlimited) on Agenta and Self-hosted Enterprise.

## Safety Gaps

- No validation boundary for nested entitlement data.
  - **Resolution:** `_PlanOverride` Pydantic model in `controls.py`
    validates flag/counter/gauge/throttle keys against their enums and
    rejects unknown fields (`extra="forbid"`).

- No validation boundary for env-defined roles.
  - **Resolution:** `_RoleOverride` Pydantic model; permissions must
    exist in `Permission` enum or be the wildcard `*`; `owner` and
    `viewer` minima cannot be redefined (platform-synthesized per scope).

- Cache behavior could hide changes temporarily.
  - **Resolution:** subscription plan cache invalidation unchanged;
    entitlement controls parse once at import time (subprocess-driven
    tests confirm); frontend 10-minute cache documented as expected
    catch-up window.

- Multi-process consistency.
  - **Resolution:** startup log `[access-controls] plans=... roles=...
    overlay=... hash=...` exposes a 12-char hash of the effective
    controls so operators can grep across worker logs to verify all
    processes loaded the same config.

- `get_default_plan()` did not validate against effective plan set.
  - **Resolution:** validated in `_build_settings()` at startup
    (FIND-006).

- `get_free_plan()` fallback ignored effective plan set.
  - **Resolution:** startup fails when no `"free": true` marker exists
    and `cloud_v0_hobby` is missing from the effective plan map (FIND-005).

- Throttle middleware passed unknown plans through unthrottled.
  - **Resolution:** falls back to free-plan throttles when the org's
    plan is unknown or carries no throttles (FIND-013).

## Product Gaps

- Changing catalog copy is easy and low risk (UI-only).
- Changing enforced limits is higher risk: quota checks, metering,
  usage reporting, retention (spans + events), throttling, organization
  feature access.
- Changing roles is medium/high risk: invite flows, role update flows,
  workspace member serialization, frontend permission checks,
  owner/admin safety invariants.

- No operator-visible controls version.
  - **Resolution:** controls hash logged at startup (above).

- Self-hosted operators needed per-knob tweaks without restating the
  whole plan.
  - **Resolution:** `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` — partial
    entitlement patch for the default plan only. Quotas field-merge,
    flags per-key replace, throttles category-keyed per-entry merge.

## Testing Gaps

- No dedicated test surface for entitlement controls parsing/merging.
  - **Resolution:** `api/ee/tests/pytest/unit/test_access_controls.py`
    (parser-level), `test_controls_env_override.py` (subprocess-driven
    end-to-end env overrides), `test_billing_settings.py` (catalog +
    pricing parsers), `test_events_retention.py` (events flush logic),
    `test_admin_retention_routers.py` (spans + events admin endpoint
    lock + handler).
- No regression test proving defaults are stable when no env override is
  present.
  - **Resolution:** `TestNoOverride.test_no_env_uses_defaults` and
    related defaults-state classes.

## Documentation Gaps

- Operators had no documented JSON schema.
  - **Resolution:**
    [docs/docs/self-host/04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx)
    and
    [docs/docs/self-host/05-dynamic-billing-settings.mdx](../../docs/self-host/05-dynamic-billing-settings.mdx).
- No documented restart requirement.
  - **Resolution:** restart warnings called out in both user-facing docs.
- Retention split was undocumented.
  - **Resolution:**
    [docs/designs/data-retention/README.md](../data-retention/README.md)
    and
    [docs/designs/data-retention/data-retention-periods.initial.specs.md](../data-retention/data-retention-periods.initial.specs.md)
    cover the two independent admin endpoints, crons, and lock
    namespaces.
