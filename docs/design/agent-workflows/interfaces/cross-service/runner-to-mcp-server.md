# Runner To MCP Server

Pi takes its tools natively. Every other harness gets tools over MCP. There are TWO independent
MCP layers, and they toggle separately (do not merge their gates):

1. **The internal gateway-tool channel** — the runner synthesizes it from the run's resolved
   `customTools` so a non-Pi harness (Claude) can receive Agenta gateway/callback tools. It is
   DELIVERED over two transports, selected by where the harness runs: a loopback HTTP MCP
   endpoint the runner serves (local sandbox; no runner-host child process), or an in-sandbox
   stdio MCP shim the runner uploads and the harness launches (Daytona). Its server name,
   `agenta-tools`, is reserved on every transport.
2. **User-declared MCP servers** - the user's external HTTP servers on the `/run` payload after
   the Python side resolves header-secret references. Public stdio is not representable.

## The contract

**Gating.** The runner builds MCP servers only when the harness is not Pi and the capability
probe reports `mcpTools: true`. Pi always returns an empty MCP set because it gets tools the
native way. Because Pi cannot consume MCP, a user HTTP MCP server attached to a Pi run
would be dropped silently — so `run-plan.ts` refuses any Pi run carrying `mcpServers` up front
with `PI_USER_MCP_UNSUPPORTED_MESSAGE`,
rather than returning a "successful" empty run. A user http MCP is a Claude-only capability.

**Reserved server name.** The channel's name `agenta-tools` is a stable identity on both
transports: the Python Claude adapter renders per-tool permission rules as
`mcp__agenta-tools__<tool>` (`claude_settings.py`), so a USER-declared MCP server with that
name would collide with the internal channel and inherit or steal its rendered rules.
`run-plan.ts` refuses such a server at declaration time (`RESERVED_MCP_SERVER_NAME_MESSAGE`),
and `buildSessionMcpServers` repeats the check at session materialization
(`assertNoReservedUserMcpName`) as defense in depth.

**The internal channel, local transport (HTTP on loopback).** For a non-Pi harness with
executable tool specs on the LOCAL sandbox, `buildToolMcpServers` starts a tiny MCP
server on `127.0.0.1:<ephemeral>` and returns one ACP `type: "http"` entry
(`{name: "agenta-tools", url, headers: []}`). The server speaks JSON-RPC 2.0 over Streamable-HTTP
(stateless JSON mode) and answers three methods:

- `initialize`: returns protocol version and `capabilities.tools`.
- `tools/list`: returns the resolved tool specs as MCP tools, reading each tool's input schema
  through the shared `specInputSchema` accessor (camelCase `inputSchema` OR snake-case
  `input_schema` — reading `inputSchema` alone advertised an EMPTY schema for every
  platform-catalog tool). `client` tools ARE advertised here (when a `clientToolRelay` is wired,
  i.e. local Claude): the model must see them to call them; the runner pauses the call in
  `tools/call`.
- `tools/call`: for an executable (`code`/`callback`) tool, runs it through
  `runResolvedTool(..., { relayDir })` (the same relay the Pi path uses) and returns `content`,
  or an error. For a `client` tool it validates required args, then pauses through the shared
  client-tool seam: on `pendingApproval` it emits NO JSON-RPC result and the request listener
  aborts the in-flight request (socket destroyed, no body) so the harness cannot settle the call
  before the turn ends `paused`; an engine `AbortSignal` cancels any other in-flight request on
  pause/teardown. On resume it returns the browser's stored output.

It carries NO credential: the entry has empty `headers`, the server holds only public metadata +
the relay dir, and it is bound to loopback. It launches no child process — it is served by the
already-running runner — so it does not reintroduce the runner-host execution hole that #4831
closed for user stdio MCP. The run end closes it (releases the port).

**The internal channel, Daytona transport (in-sandbox stdio shim).** The loopback URL is a
runner-host address; on Daytona the harness runs IN the sandbox, where `127.0.0.1` is the
sandbox's own loopback, not the runner's, so the HTTP transport is unusable. Instead, for a
non-Pi harness with executable tool specs, the engine uploads two files into an ephemeral
in-VM dir (`/home/sandbox/agenta/tool-mcp/<key>`, a sibling of the relay dir, keyed the same
way — never inside the relay dir, which the relay loop sweeps, and never on the durable
geesefs cwd):

