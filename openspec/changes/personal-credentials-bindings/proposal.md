# Personal credentials and connection bindings (M7)

## Why

Every credential belongs to a project or, after M5, to the organization. When Bob uses a shared agent, the agent cannot act with Bob's own Gmail, Claude login, or MCP account. `SecretMode.USER_REQUIRED` reads the project secret, and `SecretMode.USER_OPTIONAL` is a fallback.

## What Changes

- Add the user owner (CONTRACT.md section 8) for provider keys, subscription logins, Composio connections, and MCP OAuth grants for a project's endpoint. A user-owned credential is valid in every project of its organization where its owner runs. Only the owner sees, uses and manages it.
- Give every agent connection an explicit binding: `caller_account`, `project_default`, or `specific`. Remove `SecretMode`. No binding falls back to another account.
- `caller_account` uses the human behind the run principal. A run without a human (a service account, including a Slack installation) uses the connection's agent account, or it is refused.
- Sign the bindings into the run credential.
- Apply the shared-session rule of CONTRACT.md section 8. A Slack channel session can use a project-owned agent account.
- Refuse a channel binding when a `caller_account` connection has no agent account.
- Show per turn which account each connection used.
- Delete a user's personal credentials when the user leaves the organization.
- EE: an organization policy can forbid personal credentials.

## Capabilities

### New Capabilities

- `personal-credentials`: user-owned credentials, privacy, lifecycle, EE policy.
- `connection-bindings`: bindings, the caller rule, agent accounts, signed claims.
- `personal-credential-sessions`: the shared-session guard, the sticky mark, the installation check, the per-turn record.

### Modified Capabilities

None. M2, M3, M5 and M6 are not archived.

## Non-goals

- Organization-owned Composio connections, MCP endpoints, or subscription logins.
- User-owned custom providers and MCP endpoints.
- More than one personal account per service per user in one organization.
- Composio event triggers on user-owned connections.
- Per-turn credential switching in a shared session.
