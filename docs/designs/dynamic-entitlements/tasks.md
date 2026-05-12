# Tasks: Env-Backed Plans and Entitlements

## Controls Surface

- [ ] Replace the closed `Plan` enum in `api/ee/src/core/subscriptions/types.py` with a runtime-valid plan slug type.
- [ ] Move code-default plan slugs into `api/ee/src/core/entitlements/types.py`.
- [ ] Update subscription, billing, throttling, and client imports to use the access plan slug type.
- [ ] Add `AccessControls` to `api/oss/src/utils/env.py`.
- [ ] Add `AGENTA_ACCESS_PLANS`.
- [ ] Add `AGENTA_ACCESS_ROLES`.
- [ ] Add billing settings to `api/oss/src/utils/env.py`.
- [ ] Add `AGENTA_BILLING_CATALOG`.
- [ ] Move Stripe line items from `STRIPE_PRICING` / `AGENTA_PRICING` to `AGENTA_BILLING_PRICING` and remove legacy usage from `StripeConfig`.
- [ ] Add support for a free-plan marker in `AGENTA_BILLING_PRICING`.
- [ ] Add `AGENTA_BILLING_TRIAL_PLAN`.
- [ ] Add `AGENTA_BILLING_TRIAL_DAYS`.
- [ ] Preserve current default-plan loading and fallback behavior: existing `AGENTA_DEFAULT_PLAN`, then current Stripe-enabled/disabled code fallback.

## Access and Billing Builders

- [ ] Create `api/ee/src/core/entitlements/controls.py` for access controls.
- [ ] Create billing settings helpers in `api/ee/src/core/subscriptions/`.
- [ ] Define Pydantic models for plans with optional descriptions and entitlement mappings, catalog entries, quotas, buckets, throttles, scoped roles, and full override payloads.
- [ ] Implement startup parsing of `env.billing.catalog`, `env.billing.pricing`, `env.access_controls.plans`, and `env.access_controls.roles`.
- [ ] Implement fallback to code defaults when catalog/pricing/plans JSON env vars are absent or empty.
- [ ] Implement validation that env overrides provide consistent catalog, pricing, and plans.
- [ ] Implement derivation of effective plan slugs from plan map keys.
- [ ] Implement validation that catalog plan slugs exist in the effective plans map.
- [ ] Implement complete effective controls construction from env or code defaults.
- [ ] Expose `get_plans()`.
- [ ] Expose `get_plan(slug)`.
- [ ] Expose `get_plan_entitlements(slug)`.
- [ ] Expose `get_plan_description(slug)`.
- [ ] Expose `get_roles(scope)`.
- [ ] Expose `get_role(scope, slug)`.
- [ ] Expose `get_role_permissions(scope, slug)`.
- [ ] Expose `get_role_description(scope, slug)`.
- [ ] Add billing settings accessors in `api/ee/src/core/subscriptions/`: `get_catalog()`, `get_catalog_plan(slug)`, `get_pricing()`, `get_pricing_plan(slug)`, `get_stripe_line_items(slug)`, `get_free_plan()`, `get_trial_plan()`, and `get_trial_days()`.
- [ ] Keep `get_default_plan()` where it is today.
- [ ] Log whether defaults or env overrides are active, ideally with a stable controls hash.

## Runtime Refactor

- [ ] Update `api/ee/src/apis/fastapi/billing/router.py` to use billing `get_catalog()` and access-control `get_plan_entitlements()`.
- [ ] Update `api/ee/src/utils/entitlements.py` to use `get_plan_entitlements()`.
- [ ] Update `api/ee/src/services/throttling_service.py` to use `get_plan_entitlements()`.
- [ ] Update `api/ee/src/core/tracing/service.py` to use `get_plan_entitlements()`.
- [ ] Update `api/ee/src/core/entitlements/service.py` to use controls accessors.
- [ ] Update `api/ee/src/core/subscriptions/service.py` to use billing `get_free_plan()`, `get_trial_plan()`, and `get_trial_days()`.
- [ ] Update `WorkspaceRole` runtime usage to accept access-control role slugs instead of a closed enum.
- [ ] Update `Permission.default_permissions(role)` callers to use `get_role_permissions(role)`.
- [ ] Update `WorkspaceRole.get_description(role)` callers to use `get_role_description(role)`.
- [ ] Update role discovery APIs to return `get_roles()`.
- [ ] Keep code defaults for catalog/plans/roles as the no-env fallback.

## Tests

- [ ] Add controls unit tests for no env override.
- [ ] Add integration-style settings tests for catalog/plans/pricing override.
- [ ] Add settings tests proving catalog-only override fails validation.
- [ ] Add settings tests proving plans-only override fails validation when billing catalog/pricing is required.
- [ ] Add controls unit tests for invalid JSON.
- [ ] Add controls unit tests for duplicate/empty plan slugs.
- [ ] Add controls unit tests for catalog referencing a plan missing from plans.
- [ ] Add controls unit tests for invalid tracker/key.
- [ ] Add billing settings unit tests for free/trial env behavior.
- [ ] Add controls unit tests for roles env override.
- [ ] Add controls unit tests for roles env override with unknown permission.
- [ ] Add controls unit tests for duplicate/empty role slugs.
- [ ] Add controls unit tests for required owner/default role behavior.
- [ ] Add or update billing router tests proving `/billing/plans` returns overridden catalog data.
- [ ] Add or update checkout/switch tests proving Stripe line items are read from `AGENTA_BILLING_PRICING`.
- [ ] Add or update checkout/switch tests proving paid plans without Stripe line items fail clearly.
- [ ] Add or update usage tests proving limits come from effective entitlements.
- [ ] Add or update access tests proving role discovery and member serialization use effective roles.

## Frontend and Docs

- [ ] Change frontend runtime billing plan fields to string plan slugs while keeping constants for known default plans.
- [ ] Change frontend runtime role fields to string role slugs while keeping constants for known default roles.
- [ ] Confirm the pricing modal handles overridden catalog fields without layout or behavior regressions.
- [ ] Document `AGENTA_BILLING_CATALOG`, `AGENTA_BILLING_PRICING`, `AGENTA_ACCESS_PLANS`, and `AGENTA_ACCESS_ROLES` with examples.
- [ ] Document that `AGENTA_BILLING_CATALOG` contains display metadata and `AGENTA_BILLING_PRICING` contains Stripe line items.
- [ ] Document restart requirements for API and worker processes.

## Validation

- [ ] Run `ruff format` from the repo root.
- [ ] Run `ruff check --fix` from the repo root.
- [ ] Run `pnpm run format-fix` from `web`.
- [ ] Run `pnpm run lint-fix` from `web`.
- [ ] Full unit/integration/acceptance suites in `api`, `sdk`, `services`, and `web` are run manually by the maintainer.
