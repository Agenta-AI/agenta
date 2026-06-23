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

MCP servers are a sibling field, `AgentConfig.mcp_servers`, not a tool type. They are declared
in `sdks/python/agenta/sdk/agents/mcp/models.py` and resolved alongside tools. They are
covered in their own section below.

## Three orthogonal axes

The `type` field is one of three independent axes a tool config carries. They do not interact,
and the runner reads each one separately. This is the single idea that makes the tool model
extensible without new branches everywhere.

- **Executor (`type` at config time, `kind` at runtime):** who fulfils a call. This is the
  axis that decides *where execution happens*, and the rest of this page is mostly about it.
- **`needs_approval`:** whether a call waits for a human yes/no before it runs. Default false.
- **`render`:** an optional generative-UI hint so the frontend can draw the call and its
  result as something richer than text.

A code tool can need approval. A gateway tool can carry a render hint. The axes compose.

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

MCP servers resolve on the same path but only when `AGENTA_AGENT_ENABLE_MCP` is truthy. The
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
  spec as a Pi tool directly. In-process this is `buildCustomTools` in
  `services/agent/src/engines/pi.ts`; over ACP it is the bundled Pi extension
  (`services/agent/src/extensions/agenta.ts`), which reads the public specs from
  `AGENTA_TOOL_PUBLIC_SPECS` and does the same registration from inside Pi. Either way Pi runs
  the tool body the runner gives it. Pi gets no MCP server at all here: `buildSessionMcpServers`
  returns an empty list for Pi, so neither the synthetic `agenta-tools` server nor any user
  MCP server is attached.
- **Claude and other ACP harnesses take MCP.** They cannot accept a native tool, so the runner
  exposes the same resolved specs as a small synthetic MCP server named `agenta-tools`
  (`services/agent/src/tools/mcp-bridge.ts` launches `services/agent/src/tools/mcp-server.ts`).
  This bridge is given only public metadata (names, descriptions, schemas) and a relay
  directory. It never receives the `call_ref`, the code, the scoped secrets, or the callback
  auth. When the model calls a tool, the bridge relays the request back to the runner, and the
  runner runs the private spec from memory. This `agenta-tools` server is a tool DELIVERY
  vehicle, not a user MCP server: it carries gateway and code tools, and it exists only on the
  Claude path.

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

There is one transport wrinkle. On Daytona the in-sandbox process cannot reach Agenta over the
network. So the call is relayed through files instead: the in-sandbox tool writes a request
file to a relay directory, the runner (which can reach Agenta) reads it, performs the same
`/tools/call` POST, and writes the answer back (`relayToolCall` in `dispatch.ts`,
`startToolRelay` in `tools/relay.ts`). Same callback, same envelope, different delivery. The
non-Pi MCP bridge uses this same relay even on local runs, because the bridge runs in a
separate process that the runner keeps blind to the private spec.

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
in-sandbox; `runResolvedTool` throws if one is ever dispatched there, and the MCP bridge filters
client tools out of its advertised list. Instead, when the harness calls a client tool, the
runner emits an `interaction_request` event of kind `client_tool`. The `/messages` egress
projects it to a browser component, the browser runs it, and the result returns in the next
`/messages` turn, matched back by id. This is the cross-turn human-in-the-loop path, the same
mechanism approvals use. A client tool is the right type whenever only the user's environment
can answer: their location, a file on their machine, a confirmation only they can give.

### Built-in tools: the harness runs them natively

Execution is the harness's own. A built-in tool is just a name. The runner adds it to the
session's allowlist and Pi runs its own implementation of `read`, `write`, `web_search`, and so
on. Nothing is resolved and nothing is delivered. Note that built-ins are a Pi concept here;
they are not delivered to non-Pi harnesses over ACP, which bring their own native tool set.

### MCP servers: a server process the daemon launches

Execution happens in a separate server process. A declared MCP server is resolved server-side
(secrets injected into its `env`) and, for MCP-capable harnesses, passed to the ACP daemon as a
stdio server (`toAcpMcpServers` in `services/agent/src/engines/sandbox_agent/mcp.ts`). The
daemon launches the server's `command` with the resolved `env`, and the harness talks to it
over the MCP protocol.

In practice user MCP is dead on the default path, and for two reasons that stack. First,
resolution is gated behind `AGENTA_AGENT_ENABLE_MCP`, which is off by default, so the servers
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

