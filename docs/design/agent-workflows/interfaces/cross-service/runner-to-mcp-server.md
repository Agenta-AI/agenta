# Runner To MCP Server

Pi takes its tools natively. Every other harness gets tools over MCP. The runner-owned stdio
tool bridge (which exposed backend-resolved tools to non-Pi harnesses) is currently DISABLED —
it launched a child process on the runner host, outside the sandbox boundary. User-declared
MCP servers ride the same `/run` payload after the Python side resolves their secrets; of
those, HTTP (remote) servers are delivered and stdio servers are disabled for the same reason.
This page covers both: the runner-owned bridge and the user servers.

## The contract

**Gating.** The runner builds MCP servers only when the harness is not Pi and the capability
probe reports `mcpTools: true`. Pi always returns an empty MCP set because it gets tools the
native way.

**The stdio bridge (disabled).** The runner-owned server spoke JSON-RPC 2.0 over stdio and
answered three methods. It is disabled today (`MCP_UNSUPPORTED_MESSAGE`); the shape below is
retained for when its runner-host execution is made sandbox-safe:

- `initialize`: returns protocol version and `capabilities.tools`.
- `tools/list`: returns the resolved tool specs as MCP tools. Client-kind tools are filtered
  out here, because the browser fulfills those.
- `tools/call`: runs the named tool with its arguments and returns `content`, or an error.

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
  The runner builds the ACP `McpServer` `type: "http"` variant (`{name, url, headers}`).
- **Stdio (`transport: "stdio"` + `command`) is disabled.** A stdio server launches an
  arbitrary process on the runner host, outside the sandbox boundary, so the implementation is
  disabled (parity with the removed code execution) until its security is fixed. `run-plan.ts`
  refuses any run carrying one (`MCP_UNSUPPORTED_MESSAGE`); `toAcpMcpServers` throws the same as
  a defense-in-depth backstop. The wire shape is kept; only delivery is off.

## Owned by

- `sdks/python/agenta/sdk/agents/mcp/`: the Python models and resolver.
- `services/agent/src/engines/sandbox_agent/mcp.ts`: builds the session's MCP servers.
- `services/agent/src/tools/mcp-bridge.ts`: the bridge.
- `services/agent/src/tools/mcp-server.ts`: the stdio JSON-RPC server.
- `services/agent/src/tools/relay.ts`: the file relay loop and hosts.

## Watch for when changing

- **The gate.** MCP delivery depends on harness type and the `mcpTools` capability, not on a
  single env flag. Changing either changes which tools reach the harness.
- **The MCP server config shape.** It is part of the `/run` contract and the wire serializer.
- **The stdio methods.** `initialize`, `tools/list`, `tools/call`, and the client-tool filter.
- **The relay.** Polling interval, timeout, and the local-versus-Daytona host. A slow tool
  must fail cleanly.
- **HTTP MCP delivery.** `toAcpMcpServers` routes the resolved secret from `env` into a
  request header and builds the ACP `type: "http"` entry. Changing the env-to-header mapping or
  the ACP variant shape changes which auth reaches the remote server.
- **Stdio MCP stays disabled.** Re-enabling it requires making its runner-host execution
  sandbox-safe — a real security change, not a flag flip.
- **Per-server permission and allowlist behavior.**
