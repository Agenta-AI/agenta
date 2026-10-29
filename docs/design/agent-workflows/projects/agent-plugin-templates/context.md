# Context

## Current experience

The existing template action creates an agent and starts a builder conversation using a template playbook. PR #6395 added required connections and alternative providers. `/m` is the new default application on both desktop and phone screens. Its connection card appears inside the session. The older web application has a separate pre-create flow.

Keep these screens and interactions unchanged. The problem to solve is how the template content loads, not how the user opens a template.

## First version

The loading service resolves an internal template source by default. It reads one agent's name, description, permanent instructions, skills, files, and connection declarations from an Agent Plugin package. It creates ordinary resources through existing services and uses the current model-selection logic.

The first message includes setup instructions and remaining work, such as connecting a missing account or configuring an automation. The agent already has access to its saved configuration and build-kit tools. It continues setup in the normal conversation.

The loading feature ends when that first message is accepted. It does not track whether the agent has finished all setup, introduce a new readiness status, or block future runs through a template lifecycle.

## Deferred work

Multi-agent loading is specified separately and marked NOT IMPLEMENTED. A future general tool for creating and editing agents can let an entry agent configure children. Repository/archive source adapters, marketplace UI, automatic updates, and new template-opening screens are also outside the first version.

## MCP baseline

Use the v0.119 MCP gateway and its existing HTTP/gateway configuration and OAuth/API-key/no-auth flows. The earlier plan's direct-HTTP/header-only model was incomplete. Verified transport support and authentication support are separate concerns; see [research](research.md) for precise limits.
