# Tasks: Env-Backed Plans and Entitlements

Status: complete. All initial tasks shipped; the post-initial sections
record work that emerged after `scan-codebase` / `triage-findings` /
`resolve-findings` and user-driven design changes.

## Controls Surface (initial)

- [x] Replace the closed `Plan` enum in `api/ee/src/core/subscriptions/types.py` with a runtime-valid plan slug type.
- [x] Move code-default plan slugs into `api/ee/src/core/entitlements/types.py` (`DefaultPlan` enum, used as fallback only).
- [x] Update subscription, billing, throttling, and client imports to use the access plan slug type.
- [x] Add `AccessControls` to `api/oss/src/utils/env.py`.
- [x] Add `AGENTA_ACCESS_PLANS`.
- [x] Add `AGENTA_ACCESS_ROLES`.
- [x] Add billing settings to `api/oss/src/utils/env.py`.
- [x] Add `AGENTA_BILLING_CATALOG`.
- [x] Move Stripe line items from `STRIPE_PRICING` / `AGENTA_PRICING` to `AGENTA_BILLING_PRICING` and remove legacy usage from `StripeConfig`.
- [x] Add support for a free-plan marker in `AGENTA_BILLING_PRICING`.
- [x] Add `AGENTA_BILLING_TRIAL_PLAN`.
- [x] Add `AGENTA_BILLING_TRIAL_DAYS`.
- [x] Preserve current default-plan loading and fallback behavior (Stripe-on/off code fallback).

## Access and Billing Builders (initial)

- [x] Create `api/ee/src/core/entitlements/controls.py` for access controls.
- [x] Create billing settings helpers in `api/ee/src/core/subscriptions/settings.py`.
- [x] Define Pydantic models for plans (`_PlanOverride`), catalog entries (`_CatalogEntry`), roles (`_RoleOverride`).
- [x] Implement startup parsing of `env.billing.catalog`, `env.billing.pricing`, `env.access_controls.plans`, `env.access_controls.roles`.
- [x] Implement fallback to code defaults when catalog/pricing/plans JSON env vars are absent or empty.
- [x] Implement validation that env overrides provide consistent catalog, pricing, and plans.
- [x] Implement derivation of effective plan slugs from plan map keys.
- [x] Implement validation that catalog plan slugs exist in the effective plans map.
- [x] Expose `get_plans()`.
- [x] Expose `get_plan(slug)`.
- [x] Expose `get_plan_entitlements(slug)`.
- [x] Expose `get_plan_description(slug)`.
- [x] Expose `get_roles(scope)`.
- [x] Expose `get_role(scope, slug)`.
- [x] Expose `get_role_permissions(scope, slug)`.
- [x] Expose `get_role_description(scope, slug)`.
- [x] Add billing settings accessors: `get_catalog()`, `get_catalog_plan(slug)`, `get_pricing()`, `get_pricing_plan(slug)`, `get_stripe_line_items(slug)`, `get_stripe_meter_price(plan, meter)`, `get_free_plan()`, `get_trial_plan()`, `get_trial_days()`, `trial_enabled()`.
- [x] Keep `get_default_plan()` (now reads from `env.access_controls.default_plan` — see post-initial section).
- [x] Log whether defaults or env overrides are active with a stable controls hash.

## Runtime Refactor (initial)

- [x] Update `api/ee/src/apis/fastapi/billing/router.py` to use billing `get_catalog()` and access-control `get_plan_entitlements()`.
- [x] Update `api/ee/src/utils/entitlements.py` to use `get_plan_entitlements()`.
- [x] Update `api/ee/src/services/throttling_service.py` to use `get_plan_entitlements()`.
- [x] Update `api/ee/src/core/tracing/service.py` to use `get_plan_entitlements()` via `get_plans()` iteration.
- [x] Update `api/ee/src/core/entitlements/service.py` to use controls accessors.
- [x] Update `api/ee/src/core/subscriptions/service.py` to use billing `get_free_plan()`, `get_trial_plan()`, `get_trial_days()`.
- [x] Update `WorkspaceRole` runtime usage to accept access-control role slugs instead of a closed enum.
- [x] Update `Permission.default_permissions(role)` callers to use `get_role_permissions(scope, role)`.
- [x] Update `WorkspaceRole.get_description(role)` callers to use `get_role_description(scope, role)`.
- [x] Update role discovery APIs to return `get_roles()`.
- [x] Keep code defaults for catalog/plans/roles as the no-env fallback.

