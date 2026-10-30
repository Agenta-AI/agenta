## ADDED Requirements

### Requirement: Plugin gateway route
The MCP gateway SHALL serve each plugin at `/gateways/mcps/builtin/plugin/{plugin_slug}` and answer `initialize`, `tools/list` and `tools/call` without dialing an upstream, after the same `USE_MCP_ENDPOINTS` authorization and usage recording as other built-in providers.

#### Scenario: Listing tools
- **WHEN** an MCP client sends `tools/list` to `/gateways/mcps/builtin/plugin/linear-triage`
- **THEN** the result lists one tool per manifest operation, with its description and input schema

#### Scenario: Slug that is not a plugin
- **WHEN** the slug names a workflow whose latest revision is not a plugin, or no workflow
- **THEN** the gateway answers endpoint not found, for `tools/list` and for `tools/call` alike

#### Scenario: Unknown tool name
- **WHEN** `tools/call` names a tool that is not a manifest operation
- **THEN** the gateway answers with a JSON-RPC error and does not start a run

### Requirement: Calls run as a child run
`tools/call` on a plugin route SHALL invoke the plugin workflow with inputs `{operation, args}` through the existing workflow tool call path, pinned to the checked revision (call ref `workflow.variant.{slug}.{version}`), so the child run keeps the caller's principal, and SHALL mark a failed run as an MCP result with `isError: true`.

#### Scenario: Agent calls an operation
- **WHEN** an agent run calls tool `my_open_issues` on the plugin route
- **THEN** the plugin workflow runs as a child of that run with the same principal, and the tool result is the operation's JSON output

### Requirement: Agents link plugins as MCP servers
The agent SDK SHALL accept a gateway MCP connection with `namespace = "builtin"`, `provider = "plugin"` and a `slug`, and resolve it to `/gateways/mcps/builtin/plugin/{slug}`.

#### Scenario: Agent config with a plugin
- **WHEN** an agent's `mcps` has `{"name": "linear-triage", "connection": {"type": "gateway", "namespace": "builtin", "provider": "plugin", "slug": "linear-triage"}}`
- **THEN** the agent sees the plugin's operations as tools of server `linear-triage`

#### Scenario: Agent rules apply
- **WHEN** the agent's policy sets `ask` for tool `bulk_label` on that server
- **THEN** the turn pauses for approval before the plugin runs, as for any MCP tool

#### Scenario: Slug on other built-in providers
- **WHEN** a built-in connection names a provider other than `plugin` together with a slug
- **THEN** validation still fails, as today
