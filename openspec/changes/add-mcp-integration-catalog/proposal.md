# Select MCP integrations from a catalog

Draft for review. Not implemented.

## Why

People currently need to know an MCP server URL before they can connect it. Agenta needs one maintained catalog of known integrations so people can select GitHub or Slack first, while keeping custom servers available.

## What Changes

- Add an Agenta-owned, code-defined MCP integration catalog with stable keys, display metadata, canonical server URLs, and setup documentation links.
- Show a searchable list before the new-connection form and retain **Custom server URL**.
- Resolve selected keys on the backend and reuse the current project endpoint, probe, consent, and agent permission flow.
- Reuse Agenta's catalog/service and gallery conventions without treating direct MCP servers as Composio connections or Skills workflows.
- Keep unconfigured integrations visible. A catalog entry is not proof of a working connection.

## Capabilities

### New Capabilities

- `mcp-integration-catalog`: Maintain, list, select, and safely evolve direct MCP integration definitions.

### Modified Capabilities

- `mcp-connections`: Start new connections with a catalog and preserve the custom URL and reconnect paths.

## Impact

Backend work belongs in the MCP domain with typed catalog data and read routes. Frontend work belongs in `@agenta/entities/mcpEndpoint` and the shared `McpConnectJourney`. Existing settings and agent entry points reuse it.

Depends on `support-registered-mcp-oauth-clients`. Backend catalog and frontend browsing can be separate pull requests. The catalog works with manual application credentials before managed credentials exist. No new provider credentials, scheduler, marketplace, or remote catalog service is required.