- `tool-mcp-stdio.js` — the esbuild bundle of `tools/tool-mcp-stdio.ts`, built by
  `pnpm run build:extension` alongside the Pi extension. `SANDBOX_AGENT_RELAY_MCP_BUNDLE`
  overrides the bundle path on the runner (trusted deployment configuration, never run or
  request configuration; tests point it at a fixture).
- `tool-mcp-specs.json` — the run's `AdvertisedToolSpec` array (public fields only). A file,
  not an env value, because the env is copied through four exec layers and tool JSON Schemas
  are unbounded.

`buildInternalToolMcpEntry` then advertises one ACP stdio entry in `sessionInit.mcpServers`:
`{name: "agenta-tools", command: "node", args: [bundlePath], env}` with NO `type` field — the
Claude ACP adapter maps a typeless entry to a Claude SDK `{type: "stdio", ...}` server and
spawns the shim inside the sandbox (newline-delimited JSON-RPC on stdin/stdout; stderr for
logs). The entry is built entirely from runner constants and uploaded-asset paths; no
user-supplied `command`, `args`, `env`, or `transport` can flow into it, and it carries no
credential. The shim's env contract (`tools/tool-mcp-env.ts`):

- `AGENTA_AGENT_TOOLS_RELAY_DIR` — the in-sandbox relay dir to write request files into
  (reused name; the same variable the Pi extension reads).
- `AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE` — PATH to the uploaded specs JSON file (new).
- `AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED` — the hop-1 response-watch kill switch,
  forwarded verbatim only when the operator set it on the runner (the writer defaults it on).

Missing or unreadable env/file makes the shim log to stderr and exit 1, so the MCP client
reports a server-start failure instead of a silently inert tool advertiser. On `tools/call`
the shim writes a relay request file through the shared relay client (`relay-client.ts`, the
same writer the Pi extension uses) and the runner-side relay loop executes the private spec
server-side. The shim runs under the sandbox's own confinement, not on the runner host, so it
does not reopen the #4831 user-stdio hole (that hole is a runner-host concern, and this entry
is synthesized by the runner, never user-declared).

Two refusals remain on the remote path, both loud in `run-plan.ts` (never a silent tool drop):
a remote provider that is not Daytona fails closed with `REMOTE_TOOLS_UNSUPPORTED_MESSAGE`
(the shim's upload + spawn path is proven for Daytona only, and a new provider must not
silently re-open the F1 zero-tools drop), and any `client` (browser-fulfilled) tool on a
non-Pi remote run refuses with `REMOTE_CLIENT_TOOLS_UNSUPPORTED_MESSAGE` (the relay loop parks
a client call and writes no response file, so through the shim it would hang until the relay
timeout; the loopback channel's pause-by-abort has no stdio equivalent yet). Executable
(gateway/callback) tools proceed. A user http MCP server (a remote URL the harness dials
directly) is NOT loopback-bound and stays delivered on Daytona unchanged.

**The file relay.** A resolved tool may need to run privately rather than inside the harness
process. The relay moves the call across that boundary: the child publishes a `<id>.req.json`
request into the relay directory, the runner picks it up, executes the tool through the
`RelayHost` (local `node:fs` or the Daytona sandbox filesystem), and publishes a
`<id>.res.json` response. Every publication is atomic on both sides: full bytes under a temp
name (`<final>.tmp.<nonce>`), then a same-directory rename, so neither side ever reads partial
JSON. The runner deletes the request file as soon as it has read it, so a request executes at
most once per publication; the writer still deletes the response after reading it (its own
request unlink is now usually a no-op). Crash redelivery is gone on both backends: a runner
crash after pickup loses the request, the writer times out, and the call surfaces as a tool
error. Pickup is event-driven with polling as the fallback: an in-process `fs.watch` locally,
a flagged bounded watch exec on Daytona, and the ~300 ms poll as the safety timer. A tool
slower than the relay timeout surfaces as a tool error.

**The relay execution guard (every harness).** The relay dir is sandbox-writable, so any
in-sandbox process can forge an `<id>.req.json` execute record without ever passing an
approval dialog. `startToolRelay` re-checks every execute record runner-side through
`buildRelayExecutionGuard` (`engines/sandbox_agent/relay-guard.ts`), on EVERY harness (it was
Pi-only). `allow` passes and `deny` refuses identically everywhere; `ask` splits by harness.
On Pi, the ask dialog is decided runner-side and every approval is recorded as an execution
grant, so the guard consumes exactly one grant per record and a forged or replayed record for
an `ask` tool fails closed. On a non-Pi MCP harness (Claude), the harness's own dialog (the
rendered `mcp__agenta-tools__<tool>` ask rules plus the ACP permission flow) gates a call
before it reaches the shim, so the runner holds no grant for a legitimately approved call and
the guard passes `ask`. Residual, stated honestly: on that path a forged request file can
still trigger an ask-tool WITHOUT a dialog; reflecting the harness approval into the grant
ledger is a documented follow-up. The hard deny boundary holds on every harness.

