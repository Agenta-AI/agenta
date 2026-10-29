# WP36 — Composio brokered MCP data plane

Composio catalogue browsing and project connection management are implemented, but a connected
Composio MCP endpoint cannot relay traffic: the gateway selects a `composio` upstream adapter that
does not exist. This package completes the brokered builtin provider.

## Scope

- Implement and register `ComposioMCPAdapter` for a project’s active Composio connection.
- Resolve the connection’s brokered MCP endpoint and use the broker-owned authorization model;
  do not copy a Composio or user upstream secret into the agent, runner, or general vault path.
- Relay Streamable HTTP MCP traffic, preserve JSON-RPC responses, and map broker authentication,
  disconnected-account, and upstream failures to the gateway error contract.
- Keep this package strictly to `builtin`: it uses the deployment's `COMPOSIO_API_KEY` and an
  Agenta-managed Composio project. Project-owned Composio developer keys are the separate
  `standard` mode in WP38; never silently fall back between the two.

## Required verification

- **Unit:** adapter registration, connection-state handling, endpoint construction, headers, and
  failure mapping with a Composio transport fake.
- **Integration:** a connected-account fixture reaches `tools/list` and `tools/call`; inactive or
  invalid connections fail before any broker request.
- **Acceptance:** a local Composio-compatible broker double proves a builtin Composio tool call
  in OSS and EE without real Composio credentials.

## Done when

A connected Composio builtin MCP endpoint performs a real gateway relay through a registered
adapter using the deployment credential only.
