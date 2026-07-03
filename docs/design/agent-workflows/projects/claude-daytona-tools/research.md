# Research — Claude custom tools on Daytona

Verified state of the code on `origin/big-agents` (the stable base; the engine files were read
via `git show origin/big-agents:<path>` because another agent is editing `services/agent/src/`).
Every claim below carries a `file:line` (or `file`) reference.

## The one-line problem

On the **Daytona** sandbox, the **Claude** (MCP-client) harness receives **zero** custom tools of
any kind — gateway/callback, code, and client (`request_connection`) — and today it fails
**silently**. Pi works on Daytona because it has an in-sandbox writer (its bundled extension); Claude
has none.

## How tools reach a harness — three delivery paths, one execution path

There is exactly **one** place a resolved tool actually executes server-side, and it is harness- and
sandbox-agnostic. Everything else is just a *front-end* that turns a model's tool call into a request
the runner can answer.

### The single execution path: the runner-side relay loop

`startToolRelay(host, relayDir, specs, callback, policy, runContext, clientToolRelay)`
(`services/agent/src/tools/relay.ts:812`) runs **on the runner**, polls a relay directory for
`<id>.req.json` files, and for each one calls `executeRelayedTool` (`relay.ts:732`), which is the
single dispatch:

- `kind: "client"` → hands to `clientToolRelay.onClientTool`; on `"park"` it returns
  `CLIENT_TOOL_PARKED` and **writes no response file** (`relay.ts:741-761`, `:842`).
- `kind: "code"` → `runCodeTool` (gated off upstream; see below).
- `callback`/`call`/gateway (default) → `callDirect` / `callAgentaTool`, applying the private spec,
  the callback endpoint, and the callback authorization **in runner memory** (`relay.ts:774-803`).

It writes the answer to `<id>.res.json` (`relay.ts:847-848`). The relay-file protocol is the stable
contract: request `{ toolName, toolCallId, args }`, response `{ ok, text? , error? }`
(`relay.ts:578-587`, suffixes `:569-570`).

The loop reads/writes through a pluggable `RelayHost` (`relay.ts:687`):

- `localRelayHost()` — `node:fs` on the runner host (`relay.ts:694`).
- `sandboxRelayHost(sandbox)` — the **Daytona** host: `sandbox.runProcess("ls", …)`,
  `sandbox.readFsFile`, `sandbox.writeFsFile` against the **sandbox filesystem** over the daemon API
  (`relay.ts:709`).

**This loop already runs on Daytona.** The engine starts it for any run with tools, choosing
`sandboxRelayHost` when `plan.isDaytona` (`engines/sandbox_agent.ts:543-591`, gated on
`plan.useToolRelay = toolSpecs.length > 0`, `run-plan.ts:1022`). So the runner half of Daytona tool
delivery is **complete and harness-agnostic**.

### Front-end #1 — Pi (works on Daytona)

The bundled Pi extension (`services/agent/src/extensions/agenta.ts`) runs **inside** the harness
process. `registerTools` reads `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` + `AGENTA_AGENT_TOOLS_RELAY_DIR` from
env and registers each public spec as a Pi tool whose `execute` calls
`runResolvedTool(spec, params, { toolCallId, relayDir })` (`extensions/agenta.ts` `registerTools`).
With `relayDir` set, `runResolvedTool` → `relayToolCall(relayDir, …)` **writes the `.req.json` file
and polls for `.res.json`** (`tools/dispatch.ts` `relayToolCall`). On Daytona the extension runs in
the sandbox, so it writes to the **sandbox** relay dir, which is exactly what `sandboxRelayHost`
polls. This is the **in-sandbox writer** that makes Pi work; it is uploaded per-run by
`uploadPiExtensionToSandbox` (`engines/sandbox_agent/pi-assets.ts`) from the esbuild bundle
`EXTENSION_BUNDLE`.

