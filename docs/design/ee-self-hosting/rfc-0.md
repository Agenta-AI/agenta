# RFC-0: Self-Hosted Enterprise Edition

## Summary

Enable self-hosted deployment of Agenta EE by using Stripe availability as the differentiator between cloud and self-hosted behavior. When Stripe is not configured, the system operates in self-hosted mode: organizations get full enterprise entitlements, cloud-specific flows (trials, checkout, plan switching) are inactive, and billing UI is hidden.

## Motivation

Today, deploying Agenta EE without Stripe results in a broken experience. Organizations are stuck on the Hobby plan with enterprise features disabled (RBAC, SSO, access controls, domain verification). This is because the org creation flow hardcodes a cloud-specific trial/free-plan lifecycle that depends on Stripe to ever move beyond Hobby.

A self-hosted enterprise customer needs: deploy EE → create orgs → get full enterprise features. No Stripe, no trial concepts, no billing page.

## Design

### Principle

`STRIPE_API_KEY` present → cloud mode (current behavior, unchanged).
`STRIPE_API_KEY` absent → self-hosted mode (new behavior).

No new "mode" env var. The existing `env.stripe.enabled` check is the only differentiator. Cloud behavior is completely unchanged by this RFC.

### 1. New self-hosted enterprise plan

A new `SELF_HOSTED_ENTERPRISE` plan is added to the plan definitions with full enterprise entitlements:

- All feature flags enabled (RBAC, SSO, access controls, domains, hooks)
- All counters unlimited (traces, evaluations, credits)
- All gauges unlimited (users, applications)
- No throttle rules (or very generous ones)

This plan has no pricing catalog entry and no Stripe pricing — it exists purely for entitlement resolution.

### 2. Default plan configuration

A new env var `AGENTA_DEFAULT_PLAN` (added to `env.agenta.default_plan`) controls which plan new organizations receive. The hardcoded fallback depends on whether Stripe is configured:

- Stripe disabled (self-hosted): defaults to `self_hosted_enterprise`
- Stripe enabled (cloud): defaults to `cloud_v0_hobby` (current free plan)

### 3. Organization creation flow

The org creation flow is refactored into two clear entry points with distinct subscription policies:

**`create_organization_for_signup(...)`** — called during user signup (`create_accounts()`). Delegates subscription provisioning to `provision_signup_subscription()` on `SubscriptionsService`, which is the single decision point:
- Stripe enabled (cloud): calls `start_reverse_trial()` — existing cloud behavior
- Stripe disabled (self-hosted): calls `start_plan(get_default_plan())` — enterprise plan

**`create_organization_for_user(...)`** — called from `POST /organizations/` for explicit org creation by existing users. Always uses `start_plan(get_default_plan())`. No trial logic, regardless of Stripe. This preserves existing cloud behavior where manual org creation gets the hobby plan (no trial).

The old `start_free_plan()` is removed. `start_plan(plan)` is the single generic method for creating a local subscription row with any plan. `start_reverse_trial()` now fails fast if Stripe is disabled (guard at the top) instead of silently falling back to hobby.

The `use_reverse_trial` boolean flag that was threaded through `create_accounts()` → `create_organization_with_subscription()` is removed entirely — the decision is now made inside `provision_signup_subscription()` based on `env.stripe.enabled`.

### 4. Frontend changes

**How the frontend knows billing is disabled:**

The frontend container's `entrypoint.sh` already derives runtime config from backend env vars and writes them to `__env.js` (loaded before the app). This is the same pattern used for Turnstile, auth email, and OIDC. We add:

```bash
# In entrypoint.sh:
BILLING_ENABLED="false"
if [ -n "${STRIPE_API_KEY}" ]; then
  BILLING_ENABLED="true"
fi
```

```js
// In generated __env.js:
NEXT_PUBLIC_AGENTA_BILLING_ENABLED: "${BILLING_ENABLED}",
```

No new env var for the deployer. It's automatically derived from `STRIPE_API_KEY` presence.

Note: this is the simple implementation route. In split deployments, Stripe secrets may exist only in the API container, not the web container. A future extension should source `billing_enabled` from a backend-provided capability/config endpoint instead of inferring it purely from the web container environment.

**Billing UI hidden when billing is disabled:**
- Billing settings tab: not shown
- Sidebar banners (trial/upgrade prompts): not shown
- Upgrade prompts / paywalls: not shown (enterprise features are available)
- Pricing modal: not shown

**Entitlement recognition:**
The frontend entitlement hook currently hardcodes cloud plan names. It needs to recognize the `self_hosted_enterprise` plan as "all features enabled."

**No other frontend differences:**
All other EE UI (org management, RBAC role selectors, workspace permissions) works the same in self-hosted and cloud. Other integrations (Crisp, PostHog, Turnstile) are already env-var gated and inactive when unconfigured.

### 5. OpenAPI schema fix

`extend_app_schema()` currently hardcodes the OpenAPI `servers` field to `https://cloud.agenta.ai/api`. This uses the existing `AGENTA_API_URL` env var instead. This is a bug fix that benefits both cloud and self-hosted.

## What does NOT change

- **Cloud behavior**: completely unchanged. Stripe enabled → existing trial, checkout, billing, plan switching all work as before. Manual org creation still gets hobby plan (no trial).
- **RBAC enforcement**: unchanged. Already gated by the `RBAC` entitlement flag. Self-hosted enterprise plan sets it to `True`, so RBAC works.
- **Metering**: unchanged. Meters track usage locally regardless of Stripe. Stripe sync is already a no-op when disabled.
- **Throttling**: unchanged. Per-plan. Self-hosted enterprise plan has no throttle rules defined.
- **Existing integrations** (Loops, Crisp, SendGrid, demos): already env-var gated. Not configured → not active. No changes needed.
- **The `is_ee()` / `is_oss()` distinction**: unchanged.

## Configuration for self-hosted customers

A self-hosted customer deploying EE needs:

```bash
AGENTA_LICENSE=ee
# That's it. AGENTA_DEFAULT_PLAN defaults to "self_hosted_enterprise".
# No STRIPE_API_KEY means self-hosted mode automatically.
```

Optionally, they can override the default plan:

```bash
AGENTA_DEFAULT_PLAN=self_hosted_enterprise   # default, can be changed
```
