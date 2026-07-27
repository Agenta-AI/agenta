# MCP Models And Resolution

MCP configuration follows a separate path from Agenta tools. The saved author object contains a
remote HTTP connection, secret references, and policy. The resolver fetches named values from the
project vault and creates a per-run object with resolved headers. Secret values never live in the
saved agent revision.

## The contracts

**Declared (`MCPServerConfig`).** What the author saves:

```jsonc
{
  "name": "memory",
  "connection": {
    "type": "http",
    "url": "https://memory.example.com/mcp",
    "headers": {},
    "credentials": {
      "type": "header_secret_refs",
      "headers": { "Authorization": "memory-mcp-token" }
    }
  },
  "policy": {
    "tools": { "mode": "all" },
    "permission": "ask"
  }
}
```

The only public connection type is `http`. `credentials.type` is `none` or
`header_secret_refs`. Public stdio, commands, arguments, and environment variables are not
representable. `agenta-tools` is a reserved name.

**Resolved (`ResolvedMCPServer`).** The per-run model contains `name`, `url`, resolved `headers`,
and `policy`. It is secret-bearing and must not be persisted, returned by inspect, or logged.
Serialization emits the runner object as `{name, connection: {type, url, headers}, policy}`.

**Resolution.** The resolver collects the referenced secret names across all servers, fetches them
in one call, and maps each value onto its declared HTTP header. A missing required secret fails the
run. Public headers and resolved credential headers are merged only in the per-run object.

## Runtime delivery

The runner validates each external URL before attaching credentials. HTTPS is required, and
loopback, private, link-local, and metadata destinations are blocked unless an operator explicitly
adds the host to `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`.

Claude receives each external HTTP server in ACP session initialization and connects to the remote
server directly. The same delivery works when Claude runs locally or in Daytona because the URL is
not runner loopback. Pi refuses any external MCP server with `PI_USER_MCP_UNSUPPORTED_MESSAGE`
until its MCP bridge exists. This user-server path is separate from the trusted internal
`agenta-tools` channel.

The service has no MCP feature flag. The runtime harness catalog publishes
`mcp.user_servers` only for harnesses that support the path, and the editor follows that
capability.

## Owned by

- `sdks/python/agenta/sdk/agents/mcp/models.py`: declared and resolved models.
- `sdks/python/agenta/sdk/agents/mcp/resolver.py`: batch secret resolution.
- `sdks/python/agenta/sdk/agents/mcp/wire.py`: runner serialization.
- `services/runner/src/engines/sandbox_agent/mcp.ts`: URL validation and ACP entries.
- `sdks/python/agenta/sdk/agents/capabilities.py`: harness capability publication.

## Watch for when changing

- Keep saved secret references separate from resolved header values.
- Keep public user MCP separate from the trusted internal `agenta-tools` stdio shim.
- Preserve HTTP-only authoring unless a new public execution boundary is explicitly designed.
- Keep the SDK, runner protocol, interface inventory, editor, and harness catalog in sync.
- Enforce policy on both tool listing and calls when tool-selection product work lands.
