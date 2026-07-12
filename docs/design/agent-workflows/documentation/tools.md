# Tools

An agent is only as useful as the tools it can call. This page explains how Agenta defines a
tool, the tool types we support, and exactly how each type runs at request time. The question
this page keeps coming back to is *where execution happens*: inside the harness, in a runner
subprocess, back at the Agenta service, or in the browser. The answer is different for each
tool type, and getting it right is what keeps secrets server-side while still letting the
agent act.

Read the [architecture](architecture.md) and [ports and adapters](ports-and-adapters.md)
pages first. This page assumes the service/runner split and the `/run` wire contract. For the
two harnesses' delivery mechanics in full, see the [Pi adapter](adapters/pi.md) and the
[Claude Code adapter](adapters/claude-code.md).

## A tool has two lives: declared config and resolved spec

A tool exists in two forms, and almost every confusion about tools comes from mixing them up.

1. **The declared config** is what an author commits in `AgentConfig.tools`. It says what the
   tool *is*: a reference to a gateway action, an inline snippet, a built-in name. It is
   stable, portable, and contains no secrets and no endpoints.
2. **The resolved spec** is what the runner receives on the `/run` wire. It says how to *run*
   the tool: the secrets already injected, the callback endpoint already filled in, the
   gateway reference already turned into a server-side slug. It is per-run and never committed.

The service turns the first into the second every run. The runner only ever sees the second.

The declared models live in `sdks/python/agenta/sdk/agents/tools/models.py`. Every tool config
shares two fields through `ToolConfigBase`, and then a `type` discriminator picks the variant:

