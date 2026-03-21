# Status

## Current Phase: PR 1 Implementation Complete, Pending Review

### 2026-03-21
- Created planning workspace
- Completed comprehensive codebase research across 6 areas (16 sections in `research.md`)
- Key decisions:
  - Single Enterprise artifact, Cloud as managed EE deployment (not a product fork)
  - Stripe presence (`env.stripe.enabled`) is the differentiator — no new mode env var
  - `AGENTA_DEFAULT_PLAN` env var (defaults to `self_hosted_enterprise`) for self-hosted
  - Org creation restriction via simple `AGENTA_ORG_CREATORS` allowlist (RFC-1, not yet implemented)
  - Billing-enabled flag derived from `STRIPE_API_KEY` in `entrypoint.sh` → `__env.js`
  - No other cloud/self-hosted behavioral differences — everything else is already env-var gated
- Wrote `rfc-0.md`, `rfc-1.md`, `plan.md`, `doc-0.md`, `doc-1.md`
- Implemented PR 1 (RFC-0):
  - Backend: new `SELF_HOSTED_ENTERPRISE` plan, `get_default_plan()` via `env` object, refactored org creation into `create_organization_for_signup()` / `create_organization_for_user()`, added `provision_signup_subscription()` as single decision point, removed `start_free_plan()` and `use_reverse_trial` flag, graceful handling of undefined quotas in entitlements, OpenAPI schema fix
  - Backend follow-up: fixed `/billing/subscription` for self-hosted non-Stripe plans so it returns locally computed subscription status instead of 404 when `subscription_id` is absent
  - Frontend: `isBillingEnabled()` helper, billing UI gating (tab, sidebar banners, upgrade prompts), entitlement recognition for `self_hosted_enterprise` plan
  - Config: `env.agenta.default_plan` for `AGENTA_DEFAULT_PLAN`, `NEXT_PUBLIC_AGENTA_BILLING_ENABLED` derived in `entrypoint.sh`
  - Updated `AGENTS.md` with environment config conventions
- Updated `rfc-0.md` and `plan.md` to match final implementation, including note that frontend billing-enabled detection currently uses the simple web-container env approach and may need backend-sourced config in split deployments

### Remaining TODOs

- [ ] Review and finalize `doc-0.md` (self-hosted EE docs)
- [ ] Review and finalize `doc-1.md` (org creation restriction docs)
- [ ] QA PR 1: deploy EE without Stripe, verify full flow
- [ ] QA PR 1: deploy EE with Stripe, verify cloud regression
- [ ] Implement PR 2 (RFC-1): Org creation restriction — backend + frontend + docs