**User-declared servers.** `/run.mcpServers` carries only resolved external HTTP servers:

```jsonc
{
  "name": "memory",
  "connection": {
    "type": "http",
    "url": "https://memory.example.com/mcp",
    "headers": { "Authorization": "Bearer resolved-value" }
  },
  "policy": {
    "tools": { "mode": "all" },
    "permission": "ask"
  }
}
```

The Python service resolves named header-secret references before constructing this object. The
runner treats `connection.headers` as secret-bearing and converts each entry to the ACP HTTP header
array. `validateUserMcpUrl` requires HTTPS and blocks internal, private, link-local, loopback, and
metadata destinations unless the operator explicitly allowlists the host with
`AGENTA_AGENT_MCPS_HOST_ALLOWLIST`.

A user HTTP server remains reachable from Daytona because Claude connects from inside the sandbox
to the remote URL. This is independent of the internal `agenta-tools` transport selection. Public
stdio does not exist in the run contract. Pi refuses external user MCP servers with
`PI_USER_MCP_UNSUPPORTED_MESSAGE` until Pi has a delivery bridge.

## Owned by

- `sdks/python/agenta/sdk/agents/mcp/`: the Python models and resolver.
- `services/runner/src/engines/sandbox_agent/mcp.ts`: builds the session's MCP servers (the two
  layers; the internal channel's transport pick — loopback HTTP locally, the uploaded stdio shim
  on Daytona via `buildInternalToolMcpEntry`; the reserved-name check
  `assertNoReservedUserMcpName`; threads `clientToolRelay` + abort signal; `validateUserMcpUrl`
  SSRF guard).
- `services/runner/src/engines/sandbox_agent/run-plan.ts`: the remote gates
  (`REMOTE_TOOLS_UNSUPPORTED_MESSAGE` for non-Daytona remotes,
  `REMOTE_CLIENT_TOOLS_UNSUPPORTED_MESSAGE` for client tools on a non-Pi remote run, the
  reserved-name refusal) and the `toolMcpDir` placement invariants.
- `services/runner/src/engines/sandbox_agent/tool-mcp-assets.ts`: the shim bundle location
  (`SANDBOX_AGENT_RELAY_MCP_BUNDLE` override) and the per-run upload (`uploadToolMcpAssets`,
  fail-loud `TOOL_MCP_UNAVAILABLE_MESSAGE`).
- `services/runner/src/engines/sandbox_agent/relay-guard.ts`: the every-harness relay execution
  guard (`buildRelayExecutionGuard`).
- `services/runner/src/engines/sandbox_agent/client-tools.ts`: the shared client-tool seam
  (`buildClientToolRelay`, `emitClientToolInteraction`, the ACP tool-call correlation index).
- `services/runner/src/tools/mcp-bridge.ts`: the internal channel builder (advertises `client`
  tools when a relay is wired).
- `services/runner/src/engines/sandbox_agent/run-plan.ts`: the
  `PI_USER_MCP_UNSUPPORTED_MESSAGE` refusal.
