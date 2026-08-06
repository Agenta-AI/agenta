# Research

Verified against the working tree on 2026-06-24. Paths are repo-relative.

## 1. The config already models HTTP

`sdks/python/agenta/sdk/agents/mcp/models.py` — `MCPServerConfig` and `ResolvedMCPServer`
both have:

- `transport: Literal["stdio", "http"] = "stdio"`
- `url: Optional[str]` (validated: `http` transport requires `url`, `stdio` requires `command`)
- `secrets: Dict[str, str]` — `{env-or-header var name: vault secret name}`
- `env: Dict[str, str]` — non-secret env

So an author can already write a valid HTTP server today:

```jsonc
{
  "name": "linear",
  "transport": "http",
  "url": "https://mcp.linear.app/sse",
  "secrets": { "AUTHORIZATION": "linear-mcp-token" },
  "tools": [],
  "permission": "ask"
}
```

The config validator accepts it. Nothing downstream rejects it. It just never reaches the
agent.

## 2. The resolver is transport-agnostic already

`sdks/python/agenta/sdk/agents/mcp/resolver.py` — `MCPResolver.resolve()`:

- collects every named secret across all servers,
- fetches them in one `secret_provider.get_many(...)` call,
- merges each resolved value into that server's `env` (`env[env_var] = secret_values[...]`),
- raises `MissingMCPSecretError` under the ERROR policy if a named secret is absent.

It does **not** branch on transport. For an HTTP server today the resolved secret lands in
`env`, which is correct for stdio but is the wrong destination for a remote server (a remote
MCP wants the token in a request **header**, not in a non-existent child process's env). This
is the one real semantic gap, not a plumbing gap. See plan §2.

## 3. The wire already carries it

`sdks/python/agenta/sdk/agents/mcp/models.py` `ResolvedMCPServer.to_wire()` emits `transport`,
`url`, `env`, `tools`, `permission` (omitting empty keys). `mcp/wire.py` just calls it. So the
`/run` payload **already** contains a fully-formed HTTP server entry — `transport: "http"`,
the `url`, and the resolved secret (currently under `env`). No new wire field is needed for the
basic case; a `headers` destination is the only candidate addition (plan §3).

## 4. The deferral lives entirely in runner delivery

`services/agent/src/engines/sandbox_agent/mcp.ts` — `toAcpMcpServers()`:

```ts
if ((s.transport ?? "stdio") !== "stdio" || !s.command) {
  log(`skipping non-stdio MCP server '${s?.name ?? "?"}' (remote transport deferred)`);
  continue;
}
```

Every non-stdio server is dropped here. It builds only `McpServerStdio` entries
(`{name, command, args, env}`) for the ACP session via `buildSessionMcpServers()`. **This skip
is the whole deferral.** The SDK side is ready; the runner side throws HTTP servers away.

## 5. The harnesses can already reach HTTP MCP

- **Claude:** the bundled `@zed-industries/claude-agent-acp`
  (`dist/acp-agent.d.ts`) documents HTTP-MCP auth — a `gateway` auth meta that maps to
  *"Redirect API calls via baseUrl / **Inject custom headers** / Bypass the default login"*,
  with `{ baseUrl: string; headers: Record<string, string> }`. Claude Code itself supports
  HTTP/SSE MCP servers natively (`.mcp.json` `type: "http"|"sse"` with a `headers` map). So
  the destination for an HTTP MCP secret on Claude is a **header**, which is exactly what a
  bearer token wants.
- **Pi:** the Pi extension (`extensions/agenta.ts`) and ACP session config accept MCP server
  entries; remote MCP is a standard MCP transport. The runner needs to pass the URL + headers
  through rather than synthesize a stdio launcher.

Confirm the exact ACP `McpServer` HTTP variant (field names: `url` + `headers`, and whether
SSE vs streamable-HTTP is a separate `type`) against the installed ACP/claude-agent-acp
versions at implementation time — the d.ts in the tree documents header injection but the
implementer should pin the precise variant shape.

## 6. Secret handling today (the reuse target)

The named-secret machinery the stdio path uses is the same one HTTP reuses:

- SDK: `MCPSecretProvider.get_many(names)` (interface in `mcp/interfaces.py`), batched.
- Service: backed by the platform secret provider that calls `/secrets/resolve` (see
  `sdks/python/agenta/sdk/agents/platform/` and the in-service
  [`mcp-models-and-resolution.md`](../../interfaces/in-service/mcp-models-and-resolution.md)).
- The token never lives in the config; the config holds the **secret name** only. That
  property must hold for HTTP exactly as it does for stdio.

## 7. Why "easier than stdio" is a fair claim

| Concern | stdio | http |
|---|---|---|
| Process launch | `command` + `args`, often `npx -y` cold start | none |
| Process lifecycle / cleanup | runner-supervised | none |
| Scoped env to child | required | n/a |
| Bootstrap availability in sandbox | needs the binary / node present | n/a |
| Auth | env var into the child | header on the request |
| Network egress under `sandbox_permission` | child makes the calls | runner/agent makes the calls — same network policy applies |

The only net-new concern for HTTP is the auth **destination** (header) and respecting the
sandbox network policy for the outbound URL. Both are small.
