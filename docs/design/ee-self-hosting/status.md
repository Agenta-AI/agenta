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

### 2026-03-22
- Implemented PR 2 (RFC-1): Org creation restriction — **backend only**
  - Backend: `AGENTA_ORG_CREATION_ALLOWLIST` env var in `env.agenta.org_creation_allowlist` (set of emails, or None when unset)
  - Backend: `OrganizationCreationNotAllowedError` exception added to `core/organizations/exceptions.py`
  - Backend: `can_create_organization(email)` guard function in `commoners.py`
  - Backend: Guard enforced in `create_accounts()` (silent skip on signup) and `create_organization_for_user()` (raises exception)
  - Backend: `POST /organizations/` catches exception → HTTP 403
  - Frontend: **not handled** — see known limitation below

### Known Limitation: Frontend does not handle restricted signup gracefully

When `AGENTA_ORG_CREATION_ALLOWLIST` is set and a user who is not in the allowlist
signs up **without** auto-join (domain-based) or an existing invitation, the frontend
breaks. The user has a valid session but zero orgs/workspaces. The auth middleware
returns 401 for `/profile` and `/organizations` (because it requires a resolvable
workspace/project scope), which triggers the global axios 401 handler to sign the
user out and redirect to `/auth`. On re-login the same cycle repeats.

**Root cause:** The backend auth middleware (`auth_service.py`) assumes every
authenticated user has at least one workspace/project. When default workspace
resolution fails (no orgs), it raises `UnauthorizedException`. The frontend then
cannot call any bootstrap endpoint (`/profile`, `/organizations`), so it cannot
distinguish "no orgs, needs invitation" from "actually unauthorized."

**Workaround for operators:**
- Pre-invite users before they sign up (existing invitation flow).
  This ensures the user has an org by the time they hit the app.

**What would be needed to fix properly:**
- Backend: allow a small set of bootstrap endpoints (`/profile`, `/organizations`)
  to work with an authenticated session that has no workspace/project scope.
- Backend: add `can_create_organizations` boolean to `/profile` response.
- Frontend: support "signed in, zero orgs" as a valid app state (show a message
  instead of entering the normal app shell).
- This is a larger architectural change to the auth middleware and was deferred.

### Remaining TODOs

- [ ] Review and finalize `doc-0.md` (self-hosted EE docs)
- [ ] Review and finalize `doc-1.md` (org creation restriction docs)
- [ ] QA PR 1: deploy EE without Stripe, verify full flow
- [ ] QA PR 1: deploy EE with Stripe, verify cloud regression
- [x] Implement PR 2 (RFC-1): Org creation restriction — backend only
- [ ] QA PR 2: deploy EE with `AGENTA_ORG_CREATION_ALLOWLIST` + pre-invited user, verify restricted user joins via invite
- [ ] QA PR 2: deploy without allowlist, verify current behavior preserved
- [ ] Future: frontend support for "signed in, zero orgs" state (see known limitation above)
