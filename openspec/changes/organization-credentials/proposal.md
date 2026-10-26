# Organization credentials (M5)

## Why

A company with ten projects pastes the same OpenAI key ten times, and edits ten rows when the key rotates. This is the most common credential request from teams (RFC story 8).

## What Changes

- Organization owners and admins manage organization LLM connections of two kinds: `provider_key` and `custom_provider` (Azure, Vertex, custom base URLs). Bedrock is refused because the LLM gateway does not serve it.
- An admin chooses which projects may use each connection: all projects (the default for a new connection) or, in EE, selected projects. OSS runs the same code but refuses the limit setting.
- An agent uses exactly the connection it picked, by scope and name: a project connection, or an organization connection. Nothing is inherited or overridden automatically. A project connection and an organization connection with the same name are two separate connections. See CONTRACT.md section 8.
- An agent with no connection keeps today's behavior: the project's default for the provider. No data is backfilled.
- Every save path and the template default write an explicit connection. On the cloud, an agent saved with a `self_managed` connection must name a subscription connection.
- Organization connection values never leave the API. Runs use them only through the LLM gateway. Paths that deliver plaintext values (the SDK vault fallback, the legacy vault middleware) never receive them.
- Project members see the organization connections their project may use (name, provider, status) in the project connection list, never their values, and may test one as saved.
- A new organization-scoped access decision guards management. It accepts only a human in a browser session, never an API key or a run credential. Project RBAC shortcuts, including the EE no-RBAC bypass, do not apply to it.

## Non-goals

- User-owned credentials and exact bindings (M7).
- Organization-owned `custom_secret`, MCP servers, MCP OAuth grants, Composio connections, webhook and channel secrets.
- Moving existing project credentials to the organization.
- Organization credentials for legacy completion and chat apps, which receive plaintext keys.
- The "needs configuration" state for a connection an agent names but that does not exist where it runs. A typed error is returned now; the UI state is designed separately.