- `services/runner/src/tools/tool-mcp-http.ts`: the internal loopback HTTP MCP server (the
  `client` pause: no JSON-RPC result + abort-the-request).
- `services/runner/src/tools/tool-mcp-stdio.ts`: the in-sandbox stdio shim (newline-delimited
  JSON-RPC; `tools/call` writes relay request files through the shared relay client).
- `services/runner/src/tools/tool-mcp-env.ts`: the shim's env-name contract, a dependency-free
  module the server-side entry builder shares without importing the bundle entrypoint.
- `services/runner/src/tools/spec-schema.ts`: the shared `specInputSchema` accessor + arg
  validation.
- `services/runner/src/tools/relay.ts`: the runner-side relay loop and hosts
  (delete-on-pickup; idle-poll backoff in fallback mode).
- `services/runner/src/tools/relay-client.ts` and `relay-protocol.ts`: the bundle-safe
  in-sandbox writer and wire protocol (atomic publication; the hop-1 response watch).
- `services/runner/src/tools/relay-watch.ts`: the hop-2 wake sources (local `fs.watch`; the
  flagged Daytona watch exec).

## Watch for when changing

- **The gate.** MCP delivery depends on harness type and the `mcpTools` capability, not on a
  single env flag. Changing either changes which tools reach the harness.
- **The MCP server config shape.** It is part of the `/run` contract and the wire serializer.
- **The internal channel's MCP methods.** `initialize`, `tools/list` (now advertises `client`
  tools and reads schemas via `specInputSchema`), and `tools/call` (the `client` pause: emit NO
  result + abort the request, so the paused widget is the last word before the turn ends).
  Served over loopback HTTP locally; the framing (stateless JSON Streamable-HTTP) is pinned to
  the MCP client the installed Claude harness uses; re-verify it if that version moves. The
  Daytona stdio shim answers the same three methods over newline-delimited JSON-RPC; it copies
  the `specInputSchema` fallback locally so its bundle's import surface stays exactly
  relay-client + relay-protocol + types.
- **The client-tool pause is no-result-before-finish.** A paused `tools/call` must never write a
  JSON-RPC result (a result lets the harness settle and clobber the pending widget); the handler
  aborts its own request and the engine fires an `AbortSignal` on pause/teardown. The stdio shim
  has NO pause path, which is exactly why client tools are refused on the remote non-Pi path.
- **The remote-tools gates.** A non-Pi run on a non-Daytona remote provider carrying ANY custom
  tool is refused in `run-plan.ts` (fail closed until in-sandbox delivery is proven there); a
  non-Pi remote run carrying a `client` tool is refused separately. Executable tools proceed on
  Daytona via the shim. Do not widen either gate without a proven delivery path.
- **The reserved server name.** `agenta-tools` must stay in lockstep with the Python adapter's
  rendered `mcp__agenta-tools__<tool>` rules, and a user server may never claim it (checked at
  declaration time and again at materialization).
- **The shim env contract.** `AGENTA_AGENT_TOOLS_RELAY_DIR` (reused) and
  `AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE` (a file path, never inline JSON) are the shim's whole
  input contract; both sides read the names from `tool-mcp-env.ts`. The response-watch flag is
  forwarded verbatim only when set.
- **The relay.** Atomic temp-plus-rename publication, delete-on-pickup (at most one execution
  per publication), the wake sources and their flags, polling interval, idle backoff, timeout,
  and the local-versus-Daytona host. A slow tool must fail cleanly.
- **The relay execution guard's `ask` split.** Pi consumes a dialog-recorded execution grant
  (fail closed); a non-Pi MCP harness passes `ask` because its own dialog gates the call before
  the shim. Requiring a grant there would refuse every approved call; removing the guard would
  let a forged file run a denied tool. Keep the residual (forged-file ask without a dialog on
  the MCP path) documented until the grant-ledger follow-up lands.
- **HTTP MCP delivery.** `toAcpMcpServers` routes resolved `connection.headers` into the ACP
  `type: "http"` entry. Changing the header mapping or ACP variant changes which authentication
  reaches the remote server.
- **Per-server permission and allowlist behavior.**
