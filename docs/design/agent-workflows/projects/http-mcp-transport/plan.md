# Plan

Goal: deliver `transport: "http"` MCP servers to the harness, with named-secret auth injected
as request headers, reusing the existing resolver and `/run` wire. No new vault route.

## Slice 0 — decide the secret destination (design call, no code)

A named secret on an HTTP server should land in a **header**, not in `env`. Two ways to model
it, pick one:

- **A. Convention (no new field).** Keep the existing `secrets: {NAME: vault-secret}` map. For
  `transport: "http"`, the resolver writes resolved values into a resolved `headers` map
  instead of `env`. The author names the header (e.g. `"Authorization"`), and for a bearer
  token writes the full value as the secret (`"Bearer ..."`) or the runner wraps it. Simple,
  but overloads `secrets` semantics by transport.
- **B. Explicit `headers` declaration (recommended).** Add a `headers: Dict[str, str]` to
  `MCPServerConfig` for non-secret headers, and let `secrets` target header names for the
  http transport. Resolved server gains a `headers` map; `to_wire()` emits it. Clearer, and it
  mirrors how Claude's `.mcp.json` and the ACP header-injection meta are shaped.

Recommendation: **B**, because the harnesses consume HTTP MCP auth as headers and a `headers`
map is the least surprising contract. The `Authorization: Bearer <token>` case becomes
`headers: {}` + `secrets: {"Authorization": "linear-mcp-token"}` resolving to a header.

## Slice 1 — SDK: resolve secrets into headers for http

`sdks/python/agenta/sdk/agents/mcp/`:

- `models.py`: add `headers: Dict[str, str]` to `MCPServerConfig` and `ResolvedMCPServer`;
  emit it from `to_wire()` (omit when empty, like the other optional keys).
- `resolver.py`: branch on transport when injecting resolved secrets — `stdio` -> `env`
  (unchanged), `http` -> `headers`. The batch fetch and missing-secret policy are unchanged.
- Keep `env` working for http too (non-secret env is harmless), but route **secret** values to
  `headers` for http.

## Slice 2 — wire + golden

`sdks/python/agenta/sdk/agents/mcp/wire.py` needs no logic change (it delegates to
`to_wire()`), but the golden `/run` fixtures gain an http-server case. Per the coordination
board's shared-surface rule, **any `/run` field change (the new `headers` key) requires the
Python model, the TypeScript runner type, and the golden fixtures updated in one change.**

- Update `services/agent/src/protocol.ts` `McpServerConfig` to add `url` (if not present) and
  `headers?: Record<string,string>`.
- Add/extend golden fixtures under
  `sdks/python/oss/tests/pytest/unit/agents/golden/` with an http MCP server.

## Slice 3 — runner delivery (flip the deferral)

`services/agent/src/engines/sandbox_agent/mcp.ts` `toAcpMcpServers()`:

- Stop skipping `transport: "http"`. For http, build the ACP HTTP-MCP entry instead of a
  stdio entry: `{ name, url, headers }` (confirm the exact ACP variant/field names against the
  installed `@zed-industries/claude-agent-acp` / ACP versions; the d.ts documents
  custom-header injection).
- Keep skipping a server that is neither valid stdio nor valid http, with the same log.
- Respect harness capabilities: only deliver when the harness supports MCP (the
  `buildSessionMcpServers` `capabilities.mcpTools` gate already does this).

## Slice 4 — sandbox network policy

The outbound MCP URL is network egress. Under `sandbox_permission` (Daytona network
isolation), an HTTP MCP server's host must be reachable. Document and, if needed, surface the
URL host so the network policy can allowlist it. For `sandbox: "local"` this is a no-op. Cross-
check with the sidecar-trust / sandbox-enforcement project
([../sidecar-trust-and-sandbox-enforcement/](../sidecar-trust-and-sandbox-enforcement/)).

## Slice 5 — docs in sync (same PR as the impl)

Per `keep-docs-in-sync`, the implementing PR updates:

- `interfaces/in-service/mcp-models-and-resolution.md` — drop the "remote deferred" caveat,
  document the header-injection path.
- `interfaces/public-edge/agent-config-schema.md` — the `mcp_servers[]` http example with
  `headers` + `secrets`.
- Any `documentation/` MCP page.

## Tests

- SDK: resolver injects a named secret into `headers` for http and into `env` for stdio;
  missing-secret policy still raises; `to_wire()` emits `headers`/`url` and omits when empty.
- Wire-contract / golden: an http MCP server round-trips Python -> wire -> runner type.
- Runner (vitest): `toAcpMcpServers` builds an HTTP-MCP ACP entry for http and still builds
  stdio for stdio; capability gate respected.
- Acceptance (manual, deferred): a real remote MCP (e.g. a hosted SSE server) reachable from a
  Pi run with a vault-stored bearer token.

## Rollout

1. Slice 1-2 (SDK + wire + golden) — additive, no behavior change until the runner flips.
2. Slice 3 (runner) — turns the feature on; gate behind a flag if a staged rollout is wanted.
3. Slice 4-5 — network policy + docs.

## Out of scope / later

- OAuth / dynamic client registration MCP auth.
- Per-server tool-allowlist enforcement over ACP (existing v1 gap).
- Streamable-HTTP vs SSE selection if the ACP variant needs an explicit `type` — resolve at
  implementation time against the pinned ACP version.
