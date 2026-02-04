# Execution Plan

## Phase 1: Security Documentation (Draft)

Create security section - these are being kept as drafts for now since some information is still being finalized.

| Doc | Content | Status |
|-----|---------|--------|
| `security/01-overview.mdx` | Encryption (AES-256 at rest, TLS in transit), architecture overview, Trust Center link | Draft |
| `security/02-data-regions.mdx` | EU (Frankfurt), US regions, enterprise dedicated instances | Draft |
| `security/03-compliance.mdx` | SOC 2 Type 2, GDPR mention, link to Trust Center | Draft |
| `security/04-privacy.mdx` | Data handling overview, placeholder for DPA | Draft |

**Note**: Security docs kept as drafts because:
- Sub-processor list not finalized
- DPA not available yet
- Some compliance details TBD

## Phase 2: Access Control Documentation

Adapt existing drafts from `/docs/drafts/` to new structure.

| Doc | Source | Status |
|-----|--------|--------|
| `access-control/01-organizations.mdx` | Adapt from `multi-organization-access.mdx` | Ready to adapt |
| `access-control/02-sso.mdx` | Adapt from `sso-providers.mdx` | Ready to adapt |
| `access-control/03-rbac.mdx` | New, based on codebase analysis | To write |
| `access-control/04-domain-verification.mdx` | Adapt from `domain-verification.mdx` | Ready to adapt |

## Phase 3: Integration

1. Create folder structure in `docs/docs/administration/`
2. Update `sidebars.ts` with new Administration section
3. Add appropriate cross-links between docs
4. Link from Trust Center where appropriate

## Dependencies

- Security docs depend on: Trust Center content, compliance status
- Access Control docs depend on: Existing drafts, codebase RBAC model
- Sidebar update depends on: All docs created

## Out of Scope (Future Work)

- Provider-specific SSO guides (Okta, Azure AD, Google Workspace)
- Self-hosted authentication configuration
- API reference for auth endpoints
- Detailed TOMs document (Technical and Organisational Measures)