| Config (`type`) | Carries | Example use |
| --- | --- | --- |
| `builtin` | `name` | A harness-native tool such as Pi's `read` or `web_search`. |
| `gateway` | `provider`, `integration`, `action`, `connection`, optional `name` | A Composio action, like `github__create_issue` on a connected account. |
| `code` | `name`, `runtime` (`python`/`node`), `script`, `input_schema`, `secrets` | An inline snippet the author writes, with named vault secrets injected. |
| `client` | `name`, `input_schema` | A tool the browser fulfils, like "ask the user to pick a date." |
| `reference` | `ref_by` (`variant`/`environment`), `slug`, optional `environment`/`version`, optional `name`/`description`/`input_schema` | A workflow referenced as a tool (see below); the service runs the referenced workflow revision when the model calls it. |
| `platform` | `op` (a platform-op catalog key), optional `permission` | An existing Agenta endpoint exposed to the agent (e.g. `discover_tools`, `query_spans`, `commit_revision`); the runner calls the endpoint directly. See [Platform tools](#platform-tools-existing-agenta-endpoints) below. |

A tool can also be a **workflow** referenced as a tool:

- **`type: "reference"`** — a `ReferenceToolConfig` (the author writes it as a plain `tools` entry,
  no marker). It carries the workflow identity on one of two axes — `ref_by: "variant"` (the
  workflow `slug`, latest revision or a pinned `version`) or `ref_by: "environment"` (whatever is
  deployed in `environment` for `slug`) — plus the model-facing surface. `resolve_tools` turns it
  into a `CallbackToolSpec` whose `call_ref` is `workflow.variant.{slug}[.{version}]` or
  `workflow.environment.{environment}.{slug}`. The model's call routes back to `POST /tools/call`,
  which runs the selected workflow revision server-side. Connections/secrets the workflow needs
  stay server-side, the same safety shape a gateway tool has. **No new runner `kind`.**
- **`@ag.embed`** (a different feature) — inline a value. The generic resolver resolves the
  reference into a concrete `client` tool config *before* `resolve_tools` runs, so it rides the
  existing `client` path (fulfilled in the browser). Not surfaced in the tool-authoring UI.

A `type: "reference"` tool is plain config, not a marker: the generic resolver (`ResolverMiddleware`
+ the API embed resolver in `api/oss/src/core/embeds/utils.py`) only ever INLINES `@ag.embed` and
has no special case for reference tools; all tool-specific mapping lives in `resolve_tools`.

A tool can also be a **platform** tool — an existing Agenta endpoint exposed to the agent:

- **`type: "platform"`** — a `PlatformToolConfig`. The author writes only `{type:"platform", op}`
  (plus optional `permission`); the `op` names an entry in the platform-op catalog
  (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`), which owns everything else: the
  model-facing description, the endpoint (method + relative path), the input schema, any
  self-targeting fields bound from run context, and the per-op default permission/approval.
  `resolve_tools` turns it into a `CallbackToolSpec` carrying a direct `call` descriptor, so the
  runner calls the existing endpoint directly (no `/tools/call` hop). See
  [Platform tools](#platform-tools-existing-agenta-endpoints).

MCP servers are a sibling field, `AgentConfig.mcp_servers`, not a tool type. They are declared
in `sdks/python/agenta/sdk/agents/mcp/models.py` and resolved alongside tools. They are
covered in their own section below.

## Three orthogonal axes

The `type` field is one of three independent axes a tool config carries. They do not interact,
and the runner reads each one separately. This is the single idea that makes the tool model
extensible without new branches everywhere.

- **Executor (`type` at config time, `kind` at runtime):** who fulfils a call. This is the
  axis that decides *where execution happens*, and the rest of this page is mostly about it.
- **`permission`:** `allow`, `ask`, or `deny`, or left unset to inherit the agent's policy.
  Decides whether a call waits for a human yes/no before it runs. See
  [Approval and rendering](#approval-and-rendering) below.
- **`render`:** an optional generative-UI hint so the frontend can draw the call and its
  result as something richer than text.

A code tool can carry its own permission. A gateway tool can carry a render hint. The axes
compose.

The executor axis is named `type` in the committed config and `kind` on the resolved spec. The
rename is deliberate: config talks about where a tool *comes from* (`gateway`), while runtime
talks about *how the runner fulfils it* (`callback`). The mapping is small but worth pinning,
because it is the seam between the two lives of a tool:

| Declared `type` | Resolved form | Resolved `kind` |
| --- | --- | --- |
| `builtin` | a bare name in `builtin_names` | (none; not a spec) |
| `gateway` | `CallbackToolSpec` with a `call_ref` slug | `callback` |
| `code` | `CodeToolSpec` with secrets in `env` | `code` |
| `client` | `ClientToolSpec` | `client` |
| `reference` | `CallbackToolSpec` with a `workflow.{axis}.*` `call_ref` | `callback` |
| `platform` | `CallbackToolSpec` with a direct `call` (method/path/context) | `callback` |

The resolved specs are also defined in `tools/models.py` (`CallbackToolSpec`, `CodeToolSpec`,
`ClientToolSpec`), and the matching TypeScript shape is `ResolvedToolSpec` in
`services/agent/src/protocol.ts`. A run bundles them as a `ResolvedToolSet`: the built-in
names, the list of specs, and one `ToolCallback` (the endpoint callback tools post back to).

## How tools get resolved (the service side)

Resolution is the service's job, but most of it now lives in the SDK. The service calls two
entrypoints in `services/oss/src/agent/app.py` (`_agent`): `resolve_tools(agent_config.tools)`
and `resolve_mcp_servers(agent_config.mcp_servers)`. Both are thin re-exports. The service
files under `services/oss/src/agent/tools/` are shims:
`resolver.py` re-exports the SDK's `resolve_tools` and adds the MCP gate; `gateway.py` and
`secrets.py` re-export the SDK platform adapters. The real composition is
`resolve_tools` in `sdks/python/agenta/sdk/agents/platform/resolve.py`, which builds a
`ToolResolver` (`sdks/python/agenta/sdk/agents/tools/resolver.py`) wired with two
Agenta-platform adapters: `AgentaNamedSecretProvider` for secrets and
`AgentaGatewayToolResolver` for gateway tools (both in
`sdks/python/agenta/sdk/agents/platform/`). The SDK owns the generic algorithm; the platform
adapters plug in the Agenta-specific HTTP calls. The SDK never imports the service.

Resolution runs per type:

- **Builtin** passes straight through. The name lands in `builtin_names`. No network call.
- **Code** has its declared `secrets` looked up by name. The named-secret provider resolves
  them through `POST /secrets/resolve` (the platform adapter in
  `sdks/python/agenta/sdk/agents/platform/secrets.py`, re-exported by
  `services/oss/src/agent/tools/secrets.py`) and injects the values into the spec's `env`. The
  script itself is not run here.
- **Client** passes through to a `ClientToolSpec`. There is nothing to resolve server-side.
- **Reference** (a `type: "reference"` workflow) resolves through `AgentaWorkflowToolResolver`
  (`sdks/python/agenta/sdk/agents/platform/workflow.py`). Unlike gateway it makes no HTTP
  round-trip — the reference is already concrete in the config — so it builds the
  `CallbackToolSpec` (`call_ref = workflow.{axis}.*`) directly and assembles the shared
  `ToolCallback` to `{api}/tools/call`. Gateway and reference share the one `ToolCallback`
  (same endpoint, same per-request auth); the server-side `/tools/call` routes by the `call_ref`
  prefix (`tools.*` vs `workflow.*`).
- **Platform** (a `type: "platform"` tool) resolves through `AgentaPlatformToolResolver`
  (`sdks/python/agenta/sdk/agents/platform/platform_tools.py`). Like reference it makes no HTTP
  round-trip — the op is fully described by the code-defined catalog
  (`platform/op_catalog.py`). It looks up the op, expands the catalog input schema (`x-ag-type-ref`
  resolved against `CATALOG_TYPES`), strips the op's `context_bindings` fields from the
  model-visible schema, and builds a `CallbackToolSpec` whose `call` points at the existing endpoint
  (`call.context` carries the context bindings). It assembles the same shared `ToolCallback` to
  `{api}/tools/call` (gateway/reference/platform share the one callback; it gives the runner the
  origin to resolve the relative `call.path` against).
- **Gateway** is the involved one. `AgentaGatewayToolResolver`
  (`sdks/python/agenta/sdk/agents/platform/gateway.py`, re-exported by
  `services/oss/src/agent/tools/gateway.py`) posts the references to the API's
  `POST /tools/resolve`. The API (`api/oss/src/core/tools/service.py`, `resolve_agent_tools`)
  validates that the named connection exists, is active, and is authenticated, then enriches
  the tool from the Composio catalog with its real description and input schema. It returns a
  `call_ref` slug of the form `tools.{provider}.{integration}.{action}.{connection}`. The
  resolver wraps each one in a `CallbackToolSpec` and attaches a single `ToolCallback` whose
  endpoint is the API's `POST /tools/call`.

This is what "gateway tools are built at the service level" means in practice. The service
does the connection check and the catalog lookup up front, so a bad connection fails the
invoke immediately instead of failing the model mid-loop, and the agent only ever receives a
name, a schema, and an opaque slug. The Composio key and the connection's auth never leave the
service.

MCP servers resolve on the same path but only when `AGENTA_AGENT_MCPS_ENABLED` is truthy. The
gate lives in `resolve_mcp_servers` (`services/oss/src/agent/tools/resolver.py`): when the
flag is off it returns an empty list before the SDK `MCPResolver` ever runs. When on, the
`MCPResolver` injects each server's named secrets into its `env`, the same way code tools get
theirs. By default this is off, so `mcp_servers` is dropped at the service and `mcpServers` is
omitted from the wire. See the [status](#status-and-known-gaps) section: even with the flag on,
user MCP reaches Claude only, not the default Pi harness, so the field is a no-op in the common
case.

The whole resolved bundle then rides the `/run` wire: built-in names in `tools`, resolved
specs in `customTools`, the callback in `toolCallback`, and resolved MCP servers in
`mcpServers`.

## How tools get delivered (the harness fork)

The runner has to hand resolved tools to a harness, and harnesses do not accept tools the same
way. The runner branches on a capability, `mcpTools`, not on the harness name (the branch is
`buildSessionMcpServers` in `services/agent/src/engines/sandbox_agent/mcp.ts`). A harness that
reports it can take tools over MCP gets them that way; a harness that cannot gets them
natively. Today that splits cleanly into two paths.

- **Pi takes native tools.** Pi has an extension API, so the runner registers each resolved
  spec as a Pi tool directly. The bundled Pi extension
  (`services/agent/src/extensions/agenta.ts`) reads the public specs from
  `AGENTA_TOOL_PUBLIC_SPECS` and registers them from inside Pi, then Pi runs the tool body the
  runner gives it. Pi gets no MCP server at all here: `buildSessionMcpServers` returns an empty
  list for Pi, so neither the synthetic `agenta-tools` server nor any user MCP server is
  attached.
- **Claude and other ACP harnesses take MCP.** They cannot accept a native tool, so the runner
  exposes the same resolved specs as a small synthetic MCP server named `agenta-tools`
  (`services/agent/src/tools/mcp-bridge.ts` launches `services/agent/src/tools/mcp-server.ts`).
  This bridge is given only public metadata (names, descriptions, schemas) and a relay
  directory. It never receives the `call_ref`, the code, the scoped secrets, or the callback
  auth. When the model calls a tool, the bridge relays the request back to the runner, and the
  runner runs the private spec from memory. This `agenta-tools` server is a tool DELIVERY
  vehicle, not a user MCP server: it carries gateway and code tools AND `client` tools (which it
  pauses in `tools/call` rather than executing — see "Client tools" below), and it exists only on
  the local Claude path (it is skipped on a remote sandbox, where its loopback URL is
  unreachable).

Both paths funnel execution through one function, `runResolvedTool` in
`services/agent/src/tools/dispatch.ts`. It is the single place that branches on `kind`, so how
a tool type executes is defined once, not three times.

## Execution, type by type

This is the heart of the page. For each tool type, the question is the same: when the model
picks the tool and supplies the arguments, who actually runs it, and where?

### Gateway tools: the harness calls back to the service

Execution is a callback. The harness selects the tool and supplies arguments, but the runner
does not run the integration. The tool body POSTs the call to Agenta's `POST /tools/call`
(`services/agent/src/tools/callback.ts`, `callAgentaTool`), sending the `call_ref` slug and
the model's arguments in an OpenAI-style envelope. The API re-resolves the connection, runs the
Composio action through the provider adapter (`execute_tool` in `core/tools/service.py`), and
returns the result, which the runner hands back to the model verbatim.

So the split is clean: **the harness decides which tool and with what arguments; the service
runs it.** This is the central safety property of the whole tool system. The Composio key and
the connection's auth stay on the service. The agent, the sandbox, and the harness never hold
a credential. They only ever ask Agenta to run a named, pre-validated action.

### Reference (workflow) tools: the service runs the workflow

A `type: "reference"` workflow tool is the same callback shape with a different execute target. The
call_ref is `workflow.variant.{slug}[.{version}]` or `workflow.environment.{environment}.{slug}`
instead of the Composio 5-segment slug. `POST /tools/call`
(`ToolsRouter.call_tool` in `api/oss/src/apis/fastapi/tools/router.py`) routes by the prefix:
`workflow.*` goes to `_call_workflow_tool`, which parses the targeting axis and builds a
`WorkflowServiceRequest` — the variant axis sets `references={"workflow": Reference(slug, version)}`;
the environment axis sets `references={"environment": Reference(slug=environment),
"workflow": Reference(slug)}` (the environment selects the deployed revision via the derived
`{slug}.revision` key) — with `data.inputs = <the model's arguments>`, and calls
`WorkflowsService.invoke_workflow(project_id, user_id, request)`. The auth is minted
server-side from the caller's project + user, so any connections/secrets the workflow itself uses
never leave the service — the same safety property gateway tools have. The workflow's
`response.data.outputs` becomes the tool result content. The runner needs no new `kind`; it
relays a `callback` spec exactly as it does a gateway tool (direct or via the Daytona file relay).

There is one transport wrinkle. On Daytona the in-sandbox process cannot reach Agenta over the
network. So the call is relayed through files instead: the in-sandbox tool publishes a request
file into a relay directory, the runner (which can reach Agenta) picks it up, performs the same
`/tools/call` POST, and publishes the answer back. The writer is `relayToolCall` in
`tools/relay-client.ts` (re-exported by `dispatch.ts`); the wire protocol (file suffixes,
request and response shapes, byte-pinned request serialization) is `tools/relay-protocol.ts`;
the runner-side loop is `startToolRelay` in `tools/relay.ts`. The two writer modules import
node builtins only, so the Pi extension bundle and the future in-sandbox MCP shim (#5234)
consume them from inside the sandbox. Same callback, same envelope, different delivery. The
non-Pi internal MCP channel (a loopback HTTP MCP server the runner serves) uses this same relay
even on local runs, because the harness calling it is kept blind to the private spec — only
public metadata crosses the channel, and execution relays back to the runner.

The relay files carry three guarantees. Publication is atomic in both directions: each side
writes the full bytes to a temp name (`<final>.tmp.<nonce>`) and renames it to the final name
in the same directory, so a reader never sees partial JSON (on Daytona the daemon's `moveFs`
is `rename(2)` underneath). The runner deletes each request file right after reading it, so a
request executes at most once per publication; a request lost to a runner crash surfaces as a
writer timeout and a tool error, never a redelivery. And each turn's relay loop treats its
first directory listing as a snapshot: request files that predate the turn are deleted, never
executed, so a crashed earlier turn cannot leak a stale call into a warm-continued one.

Pickup is event-driven, with polling kept as the fallback. The writer arms one coalescing
`fs.watch` on the relay dir before its first response check, so the runner's answer wakes it
instantly; the 300 ms poll survives as the racing safety timer. The runner's loop wakes the
same way: locally from an in-process `fs.watch` (unflagged; it only shortens the poll sleeps),
and on Daytona, behind a flag, from one bounded watch exec per window inside the sandbox.
While the Daytona watch is healthy the runner suspends its remote `ls` polling and keeps a
30 s safety poll; failures demote the turn to classic polling with jittered backoff and one
log line. Three env vars control the wakes:

- `AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED`: the in-sandbox response watch (hop 1).
  Default true; only the exact strings `false` and `0` disable it. Forwarded into the sandbox
  env only when the operator set it.
- `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED`: the Daytona watch exec (hop 2). Default
  false; only the exact strings `true` and `1` enable it.
- `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS`: one watch exec window. Default 25000,
  clamped to [5000, 120000], with downward-only jitter of up to 20 percent. Keep it below the
  30 s safety poll: a window of 30 s or more still works but degrades pickup latency and can
  demote a healthy watch.

The existing relay vars (`AGENTA_AGENT_TOOLS_RELAY_POLLING`, `_POLLING_MAX`,
`_IDLE_GROW_AFTER`, `_TIMEOUT`) keep their names and meanings; they now describe the fallback
poll mode and the safety timers.

### Platform tools: the runner calls an existing Agenta endpoint directly

A `type: "platform"` tool exposes an EXISTING Agenta endpoint to the agent — a thin wrapper, no
new endpoint and no hidden logic. It resolves to a `CallbackToolSpec` carrying a direct `call`
descriptor (`{method, path, body?, context?, args_into?}`) instead of a `call_ref`, so the runner
calls the endpoint directly with the run's caller credential. There is no `/tools/call` hop. The
SSRF guard binds the call to the run's own Agenta origin and confines it to the API mount
(`directCallUrl` in `services/agent/src/tools/direct.ts`); the same dispatch handles the Daytona
relay path. The runner needs no platform-specific code — it dispatches any `call` opaquely (the
branch already exists for reference tools).

For a **self-targeting** op the agent's own identity is bound server-side. The catalog entry
declares a `context_bindings` map (an endpoint body path → a `$ctx.<key>` run-context token); the resolver
strips those fields from the model-visible schema and emits them as `call.context`, and the runner
fills them from the per-turn `runContext` at dispatch (see
[run context](../../projects/direct-call-tools/run-context.md)). So `commit_revision` binds the
running variant id — the model supplies only the new config and can never retarget a different
variant. Permission/approval ride the same axes as every other tool type, so HITL still works on a
direct call.

### Code tools: the runner runs them locally

Execution is a local subprocess inside the runner. `runCodeTool`
(`services/agent/src/tools/code.ts`) writes the snippet to a temp file, spawns `python3` or
`node`, passes the model's arguments as JSON on stdin, and reads the JSON result from stdout.
There is no callback. The code runs where the harness runs.

This is the mirror image of a gateway tool. A gateway tool keeps every secret out of the
sandbox and runs remotely. A code tool needs its secrets *in* the sandbox, so the runner
injects them, but tightly. The child process gets a minimal environment allowlist (`PATH`,
`HOME`, locale, temp dirs) plus only the tool's own declared, resolved secrets. It does not
inherit provider keys, `AGENTA_*` config, or Composio and Daytona variables (`buildChildEnv`
in `code.ts`). The snippet defines a `main` function; Python is called as `main(**inputs)` and
Node as `main(inputs)`. A non-zero exit or a timeout becomes a tool error so the model loop
continues rather than crashing the run.

The production image ships the interpreters: the runner Dockerfile installs `python3`
(`services/agent/docker/Dockerfile`), and `node` is already present. An earlier missing
`python3` made Python code tools fail with `spawn python3 ENOENT`; that is fixed. One real
constraint remains: the child only has the interpreter and the tool's own secrets, with no
package-install step and no `NODE_PATH` to the runner's modules. So a code tool is limited to
the language standard library. Glue code works; anything that needs a third-party package does
not, until a provisioning story exists.

### Client tools: the browser fulfils them across a turn boundary

Execution happens in the browser, not in the runner at all. A client tool is never run
in-sandbox; `runResolvedTool` throws if one is ever dispatched there. The model still SEES the
tool and calls it; the runner then PAUSES the call and emits an `interaction_request` event of
kind `client_tool`. The `/messages` egress projects it to a browser component, the browser runs
it, and the result returns in the next `/messages` turn, matched back by tool name + args. This
is the cross-turn human-in-the-loop path, the same mechanism approvals use. A client tool is the
right type whenever only the user's environment can answer: their location, a file on their
machine, a confirmation only they can give.

The pause itself is shared by both delivery paths through one seam
(`services/runner/src/engines/sandbox_agent/client-tools.ts`, `buildClientToolRelay` +
`emitClientToolInteraction`):

- **Pi** calls the tool through its extension; the runner's file relay pauses it (writes no
  response file) and the seam emits the interaction.
- **Claude** calls the tool over the internal `agenta-tools` MCP server, and the runner pauses it
  inside the `tools/call` handler: it emits NO JSON-RPC result and aborts that in-flight request,
  so Claude cannot settle the call before the turn ends `paused`. The browser result resumes it
  next turn (the MCP handler returns the stored output if the model re-calls). This is
  local-only: on a remote sandbox the loopback MCP channel is unreachable, so a non-Pi run
  carrying ANY custom tool — client kind included — is rejected up front
  (`REMOTE_TOOLS_UNSUPPORTED_MESSAGE`), never delivered silently. (The ACP permission gate in
  `acp-interactions.ts` keeps its own `kind: "client"` pause branch as a live fallback for a
  harness that raises a permission gate carrying a resolved client spec.)

A client tool's `render` hint can be `{ kind: "connect" }` (e.g. `request_connection`), the typed
member of `RenderHint` that asks the frontend to draw the connect widget.

### Built-in tools: the harness runs them natively, gated through the same relay

Execution is the harness's own. A built-in tool is just a name. The runner adds it to the
session's allowlist and Pi runs its own implementation of `read`, `write`, `web_search`, and so
on. Nothing is resolved and nothing is delivered. Note that built-ins are a Pi concept here;
they are not delivered to non-Pi harnesses over ACP, which bring their own native tool set.

Pi's builtins now flow through the same permission relay as gateway tools (code tools are
declared but not yet executable in the runner; the relay path is shared either way). The
bundled Pi extension's `tool_call` hook reports every builtin call over the relay directory as
a permission record (`kind: "permission"`), and the runner decides it through the same shared
`decide()` in `permission-plan.ts` the relay already uses for gateway tools. An `ask`
verdict pauses the turn exactly like a relay tool does. The extension hook then maps a
non-allow verdict to Pi's own `{ block: true }`, because Pi, not the runner, is the thing that
would otherwise execute the call.

The grant list (the wire `tools` field: the builtins an author selected) is enforced
separately, at session start. The extension edits Pi's active tool set at
`before_agent_start`, replacing only the builtin slice with the granted names and leaving
every non-builtin tool untouched. A builtin outside the grant list is simply absent from the
model's active tools, so no call for it ever fires, and the permission hook never sees it.

### MCP servers: a server process the daemon launches

Execution happens in a separate server process. A declared MCP server is resolved server-side
(secrets injected into its `env`) and, for MCP-capable harnesses, passed to the ACP daemon as a
stdio server (`toAcpMcpServers` in `services/agent/src/engines/sandbox_agent/mcp.ts`). The
daemon launches the server's `command` with the resolved `env`, and the harness talks to it
over the MCP protocol.

In practice user MCP is dead on the default path, and for two reasons that stack. First,
resolution is gated behind `AGENTA_AGENT_MCPS_ENABLED`, which is off by default, so the servers
never reach the wire. Second, even with the flag on, `buildSessionMcpServers` drops user MCP
for Pi (Pi's ACP adapter does not forward them), so it would reach Claude only. Pi and Agenta
are the default harnesses, so the `mcp_servers` field is accepted and then silently ignored in
the common case. This is the silent-drop that the
[harness-capabilities project](../../projects/harness-capabilities/proposal.md) is built to fix
(fail loud, or deliver MCP on Pi through the extension). The
[removal-and-capability notes](../../scratch/notes-tools-mcp-capabilities.md) lay out the two
options.

## Approval and rendering

These are the other two axes, and they ride alongside execution rather than changing where it
happens.

**`permission`** gates a call on a human answer. Each tool carries `allow`, `ask`, `deny`, or
nothing (inherit). A run request also carries an agent-wide policy,
`permissions: {default: "allow"|"ask"|"deny"|"allow_reads", rules?}`. One shared decision
module in the runner, `services/runner/src/permission-plan.ts`, resolves a tool's effective
permission: the tool's own explicit setting wins; failing that, an authored rule match; failing
that, the policy mode. Under `allow_reads` (the default), a tool's read-only hint decides: reads
run, everything else asks.

Two gates consult this same decision:

- **The ACP responder**, `ApprovalResponder` in `services/runner/src/responder.ts`, answers
  permission requests that a gating harness raises itself. Claude Code is the only harness that
  raises these today: it checks its own settings file first, and only an undecided call reaches
  the responder.
- **The tool relay**, `services/runner/src/tools/relay.ts`, enforces permission on tools the
  runner executes directly (gateway, code) and, now, on Pi's own builtins, relayed through the
  bundled extension's `tool_call` hook. It only needs to, because on Claude the harness settings
  file plus the ACP responder already decide before a call reaches the relay. On Pi there is no
  separate harness-side settings gate, so the relay is the enforcement point for everything Pi
  runs, including its native builtins, and it gives Pi the same human-in-the-loop behavior
  Claude gets.

Client tools are a carve-out from that same ladder. They are decided by the responder's
`onClientTool` (consulted at the ACP gate on Claude, and by the relay on Pi), not by the
policy-and-rules path above: a client tool with no `permission` of its own defaults to
`allow` under every policy mode except `deny`, where it is blocked. An explicit `permission`
always wins, in both directions: `allow` runs even under a `deny` policy, and `ask`/`deny`
bind even under `allow`. The reasoning is that a client tool's only job is to reach the
browser, so folding it into `ask`/`allow_reads` defaults would strand it.

Either gate answers `allow` by running the tool with no extra event, `deny` by refusing it, or
`ask` by pausing the turn (the wire's `stopReason: "paused"`) and emitting exactly one
`interaction_request(user_approval)` event. The event fires only when the run actually pauses;
an allow or deny produces no extra event, only the ordinary `tool_call`/`tool_result` pair. On
resume, the harness re-issues the call and the runner matches it on a stable anchor (the spec's
own name for relay tools, the recorded tool call name for Claude gates, canonicalized arguments
on both), never on a display title that can drift. A match consumes the stored decision once; a
mismatch is a visibly new approval prompt, never a silent loop and never an auto-deny.
`SANDBOX_AGENT_DENY_PERMISSIONS=true` is an operator kill-switch that forces the effective
policy to deny everywhere.

**`render`** is a generative-UI hint. The runner does not act on it; it copies the hint from the
spec onto the `tool_call` and `tool_result` events so the egress can project it to the frontend
without a spec lookup. The hint can name a prebuilt component, ship rendered source, or carry a
declarative UI spec (`RenderHint` in `protocol.ts`).

## Platform tools (existing Agenta endpoints)

A platform tool exposes an existing Agenta endpoint to the agent so it can act on the platform —
discover tools, query workflows, even update itself. The set of exposable endpoints is a
code-defined catalog in `sdks/python/agenta/sdk/agents/platform/op_catalog.py`. The author writes
only `{type:"platform", op}`; the catalog owns the rest. Adding an op is a data change to the
catalog, not new plumbing.

Each catalog entry (`PlatformOp`, a typed model validated at import) maps an `op` to:

| Field | Meaning |
| --- | --- |
| `description` | The model-facing description (SDK-owned). |
| `method`, `path` | The existing endpoint to call: `GET`/`POST` and a relative `/api/...` path. Endpoint-mode ops set these; a handler-mode op sets `handler` instead (exactly one of the two targets). |
| `handler` | A reserved `tools.agenta.<op>` call-ref for a server-side handler (see [server-handled ops](#server-handled-ops-handler-mode)). Mutually exclusive with `method`+`path`. |
| `input_schema` / `input_schema_ref` | The request input schema — inline JSON Schema, or a `CATALOG_TYPES` key (expanded via `x-ag-type-ref`). Exactly one. |
| `context_bindings` | Self-targeting fields: an endpoint body path → a `$ctx.<key>` run-context token. Stripped from the model schema; emitted as `call.context` (endpoint mode) or spec-level `contextBindings` (handler mode). |
| `timeout_ms` | Optional per-op execution budget, emitted as `timeoutMs` on the resolved spec. Used by long-running handler ops (`test_run` sets 120s). |
| `read_only` | A bool hint, not a gate value. Under the `allow_reads` policy default it decides the op's effective permission: `true` runs without asking, anything else asks. The tool's own explicit `permission` (`allow`/`ask`/`deny`) always overrides this hint. |

Each op has a stable reserved id, `tools.agenta.<op>`. The catalog holds every exposable op
(discovery, workflow reads/writes, tracing reads, and the trigger/schedule/subscription
lifecycle). The playground **build kit** is itself served as the reserved static workflow
`__ag__build_kit` (a constant agent config in `api/oss/src/core/workflows/static_catalog.py`;
content builder `api/oss/src/core/workflows/build_kit.py`) — the frontend resolves it by slug
once per project and merges it as an overlay onto any agent-typed entity; it is retrievable
but not embeddable/committable, and the legacy per-application `additional_context` rider
remains one release as a fallback. It embeds an explicit default subset,
`DEFAULT_BUILD_KIT_OPS` in `api/oss/src/core/workflows/build_kit.py`: `discover_tools`,
`commit_revision`, `annotate_trace`, `query_spans`, `discover_triggers`, `create_schedule`,
`create_subscription`, `list_schedules`, `list_deliveries`, `test_subscription`,
`remove_schedule`, and `remove_subscription` (12 ops, plus the `request_connection` client
tool and the build-an-agent playbook skill). Every other catalog op (the pause/resume
lifecycle, `query_workflows`, `list_connections`, `list_subscriptions`) stays a catalog
opt-in: an author adds `{type:"platform", op}` explicitly. The rationale for the cut list
lives in the [build-kit-tools-cleanup workspace](../projects/build-kit-tools-cleanup/research.md).

A few ops worth naming:

| Op | Endpoint | Gate | Notes |
| --- | --- | --- | --- |
| `discover_tools` | `POST /api/tools/discover` | read (auto-allow) | Tool discovery; turns plain-language use cases into Agenta-shaped tools (see below). Renamed from `find_capabilities` (hard migrate, no alias). |
| `discover_triggers` | `POST /api/triggers/discover` | read (auto-allow) | Trigger discovery. Renamed from `find_triggers` (hard migrate, no alias). |
| `query_spans` | `POST /api/spans/query` | read (auto-allow) | Read spans from past runs, so the builder can verify its own work. The op schema mirrors `SpansQueryRequest`; a drift contract test pins the two together. |
| `commit_revision` | `POST /api/workflows/revisions/commit` | mutating (approval) | "Update yourself": binds `workflow_revision.workflow_variant_id` ← `$ctx.workflow.variant.id`, so the agent can only ever commit a revision to its own variant. |
| `test_run` | handler `tools.agenta.test_run` | mutating (approval) | Run the agent's own variant once and return a digest + verdict. Handler mode, flag-gated off, not in the overlay yet (see below). |

This mirrors the evaluators catalog pattern (`api/oss/src/resources/evaluators/evaluators.py`,
a code-defined table of named ops). Multi-step operations (e.g. create-then-commit) are composed
by the harness across several endpoint-wrapper calls, guided by a skill, not collapsed into a
new convenience endpoint. We expose the endpoints we have; a handler op is the one exception,
reserved for logic that cannot be a thin endpoint wrapper.

### Server-handled ops (handler mode)

Most platform ops are thin wrappers over an existing endpoint. A **handler-mode** op carries
real server-side logic instead: the catalog entry sets `handler` (a reserved `tools.agenta.<op>`
call-ref) rather than `method`+`path`, and the resolver emits a `CallbackToolSpec` with that
`call_ref` plus spec-level `contextBindings` and `timeoutMs`. The call routes through
`POST /tools/call`, where a reserved-ref registry
(`api/oss/src/core/tools/platform_handlers.py`) dispatches it to a registered Python handler.
An unknown reserved ref fails loud with a 404.

The first handler op is `test_run`: it hydrates the bound variant's revision, applies an
optional in-memory `delta` (which requires `EDIT_WORKFLOWS`), invokes the workflow headless
with a server-minted token, digests the transcript and spans, and returns a verdict (the
terminal result wins). It carries a recursion marker (inert until the runner half lands) and a
120s ceiling.

**Status:** the server half only. Resolution of handler-mode ops is gated off by
`AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` (default off) until the runner learns to dispatch a
reserved `call_ref` with spec-level context injection and `timeoutMs`; `test_run` joins the
overlay when that flips. Contract and slice plan:
[build-kit-tools-cleanup api-design](../projects/build-kit-tools-cleanup/api-design.md).

## Tool discovery: `discover_tools`

Before an agent can attach a tool it has to find the right one. `discover_tools` (named
`find_capabilities` until the build-kit cleanup hard-migrated it, no alias) turns a set
of plain-language use cases into Agenta-shaped tools, each integration's connection state, and
operating guidance, in one call, so a builder agent never guesses slugs or learns Composio.

- **Endpoint:** `POST /tools/discover` (project-scoped via caller auth, `VIEW_TOOLS`). Request:
  `{use_cases: string[], provider?: "composio", limit_alternatives?: 3}`. Response: the
  `CapabilitiesResult` contract (`capabilities[]`, `connections[]`, `guidance`, `ready`,
  `notes`).
- **What it does:** wraps Composio's `COMPOSIO_SEARCH_TOOLS` and translates the result to Agenta
  concepts (`integration` + `action`, connection slugs, our `POST /tools/connections/`
  affordance). The raw Composio slug rides along only as an opaque `provider_action`. It reports
  each integration's connection state (`ready` / `needs_auth` / `needs_input`) read fresh from
  the project's `gateway_connections`; the tool/schema half is cached (the search runs an LLM
  internally, so it is a few seconds).
- **Scope (v1):** action tools only. A use case that reads like a trigger ("listen for…") is
  flagged in `notes` and on the capability; event listening is a separate trigger subscription
  (a follow-up). Composio has no semantic trigger search.
- **Agent-facing tool:** `discover_tools` is the first [platform tool](#platform-tools-existing-agenta-endpoints).
  An agent config declares it as `{type:"platform", op:"discover_tools"}`, and
  `platform.resolve_tools` emits a `CallbackToolSpec` with a direct `call` to
  `POST /api/tools/discover`, so the model calls it end to end (no `/tools/call` hop). The
  original server-side `/tools/call` `tools.agenta.find_capabilities` dispatch is deleted; the
  reserved `tools.agenta.*` namespace now belongs to the
  [handler registry](#server-handled-ops-handler-mode). The runner needs no change.

The contract and the field-by-field Composio→Agenta mapping live in the
[tool-discovery design](../projects/tool-discovery/design.md). The setup loop
(discover → wire connections → build → test → schedule) is one ordered playbook skill,
`build-an-agent` (slug `__ag__build_an_agent`), which replaced the three earlier authoring
skills; see the [skills port](../projects/build-kit-tools-cleanup/skills-port.md).

The skill body is a short router. It loads every turn, so before the generic loop it checks a
bundled `references/agent-templates/index.md` match table for a playbook that fits the user's
ask. When one matches, the builder reads that playbook and follows it; a playbook layers one
use case (changelog writer, issue triager, support router, and so on) onto the loop and never
drops its approval stops. When none matches, the builder falls back to the generic loop.
The playbooks ship beside the skill as `references/agent-templates/<key>.md`, one per home-page
template (28 today), plus the two field references `references/config-schema.md` and
`references/trigger-inputs.md`. The index and every playbook are generated from the
`agent_templates` package in `sdks/python/agenta/sdk/agents/adapters/`, so the router table can
never drift from the files that exist. The canonical playbook format lives in the
[agent-templates workspace](../projects/agent-templates/playbook-spec.md), and the
`write-template-playbooks` repo skill authors one.

## The whole picture

| Tool type | Resolves to | Who executes | Where | Secret handling |
| --- | --- | --- | --- | --- |
| Built-in | a name | the harness | in the harness | none |
| Gateway | `callback` spec + `call_ref` | the Agenta service | back at the service (`/tools/call`), relayed via files on Daytona | key and connection auth stay server-side |
| Reference | `callback` spec + `workflow.*` `call_ref` | the Agenta service | the referenced workflow revision, server-side | connections/secrets stay server-side |
| Platform | `callback` spec + direct `call` | the Agenta service | the exposed endpoint, called directly (no `/tools/call` hop) | caller credential reused; self-targeting ids bound server-side |
| Code | `code` spec + `env` | the runner | a local subprocess | only the tool's own secrets, scoped to the child |
| Client | `client` spec | the browser | the user's browser, next turn | none |
| MCP | resolved server + `env` | a server process | a stdio child the daemon launches | secrets injected into the server env |

## Where this lives

| Concern | File |
| --- | --- |
| Declared tool configs | `sdks/python/agenta/sdk/agents/tools/models.py` |
| Resolved tool specs | `sdks/python/agenta/sdk/agents/tools/models.py` (`ResolvedToolSet`) |
| MCP config | `sdks/python/agenta/sdk/agents/mcp/models.py` |
| SDK resolution algorithm | `sdks/python/agenta/sdk/agents/tools/resolver.py` |
| SDK platform composition (`resolve_tools`/`resolve_mcp`) | `sdks/python/agenta/sdk/agents/platform/resolve.py` |
| Platform-op catalog (the `op` table + schema/context-binding resolution) | `sdks/python/agenta/sdk/agents/platform/op_catalog.py` |
| Platform tool resolver (catalog → `CallbackToolSpec` + `call`) | `sdks/python/agenta/sdk/agents/platform/platform_tools.py` |
| `x-ag-type-ref` schema expansion | `sdks/python/agenta/sdk/agents/platform/_schema.py` |
| Service entrypoints (shims + MCP gate) | `services/oss/src/agent/tools/resolver.py`, `__init__.py` |
| Gateway resolver (calls `/tools/resolve`) | `sdks/python/agenta/sdk/agents/platform/gateway.py` (shim: `services/oss/src/agent/tools/gateway.py`) |
| Named-secret resolution (`/secrets/resolve`) | `sdks/python/agenta/sdk/agents/platform/secrets.py` (shim: `services/oss/src/agent/tools/secrets.py`) |
| API resolve + execute | `api/oss/src/core/tools/service.py`, `api/oss/src/apis/fastapi/tools/router.py` |
| Tool discovery (search + Composio→Agenta translation) | `api/oss/src/core/tools/discovery.py`, `service.py` (`discover_capabilities`) |
| Discovery endpoint + reserved-handler dispatch | `api/oss/src/apis/fastapi/tools/router.py` (`/tools/discover`, `_call_reserved_agenta_tool`) |
| Server-side platform-op handlers (reserved-ref registry, `test_run`) | `api/oss/src/core/tools/platform_handlers.py` |
| Build-kit overlay defaults (`DEFAULT_BUILD_KIT_OPS` + skill/tool embeds) | `api/oss/src/apis/fastapi/applications/overlay.py` |
| Wire contract | `services/agent/src/protocol.ts`, `sdks/python/agenta/sdk/agents/utils/wire.py` |
| Tool-delivery fork (branch on `mcpTools`) | `services/agent/src/engines/sandbox_agent/mcp.ts` |
| Runtime dispatch (branch on `kind`) | `services/agent/src/tools/dispatch.ts` |
| Callback transport | `services/agent/src/tools/callback.ts` |
| Code execution | `services/agent/src/tools/code.ts` |
| Daytona/non-Pi relay (runner-side loop) | `services/runner/src/tools/relay.ts` |
| In-sandbox relay writer + wire protocol | `services/runner/src/tools/relay-client.ts`, `relay-protocol.ts` |
| Relay wake sources (local `fs.watch`, Daytona watch exec) | `services/runner/src/tools/relay-watch.ts` |
| Pi native delivery | `services/agent/src/extensions/agenta.ts` |
| `agenta-tools` server for non-Pi harnesses | `services/agent/src/tools/mcp-bridge.ts`, `services/agent/src/tools/mcp-server.ts` |
| Capability probe | `services/agent/src/engines/sandbox_agent/capabilities.ts` |
| Permission decision (shared by both gates) | `services/runner/src/permission-plan.ts` |
| ACP responder (`ApprovalResponder`) | `services/runner/src/responder.ts` |
| Tool relay enforcement | `services/runner/src/tools/relay.ts` |

## Status and known gaps

- **User MCP is effectively dead on the default path.** Resolution is off unless
  `AGENTA_AGENT_MCPS_ENABLED` is truthy, and even on, the runner drops user MCP for Pi. Pi and
  Agenta are the default harnesses, so `mcp_servers` is a silent no-op for most runs. It would
  reach Claude only. Do not confuse this with the `agenta-tools` server, which is an internal
  tool-delivery vehicle for Claude, not a user MCP server.
- A tool's `permission` is honored on both harnesses now, including Pi's own builtins. Claude
  checks its rendered settings file first, then the ACP responder. Pi has no separate
  harness-side settings gate, so the relay decides everything Pi runs: gateway and code tools
  directly, and builtins relayed through the extension's `tool_call` hook. An `ask` pauses the
  run and asks a human on either harness.
- Gateway tools support only the `composio` provider today; other providers raise.
- The `render` hint is plumbed end to end on the runner side, but full frontend projection of
  every render kind is still in progress.
- Gateway calls on Daytona depend on the file relay, because the sandbox cannot reach Agenta
  directly. The relay is also used by the non-Pi internal MCP channel on local runs.
- **Code tools are standard-library-only.** The image ships `python3` and `node`, but the
  child env has no package install and no module path to the runner's dependencies, so a tool
  cannot import third-party packages.
- **Tool discovery is agent-usable** as the `discover_tools` platform tool: an agent config
  declares `{type:"platform", op:"discover_tools"}` and the model calls
  `POST /api/tools/discover` directly. The legacy server-side `/tools/call`
  `tools.agenta.find_capabilities` dispatch is deleted; the reserved namespace now serves the
  handler registry. Trigger discovery is its own read op, `discover_triggers`.
- **Platform tools are SDK-resolved from a catalog of ~20 ops**; the playground build-kit
  overlay embeds an explicit 12-op default (`DEFAULT_BUILD_KIT_OPS`), and the rest stay
  catalog opt-ins. More ops are a data add to the catalog. The reference tool still executes
  through the `/tools/call` `workflow.*` route; moving it to a direct `call` and removing that
  route is a later phase.
- **Handler-mode ops are server-half only.** `test_run` exists behind
  `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` (default off) and is not in the overlay; the runner
  half (reserved `call_ref` dispatch, spec-level context injection, `timeoutMs`) is deferred.
  See the [build-kit-tools-cleanup workspace](../projects/build-kit-tools-cleanup/status.md).
- **Old op names are gone, hard.** `find_capabilities` and `find_triggers` no longer resolve;
  a committed revision that still carries them fails loud (`UnknownPlatformOpError`) until the
  [revision sweep script](../projects/build-kit-tools-cleanup/scripts/sweep_platform_op_renames.py)
  runs against that database.
- **Harness capabilities are probed but not consumed.** The runner probes `HarnessCapabilities`
  per run (`engines/sandbox_agent/capabilities.ts`), uses them only for the internal `mcpTools`
  delivery branch, and returns them on the `/run` result. The result field is parsed into
  `AgentResult.capabilities` and then read by nobody: no `/inspect` surface, no frontend gate,
  no service check. `/health` advertises `engines` and `harnesses` but no capabilities. The
  [harness-capabilities proposal](../../projects/harness-capabilities/proposal.md) is the plan
  to make this a real, consumed contract.
