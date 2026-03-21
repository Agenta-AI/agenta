# RFC-1: Organization Creation Restriction

## Summary

Introduce a simple allowlist to control who can create organizations. If `AGENTA_ORG_CREATORS` is set, only listed emails can create orgs. If not set, anyone can — preserving current behavior.

## Motivation

In self-hosted deployments, unrestricted organization creation is often undesirable. A company deploying Agenta for their team typically wants one or a few organizations managed by specific people, not every user creating their own.

Today, any authenticated user can create unlimited organizations with no checks. This RFC adds a single env var to restrict that.

## Design

### Env var

```bash
AGENTA_ORG_CREATORS=admin@company.com,ops@company.com
```

- **Not set (default)**: any authenticated user can create orgs. Current behavior. Suitable for cloud.
- **Set**: only users whose email is in the comma-separated list can create orgs. Everyone else must be invited to an existing org.

### Guard logic

A single function checked before any user-facing org creation:

```python
def can_create_organization(user_email: str) -> bool:
    allowed = env.org_creators  # parsed list, or None if not set
    if allowed is None:
        return True
    return user_email in allowed
```

No database calls, no async, no Stripe dependency.

### Where it is enforced

There are two user-facing org creation paths:

**1. Signup auto-creation** (`create_accounts()` in `commoners.py`)

When a new user signs up, an org is auto-created for them. With the restriction:
- `AGENTA_ORG_CREATORS` not set → auto-create org (current behavior)
- Set, user in list → auto-create org
- Set, user NOT in list → create user account but skip org creation. User must be invited.

**2. Explicit org creation** (`POST /organizations/`)

Any authenticated user can call this to create an org. With the restriction:
- `AGENTA_ORG_CREATORS` not set → allow (current behavior)
- Set, user in list → allow
- Set, user NOT in list → HTTP 403

**Admin endpoints** (`POST /admin/account`, `POST /admin/accounts`) are internal and bypass this restriction.

### UX for users who cannot create orgs

When a user signs up but is not in the creator list:
- User account is created successfully (they can log in)
- No org/workspace/project is created
- They see a "you need an invitation" state in the UI
- An org creator invites them via the existing invitation flow

This requires a frontend change: handle the "user has no orgs" state gracefully instead of assuming every user has at least one org.

## What does NOT change

- Cloud behavior: `AGENTA_ORG_CREATORS` not set → current behavior.
- Invitation flow: unchanged. Org owners/admins can still invite users.
- RBAC: unchanged. Roles and permissions within orgs are not affected.
- Billing/Stripe: this restriction is completely independent of billing.

## Configuration

Typical self-hosted setup:

```bash
AGENTA_ORG_CREATORS=admin@company.com
```

Only `admin@company.com` can create orgs. All other users sign up and wait for an invitation.

For cloud or unrestricted deployments, simply don't set the variable.
