# Doc-1: Documentation Changes for Org Creation Restriction

Draft of documentation changes needed after RFC-1 is implemented.

## New content needed

### Env Var Reference Updates

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTA_ORG_CREATION_ALLOWLIST` | Comma-separated list of emails allowed to create organizations. If not set, any user can create orgs. | Not set (open) |

### Self-Hosted Deployment Guide Updates

- Add section on restricting org creation
- Example config for single-admin setup: `AGENTA_ORG_CREATION_ALLOWLIST=admin@company.com`
- Explain what happens to users not in the list (account created, must be invited)
- Explain that this works independently of billing/Stripe

### Important: Pre-invite restricted users

> **Warning:** When using `AGENTA_ORG_CREATION_ALLOWLIST`, restricted users who sign
> up without a pending invitation will not be able to use the app (the frontend does
> not currently support "signed in, zero orgs").
>
> Always invite users before they sign up (using the invitation flow in organization settings).

### Example configuration

```bash
AGENTA_ORG_CREATION_ALLOWLIST=admin@company.com
```
Only `admin@company.com` can create orgs. All other users must be invited before signing up.

### Existing docs to update

- EE configuration reference: add `AGENTA_ORG_CREATION_ALLOWLIST`
- Organization management docs: mention the restriction mechanism
- Note the known frontend limitation and recommend pairing with auto-join or pre-invite
