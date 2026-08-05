> **Historical record.** This is a work-package note. It describes the design as it was at the time and may reference components that no longer exist. For the current design see the [agent-workflows docs](../../README.md); for the live state see [sdk-local-backend/status.md](../sdk-local-backend/status.md).
# WP-7: Runnable tools as agent configuration

Status: Composio MVP implemented. Resolution lives in `api`; the bridge routes Pi tool
calls back through `POST /tools/call`. Builds on WP-2 (agent service) and WP-6 (workflow
type and template). See [Implementation status](#implementation-status-composio-mvp) below.

## Goal

Make runnable tools part of an agent's configuration. Start with Composio actions, and keep
the door open to workflow-as-tool and MCP without reworking the agent path. The agent runs on
the Pi harness, which drives its own multi-turn loop and executes tools in-loop. So the work
is to declare tools in the agent revision config, resolve those declarations into tools Pi can
call, and run each tool call through Agenta's existing tools subsystem.

## What already exists (the key reuse)

Agenta already ships a full, provider-agnostic tools subsystem in `api/oss/src/core/tools/`.
It is not wired to agents yet, but the hard parts are done and verified against the code:

- **Tools are callable from the backend today.** `ToolsService.execute_tool(...)`
  (`api/oss/src/core/tools/service.py:389`) runs a Composio action. It is exposed as
  `POST /tools/call` (`api/oss/src/apis/fastapi/tools/router.py:891`). The endpoint takes an
  OpenAI-style envelope whose `function.name` encodes
  `tools.{provider}.{integration}.{action}.{connection}` (router.py:916), looks up the
  project-scoped connection, checks it is active and valid, and dispatches through the gateway
  using the stored `provider_connection_id` (router.py:1000).
- **Tool auth is settable today, per project.** Composio connections are created via
  `POST /tools/connections/` (signed-state OAuth) and activated via
  `GET /tools/connections/callback` (router.py:173). The `connected_account_id` is stored in
  the `tool_connections` table (`api/oss/src/dbs/postgres/tools/dbes.py:38`), scoped to the
  project, with `is_active` and `is_valid` flags. The Composio API key lives only in the
  backend (`ComposioConfig`, `api/oss/src/utils/env.py`).
- **The gateway is provider-agnostic.** `ToolsGatewayInterface`
  (`api/oss/src/core/tools/interfaces.py:88`) defines `get_action` (line 128) and `execute`
  (line 175). A registry dispatches by `provider_key`. The Composio adapter implements both
  (`providers/composio/adapter.py:122` and `:381`, which POSTs to `/tools/execute/{slug}`).
- **A catalog with JSON Schemas exists.** `ToolsService.get_action(...)` (service.py:120)
  returns `ToolCatalogActionDetails.schemas.inputs`, a JSON Schema built by the Composio
  adapter, ready to hand to a model as a tool definition.

What is missing is only two things: attaching tool references to the agent config, and letting
Pi call them during a run.

## Do not copy the chat tools contract

The completion and chat handlers carry tools as
`parameters["tools"] = {internal: [...], external: [...]}`. There, external tools are not
executed server-side. The `llm_v0` loop returns HTTP 202 "tool_requested" and the client
executes them. The agent path is the opposite. Pi runs the loop and must execute tools in-loop.
We reuse the tools subsystem, but not the chat tools-config shape.

## Scope

In:

- A provider-agnostic `tools` list in the agent revision config (WP-6 `parameters`).
- A backend resolver that turns each tool reference into a tool Pi can call.
- An execution bridge so a Pi tool call routes back through `POST /tools/call`.
- The Composio path end to end, plus the extension argument for MCP and workflow-as-tool.

Out:

- Building the MCP and workflow-as-tool adapters. This WP defines the shape they slot into.
- Per-invoke injection of LLM provider keys from the vault. That is orthogonal and tracked
  with WP-6.
- A tool-picker UI in the agent playground. Later.

## Configuration shape

Store one provider-agnostic list under the agent revision `parameters["tools"]`. Each entry is
a discriminated union on `type`. Config holds references and display metadata only, never
secrets.

```json
{
  "model": "gpt-5.5",
  "tools": [
    { "type": "builtin", "name": "read_file" },
    {
      "type": "composio",
      "integration": "gmail",
      "action": "SEND_EMAIL",
      "connection": "gmail-team",
      "name": "gmail__SEND_EMAIL"
    }
  ]
}
```

- `builtin` entries are the current `List[str]` of Pi built-in tool names
  (`services/oss/src/agent_pi/ports.py:95`). They pass straight into Pi's `tools: string[]`.
  This reconciles the existing field: it becomes the `builtin` subset.
- `composio` entries carry the exact slug segments `/tools/call` already parses: `integration`,
  `action`, and `connection`. The backend owns slug encoding in one place.
- `connection` is a project-scoped **slug**, resolved to the live connection row at run time.
  This keeps a single config revision promotable across environments where the underlying
  connection differs but the slug is stable.
- `name` is the function name shown to the model. The description and input schema resolve live
  from the catalog so config never drifts from the provider.

## Execution bridge

Route tool execution back through Agenta's existing `POST /tools/call`. Pi never sees the
Composio key. End to end:

1. The backend invokes the agent workflow with the resolved config (WP-6).
2. The backend **resolves** each `composio` reference: `ToolsService.get_action(...)` for the
   input schema, plus a connection-slug lookup that fails fast if the connection is missing,
   inactive, or invalid. It builds a resolved spec `{ name, description, inputSchema, callRef }`
   where `callRef` is `tools.composio.{integration}.{action}.{connection}`. `builtin` references
   pass through as names.
3. The backend injects the specs plus a callback context (endpoint and authorization) into the
   harness request. The endpoint and credential reuse the mechanism that already threads the
   OTLP credential down to the wrapper (`TraceContext`, ports.py:60).
4. The TS wrapper (`services/agent/src/runPi.ts`) turns each spec into a Pi `customTool`: name,
   description, JSON-Schema params, and an async `execute(args)` closure. It passes them via
   `createAgentSession({ tools, customTools })` next to the existing `tools` (runPi.ts:179).
5. The model emits a tool call. Pi runs the matching `execute(args)` closure itself.
6. The closure does one `POST {endpoint}/tools/call` with the envelope
   `{ data: { function: { name: callRef, arguments: args } } }` and the callback Authorization.
7. The backend runs the existing path: `RUN_TOOLS` permission check, project-scoped connection
   lookup, then `ToolsService.execute_tool(...)` to Composio with the stored
   `connected_account_id`.
8. The result string returns to the closure, Pi feeds it to the model, and the loop continues.
9. Tracing is free. `services/agent/src/agenta-otel.ts` already spans
   `tool_execution_start` and `tool_execution_end`, so the Composio call appears under the
   agent's invoke span.

Why route through the backend rather than inject provider creds into the sandbox:

- The Composio API key and the connection auth stay server-side, out of the sandbox.
- It reuses the tested path: connection lookup, active and valid gating, EE `RUN_TOOLS`, adapter
  dispatch, and error mapping.
- Execution happens outside the sandbox, which is the Daytona-friendly property we want.
- New providers work through the same callback with no sandbox or Pi changes.

## Auth model: two distinct kinds, never mixed

- **LLM provider keys** live in the vault (`api/oss/src/core/secrets/`). They are injected into
  Pi as env or a runtime key. Today `runPi.ts` reads a local login or `*_API_KEY` env. Per-invoke
  vault injection is orthogonal to tools and tracked with WP-6.
- **Tool connection auth** (Composio OAuth) lives behind `/tools/call`, scoped to the project,
  and is fully settable today. Pi and the sandbox never see it.

## Where resolution happens: the backend, not the services runner

`ToolsService`, the catalog, the connections, and the project scope all live in `api`. WP-6
already has the backend invoking the agent workflow with the config in hand, so resolving
references into `customTools` is a natural pre-invoke step there. The `services` runner stays a
thin harness driver that receives ready specs plus a callback URL. Until WP-6 lands, a Composio
demo could resolve inside `services/oss/src/agent.py` by calling the `api` catalog over HTTP,
but the real design resolves in `api`.

## Extensibility to MCP and workflow-as-tool

Both are just a new `ToolsGatewayInterface` adapter plus a new config `type`, with no change to
Pi, the bridge, or the sandbox:

- **MCP adapter.** Map `get_action` to MCP `tools/list` and `execute` to MCP `tools/call`.
  Register under `provider_key="mcp"`. Config gains `type: "mcp"`. The `callRef` becomes
  `tools.mcp.{server}.{action}.{connection}`, which the existing 5-segment parser handles.
- **Workflow-as-tool adapter.** Return the target workflow's input schema from `get_action`, and
  call the workflow `/invoke` from `execute`. Register under `provider_key="workflow"`.

Because the bridge only ever speaks the OpenAI-style envelope to `/tools/call`, and `/tools/call`
dispatches purely by `provider_key` through the registry, the agent side stays provider-blind.

## Implementation sketch (Composio MVP)

- `services/oss/src/agent_pi/ports.py` — add `custom_tools` and `tool_callback` to
  `HarnessRequest`.
- `services/oss/src/agent_pi/config.py` — evolve `tools` from `List[str]` to the discriminated
  shape; split `builtin` from runnable references.
- `services/oss/src/agent_pi/pi_http_harness.py` and `pi_harness.py` — serialize the new fields
  onto the wire.
- `services/agent/src/runPi.ts` — build Pi `customTools` and the `/tools/call` closure.
- `api/oss/src/core/tools/service.py` — add `resolve_connection_by_slug(...)`, extracted from the
  router so the resolver and `call_tool` share it.
- WP-6 invoke path in `api` — the resolver that turns `parameters["tools"]` into `custom_tools`
  and `tool_callback`. Reuse `router.py` `call_tool` unchanged as the execution endpoint.

## Risks and open questions

1. **Blocking latency in Pi's loop.** Each tool call is Pi to `/tools/call` to Composio and back,
   serialized per turn. The agent timeout is 180s and the Composio client timeout is 30s. Surface
   per-tool timeouts as tool-error strings, not run failures, and keep a generous overall budget.
2. **Connection-slug resolution.** Pre-validate every referenced connection at resolve time and
   fail the invoke early with a clear message, rather than letting the model hit a runtime tool
   error mid-loop. Decide the behavior when one environment lacks a connection a shared revision
   references.
3. **EE `RUN_TOOLS` scoping.** The callback credential must carry `RUN_TOOLS` for the project.
   Recommend scoping to the invoking user's permissions, threaded like the OTLP credential, so an
   agent run cannot call tools the user could not.
4. **Streaming.** The agent `/invoke` returns a single final message. Intermediate tool calls are
   visible only via the trace today. A streaming channel for tool events is out of scope for the
   MVP but should be flagged.
5. **Slug encoding round-trip.** The `__` vs `.` convention only holds if integration, action, and
   connection names never contain `__` or `.`. The connection slug rules already guard this; verify
   Composio action keys do too. Send `arguments` as a dict to avoid double-encoding.

## Definition of done

- A documented config schema for agent tools, with the discriminated `type` and the Composio
  fields spelled out.
- A backend resolver that turns references into `customTools` and validates connections up front.
- An execution bridge that routes Pi tool calls through `/tools/call`, verified with a Composio
  smoke run, with the call nested under the agent invoke span and the Composio key absent from the
  sandbox.

## Implementation status (Composio MVP)

What landed, by seam. WP-6 is not started, so resolution runs in `api` behind a thin
endpoint that the agent service calls over HTTP; when WP-6 lands, its invoke path calls the
same `ToolsService.resolve_agent_tools(...)` in-process and the HTTP hop drops out.

**Backend (`api`) — the resolver and the shared connection lookup.**

- `core/tools/dtos.py`: `AgentToolReference` (discriminated `builtin` | `composio`),
  `ResolvedAgentTool` (`name`, `description`, `input_schema`, `call_ref`), and
  `AgentToolsResolution` (`builtins`, `custom`).
- `core/tools/service.py`: `resolve_connection_by_slug(...)` (extracted from `call_tool`, now
  shared) and `resolve_agent_tools(...)`. Composio refs validate the connection up front,
  enrich `description` + `input_schema` from the catalog (`get_action`), and build the
  `call_ref` `tools.composio.{integration}.{action}.{connection}`. Slug segments are validated
  and `__` is rejected so the `/tools/call` `__`↔`.` round-trip can't corrupt the split.
- `apis/fastapi/tools/router.py`: `POST /tools/resolve` (project-scoped, EE `VIEW_TOOLS`)
  returns the resolution; `call_tool` now reuses `resolve_connection_by_slug`. `call_tool` is
  otherwise unchanged as the execution endpoint.

**Agent service (`services/oss`) — thin driver.**

- `agent_pi/ports.py`: `ToolCallback` (endpoint + authorization) and `custom_tools` /
  `tool_callback` on `HarnessRequest`, serialized onto the wire by both harness adapters.
- `agent.py`: reads `parameters["tools"]` (or the file config), POSTs them to `/tools/resolve`,
  and threads the result plus a `/tools/call` callback into the harness. The callback endpoint
  and credential reuse the OTLP-credential mechanism (`inject()` Authorization, API-base derived
  from `ag.tracing.otlp_url`, with `AGENTA_AGENT_TOOLS_API_URL` / `AGENTA_API_KEY` fallbacks). An
  agent with no tools never touches the backend, preserving the tool-less WP-2 path.

**TS wrapper (`services/agent`) — the bridge.**

- `runPi.ts`: `buildCustomTools(...)` turns each resolved spec into a Pi `customTool` whose
  `execute` does one `POST {endpoint}` with the OpenAI envelope
  `{ data: { id, type, function: { name: callRef, arguments } } }` and the callback
  Authorization. Arguments go as an object (no double-encoding); the result `content` returns
  verbatim; an HTTP/timeout failure throws, which Pi turns into a tool-error result rather than a
  run failure. Custom tool names are added to the `createAgentSession` `tools` allowlist, because
  the allowlist gates custom tools too (an empty allowlist would hide them).

**Config schema as shipped.** Under the agent revision `parameters["tools"]`, each entry is a
built-in tool name (string, normalized to `{"type": "builtin", "name": ...}`) or a discriminated
object. Example:

```json
{
  "model": "gpt-5.5",
  "tools": [
    "read_file",
    { "type": "composio", "integration": "gmail", "action": "GMAIL_SEND_EMAIL",
      "connection": "gmail-team", "name": "gmail__SEND_EMAIL" }
  ]
}
```

**Playground integration: reuse the existing tool picker.** The chat/completion tool picker
only renders inside the prompt control, which the playground shows for a config field marked
`x-ag-type-ref: "prompt-template"`. So the agent advertises its config as a `prompt`
prompt-template (`agent_pi/schemas.py`) instead of a bespoke form: the playground then renders
the same model selector + system-message editor + tool picker, with no new frontend code. The
handler (`agent.py` `_resolve_run_config`) reads the system message as the AGENTS.md, the model
and tools from `prompt.llm_config`, and still accepts the flat `{model, agents_md, tools}` an API
caller may send. The picker encodes a Composio action as a gateway function name,
`tools__{provider}__{integration}__{action}__{connection}` (connection = the connection slug);
`agent.py` `_parse_gateway_slug` turns that into the same `composio` ref the resolver already
takes, so no backend change was needed. Non-Composio picker entries (provider built-ins, inline
functions) are skipped.

**Verified live (2026-06-16, dev stack, pi-agents project).** A real GitHub Composio connection
(`github-tvn`) plus a `GET_THE_AUTHENTICATED_USER` reference, passed via `parameters["tools"]` to
the agent `/invoke`, drove the whole path: `/tools/resolve` built the spec, Pi registered the
`github_whoami` customTool, called it, and the bridge executed the real action through
`/tools/call`. The agent answered with live data (login `mmabrouk`, follower count, public-repo
count) that only comes from executing the action. The trace nests the tool call correctly:
`_agent → invoke_agent → turn 0 → {chat, execute_tool github_whoami} → turn 1 → chat`. The same
run also works end to end from the playground: the picker shows the GitHub tool as a gateway card,
and Run returns the live answer.

Earlier unit-level checks still hold: the resolver builds correct specs and raises the right
errors for missing / inactive / invalid connections, bad slugs, and missing actions; the bridge
sends the right envelope, forwards Authorization, sends object-form arguments, returns content
verbatim, and throws on HTTP error; Pi's validator accepts and coerces the plain Composio JSON
Schema.

**Deployment hardening found and fixed.** The DoD wants the Composio key absent from the sandbox.
The WP-7 *data path* already guarantees this (the key is never sent to Pi). But the dev
`agent-pi` sidecar was loading the whole stack `env_file`, so the container inherited
`COMPOSIO_API_KEY` and other secrets anyway. Dropping `env_file` from the `agent-pi` service in
`hosting/docker-compose/ee/docker-compose.dev.yml` (it reads only `PORT`, `PI_CODING_AGENT_DIR`,
`AGENTA_HOST`, `AGENTA_API_KEY`, and two optional vars; Pi auth comes from the mounted login) makes
the property hold in the local sidecar too. A real sandbox (WP-3 Daytona) is isolated and never
saw these.

## Links

- [`wp-2-agent-service/`](../wp-2-agent-service/README.md)
- [`wp-6-workflow-type-and-template/`](../wp-6-workflow-type-and-template/README.md)
- [`../research/auth-secrets.md`](../research/auth-secrets.md)
- [`../research/diskless-in-memory-config.md`](../research/diskless-in-memory-config.md)
- [Project README](../README.md)