## Tests (initial)

- [x] Controls unit tests for no env override.
- [x] Integration-style settings tests for catalog/plans/pricing override (subprocess-driven).
- [x] Settings tests proving catalog-only override fails validation.
- [x] Settings tests proving plans-only override fails validation when billing catalog/pricing is required.
- [x] Controls unit tests for invalid JSON.
- [x] Controls unit tests for duplicate/empty plan slugs.
- [x] Controls unit tests for catalog referencing a plan missing from plans.
- [x] Controls unit tests for invalid tracker/key.
- [x] Billing settings unit tests for free/trial env behavior.
- [x] Controls unit tests for roles env override.
- [x] Controls unit tests for roles env override with unknown permission.
- [x] Controls unit tests for duplicate/empty role slugs.
- [x] Controls unit tests for required owner/default role behavior.
- [x] Billing router tests proving `/billing/plans` returns overridden catalog data (via subprocess override tests).
- [x] Checkout/switch tests proving Stripe line items are read from `AGENTA_BILLING_PRICING`.
- [x] Checkout/switch tests proving paid plans without Stripe line items fail clearly.
- [x] Usage tests proving limits come from effective entitlements.
- [x] Access tests proving role discovery and member serialization use effective roles.

## Frontend and Docs (initial)

- [x] Change frontend runtime billing plan fields to string plan slugs while keeping `DefaultPlan` constants for known default plans.
- [x] Change frontend runtime role fields to string role slugs.
- [x] Confirm the pricing modal handles overridden catalog fields without layout or behavior regressions.
- [x] Document `AGENTA_BILLING_CATALOG`, `AGENTA_BILLING_PRICING`, `AGENTA_ACCESS_PLANS`, `AGENTA_ACCESS_ROLES` with examples in
  [docs/docs/self-host/04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx)
  and
  [docs/docs/self-host/05-dynamic-billing-settings.mdx](../../docs/self-host/05-dynamic-billing-settings.mdx).
- [x] Document the catalog/pricing split.
- [x] Document restart requirements for API and worker processes.

## Findings Resolution (post-scan)

`scan-codebase` surfaced 13 findings against the initial implementation
([findings.md](findings.md)). All resolved on this branch:

- [x] FIND-001 — `WorkspacePermission.role_name: str` (response models opened).
- [x] FIND-002 — project scope mirrors workspace role default extras.
- [x] FIND-003 — `workspace_router.update_user_roles` validates via `get_role("workspace", slug)`.
- [x] FIND-004 — `db_manager_ee.get_all_workspace_roles` and `workspace_manager.get_all_workspace_roles` return `get_roles("workspace")`.
- [x] FIND-005 — `get_free_plan()` fallback validated against effective plan set; fails startup when unreachable.
- [x] FIND-006 — `get_default_plan()` validated against effective plan set at startup.
- [x] FIND-007 — admin `start_plan` validates plan via `get_plans()`.
- [x] FIND-008 — `AGENTA_BILLING_PRICING.stripe.meters` keys validated against `Counter` / `Gauge` enums.
- [x] FIND-009 — `_CatalogEntry` Pydantic model with required fields + `type ∈ {standard, custom}`.
- [x] FIND-010 — migration comments call out the operator constraint on `cloud_v0_hobby`; FIND-005 guard catches mismatches at startup.
- [x] FIND-011 — plans with only a `description` (or empty entry) allowed; `fetch_usage` distinguishes unknown plan vs. empty entitlements.
- [x] FIND-012 — closed as `wontfix`. Workspace `viewer` minima permissions are code-fixed by design and documented.
- [x] FIND-013 — throttle middleware falls back to free-plan throttles on unknown plans.

## Default-Plan Relocation + Overlay (post-initial)

User-driven design change: ergonomic per-knob tweaks for self-hosted
operators without requiring full plan overrides.

- [x] Move `default_plan` from `env.agenta` to `env.access_controls`.
- [x] Canonical env var name: `AGENTA_ACCESS_DEFAULT_PLAN`.
- [x] Preserve legacy `AGENTA_DEFAULT_PLAN` as fallback read (canonical wins).
- [x] Update all readers (`subscriptions/types.py`, `subscriptions/settings.py`, `controls.py`).
- [x] Add `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` to `env.py`.
- [x] Define `_DefaultPlanOverlay` Pydantic model in `controls.py`.
- [x] Implement quota field-merge (`_merge_quota`).
- [x] Implement throttle field-merge keyed by category (`_merge_throttle`, throttles-as-map shape).
- [x] Apply overlay after base plan map is built; validate target plan and throttle-category presence.
- [x] Tests for overlay parse + apply (unit) and end-to-end env wiring (subprocess).
- [x] Document overlay shape, merge semantics, and examples in
  [docs/docs/self-host/04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx).

