# Context

## Problem Statement

Enterprise customers (TrustCloud, cords.io, Discord) are asking about SSO/RBAC capabilities. The features are shipped (Jan 2026) but:

1. **No public documentation** - Features exist but aren't discoverable
2. **Scattered information** - Some drafts exist in `/docs/drafts/` but not published
3. **Missing security docs** - No encryption, compliance, or data residency documentation
4. **Blocking enterprise deals** - Sales needs docs to share with prospects

## Goals

1. Create a new **Administration** section in docs sidebar
2. Document security posture (encryption, compliance, regions)
3. Document access control features (SSO, RBAC, domain verification, organizations)
4. Enable sales to share docs with enterprise prospects
5. Support self-service enterprise onboarding

## Non-Goals

- Full DPA documentation (not available yet)
- Detailed sub-processor list (being worked on separately)
- HIPAA compliance documentation (not applicable currently)
- Self-hosted authentication deep-dive (separate from this scope)

## Current State

### What's Shipped
- SSO (OIDC) - Jan 2026
- RBAC with 6 roles and 50+ permissions
- Domain verification via DNS TXT
- Multi-organization support
- Account linking

### What Exists
- Trust Center: https://trustcenter.agenta.ai/ (SOC 2 badge, controls)
- Status Page: https://agenta.hyperping.app/
- Draft docs in `/docs/drafts/`:
  - `authentication/account-linking.mdx`
  - `authentication/multi-organization-access.mdx`
  - `security/domain-verification.mdx`
  - `security/sso-providers.mdx`
- Previous documentation plan: `/docs/designs/advanced-auth/DOCUMENTATION_PLAN.md`

### Technical Facts (from codebase)
- **Encryption at rest**: PostgreSQL PGP symmetric encryption (AES-256)
- **Encryption in transit**: TLS via Traefik with Let's Encrypt
- **Compliance**: SOC 2 Type 2
- **Data Regions**: 
  - EU: eu.cloud.agenta.ai (Frankfurt)
  - US: us.cloud.agenta.ai
  - Enterprise: Dedicated instances available

## Stakeholders

- **Sales**: Needs docs to share with enterprise prospects
- **Enterprise customers**: Need to understand security posture
- **DevOps teams**: Need to understand SSO/RBAC setup
- **Compliance teams**: Need security documentation for vendor reviews

## Success Criteria

1. Administration section live in docs
2. All 8 pages drafted and reviewed
3. Links from Trust Center to detailed docs
4. Sales can share docs with prospects
