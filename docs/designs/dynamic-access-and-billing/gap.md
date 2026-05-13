# Gap Analysis: Env-Backed Plans and Entitlements

## Functional Gaps

- Runtime source of truth is hard-coded constants.
  - `CATALOG` and `ENTITLEMENTS` are imported directly in multiple modules.
  - There is no single accessor layer where env overrides can be applied safely.

- Subscription defaults are only partially configurable.
  - `AGENTA_DEFAULT_PLAN` exists today and should stay where it is.
  - `FREE_PLAN`, `REVERSE_TRIAL_PLAN`, and `REVERSE_TRIAL_DAYS` are still hard-coded.

- Plan identity is too static.
  - The backend `Plan` enum lives in subscription types.
  - A closed enum prevents env-defined plan slugs.
  - Plans are the root identifiers for entitlements and catalog entries, so the effective plan set should come from the access-control plans map, with code defaults as fallback.

- There is no effective access-controls consistency check.
  - `catalog` and `plans` need to agree.
  - `pricing` and `plans` also need to agree.
  - The plan set should come from plan-map slugs, and each plan value should hold the entitlement mapping.
  - A partial env override could otherwise make the UI and enforcement diverge.

- Display pricing and Stripe pricing are separate today.
  - `CATALOG.price` drives the UI.
  - `env.stripe.pricing` drives checkout/switching.
  - Env-based catalog changes can make the UI disagree with Stripe if operators are not careful.
  - Target design should move Stripe line items into `AGENTA_BILLING_PRICING` and remove `STRIPE_PRICING` / `AGENTA_PRICING`.

- Frontend plan typing is slightly inconsistent.
  - The frontend `Plan` union includes `cloud_v0_enterprise`.
  - Runtime billing data should use string plan slugs so env-defined plans do not require a frontend rebuild.

- Workspace roles are also too static.
  - `WorkspaceRole` is a closed enum.
  - `Permission` should remain code-defined, but role slugs, descriptions, and permission assignments can come from access controls.
  - `Permission.default_permissions(role)` and `WorkspaceRole.get_description(role)` centralize static role assumptions.
  - `get_all_workspace_roles()` returns `list(WorkspaceRole)`, so role discovery cannot expose env-defined roles today.

## Safety Gaps

- No validation boundary exists for nested entitlement data.
  - Moving `ENTITLEMENTS` to env without validation would be dangerous.
  - Bad tracker names, bad plan slugs, or malformed throttles can break enforcement paths.
  - Missing paired `catalog` or `plans` sections should fail when an env override is present.

- No validation boundary exists for env-defined roles.
  - Custom roles must reference only code-defined permissions.
  - Special platform behavior around `owner` and default invite roles needs explicit handling.

- Cache behavior can hide changes temporarily.
  - Subscription plan cache is invalidated when subscriptions change.
  - Entitlement controls would be process-local after startup.
  - Frontend plan data is cached for 10 minutes.

- Multi-process consistency is an operational concern.
  - API workers, background workers, and throttling code may import controls separately.
  - All running processes need the same env and restart cycle.

## Product Gaps

- Changing catalog copy is easy and low risk.
- Changing enforced limits is higher risk because it affects:
  - quota checks;
  - metering;
  - usage reporting;
  - trace retention;
  - request throttling;
  - organization feature access.

- Changing roles is medium/high risk because it affects:
  - invite flows;
  - role update flows;
  - workspace member serialization;
  - frontend permission checks;
  - owner/admin safety invariants.

- There is no operator-visible controls version.
  - Debugging would be easier if logs exposed whether access controls came from defaults or env, plus a hash of the effective controls.

## Testing Gaps

- Existing tests appear focused on billing router behavior and billing periods.
- There is no dedicated test surface for entitlement controls parsing/merging.
- There is no clear regression test proving current defaults remain unchanged when no env override is present.

## Documentation Gaps

- Operators do not have a documented JSON schema for access controls.
- There is no paired billing schema documenting display catalog and Stripe pricing under one namespace.
- There is no documented restart requirement for env changes.
