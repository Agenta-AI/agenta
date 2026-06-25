# Plan

Goal: restore delivery of Agenta gateway/callback tools to Claude (and any non-Pi, MCP-only
harness) as an **internal** MCP channel, independent of the disabled **user** stdio MCP path,
with credentials staying server-side. Smallest correct change, no wire/SDK/protocol change.

## Design: three independent MCP layers, made explicit

`engines/sandbox_agent/mcp.ts` `buildSessionMcpServers` already builds two terms. Keep them
fully independent and name them in code/comments so the conflation cannot recur:

```
buildSessionMcpServers (non-Pi, capabilities.mcpTools) =
    buildToolMcpServers(toolSpecs, ...)   // Layer: INTERNAL gateway-tool channel  -> RESTORE
  + toAcpMcpServers(userMcpServers)        // Layer: USER MCP capability             -> unchanged
                                           //   - stdio: throws (#4831)  KEEP DISABLED
                                           //   - http : delivered (#4834)            unchanged
```

- **User MCP capability = off** for stdio (the `run-plan.ts` `hasStdioMcpServer` gate + the
  `toAcpMcpServers` stdio throw stay exactly as #4831 left them).
- **Internal gateway-tool MCP = on** (this project re-populates `buildToolMcpServers`).
- **HTTP MCP = a third thing** (#4834), delivered for user http servers; the internal channel
  also USES the http transport (below) but is a separate entry the user never declares.

## Recommended transport: internal HTTP MCP on loopback (Slice A, option 1 — preferred)

Restore `buildToolMcpServers` so it returns an **HTTP** MCP server entry (`McpServerHttp` from
#4834), not a stdio one. The runner serves a tiny in-process MCP HTTP endpoint bound to
loopback that advertises the public gateway-tool specs and, on `tools/call`, runs
`runResolvedTool(spec, args, { relayDir })` — the exact dispatch the old stdio `mcp-server.ts`
used. Claude consumes `type: "http"` MCP natively (verified in #4834 research).

Why HTTP, not the old stdio bridge:

- **No runner-host child process.** This is the property #4831 cared about. The old stdio
  bridge spawned `tsx mcp-server.ts`; the new channel does not spawn anything — it is an
  endpoint the runner already-running process serves. It cannot be the "arbitrary host process"
  hole, because there is no author command anywhere near it.
- **Reuses #4834's proven path.** The `McpServerHttp` ACP shape and Claude's native http-MCP
  support are already exercised. We add one internal server entry alongside the user ones.
- **Symmetric with the user http path.** One transport for all MCP delivery; stdio stays the
  one disabled transport, for users only.

Sketch (illustrative, not final code):

- New `tools/tool-mcp-http.ts` (or fold into `mcp-bridge.ts`): start an HTTP server on
  `127.0.0.1:<ephemeral>` that speaks MCP (`initialize` / `tools/list` / `tools/call`) over the
  streamable-HTTP/SSE shape Claude expects. `tools/list` returns `publicToolSpecs(executable)`
  (metadata only, `client` tools filtered). `tools/call` runs `runResolvedTool(spec, args,
  { toolCallId, relayDir })`. The server holds **only public specs + relayDir** (same env
  surface as before) and is reachable only from loopback.
- `buildToolMcpServers(specs, toolCallback, relayDir)`: if there are executable specs, start
  that server and return `[{ type: "http", name: "agenta-tools", url, headers: [] }]`. No
  secret header — the channel is unauthenticated on loopback and carries no credentials. Empty
  / all-`client` specs still return `[]` (the no-tools path stays untouched).
- The runner-side relay loop (`startToolRelay`) is already started by `engines/sandbox_agent.ts`
  when `plan.useToolRelay` is true; the http server's `tools/call` feeds the same relay dir, so
  the server-side credential path is unchanged.

Open implementation detail to pin at build time: the exact ACP/Claude HTTP-MCP variant (SSE vs
streamable-HTTP, the `tools/list` + `tools/call` JSON-RPC framing over HTTP). #4834 delivers the
ACP `type: "http"` entry to the harness but did not itself implement an MCP HTTP *server*; this
project implements that minimal server. Pin the framing against the installed ACP /
`@zed-industries/claude-agent-acp` version, mirroring #4834's same caveat.

### Slice A, option 2 — restore the stdio bridge but ONLY for the internal channel (fallback)

If the in-process HTTP MCP server proves more work than its worth for a first cut, restore the
OLD stdio `mcp-server.ts` + the `buildToolMcpServers` launcher **verbatim from before #4831**,
but ONLY for the internal gateway-tool channel — the user stdio path stays gated. This brings
back a runner-host child process for the bridge. It is acceptable on the same argument the user
makes (the bridge holds no secrets; execution relays server-side), but it re-introduces a host
process, so it is the fallback, not the recommendation. If chosen, document loudly that the
internal bridge child is metadata-only and distinct from a user stdio server.

**Recommendation: option 1 (internal HTTP MCP).** It satisfies #4831's "no runner-host
process" intent AND restores delivery, and it reuses #4834's transport.

## Slice B — make the layering un-conflatable in code

Regardless of transport, do these so the next security pass cannot re-break delivery:

1. Rename the internal-channel error/skip so it is never the user-facing
   `MCP_UNSUPPORTED_MESSAGE`. `MCP_UNSUPPORTED_MESSAGE` should mean **"user MCP servers are not
   supported"** only (used by `run-plan.ts` `hasStdioMcpServer` and `toAcpMcpServers`'s stdio
   branch). The internal channel must not borrow it.
2. Comment both terms in `buildSessionMcpServers` with the layer they belong to (internal
   gateway-tool vs user MCP capability) and a one-line "do not merge these gates" note, citing
   this project.
3. Keep `assertRequiredCapabilities` as-is — once the internal channel is restored, its
   `mcpTools:true` assertion for Claude is true again and consistent with delivery.

## Slice C — tests

Re-target the tests #4831 inverted, plus add the separability assertions:

- **Internal channel restored (delivery + callable):** a non-Pi harness (Claude) + a gateway
  `callback` toolSpec → `buildSessionMcpServers` returns the internal `agenta-tools` server
  (http `type: "http"` per option 1), `tools/list` advertises the public spec, `tools/call`
  routes through `runResolvedTool` → relay → `/tools/call`. Assert the advertised shape carries
  **no** `callRef` / `code` / scoped `env` / callback auth (the public-spec guarantee).
- **User stdio MCP still refused:** a run with `mcpServers: [{ transport: "stdio", command }]`
  → `run-plan.ts` rejects with `MCP_UNSUPPORTED_MESSAGE`; `toAcpMcpServers` still throws on it.
- **Separability (the regression guard):** (a) gateway toolSpecs + NO user MCP → internal
  channel present, no throw; (b) user stdio MCP + NO gateway tools → refused; (c) gateway
  toolSpecs + user http MCP → internal channel AND the user http server both delivered, stdio
  still refused. This is the test that fails if the two layers are ever re-merged.
- **Credentials stay server-side:** assert the channel advertisement and any child env contain
  only public metadata + relayDir; no secret, no callRef, no callback bearer.
- **Pi unaffected:** a Pi run still gets `[]` from `buildSessionMcpServers` and tools via the
  native extension.
- **Fail-loud consistency:** a Claude run with gateway tools now returns `ok: true` (delivery
  works), not the `MCP_UNSUPPORTED_MESSAGE` failure.

Run `pnpm test` + `pnpm run typecheck` in `services/agent/`. No golden-fixture change expected
(no wire change); confirm the golden contract tests stay green.

## Live verification (post-implementation, per the QA skill)

Use `agent-workflows-qa` / `agent-replay-test`: run Claude with a real gateway tool (the
github tool in the `pi-agents` project worked historically) on the local sidecar and confirm
the tool is delivered and callable end-to-end, and that a user stdio MCP server is still
refused. Capture a replay test to pin it.

## What this explicitly does NOT change

- `protocol.ts` / `wire.py` / golden fixtures (no new wire field).
- The gateway / Composio / `/tools/call` contract and Layer-3 tool-permission.
- The user stdio MCP disable, the loopback binding, the `/run` token, and the local-network /
  filesystem not-implemented gates from #4831.
- Pi's native tool delivery.

## Smallest-correct-fix, in one paragraph

Re-populate `buildToolMcpServers` (the INTERNAL channel only) to advertise the run's gateway
tools to Claude over an internal loopback HTTP MCP endpoint that the runner serves, feeding the
already-running relay for execution; rename the user-facing `MCP_UNSUPPORTED_MESSAGE` so the
internal channel never reuses it; leave `toAcpMcpServers` (stdio off, http on) and the
`run-plan.ts` stdio gate exactly as #4831 left them. No wire change. Tests assert the two layers
are independently toggled.
