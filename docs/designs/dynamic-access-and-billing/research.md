# Research: Environment-Configured Plans and Entitlements

## Goal

Make plan descriptions, pricing copy, and entitlement limits configurable without rebuilding the API/frontend image. If no environment override exists, the product should keep using the code-defined defaults that are close to today’s behavior.

## Current System

Plan and entitlement controls are currently split across a few EE API modules:

- `api/ee/src/core/subscriptions/types.py`
  - Defines the `Plan` enum today, although a fixed enum conflicts with runtime-configured plan slugs.
  - Defines hard-coded defaults:
    - `FREE_PLAN = Plan.CLOUD_V0_HOBBY`
    - `REVERSE_TRIAL_PLAN = Plan.CLOUD_V0_PRO`
    - `REVERSE_TRIAL_DAYS = 14`
  - Defines `get_default_plan()`, already backed by `env.agenta.default_plan` / `AGENTA_DEFAULT_PLAN`.
- `api/ee/src/core/entitlements/types.py`
  - Defines typed entitlement keys: `Flag`, `Counter`, `Gauge`, `Tracker`, `Quota`, `Throttle`, etc.
  - Defines `CATALOG`, the billing plan metadata shown by `/billing/plans`.
  - Defines `ENTITLEMENTS`, the authoritative server-side limits and feature flags.
  - Defines `REPORTS` and `CONSTRAINTS`.
  - This is the better long-term home for the plan identifier type and code-default plan slugs, because entitlement controls own the effective plan set.
- `api/ee/src/apis/fastapi/billing/router.py`
  - Imports `CATALOG` and `ENTITLEMENTS` directly.
  - `GET /billing/plans` filters `CATALOG`, returning all standard plans plus the current custom plan.
  - `GET /billing/usage` reads limits from `ENTITLEMENTS`.
  - Checkout and switching use `Plan` and `env.stripe.pricing`.
- `api/ee/src/utils/entitlements.py`
  - Imports `ENTITLEMENTS` directly.
  - Performs feature checks, counter checks, gauge checks, DB meter adjustments, and meter cache updates.
- `api/ee/src/services/throttling_service.py`
  - Imports `ENTITLEMENTS` directly.
  - Uses the configured throttle buckets for per-plan request throttling.
- `api/ee/src/core/tracing/service.py`
  - Imports `ENTITLEMENTS` directly.
  - Uses trace quotas/retention while flushing/reporting usage.
- `api/ee/src/models/shared_models.py`
  - Defines `WorkspaceRole` as a closed enum today.
  - Defines `Permission` as a code-defined enum.
  - Defines default role-to-permission mappings inside `Permission.default_permissions(role)`.
- `api/ee/src/services/converters.py`
  - Uses `WorkspaceRole.get_description(role)` and `Permission.default_permissions(role)` when serializing workspace members.
  - Uses `getattr(WorkspaceRole, role_name.upper())`, which breaks for env-defined role slugs.
- `api/ee/src/services/db_manager_ee.py`
  - `get_all_workspace_roles()` returns `list(WorkspaceRole)`.
  - Several membership flows already store role values as strings, so storage can likely tolerate custom role slugs once enum validation is removed.
- `web/ee/src/state/billing/atoms.ts`
  - Fetches `/billing/plans` and caches results for 10 minutes.
  - Frontend plan cards are already API-driven for titles, descriptions, price, and features.

## Existing Environment Pattern

The API already centralizes environment settings in `api/oss/src/utils/env.py` via the shared `env` object. The contributor guide explicitly says new API environment variables should be added there and feature code should avoid direct `os.getenv(...)`.

Relevant existing examples:

- `env.agenta.default_plan` from `AGENTA_DEFAULT_PLAN`, which should stay as-is.
- `env.stripe.pricing`, used by checkout and subscription switching today. Target design should replace this with Stripe line items in `AGENTA_BILLING_PRICING`.
- Nested Pydantic settings models under `EnvironSettings`.

This means a plan/entitlement override should be exposed as a typed field on `env`, not read directly in billing or entitlement code.

## Important Distinctions

There are two different control surfaces here:

1. Display catalog
   - Titles, descriptions, feature bullets, prices, retention copy, and whether a plan is `standard` or `custom`.
   - Used mostly by `/billing/plans` and the frontend pricing modal.
   - Low operational risk if changed, but can mislead users if it diverges from enforcement.

2. Enforced entitlements
   - Flags, counters, gauges, quotas, retention values, and throttles.
   - Used by server-side authorization, quota enforcement, usage responses, tracing, and throttling.
   - Higher operational risk because a malformed override can block users, loosen limits, break throttle behavior, or produce inconsistent usage displays.

