# Personal credentials and connection bindings (M7)

## Why

Every credential belongs to a project or, after M5, to the organization. When Bob uses a shared agent, the agent cannot act with Bob's own Gmail, Claude login, or MCP account. `SecretMode.USER_REQUIRED` reads the project secret, and `SecretMode.USER_OPTIONAL` is a fallback.

Agenta is multiplayer. An agent that a team shares must be able to act as each person who uses it, or as the project's shared account, and the builder must choose which one for each item.

## What Changes

The owner decided the scope on 2026-10-26. M7 can ship in one step or in several steps. This change specifies the first step and names the later steps.

- MCP servers, Composio connections and custom secrets each belong to a person or to a project. For each agent and each such item, the builder picks "Each person's own account" or "The project's shared account".
- Add the user owner (CONTRACT.md section 8) for provider keys, subscription logins, Composio connections, MCP servers, and MCP OAuth grants for a project's server. A user-owned credential is valid in every project of its organization where its owner runs. Only the owner sees, uses and manages it.
- Personal MCP servers are in M7. A person adds an MCP server for their own use.
- Personal subscription logins are in M7. Organization subscription logins ship in M5 (`organization-credentials`), not here.
- Give every agent connection an explicit binding. The first step offers two bindings: `caller_account` ("Each person's own account") and `project_default` ("The project's shared account"). Remove `SecretMode`. No binding falls back to another account.
- `caller_account` uses the human behind the run principal. A run without a human (a service account, including a Slack installation) is refused on a `caller_account` connection in the first step.
- Sign the bindings into the run credential.
- Apply the shared-session rule of CONTRACT.md section 8.
- Refuse a channel binding when the agent has a `caller_account` connection.
- Show per turn which account each connection used.
- Add the edit rule for durable work (CONTRACT.md sections 5 and 6): only the person a schedule, subscription or evaluation run runs as may change what it runs.
- Delete a user's personal credentials when the user leaves the organization.
- EE: an organization policy can forbid personal credentials.

## Later steps

- Personal and organization custom secrets. They wait for hidden secrets: the sandbox gets a placeholder, and the real value is added outside the sandbox. Project custom secrets keep today's behavior until then.
- The `specific` binding ("One fixed account"). It is not in the first step.
- Organization-owned MCP servers, Composio connections and custom secrets. Only if they are easy to add; they are not required.

## Capabilities

### New Capabilities

- `personal-credentials`: user-owned credentials, personal MCP servers, privacy, lifecycle, EE policy.
- `connection-bindings`: bindings, the caller rule, signed claims.
- `personal-credential-sessions`: the shared-session guard, the sticky mark, the installation check, the per-turn record.
- `durable-work-edits`: who may change what a schedule, subscription or evaluation run executes.

### Modified Capabilities

None. M2, M3, M5 and M6 are not archived.

## Non-goals

- Agent-owned accounts (a switch that makes the agent run with a pinned account for everyone).
- Tool settings per role.
- Hosted MCP servers.
- User-owned custom providers.
- More than one personal account per service per user in one organization.
- Composio event triggers on user-owned connections.
- Per-turn credential switching in a shared session.
