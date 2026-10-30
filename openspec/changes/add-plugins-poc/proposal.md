## Why

Agenta agents can call MCP servers through the gateway, but people cannot package their own logic on top of those servers. Today, logic that combines tools (for example "read my Linear issues, score them, and label the urgent ones") lives only in an agent's instructions, and it has no page a person can open.

This change is a proof of concept for **plugins**. A plugin can include three things, and both agents and people use the same plugin:

- **Tools:** named operations. An agent sees them as tools of an MCP server; a person triggers them from the plugin's page.
- **A backend:** JavaScript code that implements the tools. It calls MCP servers through the gateway, as the principal who triggered the call.
- **UIs:** pages a person opens in Agenta. They call the plugin's tools.

The POC builds the smallest version of each part: one backend, a few tools, and one page. The model allows more later, such as several pages per plugin or a plugin with tools and no page. The goal is to learn where the hard parts are, with an architecture we can extend instead of throwing away.

Status: implementation authorized by Mahmoud. Work in progress.

## What Changes

- New workflow kind `agenta:custom:plugin:v0` with a derived flag `is_plugin`. The revision holds the code (`script`, `runtime: javascript`) and a manifest under `parameters.plugin`: operations, declared MCP servers, and the page HTML.
- New services handler `plugin_v0`, mounted at `/plugin/v0`. It runs one named operation in the existing Daytona code runner with a new JavaScript template. The template gives the code a small `ctx.mcp(name).call(tool, args)` helper that calls the gateway with the run's credential. Gateway URLs for the declared servers are resolved in Python before the sandbox starts.
- New built-in MCP gateway provider `plugin`, served at `/gateways/mcps/builtin/plugin/{plugin_slug}`. `tools/list` returns the plugin's operations. `tools/call` invokes the plugin workflow as a child run, through the same path an agent uses to call a workflow tool today.
- The agent SDK accepts a gateway MCP connection `{namespace: "builtin", provider: "plugin", slug: <plugin_slug>}`. An agent links a plugin by an ordinary `mcps` entry, so the runner's allow, ask and deny rules apply to plugin operations unchanged.
- Web (`web/mobile`, the active app): a "Plugins" navigation item after Agents, a list screen in the same list frame as Agents, and a plugin screen that shows the plugin's HTML in the existing sandboxed frame wrapper. The page calls operations through one bridge method, `agenta.plugin.call(op, args)`, as the signed-in viewer.
- A seed script creates the demo plugin ("Linear triage"), checks that its creator can open each declared MCP server, and links it to one agent. There is no creation UI and no configuration UI.

Not in this change: build-kit tools, an editor or config UI, plugin state, a workerd runner, a narrower plugin credential, approvals inside the plugin, hiding secrets from plugin code, and per-user connections.

## Capabilities

### New Capabilities

- `plugin-definition`: what a plugin is, how it is stored, and how it is told apart from agents and prompts.
- `plugin-execution`: how one operation runs, which credential it holds, and how its code reaches MCP servers.
- `plugin-mcp-exposure`: how an agent sees and calls a plugin as an MCP server.
- `plugins-ui`: the sidebar entry, the list page, and the plugin page with its bridge.

### Modified Capabilities

- None as formal specs. The change extends code paths without changing their current behavior: the workflow flag set, the gateway built-in providers, and the SDK gateway connection rules.

## Impact

- SDK (`sdks/python`): URI role table, flag inference, revision flags model, a new handler and template, gateway connection validation and route building.
- Services (`services`): one new mounted handler.
- API (`api`): revision flags DTO, MCP gateway service and a new provider adapter.
- Web (`web/mobile` and `web/packages`): one navigation item, two route shells, a `plugins` feature folder, a small bridge stub, and the `is_plugin` flag in the workflow schema.
- Deployment: plugin operations need the Daytona runner (`AGENTA_SERVICES_CODE_SANDBOX_RUNNER=daytona`) and a snapshot with Node 18 or later (for `fetch`).
- Security posture for this POC: plugin code holds the same credential the Daytona code runner already passes to evaluator code, which works on the whole Agenta API as the principal. A follow-up switches it to the gateway-only token.