### Front-end #2 — the internal MCP server (Claude, **local only**)

Claude takes tools over MCP only, so the runner synthesizes an internal MCP server from the run's
resolved tools: `startInternalToolMcpServer(specs, relayDir, log)`
(`services/agent/src/tools/tool-mcp-http.ts:182`). It is a tiny hand-rolled JSON-RPC-over-HTTP
server — **no MCP SDK dependency**, only `node:http`/`node:crypto` — that:

- serves `tools/list` from public metadata, filtering out `client` tools (`tool-mcp-http.ts:97-99`);
- on `tools/call` calls `runResolvedTool(spec, args, { toolCallId, relayDir })`
  (`tool-mcp-http.ts:123`) — i.e. **the same relay write/poll the Pi extension uses**, because
  `relayDir` is set.

`buildToolMcpServers` (`tools/mcp-bridge.ts:981`) starts it and returns a `type: "http"` ACP entry
`{ type, name: "agenta-tools", url, headers: [] }` pointing at the URL. The server **binds
`127.0.0.1`** (`tool-mcp-http.ts:49`) on an OS-assigned ephemeral port (`:264`).

**The defect:** `127.0.0.1` is the *runner's* loopback. Locally Claude and the runner share a host, so
it resolves. On Daytona Claude runs **inside the sandbox**, where `127.0.0.1` is the *sandbox's*
loopback — the runner's URL is dead. So `buildSessionMcpServers` **skips the internal channel
entirely when `isDaytona`** (`engines/sandbox_agent/mcp.ts:515-517`) and logs
`"daytona: N gateway tool(s) delivered via the file relay, not a loopback MCP URL"`
(`mcp.ts:518-523`).

That log is **false for Claude.** The file relay has no Claude writer — only Pi's extension writes
req files. So on Daytona, Claude is advertised **no MCP server and no tools**, and nothing in the
sandbox can ever produce a `.req.json`.

## Why the failure is silent

The capability gate `assertRequiredCapabilities` (`engines/sandbox_agent/capabilities.ts`) only checks
whether the harness *can* take tools over MCP — i.e. the probe reports `mcpTools` **and** `toolCalls`
(`capabilities.ts` `assertRequiredCapabilities`). Claude reports both `true`. The gate has **no notion
of channel reachability on this sandbox**, so it passes. The run then:

1. passes the gate (Claude advertises `mcpTools`/`toolCalls`),
2. skips the internal MCP channel because `isDaytona` (`mcp.ts:515`),
3. starts the relay loop with `sandboxRelayHost` (engine `:543`) — which polls forever and is never
   fed, because no in-sandbox Claude writer exists,
4. logs the misleading "delivered via the file relay" line,
5. returns `ok: true` with whatever Claude said using **zero tools**.

This was never validated green. (Background: `scratch/pr-4936-followup/02-client-tools-and-claude.md`
D3; QA memory: Claude+Daytona was blocked on credentials/credit, so the zero-tools path was never
exercised.) An **interim honest fail-loud error** for "MCP-client harness + Daytona + any custom tool"
ships separately in the client-tool-cleanup PR; this project is the **real fix** that makes the path
actually deliver tools.

## What already exists that a real fix can reuse

