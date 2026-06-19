# Research: the verified current state

This is the map a prior review drew and this document re-verified against the code on
2026-06-19. Every claim cites `file:line`. Read it as the ground truth the plan builds on.

The headline: the tool **vocabulary** already lives in the SDK and parses standalone, but
tool **resolution** and **secret resolution** live only in the service, behind HTTP calls to
the Agenta API. A standalone run has the words but not the machinery.

## The pipeline, end to end

A configured tool travels through four stages before a harness can call it.

1. **Parse**: turn a loose config entry into a typed tool def. *In the SDK already.*
2. **Resolve**: turn a typed def into a wire-ready runnable spec (a name, a description, an
   input schema, and either a `callRef`, a code snippet, or a client marker). *Service only.*
3. **Supply secrets**: fetch the vault values a code tool or MCP server needs. *Service
   only, and partly broken even there (see below).*
4. **Execute**: actually run the call when the model invokes the tool. *Lives in the TS
   runner; the in-process Pi engine already runs code and callback tools.*

Stage 1 is portable today. Stages 2 and 3 are the gap. Stage 4 is closer than it looks.

## Stage 1: parsing (already in the SDK, standalone-ready)

The neutral tool vocabulary and its parser live in the published SDK, with no dependency on
the Agenta API.

- `sdks/python/agenta/sdk/agents/tool_defs.py:174`: `parse_tool_def` coerces one loose
  config entry into a typed def. `parse_tool_defs` (`:211`) does a list;
  `parse_mcp_servers` (`:223`) does MCP servers.
- The tool union spans four executors, discriminated on `type`:
  `BuiltinToolDef` (`:55`), `GatewayToolDef` (`:63`), `CodeToolDef` (`:79`),
  `ClientToolDef` (`:93`), joined as `AgentToolDef` (`:104`).
- Two orthogonal fields ride on every tool: `needs_approval` and `render`, both on
  `_ToolDefBase` (`:43`).
- `McpServer` (`:117`) is a sibling of `tools`, not a tool variant. It declares a transport
  (`stdio` or `http`), a command, and an env-var-to-vault-secret-name map.

A standalone user can already call `parse_tool_defs(agent.tools)` and get typed defs. The
parser is permissive on input and strict on output, and it never touches the network.

## Stage 2: resolution (service only)

Resolution lives in the service, not the SDK.

- `services/oss/src/agent/tools.py:164`: `resolve_tools` splits the parsed defs by executor
  and resolves each kind:
  - **gateway** (`:67`, `_resolve_gateway`): POSTs the refs to the Agenta API
    `POST /tools/resolve` (`:89`), then sets a callback to `POST /tools/call` (`:120`). The
    Composio key and connection auth stay server-side by design.
  - **code** (`:127`, `_resolve_code`): builds the spec locally from the def, then resolves
    the tool's declared secrets into a scoped `env` (`:134`).
  - **client** (`:153`, `_client_spec`): builds a name-plus-schema spec locally, no callback.
- `resolve_mcp_servers` (`:211`) resolves each declared server's secret env and returns
  wire-ready server dicts.

Read closely, only the **gateway** branch truly needs the network. The code and client
branches build their specs from local data; the only network call inside them is the secret
fetch (stage 3). That is the seam the plan exploits: most of `resolve_tools` is already
offline-capable logic that simply lives in the wrong layer.

The service feeds the resolved output onto the `SessionConfig` and never the SDK. The wiring
is in `services/oss/src/agent/app.py`: `resolve_tools` and `resolve_mcp_servers` are
awaited (`:91`-`:92`), then their output is placed on `SessionConfig` fields `builtin_tools`,
`custom_tools`, `tool_callback` (`:99`-`:101`). The SDK consumes these; it never produces
them.

## Stage 3: secrets (service only, and the named-secret consumer is not built yet)

Secrets live in one project vault. One table, one CRUD stack, encrypted at rest. A secret's
`kind` decides how it behaves at run time. Two kinds matter here.

- **`provider_key`**: a provider-indexed LLM credential. `data` is
  `{kind: "openai", provider: {key: "..."}}`, the inner `kind` a fixed provider enum. The
  service consumes it in `resolve_harness_secrets` (`services/oss/src/agent/secrets.py:38`),
  which fetches the vault via `GET /secrets/` (`:54`) and maps each provider to its env var
  (`openai -> OPENAI_API_KEY`). This path works. The same filter-and-map lives in the API at
  `get_user_llm_providers_secrets` (`api/oss/src/core/secrets/utils.py:54`).
- **`custom_secret`**: a free-text `name -> value` entry. `header.name` is the user-chosen
  name (for example `GITHUB_TOKEN`); `data` is `{secret: {key: "..."}}`, with no provider
  enum. It is storage-only this iteration by design. Nothing reads it, there is no env-var
  mapping, and it is not injected into the agent runtime.

Same endpoint, same table, same encryption and CRUD. The only difference is the `kind` and
what consumes the value.

