# Enterprise Documentation Planning

Documentation for enterprise features: SSO, RBAC, domain verification, security, compliance.

## Why This Exists

Enterprise deals need docs. TrustCloud, cords.io, Discord all ask about SSO/RBAC. Features are shipped but docs are scattered/incomplete.

## Workspace Contents

| File | Purpose |
|------|---------|
| [context.md](./context.md) | Background, motivation, goals, non-goals |
| [plan.md](./plan.md) | Execution plan with phases |
| [status.md](./status.md) | Living progress tracker |
| [research.md](./research.md) | Competitor analysis, codebase findings |

## Target Structure

New sidebar section: **Administration**

```
docs/docs/administration/
├── security/
│   ├── 01-overview.mdx          # Encryption, architecture
│   ├── 02-data-regions.mdx      # EU, US, data residency
│   ├── 03-compliance.mdx        # SOC2, GDPR, sub-processors
│   └── 04-privacy.mdx           # DPA, data handling
│
└── access-control/
    ├── 01-organizations.mdx     # Workspaces, members
    ├── 02-sso.mdx               # Enterprise SSO (OIDC)
    ├── 03-rbac.mdx              # Roles and permissions
    └── 04-domain-verification.mdx
```

## Quick Links

- **Trust Center**: https://trustcenter.agenta.ai/
- **Status Page**: https://agenta.hyperping.app/
- **Existing Drafts**: `/docs/drafts/` (SSO, domain verification, account linking)
- **Previous Plan**: `/docs/designs/advanced-auth/DOCUMENTATION_PLAN.md`
