# Plan: in-sandbox stdio MCP relay shim for Claude on Daytona (F-042)

Goal: deliver Agenta gateway/callback tools to a non-Pi harness (Claude) running in a Daytona
sandbox, by giving it the Daytona equivalent of the Pi extension — a tiny in-sandbox stdio MCP
server that advertises the tools and writes relay request files. Reuse the existing relay
execution path unchanged.

Read [`README.md`](./README.md) first for the root cause and the option comparison.

## Invariants this must preserve

1. **Two MCP layers stay separate** (the #4831 / gateway-tool-mcp rule): the INTERNAL
   gateway-tool channel (synthesized by the runner from `customTools`) and the USER MCP
   capability (user-declared servers) toggle independently. This change touches only the internal
   channel; user stdio MCP stays disabled, user http MCP unchanged.
2. **No secret crosses the boundary.** The shim env carries only `AGENTA_TOOL_PUBLIC_SPECS`
   (public name/description/inputSchema) and `AGENTA_TOOL_RELAY_DIR`. The callRef, code, scoped
   env, callback endpoint, and callback auth stay in runner memory; the relay loop applies them
   server-side. Same guarantee as the loopback HTTP server and the Pi extension.
3. **#4831 stays closed.** The stdio child runs INSIDE the Daytona sandbox (the harness's own
   confinement), not on the runner host. The runner-host stdio hole #4831 closed is a different
   place; this does not reintroduce it.
4. **Local path unchanged.** Local non-Pi keeps the loopback HTTP MCP server; Pi keeps `[]`
   everywhere; the only new behavior is `isDaytona && !isPi && executable specs`.
5. **Layer 3 permissions unchanged.** `ask`/`deny`/`allow` are still enforced in `startToolRelay`
   (`resolvePermission`) on the runner side, harness-agnostic. The shim never sees a permission.
6. **Fail loud, not silent (A7 / F-032).** If the shim cannot be delivered, the run must error,
   not return an `ok:true` empty turn. Today `assertRequiredCapabilities` already refuses a non-Pi
   run that carries tools when the probe lacks `mcpTools`/`toolCalls`. Keep that gate; the new
   branch only changes WHICH server entry is delivered, not whether tools are required.

## Files to change

### New: `services/agent/src/tools/relay-mcp-stdio.ts`

A standalone stdio MCP server. No imports from the harness SDK. Reads:

- `AGENTA_TOOL_PUBLIC_SPECS` — JSON `[{name, description, inputSchema}]`.
- `AGENTA_TOOL_RELAY_DIR` — relay dir (in-sandbox path).

Speaks MCP JSON-RPC over stdin/stdout (newline-delimited or LSP-style framing — match what the
in-sandbox Claude ACP -> Claude SDK MCP stdio client expects; see Open question 1):

- `initialize` -> `{protocolVersion, capabilities:{tools:{}}, serverInfo:{name:"agenta-tools"}}`.
- `notifications/initialized` -> no response.
- `tools/list` -> the public specs (`name`, `description`, `inputSchema`).
- `tools/call` -> write `<relayDir>/<sanitizeRelayId(id)>.req.json`
  `{toolName, toolCallId, args}`; poll `<relayDir>/<id>.res.json` until `{ok:true,text}` (return
  as MCP `content:[{type:"text",text}]`) or `{ok:false,error}` (return `isError:true`); time out
  via `RELAY_TIMEOUT_MS`. This is exactly `relayToolCall` in `tools/dispatch.ts` — factor the
  shared poll/write into a helper both call, or copy it (the shim is bundled standalone, so a
  shared import must bundle cleanly).

Reuse `sanitizeRelayId`, `RELAY_REQ_SUFFIX`, `RELAY_RES_SUFFIX`, `RELAY_POLL_MS`,
`RELAY_TIMEOUT_MS` from `tools/relay.ts`, and the `tools/list` filtering/handler shape from
`tool-mcp-http.ts` `handle` (initialize/tools-list/tools-call), so the framing logic has one
source of truth where possible.

### New bundle step: `scripts/build-extension.mjs` (extend) or a sibling script

Add a second esbuild entry that emits `dist/tools/relay-mcp-stdio.js` (ESM, node target,
self-contained, `external: []` — it has no harness-SDK dep). Same banner shim as the extension if
any CJS dep sneaks in. The Daytona snapshot already bundles `dist/` (it carries the Pi extension
the same way), so no snapshot rebuild is needed beyond shipping the new file. Confirm the
sandbox-image build copies `dist/tools/` too (Open question 3).

### `services/agent/src/engines/sandbox_agent/pi-assets.ts` (or a new `relay-shim.ts`)

