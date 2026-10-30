## Context

All references are to `release/v0.127.3` at commit `f2a635c`. The cited files are unchanged at `555448bc`, the branch head on 2026-10-30.

### What exists today

- **Workflow kinds are URIs.** A workflow revision stores `uri`, `runtime`, `script`, `schemas` and `parameters` (`sdks/python/agenta/sdk/models/workflows.py:145`). Managed URIs map to a services mount path `/{key}/{version}` (`sdks/python/agenta/sdk/engines/running/utils.py:586`). Each `(kind, key)` must be listed in `_AGENTA_ROLE_TABLE` (`utils.py:607`), and flags such as `is_agent` and `is_code` are derived from the URI key (`utils.py:735`, `utils.py:738`). The API stores the same flags on the revision (`api/oss/src/core/workflows/dtos.py:145`, query flags at `dtos.py:182`).
- **User code runs only in an evaluator shape.** `code_v0` (`handlers.py:2812`) runs `evaluate(inputs, outputs, trace)` through `run_code_safely` (`sandbox.py:172`). The local runner runs Python only (`runners/local.py:45`). The Daytona runner creates one ephemeral sandbox per run and passes `AGENTA_API_URL` and `AGENTA_CREDENTIALS` into it (`runners/daytona.py:338`, `:363`). That credential is the caller's, re-minted without grants, and works on the whole API. JavaScript templates exist for evaluators (`templates.py`), and they are synchronous.
- **Services mount one service app per handler.** For example `custom_code_app` wraps `code_v0` with URI `agenta:custom:code:v0` (`services/oss/src/managed.py:45`) and is mounted at `/code/v0` (`services/entrypoints/main.py:209`).
- **The MCP gateway has built-in providers that dial no upstream.** `/gateways/mcps/builtin/{provider}/{rest}` splits `rest` into a name (`api/oss/src/apis/fastapi/gateways/mcps/utils.py:66`). The relay resolves the target (`api/oss/src/core/gateways/mcps/service.py:977`), checks the allowlist, authorizes `USE_MCP_ENDPOINTS`, and for `provider == "agenta"` hands the request to `AgentaMCPAdapter` (`service.py:830`), which answers `initialize`, `tools/list` and `tools/call` and dispatches calls through `ToolsRouter.call_tool` (`api/oss/src/core/gateways/mcps/providers/agenta/adapter.py`).
- **An agent can already call a workflow as a child run.** `ToolsRouter.call_tool` (`api/oss/src/apis/fastapi/tools/router.py:1421`) sends call refs that start with `workflow.` to the workflow dispatcher (`router.py:1446`, prefix at `router.py:123`), which turns `workflow.variant.{slug}` into a `WorkflowServiceRequest`, builds a child run envelope with the same principal (`router.py:1944`), admits it, and calls `WorkflowsService.invoke_workflow`.
- **Agent MCP entries name gateway routes.** `MCPGatewayConnection` allows `builtin` and `standard` with a provider only, and `custom` with a slug only (`sdks/python/agenta/sdk/agents/mcp/models.py:66`, `:82`). The built-in route is `/builtin/{provider}/{provider}`, or `/builtin/agenta/run` (`sdks/python/agenta/sdk/agents/mcp/resolver.py:30`).
- **The active web app is `web/mobile`.** It is served at `/m` with the Pages Router; `web/oss` is abandoned (`web/mobile/AGENTS.md`). Navigation items live in `web/mobile/src/features/nav/useMobileNavItems.tsx` (Agents at about line 222). The Agents list is `web/mobile/src/features/agents/AgentListScreen.tsx` over the shared `ListTable` (`@agenta/ui/list-table`). Route shells live in `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/`; `/apps` there is the Home screen. Agent rows are classified by the latest revision's `flags.is_agent` (`web/packages/agenta-entities/src/workflow/api/api.ts:1345`).
- **The browser already invokes workflows on the services.** `invocationUrlAtomFamily` builds `{serviceUrl}/invoke` from a workflow's URI (`web/packages/agenta-entities/src/workflow/state/runnableSetup.ts:246`). The services resolver loads the stored revision when the request carries a reference and no inline configuration (`sdks/python/agenta/sdk/middlewares/running/resolver.py:640`). A request that asks for an event stream from a batch handler gets 406 (`sdks/python/agenta/sdk/decorators/routing.py:502`).
- **The drive HTML app frame already isolates a page.** `buildRunFrame(appHtml)` wraps the plugin in a nested frame with `frame-src 'none'`, so the plugin cannot navigate away, and forwards the bridge port once (`web/packages/agenta-entities/src/drive/htmlApp/frame.ts:126`). The file bridge on top of it serves only file methods (`protocol.ts:44`).
- **Version "3" results are almost any JSON.** The runner rejects `None` and turns numbers into floats (`sdks/python/agenta/sdk/engines/running/runners/base.py:49`).
- **Timeouts.** The code sandbox defaults to 45 seconds plus queue wait (`runners/base.py:9`); the agent's MCP client budgets about 30 seconds per gateway call (`services/runner/src/extensions/pi-mcp.ts:85`).

