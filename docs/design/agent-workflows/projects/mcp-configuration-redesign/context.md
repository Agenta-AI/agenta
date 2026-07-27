# Context

## Problem

The MCP editor currently exposes a protocol-shaped object rather than a working product. It asks
for `stdio` commands even though the runner rejects them, labels HTTP headers as environment
variables, asks users to type tool names before discovery, and offers no connection status. A
saved remote HTTP server can therefore appear to do nothing.

The public object also mixes four semantic roles:

- endpoint configuration;
- process configuration inherited from stdio;
- credential references;
- authorization policy.

That coupling makes the public agent template expensive to evolve. The planned MCP gateway,
OAuth connections, Pi support, and direct-to-gateway migration should not require moving fields
again.

## Scope

This project covers:

- the public MCP authoring contract in the Python SDK and agent template schema;
- normalization into a private resolved runner contract;
- MCP controls in the agent-template UI;
- deployment and harness capability gating;
- the no-secret remote HTTP path for Claude local and Daytona;
- connection discovery, visible status, and tool-selection enforcement;
- a migration plan for pre-production saved drafts;
- the future seam for gateway execution and connection-backed credentials.

## Out of scope for the first delivery

- accepting user-authored commands or packages;
- hosting arbitrary MCP stdio processes;
- OAuth implementation;
- production enablement;
- Pi execution through the gateway;
- making Daytona Secrets the permanent MCP credential architecture;
- exposing the internal `agenta-tools` MCP as user configuration.

## Product language

Use these names consistently:

- **Agenta tools**: the trusted internal tool channel named `agenta-tools` at runtime. It is not a
  user MCP server.
- **MCP server**: an external server selected by a template author.
- **Remote MCP URL**: the external HTTPS endpoint. Do not make users choose a transport when only
  remote HTTP is supported.
- **Credentials**: an authentication strategy and references to platform-held values. A credential
  is not a raw token field.
- **Tools**: functions discovered from the MCP server through `tools/list`.

## Success criteria

1. No public UI or authoring type offers stdio, command, arguments, or process environment.
2. The internal Daytona stdio shim continues to work independently.
3. A deployment that does not enable user MCP does not show an editable MCP section.
4. A capability-enabled Claude run can prove whether the saved server reached the service,
   runner, ACP session, and Claude MCP client.
5. The UI displays `not_tested`, `connecting`, `connected`, or `error`, with discovered tool count
   and actionable error text.
6. Tool selection is discovered and enforced, not an inert list of user-typed strings.
7. Saved configs contain credential references only. Runtime contracts clearly identify any
   secret-bearing boundary.
8. Moving execution behind the gateway requires an adapter change, not another authoring-schema
   redesign.

