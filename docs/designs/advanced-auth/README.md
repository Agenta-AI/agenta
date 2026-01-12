# Authentication & Authorization

This directory contains specifications for the authentication and authorization system.

---

## Quick Reference

### Core Specifications

| Document | Description |
|----------|-------------|
| [auth.flags.specs.md](auth.flags.specs.md) | Organization flags, defaults, enforcement rules, safety mechanisms |
| [auth.domains.specs.md](auth.domains.specs.md) | Domain verification, DNS TXT, governance model |
| [auth.sso.specs.md](auth.sso.specs.md) | SSO providers, OIDC configuration, secrets, lifecycle |
| [auth.sessions.specs.md](auth.sessions.specs.md) | Session model, identity accumulation |
| [auth.flows.specs.md](auth.flows.specs.md) | Discovery, login, org switching, error handling |
| [auth.realms.specs.md](auth.realms.specs.md) | URL routing, multi-tenant realm configuration |

### Supporting Documents

| Document | Description |
|----------|-------------|
| [auth.supertokens.specs.md](auth.supertokens.specs.md) | SuperTokens runtime configuration model |
| [auth.oss-ee.specs.md](auth.oss-ee.specs.md) | OSS vs Commercial License feature matrix |
| [auth.migrations.specs.md](auth.migrations.specs.md) | Personal/collaborative org migration spec |
| [auth.testing.plans.md](auth.testing.plans.md) | Manual E2E test plan |

---

## Schema Overview

### `organizations`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Identifier |
| `slug` | TEXT | URL-visible identifier |
| `name` | TEXT | Human label |
| `flags` | JSONB | Authentication and access policies |

### `organization_domains`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Identifier |
| `organization_id` | UUID FK | Owning org |
| `slug` | TEXT | Domain name (e.g., `acme.com`) |
| `token` | TEXT | DNS TXT verification token |
| `flags` | JSONB | Contains `is_verified` |

### `organization_providers`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Identifier |
| `organization_id` | UUID FK | Owning org |
| `slug` | TEXT | Provider identifier (e.g., `okta`) |
| `name` | TEXT | User-facing label |
| `type` | TEXT | Provider type (e.g., `oidc`) |
| `flags` | JSONB | Contains `is_active`, `is_valid` |
| `secret_id` | UUID FK | Encrypted configuration |

### `users`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Identifier |
| `email` | TEXT | Unique email |
| `is_active` | BOOLEAN | Account enabled |

### `identities`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Identifier |
| `user_id` | UUID FK | Link to user |
| `method` | ENUM | `email`, `social`, `sso` |
| `provider` | TEXT | e.g., `email:otp`, `social:google`, `sso:acme:okta` |
| `subject` | TEXT | Stable identifier from provider |

---

## Organization Flags

All stored in `organizations.flags` JSONB:

| Flag | Default | Purpose |
|------|---------|---------|
| `is_personal` | `false` | Personal single-user organization |
| `is_demo` | `false` | Demo organization |
| `allow_email` | `env.auth.email_enabled` | Allow email/OTP authentication |
| `allow_social` | `env.auth.oidc_enabled` | Allow social authentication |
| `allow_sso` | `false` | Allow SSO authentication |
| `allow_root` | `false` | Owner bypasses all auth restrictions |
| `domains_only` | `false` | Restrict to verified email domains |
| `auto_join` | `false` | Auto-add users with verified domains |

---

## Error Codes

| Code | Trigger | User Action |
|------|---------|-------------|
| `AUTH_UPGRADE_REQUIRED` | Auth method not in allowed list | Re-authenticate with allowed method |
| `AUTH_SSO_DENIED` | SSO disabled or provider inactive | Contact admin |
| `AUTH_DOMAIN_DENIED` | Email domain not in verified list | Contact admin or use verified domain |

---

## Authorization Flow

```
Request → Middleware → check_organization_access()
                            │
                            ├─ Owner bypass (allow_root)
                            │
                            ├─ Build allowed methods from flags
                            │
                            ├─ Match session identities
                            │   └─ No match → AUTH_UPGRADE_REQUIRED
                            │   └─ SSO mismatch → AUTH_SSO_DENIED
                            │
                            └─ Check domains_only
                                └─ Domain not verified → AUTH_DOMAIN_DENIED
```

---

## One-Sentence Summary

> Organizations control access via flags stored in JSONB; domain verification establishes governance authority; SSO providers enable enterprise authentication; and sessions accumulate identity proofs that are validated against org policies on each request.