3. Workspace roles
   - Role slugs, descriptions, and role-to-permission assignments.
   - Permissions should remain code-defined.
   - Env-defined roles should only reference existing `Permission` values.

The strongest implementation should keep these together in one validated controls surface. Even copy-only changes should provide a consistent catalog/plans set, so the UI and enforcement cannot drift silently.

## Current Coupling and Constraints

Plan identifiers are currently code-defined through the `Plan` enum, and the enum currently lives in subscription types. That is incompatible with the main reason to add plan env vars: operators need to define plan slugs at runtime.

For the requested goal, the environment override should define the effective list of plans. Validation should check catalog and entitlement references against `AGENTA_ACCESS_PLANS`, not against a hard-coded Python enum. If the env plan list is absent, the code-default plan list remains the fallback.

The implementation should either replace `Plan` with a string-based plan slug type or keep a compatibility enum only for code defaults while making runtime subscription DTOs accept validated plan strings. `plans`, `catalog`, and `entitlements` are tightly coupled: each catalog entry must point at a known effective plan, and each entitlement entry must point at a known effective plan. If the override is incomplete or inconsistent, the API should reject it at startup rather than mixing custom pieces with code defaults.

`env.stripe.pricing` is separate from `CATALOG.price` today. That split allows the UI to show prices that Stripe does not charge. The target design should keep display catalog and Stripe pricing separate but colocated under the billing namespace: `AGENTA_BILLING_CATALOG` for display metadata and `AGENTA_BILLING_PRICING` for checkout/switching mechanics.

The frontend already consumes `/billing/plans`, so no rebuild is needed for text/price changes once the API returns env-backed data. However, the frontend caches plans for 10 minutes, and a running browser may not see changes immediately.

## Runtime Behavior

Environment variables are read when the API process starts. Changing a Kubernetes/Railway/Docker env var usually requires restarting the API container, but not rebuilding or redeploying a new image. If the goal is live mutation without process restart, env vars are the wrong storage mechanism; a database or remote config service would be needed.

## Recommended Override Shape

Use separate JSON environment variables for the coupled controls sections:

- `AGENTA_ACCESS_PLANS`
  - Defines plan slugs and maps each plan to enforced flags, counters, gauges, quotas, retention, and throttles.
  - May include internal/operator-facing descriptions for plans.
- `AGENTA_BILLING_CATALOG`
  - Defines user-facing display metadata for plan slugs in `/billing/plans`.
- `AGENTA_ACCESS_ROLES`
  - Defines effective organization, workspace, and project roles using code-defined permissions.

Catalog and plans should be treated as one validated group. If both are absent or empty, use code defaults. If either is present, both must be present and internally consistent. The effective plan slugs are the keys of the plans map.

Roles are a parallel controls section. If `AGENTA_ACCESS_ROLES` is absent or empty, use code-default roles and default role permissions. If it is present, it becomes the effective role catalog and must reference only code-defined permissions.

Separate small env vars can still be useful for high-value defaults:

- existing `AGENTA_DEFAULT_PLAN`
- free/downgrade plan marker in `AGENTA_BILLING_PRICING`
- `AGENTA_BILLING_TRIAL_PLAN`
- `AGENTA_BILLING_TRIAL_DAYS`

For larger nested data, many scalar env vars would become brittle and harder to validate than JSON. The smaller defaults can remain separate env vars because they are single scalar choices that can be independently validated against the effective plans.

## Validation Needs

The override must validate:

- Plan map keys are non-empty slugs and are unique in the effective plan set.
- Plan descriptions in access controls are optional and internal; user-facing descriptions belong to billing catalog entries.
- Every catalog plan exists in the effective plans map.
- If `catalog` or `plans` is present in env controls, both sections are present and internally consistent.
- Tracker names are valid: `flags`, `counters`, `gauges`, `throttles`.
- Entitlement keys are valid for their tracker.
- Quotas use numeric or null limits.
- Throttles reference valid categories, modes, and methods.
- Catalog entries have valid plan slugs and expected fields.
- Catalog and entitlement plans stay aligned enough to avoid misleading users.
- Role slugs are non-empty strings and unique within their scope.
- Role permissions exist in the code-defined `Permission` enum.
- Role scopes are known: `organization`, `workspace`, and `project`.
- The effective roles preserve platform invariants per scope, especially `owner`.
- Default/invite fallback roles, such as `viewer`, exist in the effective role set if code paths still depend on them.

Invalid overrides should fail fast during API startup rather than silently running with partial enforcement.