### Principal and actor

The principal is the identity whose permissions apply (`RunAuthority.principal`: a human, an API key, or an installation). The actor is who triggered the call. In this POC:

- On the plugin page, the actor and the principal are the signed-in viewer.
- From an agent, the actor is the agent turn and the principal is the run's principal, carried into the child run unchanged.
- The plugin has no permissions of its own. Every MCP call the plugin makes is checked by the gateway against the principal.

### Naming

The feature is called **plugins** (decided by Mahmoud, 2026-10-30). A plugin can include tools, a backend, and UIs that both agents and people use. Code names follow the product name: `agenta:custom:plugin:v0`, `is_plugin`, `plugin_v0`, the gateway provider `plugin`, and the web route `/plugins`. "Plugin" already appears in the code for editor plugins (`web/packages/agenta-ui/src/Editor`) and for the Codex harness's own plugins (`services/runner/src/engines/sandbox_agent/codex-assets.ts`); neither is a route, a flag or a workflow kind, so nothing collides. "HTML app" below still means the existing drive page feature.

## Goals / Non-Goals

**Goals**

- A plugin page that a person opens from the sidebar and uses.
- The same plugin callable by an agent as an MCP server, under the agent's allow, ask and deny rules.
- Plugin code that calls MCP servers the principal can use, through the gateway.
- Layers that a real build keeps: a workflow kind, a handler, a gateway provider, an agent link, a page.

**Non-Goals**

- Creating or editing plugins from the UI or from build-kit tools. A seed script creates the demo plugin.
- A UI to link a plugin to an agent. The link is a configuration entry.
- Plugin state, schedules, webhooks.
- A workerd runner, a narrower plugin credential, enforcing declared MCP servers at the gateway.
- Approvals inside the plugin or on the page.
- Hiding provider keys from plugin code.

## Decisions

### D1. What a plugin is in storage

| Option | Trade-off |
| --- | --- |
| **New URI `agenta:custom:plugin:v0` with flag `is_plugin`** | Small, explicit, versioned like every workflow. Needs one role-table entry and one new flag. |
| Reuse `agenta:custom:code:v0` with a marker in parameters | No new kind, but code workflows are evaluator-shaped and listed as evaluators; telling plugins apart needs parameter inspection everywhere. |
| Files in the drive | Easy to edit, but no versions, no invoke path, no references. |

Role table entry: `("custom", "plugin"): (True, False, False)`. A plugin is an application, not an evaluator or snippet.

### D2. Where the manifest lives