**`needs_approval`** gates a call on a human answer. Only permission-gating harnesses honor it.
Claude over ACP raises a permission request, which the runner surfaces as an
`interaction_request` of kind `permission` and answers through a `PolicyResponder`
(`services/agent/src/responder.ts`). With no human at the keyboard, the policy auto-approves by
default because the tools are backend-resolved and trusted, and a per-run policy or env
override can flip it to deny. Pi has no permission concept, so the flag is a no-op there.

**`render`** is a generative-UI hint. The runner does not act on it; it copies the hint from the
spec onto the `tool_call` and `tool_result` events so the egress can project it to the frontend
without a spec lookup. The hint can name a prebuilt component, ship rendered source, or carry a
declarative UI spec (`RenderHint` in `protocol.ts`).

## The whole picture

| Tool type | Resolves to | Who executes | Where | Secret handling |
| --- | --- | --- | --- | --- |
| Built-in | a name | the harness | in the harness | none |
| Gateway | `callback` spec + `call_ref` | the Agenta service | back at the service (`/tools/call`), relayed via files on Daytona | key and connection auth stay server-side |
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
| Service entrypoints (shims + MCP gate) | `services/oss/src/agent/tools/resolver.py`, `__init__.py` |
| Gateway resolver (calls `/tools/resolve`) | `sdks/python/agenta/sdk/agents/platform/gateway.py` (shim: `services/oss/src/agent/tools/gateway.py`) |
| Named-secret resolution (`/secrets/resolve`) | `sdks/python/agenta/sdk/agents/platform/secrets.py` (shim: `services/oss/src/agent/tools/secrets.py`) |
| API resolve + execute | `api/oss/src/core/tools/service.py`, `api/oss/src/apis/fastapi/tools/router.py` |
| Wire contract | `services/agent/src/protocol.ts`, `sdks/python/agenta/sdk/agents/utils/wire.py` |
| Tool-delivery fork (branch on `mcpTools`) | `services/agent/src/engines/sandbox_agent/mcp.ts` |
| Runtime dispatch (branch on `kind`) | `services/agent/src/tools/dispatch.ts` |
| Callback transport | `services/agent/src/tools/callback.ts` |
| Code execution | `services/agent/src/tools/code.ts` |
| Daytona/non-Pi relay | `services/agent/src/tools/relay.ts` |
| Pi native delivery | `services/agent/src/engines/pi.ts`, `services/agent/src/extensions/agenta.ts` |
| `agenta-tools` server for non-Pi harnesses | `services/agent/src/tools/mcp-bridge.ts`, `services/agent/src/tools/mcp-server.ts` |
| Capability probe | `services/agent/src/engines/sandbox_agent/capabilities.ts` |
| Permission policy | `services/agent/src/responder.ts` |

## Status and known gaps

- **User MCP is effectively dead on the default path.** Resolution is off unless
  `AGENTA_AGENT_ENABLE_MCP` is truthy, and even on, the runner drops user MCP for Pi. Pi and
  Agenta are the default harnesses, so `mcp_servers` is a silent no-op for most runs. It would
  reach Claude only. Do not confuse this with the `agenta-tools` server, which is an internal
  tool-delivery vehicle for Claude, not a user MCP server.
- `needs_approval` is honored only by permission-gating harnesses (Claude over ACP). It is a
  no-op on Pi.
- Gateway tools support only the `composio` provider today; other providers raise.
- The `render` hint is plumbed end to end on the runner side, but full frontend projection of
  every render kind is still in progress.
- Gateway calls on Daytona depend on the file relay, because the sandbox cannot reach Agenta
  directly. The relay is also used by the non-Pi MCP bridge on local runs.
- **Code tools are standard-library-only.** The image ships `python3` and `node`, but the
  child env has no package install and no module path to the runner's dependencies, so a tool
  cannot import third-party packages.
- **Harness capabilities are probed but not consumed.** The runner probes `HarnessCapabilities`
  per run (`engines/sandbox_agent/capabilities.ts`), uses them only for the internal `mcpTools`
  delivery branch, and returns them on the `/run` result. The result field is parsed into
  `AgentResult.capabilities` and then read by nobody: no `/inspect` surface, no frontend gate,
  no service check. `/health` advertises `engines` and `harnesses` but no capabilities. The
  [harness-capabilities proposal](../../projects/harness-capabilities/proposal.md) is the plan
  to make this a real, consumed contract.
</content>
</invoke>
