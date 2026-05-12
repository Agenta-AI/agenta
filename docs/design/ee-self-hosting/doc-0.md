# Doc-0: Documentation Changes for Self-Hosted EE

Draft of documentation changes needed after RFC-0 is implemented.

## New content needed

### Self-Hosted EE Deployment Guide

- How to deploy Agenta EE for self-hosting
- Minimum config: `AGENTA_LICENSE=ee` (no Stripe needed)
- What the self-hosted customer gets: RBAC, SSO, access controls, domains, unlimited usage
- Auth provider configuration (SuperTokens, Google/GitHub OAuth, Okta, Azure AD, BoxySAML)
- Post-setup note: after creating an org, the org owner needs to enable SSO by toggling `allow_sso` in org settings (it defaults to `False` even when SSO providers are configured)

### Env Var Reference Updates

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTA_DEFAULT_PLAN` | Plan assigned to new orgs when Stripe is disabled | `self_hosted_enterprise` |

### Existing docs to update

- EE installation/deployment docs: mention that Stripe is optional, explain cloud vs self-hosted behavior
- Env var reference: add `AGENTA_DEFAULT_PLAN`
- Billing/plans docs (if any): clarify these are cloud-only when Stripe is configured

## Not needed

- No changes to API reference (no new endpoints)
- No changes to SDK docs