A code tool and an MCP server name `custom_secret` entries. `resolve_named_secrets`
(`services/oss/src/agent/secrets.py:75`) is what they would use: it POSTs the requested names
to a consumer endpoint (`:97`) and reads back `{name: value}`. That consumer is not built yet.
The vault router exposes only CRUD (`api/oss/src/apis/fastapi/vault/router.py:36`-`:74`:
create, list, read, update, delete) and no resolve route. The named-secrets effort is
storage-only this iteration and says so at `docs/design/vault-named-secrets/context.md:23`:
"Do **not** inject these secrets into the agent runtime, sandbox, or any invocation."

So `resolve_named_secrets` swallows the missing-endpoint response and returns `{}`
(`secrets.py:101`-`:107`), logging a warning. A code tool or MCP server that declares a custom
secret gets an empty env today, on every path including the server. This is the expected
current state given the storage-only design, not a bug to fix in this effort. Building the
consumer is later, coordinated work (the plan's Phase 4 and
[open-issues.md](../open-issues.md)). For the standalone slice, secrets come from a local
`SecretResolver` (env by default), so the offline path does not wait on the vault consumer at
all.

## Stage 4: execution (the TS runner, and the in-process Pi engine already does most of it)

Execution lives in the TypeScript runner under `services/agent/src/tools/`:
`code.ts` runs a code snippet, `mcp-server.ts` bridges resolved tools over MCP, `execute.ts`
(`runResolvedTool`) is the shared dispatcher, `client.ts` and `relay.ts` round it out.

The important and under-appreciated fact: the **in-process Pi engine already executes tools**.
`services/agent/src/engines/pi.ts` builds Pi custom tools and branches on the executor
`kind` (`pi.ts:144`):

- `code`: runs the snippet in a sandbox subprocess with its scoped secret env (`pi.ts:169`).
- `callback`: POSTs back to Agenta's `/tools/call` (`pi.ts:179`).
- `client`: skipped in-process; there is no browser to answer (`pi.ts:165`).

`code.ts`'s own header says it is "Shared by every delivery path that runs code locally:
engines/pi.ts (in-process Pi), extensions/agenta.ts (Pi under rivet), tools/mcp-server.ts."
This matters because `LocalBackend`'s Pi path is the **bundled in-process Pi engine**. So once
`LocalBackend` ships that bundle, code-tool *execution* comes nearly for free. The work is to
hand the engine a correctly resolved code spec with its env filled in, which is stages 2 and 3.

What the in-process Pi engine does **not** do is MCP. `pi.ts:58` hard-codes
`mcpTools: false`. MCP delivery and execution live only on the rivet path (`rivet.ts`, the
capability gate at `:799`), which the standalone user does not have. MCP local support is
therefore a later phase that needs its own executor, not a reuse of the Pi engine.

## The delivery contract the SDK already speaks

The resolved output rides on neutral types the SDK owns, so a local resolver has a clear
target to produce.

- `SessionConfig` (`sdks/python/agenta/sdk/agents/dtos.py:498`) carries `builtin_tools`,
  `custom_tools`, `tool_callback`, and `mcp_servers` (`:512`-`:517`).
- The harness adapters in `sdks/python/agenta/sdk/agents/adapters/harnesses.py` only *shape*
  already-resolved specs; they never resolve. Typed `ToolSpec` models pass executor fields
  (`kind`, `runtime`, `code`, `env`, `callRef`) through to the wire. `PiHarness` keeps
  built-ins and delivers specs natively; `ClaudeHarness` drops built-ins and routes over MCP.

So the local resolver's job is well defined: produce the same `builtin_tools` /
`custom_tools` / `tool_callback` / `mcp_servers` shapes the service produces, from local data.
Everything downstream already accepts them.

## The current state, per tool kind

| Kind | Resolve today | Execute under `LocalBackend` (Pi) | Standalone reach |
| --- | --- | --- | --- |
| **builtin** | trivial; just the name (`tools.py:183`) | yes, runs in-harness | **fully offline.** Closest to free. |
| **code** | spec built locally; only the secret fetch is remote (`tools.py:127`) | yes, `pi.ts:169` already runs it | **offline if secrets come from env.** The spec builder must move to the SDK; secrets need a local source. |
| **client** | spec built locally (`tools.py:153`) | skipped in-process (`pi.ts:165`) | needs a browser/fulfiller; **out of offline reach** without a UI. |
| **gateway** | requires `POST /tools/resolve` + `/tools/call` (`tools.py:67`) | callback to Agenta (`pi.ts:179`) | **server-bound by design.** Connected-standalone only; the provider key stays server-side. |
| **MCP** | spec built locally; secret env is remote (`tools.py:211`) | not supported in-process (`pi.ts:58`) | needs a local MCP executor; **later phase.** |

## What this means for the plan

Three findings shape the phasing:

1. **Built-in and code tools are within reach of a first offline slice.** Built-in is just a
   name. Code's spec builder is local logic in the wrong layer, and the in-process Pi engine
   already executes code. The only true blocker for code is secrets, which env solves.
2. **Named-secret consumption is not built, by design.** Custom secrets are storage-only this
   iteration, so any path that relies on the vault for code or MCP secrets either waits on the
   future consumer endpoint or supplies secrets another way (env, a pluggable resolver). The
   offline slice takes the second route.
3. **Gateway and MCP are genuinely harder.** Gateway must stay server-bound. MCP needs an
   executor the in-process Pi engine does not have. Both belong in later phases, framed as
   open decisions, not promised in the first slice.
