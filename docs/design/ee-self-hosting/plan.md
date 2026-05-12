# Plan: Self-Hosted Enterprise Edition

## Overview

Two independent PRs that together make self-hosted EE functional. Each PR corresponds to one RFC and is fully self-contained (backend + frontend + docs), testable end-to-end with a single deploy.

---

## PR 1: Self-Hosted EE (RFC-0)

Make self-hosted EE work out of the box: enterprise entitlements, no billing UI, no cloud-specific flows.

### Backend changes

- Add `SELF_HOSTED_ENTERPRISE` plan to `Plan` enum
- Add `ENTITLEMENTS[Plan.SELF_HOSTED_ENTERPRISE]` with all flags on, unlimited quotas
- Add `AGENTA_DEFAULT_PLAN` to `env.agenta.default_plan` (defaults to `self_hosted_enterprise` when Stripe disabled, `cloud_v0_hobby` when Stripe enabled)
- Add `get_default_plan()` in `subscriptions/types.py` using `env` object (no local imports)
- Remove `start_free_plan()`, replace with generic `start_plan(plan)`
- Remove `use_reverse_trial` flag from `create_accounts()` and org creation functions
- Add `provision_signup_subscription()` to `SubscriptionsService` — single decision point: Stripe enabled → reverse trial, Stripe disabled → default plan
- Add `start_reverse_trial()` Stripe guard — fails fast if Stripe is disabled instead of silently falling back to hobby
- Refactor org creation into two entry points:
  - `create_organization_for_signup(...)` — signup path, uses `provision_signup_subscription()`
  - `create_organization_for_user(...)` — explicit creation path (`POST /organizations/`), uses `start_plan(get_default_plan())`
- Make `check_entitlements()` treat undefined counters/gauges as unlimited instead of raising exceptions
- Fix `extend_app_schema()` to use `env.agenta.api_url` instead of hardcoded `cloud.agenta.ai` (module-level import)

**Files:**
- `api/ee/src/core/subscriptions/types.py`
- `api/ee/src/core/entitlements/types.py`
- `api/ee/src/core/subscriptions/service.py`
- `api/ee/src/services/commoners.py`
- `api/ee/src/routers/organization_router.py`
- `api/ee/src/utils/entitlements.py`
- `api/ee/src/main.py`
- `api/oss/src/utils/env.py`
- `AGENTS.md`

### Frontend changes

- Derive `NEXT_PUBLIC_AGENTA_BILLING_ENABLED` from `STRIPE_API_KEY` in `entrypoint.sh` (same pattern as Turnstile, OIDC). Future extension: replace this with backend-sourced capability/config for split deployments.
- Add `isBillingEnabled()` helper in `isEE.ts`
- Update `useEntitlements` to recognize `"self_hosted_enterprise"` plan
- Gate billing tab, sidebar banners, upgrade prompts on billing-enabled flag

**Files:**
- `web/entrypoint.sh`
- `web/oss/src/lib/helpers/dynamicEnv.ts`
- `web/oss/src/lib/helpers/isEE.ts`
- `web/oss/src/lib/helpers/useEntitlements.ts`
- `web/oss/src/components/Sidebar/SettingsSidebar.tsx`
- `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx`
- `web/ee/src/components/SidebarBanners/state/atoms.ts`
- `web/oss/src/components/pages/settings/Organization/UpgradePrompt.tsx`

### Documentation

- Self-hosted EE deployment guide
- Env var reference for `AGENTA_DEFAULT_PLAN`
- Post-setup note: org owner needs to enable SSO manually if SSO providers are configured
- See `doc-0.md` for draft

### How to test

Deploy EE without `STRIPE_API_KEY`:
1. Sign up → org created with `self_hosted_enterprise` plan
2. RBAC works (role assignments enforced)
3. SSO, access controls, domains settings are accessible (no upgrade paywall)
4. Billing tab not shown in settings
5. No trial/upgrade sidebar banners
6. OpenAPI spec shows correct server URL (not cloud.agenta.ai)
7. Create additional org via `POST /organizations/` → gets `self_hosted_enterprise` plan

Deploy EE with `STRIPE_API_KEY` (cloud regression check):
1. Sign up → reverse trial works as before
2. `POST /organizations/` → gets hobby plan (no trial)
3. Billing tab visible for org owners

---

## PR 2: Org Creation Restriction (RFC-1)

Control who can create organizations via a simple allowlist.

### Backend changes

- Add `AGENTA_ORG_CREATORS` env var parsing
- Add `can_create_organization()` guard function
- Enforce in `create_organization_for_signup()` (signup path)
- Enforce in `create_organization_for_user()` (explicit creation path)

**Files:**
- `api/oss/src/utils/env.py`
- `api/ee/src/services/commoners.py`
- `api/ee/src/routers/organization_router.py`

### Frontend changes

- Handle users who signed up but have no org (waiting for invitation)
- Show appropriate UI state instead of assuming every user has an org

**Files:**
- Frontend routing / org selection logic (TBD — needs investigation)

### Documentation

- Document `AGENTA_ORG_CREATORS` env var
- See `doc-1.md` for draft

### How to test

Deploy EE with `AGENTA_ORG_CREATORS=admin@test.com`:
1. Sign up as `admin@test.com` → org created normally
2. Sign up as `other@test.com` → user created, no org, sees "need invitation" state
3. Admin invites `other@test.com` → they join and see the org
4. `other@test.com` tries `POST /organizations/` → 403
5. Deploy without `AGENTA_ORG_CREATORS` → anyone can create orgs (current behavior)

---

## Execution

```
PR 1 (self-hosted EE)  ←── independent, can be reviewed + QA'd + merged on its own
PR 2 (org restriction)  ←── independent, can be reviewed + QA'd + merged on its own
```

No dependencies between them. Can be developed in parallel, merged in any order. For the full self-hosted experience, both are needed, but each is valuable and testable independently.
