# WP38 — Project-key Composio standard MCP

Composio has two credential modes. WP36 covers the platform-managed Composio account under
`builtin`. This package covers a project supplying its own Composio developer API key, which is a
`standard` provider and must be isolated from the deployment credential.

## Scope

- Add a standard-Composio endpoint that is visible only when the project has a resolvable
  `provider_key=composio` secret.
- Use that project secret for all Composio catalogue, connection, and MCP data-plane requests for
  the selected standard endpoint. Never read or fall back to `COMPOSIO_API_KEY`.
- Define how its connected-account IDs and callback URLs are scoped to the project and Composio
  account. The agent and runner receive only an Agenta gateway URL and short-lived gateway token.
- Reuse protocol-compatible MCP relay behavior from WP35; preserve JSON-RPC bodies and errors.
- Keep third-party account credentials in Composio's hosted connection flow. The project Composio
  developer key remains vault-resolved and never reaches the runner or agent.

## Required verification

- **Unit:** standard endpoint visibility, project-key resolution, strict no-fallback to the
  deployment key, and gateway credential redaction.
- **Integration:** two projects with different Composio keys cannot list, connect, or invoke each
  other's accounts; a missing project key is refused before an external request.
- **Acceptance:** a local Composio-compatible broker double proves `tools/list` and `tools/call`
  through standard Composio in OSS and EE, including a negative deployment-key fallback case.

## Done when

A project can use its own Composio account through `standard/composio` without consuming or
depending on the deployment's Composio account.