| Option | Trade-off |
| --- | --- |
| **`parameters.plugin` in the revision** | One place, versioned with the code, readable by the API without running code. Names are written twice (manifest and code), and the handler refuses an operation without code. |
| Derive from code by a "declare" run (Executor's design) | No duplication, but needs a sandbox run at commit time. |
| A separate artifact | Two things to keep in sync. |

Manifest shape (one page today; `ui` can become a list of pages later without changing the other parts):

```json
{
  "operations": [
    {"name": "my_open_issues", "description": "...", "input_schema": {"type": "object"}}
  ],
  "mcps": [
    {"name": "linear", "connection": {"type": "gateway", "namespace": "custom", "slug": "linear"}}
  ],
  "ui": {"html": "<!doctype html>..."}
}
```

`mcps[].connection` uses the same shape as an agent's gateway connection, so later work can check it against the creator's permissions and narrow the token to it.

### D3. Where plugin code runs

| Option | Trade-off |
| --- | --- |
| **Daytona runner with a new async JavaScript template** | Exists, isolated, already passes the credential. Seconds of start-up per call. Needs Daytona. |
| Local runner | No isolation, Python only today. |
| New workerd runner | Fast and self-hostable, but a new runtime to build. Deferred; the template contract below is what it would implement. |

No extra runner check: the local runner already refuses non-Python code (`runners/local.py:45`) and the restricted runner runs Python only, so plugin code fails with their error.

Template contract: the code defines `const operations = { name: async (args, ctx) => result }`. The handler passes `params.inputs = {operation, args, mcps: {name: url}}`, with gateway URLs already resolved in Python. The template builds `ctx`, awaits the handler, and prints `{"result": {"value": ...}}` on the last line. The wrapper object keeps `null` and integers intact through version `"3"`; `plugin_v0` unwraps `value`.

### D4. How plugin code reaches MCP servers

| Option | Trade-off |
| --- | --- |
| **`ctx.mcp(name).call(tool, args)` for names declared in `parameters.plugin.mcps`** | One helper, declared names only, every call goes through the gateway relay and its checks and logs. |
| Raw gateway URLs in code | Works, but the declaration becomes decoration. |
| Direct upstream calls | Bypasses the vault and the gateway. Rejected. |

The helper speaks MCP Streamable HTTP over POST only, because the gateway refuses GET and DELETE and buffers responses (`api/oss/src/apis/fastapi/gateways/mcps/proxy.py:253`): `initialize`, keep the `mcp-session-id` header and the negotiated protocol version (sent back as `mcp-protocol-version`), send `notifications/initialized` and accept an empty answer, then `tools/call`. It reads a JSON body or a finite `text/event-stream` body, matches the response id, and throws on a JSON-RPC error or a result with `isError`. It follows the contract of the API's own MCP client (`api/oss/src/core/managed_tools/providers/mcp.py:105`). It sends the credential as `X-AG-Credentials` and keeps one session per server for the rest of the operation.

The handler resolves each declared connection to its gateway URL with the SDK's `MCPGatewayConnection` model and `_gateway_mcp_route` (`sdks/python/agenta/sdk/agents/mcp/resolver.py:30`) before the sandbox starts, so routing rules live in one place.

### D5. Which credential plugin code holds

| Option | Trade-off |
| --- | --- |
| **v1: the existing Daytona sandbox credential (`AGENTA_CREDENTIALS`)** | No new work. Works on the whole Agenta API as the principal. Mahmoud's call for the first version. |
| Gateway-audience token from `POST /gateways/credentials` | Same as the agent sandbox; refused outside gateway routes. Follow-up task. |

### D6. How an agent sees a plugin

| Option | Trade-off |
| --- | --- |
| **Built-in gateway provider `plugin` at `/gateways/mcps/builtin/plugin/{slug}`** | Reuses the built-in route, auth, policy and logging. To the agent and the runner, a plugin is one more MCP server. |
| One `reference` tool per operation | Subagent style, but one entry per operation and no MCP view. |
| New namespace `/gateways/mcps/plugin/{slug}` | Cleaner URL, but changes the data-plane path rule in the auth middleware. |

### D7. How the gateway dispatches a plugin call

| Option | Trade-off |
| --- | --- |
| **`ToolsRouter.call_tool` with call ref `workflow.variant.{slug}` and arguments `{operation, args}`** | Same child-run path as workflow tools: same principal, admission, tracing. Mirrors `AgentaMCPAdapter`. |
| Call `WorkflowsService.invoke_workflow` directly | Skips child-run admission and envelope handling, which we would then copy. |

One resolver serves both `tools/list` and `tools/call`: it reads the latest revision of the workflow with that slug, refuses it unless `flags.is_plugin`, and returns `parameters.plugin.operations` with the revision version. `tools/call` pins that version in the call ref (`workflow.variant.{slug}.{version}`), so the run uses the revision that was checked. `tools/call` also refuses a name that is not an operation. A failed tool result (`ToolResult.status` is an error) becomes an MCP result with `isError: true`. Authorization, usage recording and error handling stay in `MCPGatewayService.relay`, which also records a failure when the adapter raises; the adapter only speaks JSON-RPC.

### D8. How an agent links a plugin

| Option | Trade-off |
| --- | --- |
| **An ordinary `mcps` entry with `{namespace: "builtin", provider: "plugin", slug}`** | No new config field. The runner and permission rules work unchanged. Needs one validator change. |
| A new `plugins` field that compiles to `mcps` | Nicer for a future UI, but a second way to say the same thing. Can be added later on top of this. |

### D9. How the page calls the plugin

| Option | Trade-off |
| --- | --- |
| **Reuse the drive frame wrapper (`buildRunFrame`) with a new one-method plugin stub; the parent calls the services `/invoke` as the viewer** | Keeps the navigation guard and one-time port hand-off we already have. No file grants. |
| A bare sandboxed iframe with a new bridge | Re-solves navigation and port hand-off. |
| Extend the drive HTML app host | Brings file grants and access menus the POC does not need. |
| A new API route for page calls | One more route that only forwards to invoke. |

Invoke contract for the page: `POST {invocationUrl}?project_id={projectId}`, where `invocationUrl` is `invocationUrlAtomFamily(workflowId)` (already ending in `/invoke`), with the viewer's normal API auth, `Accept: application/json`, and body `{"references": {"workflow_revision": {"id": <displayed revision id>}}, "data": {"inputs": {"operation": ..., "args": ...}}}`. No inline configuration, so the service loads the stored script and manifest. The bridge resolves with `data.outputs` and rejects with the status message on failure. The page keeps `RUN_CSP` as is: it may fetch `https:` URLs, but it holds no Agenta credential, so its only way to act in Agenta is the bridge.

### D10. How the web lists plugins

| Option | Trade-off |
| --- | --- |
| **List workflows, fetch their latest revisions by `workflow_refs` with grouping, keep `flags.is_plugin`** | Same two-step pattern the agent classification uses (`api.ts:1345`). The API rejects a flag filter combined with grouping, so the filter runs on the client. |
| One revision query with `flags.is_plugin` and grouping | One call, but refused by the request validators today. |

Rule for the POC: a plugin workflow never changes kind. Plugins are not agents (`is_agent` is false), so they stay out of agent lists.

### D11. Web route and screens

In `web/mobile`, `/apps` is the Home screen. Plugins use `/plugins` and `/plugins/{workflow_id}`, with the navigation label "Plugins" right after Agents. The list reuses the shared `ListTable` frame the Agents list uses, with columns Plugin, Created by and Last changed, and no actions besides opening a row. It does not import the agent list's controllers (activity, waiting state, creation, rename, archive).

### D12. Creator check in the seed path

The settled model says the creator's permissions decide which MCP servers a plugin may include. With programmatic creation, the seed script enforces it: before it commits the plugin, it opens each declared connection through the gateway (`initialize` and `tools/list`) with the creator's credential and stops if any fails. The gateway does not enforce declarations in this POC.

## Risks / Trade-offs

| Risk | Why it matters | How we check it |
| --- | --- | --- |
| R1. The principal is lost along the chain | Agent run, gateway plugin route, child workflow run, Daytona sandbox, gateway relay. A wrong identity anywhere breaks the model. | Spike the last hop first (sandbox to gateway). Then build the backend slice and run one real agent-to-plugin-to-Linear call before any UI work; compare the user on the Linear relay record with the agent run's principal. |
| R2. The child-run path refuses the gateway credential | `AgentaMCPAdapter` proves `call_tool` works with the gateway-audience token, but only for refs carried in the token. | Call `tools/call` on the plugin route from a real agent turn. |
| R3. Linear MCP needs a session | Streamable HTTP servers can require `initialize` and `mcp-session-id`, and may answer with SSE. | The helper handles both; test against the real Linear endpoint. |
| R4. Latency and timeouts | One Daytona sandbox per call. The agent's MCP client gives a call about 30 seconds; the sandbox allows 45 plus queue wait, so a run can finish after the agent gave up. | Time `my_open_issues` from the page and from the agent, warm and cold. Documented limit: an operation should finish within the agent's MCP budget; a timed-out write may still complete, so never retry it automatically. Above about 3 seconds warm is the case for workerd. |
| R5. Node in the snapshot | The template needs `fetch` (Node 18 or later). | Print `process.version` in the first spike. |
| R6. Plugin code holds a broad credential | v1 reuses the general sandbox credential. | Accepted for the POC. Follow-up task switches to the gateway-only token. |
| R7. Declared servers are not enforced | Code could call `fetch` on any gateway URL. Today this grants nothing extra, because connections are project-wide. | Documented limit. |
| R8. Different principals see different results | Viewer lacks `USE_MCP_ENDPOINTS`; annotator and above have it. | Open the page as a viewer and as an annotator. Expect a clear refusal for the viewer. |

## Migration

None. The change adds a URI key, a flag that defaults to false, a provider, routes and pages. No data changes. Rolling back removes the new code; existing workflows are untouched. Plugins created by the seed script remain as ordinary workflows with an unknown URI key, so roll back the seed too.