## Events Counter + Retention Split (post-initial)

User-driven design change: events become a retainable domain; retention
moves out of billing.

- [x] Add `Counter.EVENTS_INGESTED` to `entitlements/types.py` as the independent events usage + retention counter.
- [x] Declare `Counter.EVENTS_INGESTED` on every plan in `DEFAULT_ENTITLEMENTS` with per-plan retention aligned to the plan's `Counter.TRACES_INGESTED` retention: `Quota(period=Period.MONTHLY, retention=Retention.MONTHLY)` on Hobby, `QUARTERLY` on Pro, `YEARLY` on Business, and `retention=None` (unlimited) on Agenta and Self-hosted Enterprise.
- [x] Add `Counter.EVENTS_INGESTED` to `CONSTRAINTS[Constraint.READ_ONLY]`.
- [x] New `EventsRetentionDAO` at `api/ee/src/dbs/postgres/events/dao.py` (independent from OSS `EventsDAO`).
- [x] New `EventsRetentionService.flush_events` at `api/ee/src/core/events/retention.py`.
- [x] New admin router `EventsAdminRouter` at `api/ee/src/apis/fastapi/events/router.py` → `POST /admin/events/flush`.
- [x] Split spans admin handler out of `BillingRouter` into `SpansAdminRouter` at `api/ee/src/apis/fastapi/spans/router.py` → `POST /admin/spans/flush`.
- [x] Hard cut on `POST /admin/billing/usage/flush` (no compat shim).
- [x] Drop `tracing_service` constructor arg from `BillingRouter`.
- [x] Mount two new admin routers in `ee/src/main.py`.
- [x] Update `crons/spans.sh` URL to `/admin/spans/flush`.
- [x] New `crons/events.sh` + `crons/events.txt` (schedule `7,37 * * * *`, offset from spans `0,30` and meters `15,45`).
- [x] Dockerfile updates (`Dockerfile.dev`, `Dockerfile.gh`) to COPY + chmod the new files.
- [x] `docker-compose.dev.yml` volume mount for `events.sh`.
- [x] Tests: `test_events_retention.py` (service logic), `test_admin_retention_routers.py` (lock + handler).
- [x] Doc updates:
  - [docs/designs/data-retention/README.md](../data-retention/README.md)
  - [docs/designs/data-retention/data-retention-periods.initial.specs.md](../data-retention/data-retention-periods.initial.specs.md)
  - [docs/design/ee-self-hosting/research.md](../../design/ee-self-hosting/research.md)
  - [docs/openapi-cleanup/endpoints.md](../../openapi-cleanup/endpoints.md)
  - [docs/docs/self-host/04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx) (events counter row)

## Roles Overlay (post-initial)

User-driven design change: symmetric overlay for the role catalog so
operators can tweak a single existing role (e.g. give `editor` one
extra permission) or add a single new role without restating the full
`AGENTA_ACCESS_ROLES` payload.

- [x] Rename "legacy extras" → "default extras" everywhere (terminology
  cleanup — the workspace roles are code defaults, not legacy).
- [x] Add `AGENTA_ACCESS_ROLES_OVERLAY` field to `env.access_controls`.
- [x] Define `_RoleOverlayEntry` Pydantic model in `controls.py`.
- [x] Implement `_parse_roles_overlay` (only `project` key accepted; rejects
  reserved minima slugs; validates permissions).
- [x] Implement `_apply_roles_overlay` (patches both workspace and project
  scopes from the same `project` payload; per-field replace for existing
  roles; appends new roles when both fields supplied).
- [x] Wire into `_build_controls`; log `roles_overlay=env|none` at startup.
- [x] Tests: parser unit tests + apply unit tests + subprocess env-wired
  end-to-end tests (16 new tests).
- [x] Doc updates:
  - [docs/docs/self-host/02-configuration.mdx](../../docs/self-host/02-configuration.mdx) (table row).
  - [docs/docs/self-host/04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx) (new section with shape, merge table, examples).
- [x] Env example files updated:
  - [hosting/docker-compose/ee/env.ee.dev.example](../../../hosting/docker-compose/ee/env.ee.dev.example)
  - [hosting/docker-compose/ee/env.ee.gh.example](../../../hosting/docker-compose/ee/env.ee.gh.example)