Add `uploadRelayShimToSandbox(sandbox, destDir, log)` mirroring `uploadPiExtensionToSandbox`:
`mkdirFs` + `writeFsFile` the bundled `relay-mcp-stdio.js` into a known in-sandbox path (e.g.
`<cwd>/.agenta-tools/relay-mcp-stdio.js`, alongside the relay dir, or `/home/sandbox/.agenta`).
Best-effort with a log on failure. Resolve the bundle path the way `EXTENSION_BUNDLE` is resolved
(env override + `PKG_ROOT/dist/...`).

### `services/agent/src/engines/sandbox_agent/mcp.ts` — `buildSessionMcpServers`

Today (Daytona branch): `const internal = isDaytona ? {servers: [], close} : await buildToolMcpServers(...)`.

Change: when `isDaytona && !isPi && capabilities.mcpTools` and `toolSpecs` has executable specs,
build an `McpServerStdio` entry instead of `[]`:

```
{
  name: "agenta-tools",
  command: "node",
  args: [<in-sandbox path to relay-mcp-stdio.js>],
  env: [
    { name: "AGENTA_TOOL_PUBLIC_SPECS", value: JSON.stringify(publicToolSpecs(executable)) },
    { name: "AGENTA_TOOL_RELAY_DIR", value: relayDir },
  ],
}
```

Keep the existing `daytona: N gateway tool(s) delivered via the file relay` log, but make it
TRUE now (the shim is the deliverer). Local non-Pi unchanged (loopback HTTP). Pi unchanged (`[]`).
The new branch needs the in-sandbox shim path; pass it into `buildSessionMcpServers` (a new input
field) or compute it from `relayDir`.

The `McpServerEntry` union (`mcp.ts`) must gain the stdio variant for the internal channel
(`McpServerStdio` already exists in `mcp-bridge.ts`; the internal channel currently only emits
`McpServerHttp`). Add `McpServerStdio` to the returned union for this branch.

### `services/agent/src/engines/sandbox_agent.ts`

Where Daytona assets are pushed (`if (plan.isDaytona) await prepareDaytonaPiAssets(...)`), also
upload the relay shim when `!plan.isPi && plan.executableToolSpecs.length > 0`. (Today
`prepareDaytonaPiAssets` early-returns for non-Pi; add a non-Pi relay-shim upload either there or
inline in the engine.) Pass the in-sandbox shim path into `buildSessionMcpServers`.

No change to: the relay loop start (`plan.useToolRelay` -> `startToolRelay` with
`sandboxRelayHost`), `resolveRunUsage`, tracing, the permission responder, or the result shape.

### `services/agent/src/protocol.ts` / `wire.py`

**No wire change.** This is entirely runner-internal (the shim is synthesized from `customTools`,
which already cross the wire). Do not touch the golden fixtures.

## Tests (vitest, `services/agent/tests/unit/`)

1. **`relay-mcp-stdio` unit** — drive the shim's `handle`/dispatch directly (export a pure
   handler like `tool-mcp-http.ts` does): `tools/list` returns the public specs (no callRef/code/
   auth leak — assert the serialized output contains none of the private fields); `tools/call`
   writes a `.req.json` with `{toolName, toolCallId, args}` and resolves from a `.res.json` you
   write; `{ok:false}` maps to an MCP `isError` result; an unknown tool errors.
2. **`buildSessionMcpServers` Daytona non-Pi branch** — `isDaytona:true, isPi:false,
   capabilities.mcpTools:true`, executable specs -> returns ONE `type:"stdio"` (or stdio-shaped)
   `agenta-tools` entry whose env carries `AGENTA_TOOL_PUBLIC_SPECS` + `AGENTA_TOOL_RELAY_DIR` and
   NO secret. Local non-Pi still returns the http loopback entry; Pi still returns `[]`; Daytona
   non-Pi with NO executable specs returns `[]`.
3. **Upload helper** — `uploadRelayShimToSandbox` calls `mkdirFs` + `writeFsFile` with the bundled
   contents at the expected path (fake sandbox, like the pi-assets test).
4. **Wire-contract test** — unchanged; assert it still passes (no wire change).

## Live verification (REQUIRED before "done" — not run tonight)

Repro from F-042: a `callback` tool `get_weather` (callRef `composio.weather.GET_WEATHER`) routed
to a local echo server returning an unguessable token. Recreate `:8280` sandbox-agent with the
full Daytona `.env.ee.dev.local`, force `sandbox:daytona`, harness `claude` (haiku), inject an
`ANTHROPIC_API_KEY` via `secrets`. Expect:

- The model calls `get_weather` and replies with the token (today it says "I don't have access to
  a get_weather tool").
- The echo server is hit (`fn=composio.weather.GET_WEATHER`).
- The runner log shows the stdio shim launched in-sandbox + the relay req/res cycle.
- Hygiene: 0 leaked sandboxes (the per-run `finally` still deletes; allow ~5s for the async
  Daytona delete).

Contrast cells that must still pass: Claude+LOCAL (loopback), Pi+Daytona (extension), Pi+LOCAL.

When green, capture the run with the `agent-replay-test` skill to pin it, and update F-042 to
RESOLVED + the matrix scoreboard in `projects/qa/`.

## Codex review (xhigh, 2026-06-26) — folded in

Verdict: "the in-sandbox stdio MCP relay shim is the smallest correct architecture for F-042"
(the runner-host loopback cannot serve Daytona Claude; the relay loop cannot advertise; the Claude
ACP adapter has no serverless tool-advertisement path). Acted on its priority points in the draft:

- **Fail loud, not best-effort.** `uploadRelayShimToSandbox` now THROWS
  (`RELAY_SHIM_UNAVAILABLE_MESSAGE`) on a missing bundle / failed upload, on the path that requires
  the shim (Daytona + non-Pi + executable tools), so F-042 cannot become another silent tool drop.
- **Layering.** Moved the shim bundle constant + upload helper OUT of the already-stretched
  `pi-assets.ts` into a dedicated `engines/sandbox_agent/relay-shim.ts`; `mcp.ts` stays pure (it
  builds the session entry, it does not touch files).
- **Dependency seam.** Factored the file-relay CLIENT out of `tools/dispatch.ts` into
  `tools/relay-client.ts`, so the in-sandbox bundle carries ONLY file-relay code — NOT the direct
  callback (`/tools/call` POST) or code executor `dispatch.ts` also imports. Verified: the bundle
  is 5.3 kB with 0 network calls (vs the 1.3 MB Pi extension).
- **Hardening.** `randomUUID()` for the relay call id; concurrent stdio request handling (a
  `tools/call` no longer blocks the read loop); nonzero exit on missing required env.
- **Security caveat (documented, not a leak).** The relay dir is an in-sandbox capability: any
  sandbox process that can write a valid `.req.json` can invoke an ALLOWED tool during the run.
  That is not a secret leak (no credential crosses the boundary) and matches the Pi relay
  precedent; the guard is the runner-side Layer-3 permission enforcement in `startToolRelay`
  (`resolvePermission`), which is unchanged. The same exposure already exists for Pi on Daytona.
- **Framing confirmed.** Codex independently confirmed the Claude Code bundled MCP transport is
  newline-delimited JSON-RPC (`cli.js`: reads to a newline, writes `JSON.stringify(...) + "\n"`),
  matching the shim. Open question 1 is closed.

## Open questions (answer before/while implementing)

1. **Claude's in-sandbox stdio MCP framing — RESOLVED (code-read).** Confirmed against the
   installed adapter `node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js` (~L899-921):
   the adapter maps each ACP `sessionInit.mcpServers` entry to a Claude SDK MCP config. An entry
   WITH a `type` field becomes an http/sse server; an entry with NO `type` (exactly the
   `McpServerStdio` shape: `name`/`command`/`args`/`env`) becomes `{type:"stdio", command, args,
   env}`. The Claude Agent SDK then launches it via the standard MCP stdio transport
   (`@modelcontextprotocol/sdk` `StdioClientTransport`), which is **newline-delimited JSON-RPC**
   (one JSON object per line on stdin/stdout). So the shim must: read NDJSON from stdin, write one
   JSON-RPC object per line to stdout, keep stdout clean (logs to stderr only). The adapter runs
   INSIDE the Daytona sandbox, so the `command` is spawned in-sandbox — the design holds. The
   internal channel entry must therefore be the type-less stdio shape (do NOT set `type` on it).
2. **Does the in-sandbox Daytona image have `node` on PATH?** The stdio `command` is `node`. The
   Daytona snapshot installs Pi via `npm` (`installPiInSandbox`), so node exists; confirm it is on
   PATH for the ACP-launched stdio child, or use an absolute path.
3. **Snapshot/image packaging of `dist/tools/`.** Confirm `sandbox-images/daytona/build_snapshot.py`
   and the sidecar Docker image carry `dist/tools/relay-mcp-stdio.js` (the extension is shipped via
   `dist/extensions/`; mirror that). If the runner uploads the shim from its own `dist/` over the
   FS API (recommended, like the Pi extension upload), the snapshot need not bake it.
4. **Codex/other non-Pi harnesses on Daytona.** This fix is harness-agnostic (any non-Pi,
   mcpTools-capable harness on Daytona gets the stdio shim). Codex on Daytona is untested; the
   design covers it but only Claude is the verified target.
