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

Resolution is the service's job. The composition point is `resolve_agent_resources` in
`services/oss/src/agent/tools/resolver.py`. It hands the declared configs to the SDK's
`ToolResolver` (`sdks/python/agenta/sdk/agents/tools/resolver.py`), wired with two Agenta
adapters: a `VaultToolSecretProvider` for secrets and an `AgentaGatewayToolResolver` for
gateway tools. The SDK owns the generic algorithm; the service plugs in the Agenta-specific
HTTP calls. The SDK never imports the service.

Resolution runs per type:

- **Builtin** passes straight through. The name lands in `builtin_names`. No network call.
- **Code** has its declared `secrets` looked up by name. The service resolves them through
  `POST /secrets/resolve` (the named-secret vault path in `services/oss/src/agent/tools/secrets.py`)
  and injects the values into the spec's `env`. The script itself is not run here.
- **Client** passes through to a `ClientToolSpec`. There is nothing to resolve server-side.
- **Gateway** is the involved one. `AgentaGatewayToolResolver`
  (`services/oss/src/agent/tools/gateway.py`) posts the references to the API's
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
`MCPResolver` injects each server's named secrets into its `env`, the same way code tools get
theirs. By default this is off, so MCP is currently opt-in.

The whole resolved bundle then rides the `/run` wire: built-in names in `tools`, resolved
specs in `customTools`, the callback in `toolCallback`, and resolved MCP servers in
`mcpServers`.

## How tools get delivered (the harness fork)

The runner has to hand resolved tools to a harness, and harnesses do not accept tools the same
way. The runner branches on a capability, `mcpTools`, not on the harness name. A harness that
reports it can take tools over MCP gets them that way; a harness that cannot gets them
natively. Today that splits cleanly into two paths.

- **Pi takes native tools.** Pi has an extension API, so the runner registers each resolved
  spec as a Pi tool directly. In-process this is `buildCustomTools` in
  `services/agent/src/engines/pi.ts`; over ACP it is the bundled Pi extension
  (`services/agent/src/extensions/agenta.ts`), which does the same registration from inside
  Pi. Either way Pi runs the tool body the runner gives it.
- **Claude and other ACP harnesses take MCP.** They cannot accept a native tool, so the runner
  exposes the same resolved specs as a small synthetic MCP server named `agenta-tools`
  (`services/agent/src/tools/mcp-bridge.ts` launches `services/agent/src/tools/mcp-server.ts`).
  This bridge is given only public metadata (names, descriptions, schemas) and a relay
  directory. It never receives the `call_ref`, the code, the scoped secrets, or the callback
  auth. When the model calls a tool, the bridge relays the request back to the runner, and the
  runner runs the private spec from memory.

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
stdio server (`toAcpMcpServers` in `services/agent/src/engines/sandbox_agent.ts`). The daemon
launches the server's `command` with the resolved `env`, and the harness talks to it over the
MCP protocol. Two limits apply today: MCP is gated behind `AGENTA_AGENT_ENABLE_MCP`, and Pi's
ACP adapter does not forward user MCP servers, so MCP currently reaches Claude-style harnesses
only.

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
| Service resolution composition | `services/oss/src/agent/tools/resolver.py` |
| Gateway resolver (calls `/tools/resolve`) | `services/oss/src/agent/tools/gateway.py` |
| Named-secret resolution (`/secrets/resolve`) | `services/oss/src/agent/tools/secrets.py` |
| API resolve + execute | `api/oss/src/core/tools/service.py`, `api/oss/src/apis/fastapi/tools/router.py` |
| Wire contract | `services/agent/src/protocol.ts`, `sdks/python/agenta/sdk/agents/utils/wire.py` |
| Runtime dispatch (branch on `kind`) | `services/agent/src/tools/dispatch.ts` |
| Callback transport | `services/agent/src/tools/callback.ts` |
| Code execution | `services/agent/src/tools/code.ts` |
| Pi native delivery | `services/agent/src/engines/pi.ts`, `services/agent/src/extensions/agenta.ts` |
| MCP bridge for non-Pi harnesses | `services/agent/src/tools/mcp-bridge.ts`, `services/agent/src/tools/mcp-server.ts` |
| Permission policy | `services/agent/src/responder.ts` |

## Status and known gaps

- MCP server resolution is off unless `AGENTA_AGENT_ENABLE_MCP` is truthy, so MCP is opt-in.
- Pi's ACP adapter does not forward user-declared MCP servers; MCP reaches Claude-style
  harnesses only.
- `needs_approval` is honored only by permission-gating harnesses (Claude over ACP). It is a
  no-op on Pi.
- Gateway tools support only the `composio` provider today; other providers raise.
- The `render` hint is plumbed end to end on the runner side, but full frontend projection of
  every render kind is still in progress.
- Gateway calls on Daytona depend on the file relay, because the sandbox cannot reach Agenta
  directly. The relay is also used by the non-Pi MCP bridge on local runs.
</content>
</invoke>
