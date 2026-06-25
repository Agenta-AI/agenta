# Runner To MCP Server

Pi takes its tools natively. Every other harness gets tools over MCP. There are TWO independent
MCP layers, and they toggle separately (do not merge their gates):

1. **The internal gateway-tool channel** — the runner synthesizes it from the run's resolved
   `customTools` so a non-Pi harness (Claude) can receive Agenta gateway/callback tools. It is
   DELIVERED, over an internal loopback HTTP MCP endpoint the runner serves (no runner-host child
   process).
2. **User-declared MCP servers** — the user's own servers on the `/run` payload after the Python
   side resolves their secrets. HTTP (remote) servers are delivered; stdio servers are DISABLED
   (they launch an arbitrary process on the runner host, outside the sandbox boundary).

PR #4831 once conflated these into a single `MCP_UNSUPPORTED_MESSAGE` switch, which disabled the
internal channel as collateral with the (correct) user-stdio disable; the gateway-tool-mcp
project split them again. The user-facing constant is now `USER_MCP_UNSUPPORTED_MESSAGE` and means
ONLY "user MCP servers are unsupported"; the internal channel never borrows it.

## The contract

**Gating.** The runner builds MCP servers only when the harness is not Pi and the capability
probe reports `mcpTools: true`. Pi always returns an empty MCP set because it gets tools the
native way. Because Pi cannot consume MCP, a USER MCP server (stdio OR http) attached to a Pi run
would be dropped silently — so `run-plan.ts` refuses any Pi run carrying `mcpServers` up front
with `PI_USER_MCP_UNSUPPORTED_MESSAGE` (fail loud, the way the stdio-MCP and code-tool gates do),
rather than returning a "successful" empty run. A user http MCP is a Claude-only capability.

**The internal gateway-tool channel (delivered, HTTP on loopback — LOCAL only).** For a non-Pi
harness with executable tool specs on the LOCAL sandbox, `buildToolMcpServers` starts a tiny MCP
server on `127.0.0.1:<ephemeral>` and returns one ACP `type: "http"` entry
(`{name: "agenta-tools", url, headers: []}`). The server speaks JSON-RPC 2.0 over Streamable-HTTP
(stateless JSON mode) and answers three methods:

- `initialize`: returns protocol version and `capabilities.tools`.
- `tools/list`: returns the resolved tool specs as MCP tools. Client-kind tools are filtered
  out here, because the browser fulfills those.
- `tools/call`: runs the named tool through `runResolvedTool(..., { relayDir })` (the same relay
  the Pi path uses) and returns `content`, or an error.

It carries NO credential: the entry has empty `headers`, the server holds only public metadata +
the relay dir, and it is bound to loopback. It launches no child process — it is served by the
already-running runner — so it does not reintroduce the runner-host execution hole that #4831
closed for user stdio MCP. The run end closes it (releases the port).

**On Daytona the internal channel is NOT advertised — the file relay delivers the tools.** The
loopback URL is a runner-host address; on Daytona the harness runs IN the sandbox, where
`127.0.0.1` is the sandbox's own loopback, not the runner's, so the URL is unreachable.
`buildSessionMcpServers` therefore skips the internal channel when `isDaytona` is true and the
already-running file relay (below) delivers the gateway tools instead — the runner's relay loop
polls the sandbox filesystem. This honors the design decision "HTTP advertisement for local, file
relay for Daytona." A user http MCP server (a remote URL the harness dials directly) is NOT
loopback-bound and stays delivered on Daytona unchanged.

**The file relay.** A resolved tool may need to run privately rather than inside the harness
process. The relay moves the call across that boundary: the child writes a `<id>.req.json`
request into the relay directory, the runner polls (every ~300ms), executes the tool through
the `RelayHost` (local `node:fs` or the Daytona sandbox filesystem), and writes a
`<id>.res.json` response. A tool slower than the relay timeout surfaces as a tool error.

**User-declared servers.** `mcpServers` in `/run` carries each user server with its
transport, command or url, args, env (secrets already injected by the Python resolver), tool
allowlist, and permission. Two transports, opposite states:

- **HTTP (`transport: "http"` + `url`) is delivered.** A remote server has no child process on
  the runner host: the harness connects to the URL and the named secret rides in a request
  header, so it does not bypass the sandbox boundary. The resolved secret arrives on the wire
  under the server's `env` map (the resolver merges named secrets into `env` regardless of
  transport, and the wire has no separate `headers` field), so `toAcpMcpServers` emits each
  `env` entry as an HTTP header (`Authorization: <token>`, etc.). The author names the header
  via the secret-map key — `secrets: {"Authorization": "linear-mcp-token"}` lands as a header.
  The runner builds the ACP `McpServer` `type: "http"` variant (`{name, url, headers}`). Before
  attaching the credential, `validateUserMcpUrl` applies an SSRF guard: the `url` must be `https`
  and must not target an internal/metadata host (loopback, link-local incl. `169.254.169.254`,
  or private literals), else the run fails loud. A host listed in the optional comma-separated
  `AGENTA_AGENT_MCP_HOST_ALLOWLIST` env var opts out of both checks (e.g. a known-safe internal
  endpoint).
- **Stdio (`transport: "stdio"` + `command`) is disabled.** A stdio server launches an
  arbitrary process on the runner host, outside the sandbox boundary, so the implementation is
  disabled (parity with the removed code execution) until its security is fixed. `run-plan.ts`
  refuses any run carrying one (`USER_MCP_UNSUPPORTED_MESSAGE`); `toAcpMcpServers` throws the same
  as a defense-in-depth backstop. The wire shape is kept; only delivery is off.

## Owned by

- `sdks/python/agenta/sdk/agents/mcp/`: the Python models and resolver.
- `services/agent/src/engines/sandbox_agent/mcp.ts`: builds the session's MCP servers (the two
  layers; the `isDaytona` guard on the internal channel; `validateUserMcpUrl` SSRF guard).
- `services/agent/src/tools/mcp-bridge.ts`: the internal gateway-tool channel builder; the
  `USER_MCP_UNSUPPORTED_MESSAGE` and `PI_USER_MCP_UNSUPPORTED_MESSAGE` refusal constants.
- `services/agent/src/tools/tool-mcp-http.ts`: the internal loopback HTTP MCP server.
- `services/agent/src/tools/mcp-server.ts`: the removed stdio JSON-RPC server (refusing stub).
- `services/agent/src/tools/relay.ts`: the file relay loop and hosts.

## Watch for when changing

- **The gate.** MCP delivery depends on harness type and the `mcpTools` capability, not on a
  single env flag. Changing either changes which tools reach the harness.
- **The MCP server config shape.** It is part of the `/run` contract and the wire serializer.
- **The internal channel's MCP methods.** `initialize`, `tools/list`, `tools/call`, and the
  client-tool filter, served over loopback HTTP. The framing (stateless JSON Streamable-HTTP) is
  pinned to the MCP client the installed Claude harness uses; re-verify it if that version moves.
- **The relay.** Polling interval, timeout, and the local-versus-Daytona host. A slow tool
  must fail cleanly.
- **HTTP MCP delivery.** `toAcpMcpServers` routes the resolved secret from `env` into a
  request header and builds the ACP `type: "http"` entry. Changing the env-to-header mapping or
  the ACP variant shape changes which auth reaches the remote server.
- **Stdio MCP stays disabled.** Re-enabling it requires making its runner-host execution
  sandbox-safe — a real security change, not a flag flip.
- **Per-server permission and allowlist behavior.**
