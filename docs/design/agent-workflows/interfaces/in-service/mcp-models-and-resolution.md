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
one call, and injects each into its server's `env`. A missing secret raises under the error
policy. Stdio servers run today; remote (`http`) servers are modeled but deferred.

## Owned by

- `sdks/python/agenta/sdk/agents/mcp/models.py`: the declared and resolved models.
- `sdks/python/agenta/sdk/agents/mcp/resolver.py`: the batch secret resolution.
- `sdks/python/agenta/sdk/agents/mcp/wire.py`: wire serialization.

## Watch for when changing

- **Stdio versus remote.** Only stdio is wired. Enabling remote is a real change.
- **Secret env resolution.** Secrets are named in config, fetched once, and injected into
  `env`. The config never holds a token.
- **Tool allowlists and the permission model.** Per-server gating flows to the runner.
- **Wire serialization.** Empty fields are omitted; that omission is part of the `/run`
  contract.