| Machinery | File | Reusable for Claude+Daytona? |
| --- | --- | --- |
| Runner relay loop (poll → execute → respond) | `relay.ts:812` `startToolRelay` | **Yes, unchanged** — already runs on Daytona via `sandboxRelayHost`. |
| Sandbox FS relay host | `relay.ts:709` `sandboxRelayHost` | **Yes, unchanged.** |
| Relay-file protocol + writer/poller | `relay.ts:569-587`, `dispatch.ts` `relayToolCall` | **Yes** — the in-sandbox writer must emit byte-identical req files. |
| Server-side dispatch (callback/gateway/client-park) | `relay.ts:732` `executeRelayedTool` | **Yes, unchanged.** |
| The MCP JSON-RPC server itself | `tool-mcp-http.ts:182` | **Yes** — relocate it into the sandbox; `HOST="127.0.0.1"` then means the *sandbox* loopback (correct). |
| Public-spec contract + env vars | `public-spec.ts`, `pi-assets.ts` `buildPiExtensionEnv` (`AGENTA_AGENT_TOOLS_PUBLIC_SPECS`/`_RELAY_DIR`) | **Yes** — the shim reads the same two vars the Pi extension does. |
| Per-run sandbox upload of a JS bundle | `pi-assets.ts` `uploadPiExtensionToSandbox`; esbuild `build:extension`; `EXTENSION_BUNDLE` | **Yes** — clone the pattern for a shim bundle. |
| In-sandbox process start | `daytona.ts` `installPiInSandbox` (`sandbox.runProcess npm install`); `mount.ts` `mountStorageRemote` (`sandbox.runProcess geesefs`) | **Yes** — same `runProcess` primitive starts the shim. |
| ACP MCP-server entry shape | `mcp.ts:306` `McpServerHttp` `{type,name,url,headers}` | **Yes, unchanged** — only the `url` host changes (sandbox loopback). |
| Daytona snapshot bake recipe | `sandbox-images/daytona/build_snapshot.py` | Optional optimization — bake the shim like `pi` is baked. The `-full` base ships **node** (Claude CLI is node), so no new runtime. |
| Claude Tool-Search disable | `engines/sandbox_agent.ts:171` `ENABLE_TOOL_SEARCH=false` | **Yes** — already applied to every Claude run and already reaches Daytona via env; tools-with-args keep their schema. No new work. |

**The only thing missing is an in-sandbox front-end for Claude** — the MCP analogue of Pi's extension.

## Constraints that bound the solution space

- **No credential may cross into the sandbox.** Today the internal MCP server carries only public
  metadata; private `callRef`/`code`/scoped `env`/callback auth stay in runner memory and are applied
  server-side via the relay (`tool-mcp-http.ts:94-97`, `mcp-bridge.ts:999-1002`). Any fix must keep
  this: the sandbox sees public specs + a relay dir, never a secret.
- **The internal loopback MCP endpoint is intentionally unauthenticated** (`tool-mcp-http.ts:48`,
  `mcp-bridge.ts:1000-1002`) precisely *because* it is loopback-only. It must stay unreachable off the
  machine it binds.
- **The SSRF guard treats sandbox→runner as dangerous.** `validateUserMcpUrl` / `isInternalHost`
  (`mcp.ts:341-379`) reject loopback, link-local, cloud-metadata, and private hosts for any URL the
  runner attaches a credential to. This is exactly the shape that "expose the runner's endpoint to the
  sandbox" would have to fight.
- **User stdio MCP is disabled on the runner host** (`mcp.ts:431-437`, `run-plan.ts:943-945`) because
  it launches an arbitrary process *outside* the sandbox boundary. A process *inside* the sandbox does
  not trigger this rationale — the sandbox boundary is the whole point — but the "stdio is disabled"
  invariant is guarded carefully, so any in-sandbox-stdio idea must be clearly distinguished as an
  internal, sandbox-confined channel.
- **Daytona FS + `runProcess` are the only host↔sandbox primitives.** The sandbox-agent SDK exposes
  `readFsFile`/`writeFsFile`/`mkdirFs`/`runProcess`/`getAgent`/`createSession` and the ACP HTTP edge.
  There is no out-of-band tool channel — **the file relay already is the Daytona-native tool channel.**
- **Strict network + executable tools is already refused on Daytona** (`run-plan.ts:956-967`): code/
  gateway tools execute on the runner host via the relay, bypassing the sandbox egress boundary, so a
  `strict` restricted-network run with executable tools fails up front. The fix does not change this —
  execution stays runner-side; the shim is loopback-only and opens no egress.
