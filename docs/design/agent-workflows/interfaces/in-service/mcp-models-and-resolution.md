# MCP Models And Resolution

MCP config is parsed and resolved on its own path, separate from tools. The author declares a
server with the secrets it needs by name; the resolver fetches those secrets from the vault
and injects them into the server's env before the runner ever sees it. So the config holds
secret names, and the resolved server holds secret values. Tokens never live in the config.

## The contract

**Declared (`MCPServerConfig`).** What the author writes:

```jsonc
{
  "name": "files",
  "transport": "stdio",            // "stdio" (needs command) | "http" (needs url)
  "command": "npx",
  "args": ["-y", "server-filesystem"],
  "env": {},                       // non-secret env
  "url": null,                     // http transport only
  "secrets": { "TOKEN_ENV": "vault-secret-name" },  // {env var: vault secret name}
  "tools": [],                     // allowlist; empty means all
  "permission": null               // "allow" | "ask" | "deny"
}
```

**Resolved (`ResolvedMCPServer`).** Same shape, minus `secrets`, with the named secrets merged
into `env`. The `to_wire()` emits only the keys that are set, so an empty `args`, `env`,
`url`, or `tools` is omitted from the `/run` payload.

**Resolution.** The resolver collects every named secret across all servers, fetches them in
one call, and injects each into its server's `env` (the same for both transports — there is no
separate `headers` wire field). A missing secret raises under the error policy.

**Transport delivery (runner side).** HTTP (`transport: "http"` + `url`) servers are delivered:
the runner (`toAcpMcpServers`) reads each resolved `env` entry and emits it as an HTTP request
header (so `secrets: {"Authorization": "vault-name"}` becomes an `Authorization` header on the
remote call). Before attaching the credential, an SSRF guard (`validateUserMcpUrl`) requires the
`url` to be `https` and to not target an internal/metadata host (loopback, `169.254.169.254`,
private literals); `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` opts a host out. Stdio (`transport: "stdio"`
+ `command`) servers are disabled in the sidecar — a stdio server runs an arbitrary process on
the runner host, outside the sandbox boundary — so a run carrying one is refused
(`USER_MCP_UNSUPPORTED_MESSAGE`). On a Pi harness, ANY user MCP server (stdio or http) is refused
up front (`PI_USER_MCP_UNSUPPORTED_MESSAGE`) because Pi delivers tools through its bundled
extension, not MCP — refusing it loudly avoids the silent drop. This is the USER MCP capability and
is distinct from the runner's internal gateway-tool MCP channel (delivered over loopback HTTP on
the local sandbox, and via the file relay on Daytona; see `runner-to-mcp-server.md`). The SDK
models, resolver, and wire are transport-agnostic; the enable/disable split lives entirely in the
runner.

## Owned by

- `sdks/python/agenta/sdk/agents/mcp/models.py`: the declared and resolved models.
- `sdks/python/agenta/sdk/agents/mcp/resolver.py`: the batch secret resolution.
- `sdks/python/agenta/sdk/agents/mcp/wire.py`: wire serialization.

## Watch for when changing

- **Stdio versus remote.** HTTP (remote) is delivered; stdio is disabled (runner-host process,
  outside the sandbox). The split is in the runner, not the SDK.
- **Secret env resolution.** Secrets are named in config, fetched once, and injected into
  `env`. The config never holds a token. For http the runner reads that `env` as request
  headers; for stdio it would be process env (if/when re-enabled).
- **Tool allowlists and the permission model.** Per-server gating flows to the runner.
- **Wire serialization.** Empty fields are omitted; that omission is part of the `/run`
  contract.
