# Doc-1: Documentation Changes for Org Creation Restriction

Draft of documentation changes needed after RFC-1 is implemented.

## New content needed

### Env Var Reference Updates

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTA_ORG_CREATORS` | Comma-separated list of emails allowed to create organizations. If not set, any user can create orgs. | Not set (open) |

### Self-Hosted Deployment Guide Updates

- Add section on restricting org creation
- Example config for single-admin setup: `AGENTA_ORG_CREATORS=admin@company.com`
- Explain what happens to users not in the list (account created, must be invited)
- Explain that this works independently of billing/Stripe

### Existing docs to update

- EE configuration reference: add `AGENTA_ORG_CREATORS`
- Organization management docs: mention the restriction mechanism