## Post-PR-#4330 Hardening

Surfaced by Copilot review on PR #4330 and a local migration-tree audit.
All seven findings (FIND-014..020) closed; details in [findings.md](findings.md).

- [x] FIND-014 — sync design-folder text (`research.md`, `gap.md`, `proposal.md`, `tasks.md`) to the shipped `Counter.EVENTS_INGESTED` per-plan retention values (MONTHLY/QUARTERLY/YEARLY on Hobby/Pro/Business; `None` on Agenta/Self-hosted). MDX docs already matched.
- [x] FIND-015 — tighten override-vs-overlay terminology in [04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx): `:::warning Override semantics` callout under `AGENTA_ACCESS_ROLES`; two H4 examples ("Override the full project-scope catalog" vs "Add a single role on top of the defaults"); `:::note Scope of effect` callouts on both overlay sections distinguishing plan-independent (`_ROLES_OVERLAY`) vs plan-targeted (`_DEFAULT_PLAN_OVERLAY`).
- [x] FIND-016 — rename `"role": "member"` → `"role": "viewer"` in three acceptance test sites: [test_memberships.py:52](../../../api/ee/tests/pytest/acceptance/accounts/test_memberships.py#L52), [test_transfer_ownership.py:65, :118](../../../api/ee/tests/pytest/acceptance/accounts/test_transfer_ownership.py#L65). No deprecation alias added — admin endpoint is internal-only.
- [x] FIND-017 — replace `assert trial_days is not None and trial_plan is not None` with explicit `if/raise EventException(...)` in [subscriptions/service.py:95-101](../../../api/ee/src/core/subscriptions/service.py#L95-L101) so the guard survives `python -O` / `PYTHONOPTIMIZE`. Comment annotated to document the rationale.
- [x] FIND-018 — require at least one of `free` or `stripe` per pricing entry in [`_normalize_pricing_entry`](../../../api/ee/src/core/subscriptions/settings.py); empty `{}` now fails startup with a slug-pointing message instead of silently 400-ing at checkout. Added [test_billing_settings.py::test_empty_pricing_entry_rejected](../../../api/ee/tests/pytest/unit/test_billing_settings.py) to lock in the behavior.
- [x] FIND-019 — thread `existing_type=sa.String()` through both `op.alter_column` calls in [a1b2c3d4e5f7_unify_org_member_role_to_viewer.py](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py); imported `sqlalchemy as sa`. No behavior change on PostgreSQL today; survives a future dialect addition or column-type change upstream.
- [x] FIND-020 — linearize the EE `core` Alembic tree after the `feat/clean-up-meters` merge: rebased `a1b2c3d4e5f7.down_revision` from `"e6f7a8b9c0d1"` to `"9d3e8f0a1b2c"` so the org-role unification chains after the meters reshape. Verified single head via `python find_head.py core` from `api/ee/databases/postgres/migrations/` — output is now `Heads: ['a1b2c3d4e5f7']`.
- [x] Pydantic `extra="forbid"` added to `Quota`, `Probe`, `Bucket`, `Throttle` so operator typos in `AGENTA_ACCESS_PLANS` / `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` (most commonly leftover `"monthly": true` from the pre-reshape config) fail startup with a clear field-pointing error.
- [x] Meters-service Stripe-reporting routes switched from name-based identity (`meter.key.name in Gauge.__members__`) to value-based (`meter.key.value in _GAUGE_SLUGS`) so dispatch survives future enum renames.
- [x] MDX docs at [04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx) refocused on `self_hosted_enterprise` examples (this page lives in `docs/self-host/`); cloud-plan flavor moved out. Added worked example for per-user / per-day `TRACES_RETRIEVED` cap via `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY`, plus a Reference section with `Period` / `Scope` / `Retention` value tables and a pointer to the `Permission` enum source.
- [x] PR threads on PR #4330 replied + resolved for FIND-014..020 (6 of 7 review threads on the PR now resolved).

## Validation

- [x] `ruff format` clean.
- [x] `ruff check` clean.
- [x] EE unit suite green (156 tests + 1 new for FIND-018).
- [x] `test_billing_settings.py` green (33/33).
- [x] `find_head.py core` single-head after FIND-020 rebase.
- [ ] Full unit/integration/acceptance suites in `api`, `sdk`, `services`, `web` — run manually by the maintainer.
