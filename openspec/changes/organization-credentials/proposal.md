# Organization credentials (M5)

## Why

A company with ten projects pastes the same OpenAI key ten times, and edits ten rows when the key rotates. This is the most common credential request from teams (RFC story 8).

## What Changes

- Organization owners and admins manage organization LLM credentials of two kinds: `provider_key` and `custom_provider` (Azure, Vertex, custom base URLs). Bedrock is refused because the LLM gateway does not serve it.
- Every project inherits them. A project overrides one by creating its own credential with the same slug and kind.
- A slug reference resolves project first, then organization. With no name, the project's own credentials for the provider win. See CONTRACT.md section 8.
- EE only: an organization admin limits a credential to selected projects. OSS runs the same code but refuses the limit setting.
- Organization credential values never leave the API. Runs use them only through the LLM gateway. Paths that deliver plaintext values (the SDK vault fallback, the legacy vault middleware) never receive them. A deployment with the gateway switched off cannot use organization credentials.
- Project members see inherited credentials (name, provider, status) in the project credential list, never their values.
- A new organization-scoped access decision guards management. It accepts only a human in a browser session, never an API key or a run credential. Project RBAC shortcuts, including the EE no-RBAC bypass, do not apply to it.

## Non-goals

- User-owned credentials and exact bindings (M7).
- Organization subscription logins. They are not supported (CONTRACT.md section 8). User-owned logins are M7.
- Organization-owned `custom_secret`, MCP servers, MCP OAuth grants, Composio connections, webhook and channel secrets.
- Moving existing project credentials to the organization.
- Organization credentials for legacy completion and chat apps, which receive plaintext keys.
