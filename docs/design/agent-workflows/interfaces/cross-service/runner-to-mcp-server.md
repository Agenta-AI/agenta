# Runner To MCP Server

Pi takes its tools natively. Every other harness gets tools over MCP. So for non-Pi
harnesses the runner stands up its own stdio MCP server, exposes the backend-resolved tools
through it, and lets the harness call them like any MCP tool. User-declared MCP servers ride
the same `/run` payload after the Python side resolves their secrets. This page covers both:
the runner-owned bridge and the user servers.

## The contract

**Gating.** The runner builds MCP servers only when the harness is not Pi and the capability
probe reports `mcpTools: true`. Pi always returns an empty MCP set because it gets tools the
native way.

**The stdio bridge.** The runner-owned server speaks JSON-RPC 2.0 over stdio and answers
three methods:

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
allowlist, and permission. Stdio servers are wired today; remote servers are modeled but
deferred.

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
- **Remote MCP support.** It is modeled but not wired. Enabling it is a real contract change.
- **Per-server permission and allowlist behavior.**
