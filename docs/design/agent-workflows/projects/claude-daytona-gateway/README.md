# Claude gateway/callback tools on Daytona (F-042)

**Status:** designed + draft impl landed on a lane (DRAFT PR, do NOT merge; no live Daytona test
run yet — that is the one remaining gate before "done"). Codex-reviewed (xhigh), findings folded
in. 284 runner unit tests + typecheck green; the bundle builds (5.3 kB, network-free) and answers
`initialize` over stdio.
**Owner:** agent-workflows.
**Base:** big-agents tip `80b2748f56` (workspace tip `407635ca01`).
**Source finding:** [`projects/qa/findings.md` F-042](../qa/findings.md) (Daytona E3 sweep,
2026-06-26). This is also the proven answer to gateway-tool-mcp
[open question 3](../gateway-tool-mcp/status.md).

## The one-line problem

On the **Claude** harness running in a **Daytona** sandbox, an Agenta gateway/callback tool is
never surfaced to the model. The same tool works on Claude+LOCAL and on Pi+Daytona. Only the
Claude x Daytona cell drops it.

## Root cause

There are two separate things a tool needs: **advertisement** (the model is told the tool
exists, with its name/description/schema) and **execution** (when the model calls it, something
runs the resolved spec server-side and returns the result). F-042 is an advertisement gap, not
an execution gap.

How each environment x harness advertises gateway/callback tools today:

| Cell | Advertisement channel | Execution channel | Works? |
| --- | --- | --- | --- |
| Pi, local | Pi extension `registerTool` (in-process) | direct `/tools/call` POST | yes |
| Pi, Daytona | Pi extension `registerTool` (in-sandbox, uploaded) | **file relay** (`tools/relay.ts`) | yes |
| Claude, local | runner **loopback HTTP MCP** server (`tool-mcp-http.ts`), advertised via `sessionInit.mcpServers` | dispatch in the MCP handler -> relay/POST | yes |
| **Claude, Daytona** | **NONE** | file relay loop is started, ready, idle | **no (F-042)** |

The #4853 fix is correct: on Daytona the runner skips the loopback HTTP MCP server, because its
URL is `127.0.0.1:<port>` which, from inside the remote sandbox, is the **sandbox's** loopback,
not the runner's host. Advertising it would hand the in-sandbox Claude an unreachable URL.
(`engines/sandbox_agent/mcp.ts` `buildSessionMcpServers`, `isDaytona` branch.)

But skipping the loopback removes Claude's ONLY advertisement channel on Daytona, and nothing
replaces it. The "file relay" (`tools/relay.ts` `startToolRelay`) is purely the **execution**
transport: the runner polls the sandbox filesystem for `<id>.req.json` files and POSTs the
resolved callback to `/tools/call`, writing `<id>.res.json` back. **Writing those req files (and
advertising the tool to the model) is done by an in-sandbox process** — for Pi, the bundled
extension (`extensions/agenta.ts` `registerTools` -> `runResolvedTool` -> `relayToolCall`).
Claude has no such in-sandbox shim, so on Daytona `sessionInit.mcpServers` is empty for Claude,
the model is never told the tool exists, and the relay loop sits idle waiting for req files that
never get written. The runner's `daytona: N gateway tool(s) delivered via the file relay` log
line is the runner's INTENT, not a Claude-reachable delivery.

### Proven by contrast (F-042 live repro)

Same synthetic `callback` tool (`get_weather` -> echo server returning an unguessable token),
posted to the runner `/run`:

- Claude + Daytona -> `ok:true`, model says "I don't have access to a `get_weather` tool". Echo
  server never called. -> tool NOT delivered.
- Claude + LOCAL -> reply is exactly the token; echo server called. -> loopback MCP works.
- Pi + Daytona -> reply is exactly the token; echo server called. -> Pi extension delivers on
  Daytona.

So the failure is specifically the missing **in-sandbox advertisement shim for a non-Pi harness
on Daytona**. The relay execution side already works; only the advertisement is missing.

## Why the loopback can't just be "made reachable"

The obvious alternative — keep the HTTP MCP server and make the sandbox reach it — was
considered and rejected as the smallest fix:

- **Daytona preview/port-forward.** The Daytona SDK exposes `getPreviewLink(port)` /
  `getSignedPreviewUrl(port)`, but that forwards a port **out of** the sandbox (sandbox -> public
  URL), not the runner's host port **into** the sandbox. There is no reverse tunnel.
- **Bind the MCP server to a sandbox-reachable address.** The runner host and the Daytona sandbox
  are on different networks with no shared routable address; the runner has no inbound URL the
  sandbox can dial without a tunnel.
- **The sandbox-agent handle doesn't expose preview/port APIs anyway.** Our `sandbox` object
  (sandbox-agent `0.4.2`) exposes `runProcess`, `readFsFile`, `writeFsFile`, `mkdirFs`,
  `createSession`, `destroySession`, `destroySandbox` — the filesystem + process surface the file
  relay already uses. It does NOT surface `getPreviewLink`. Reaching it would mean dropping below
  the sandbox-agent wrapper into the raw Daytona SDK, a much bigger change.

The file relay already crosses the boundary (the runner reads/writes the sandbox FS over the
daemon API), and it already works for Pi on Daytona. The right move is to give Claude the same
in-sandbox relay shim Pi has, not to invent a new network path.

## Recommended design: an in-sandbox stdio MCP relay shim for Claude on Daytona

Give a non-Pi harness on Daytona the Daytona equivalent of the Pi extension: a tiny,
self-contained **stdio MCP server** that runs **inside** the sandbox, advertises the run's
resolved gateway/callback tools, and on `tools/call` writes a relay `<id>.req.json` and polls
`<id>.res.json` — exactly the file protocol the existing runner-side relay loop
(`startToolRelay`) already implements and the Pi extension already speaks (`relayToolCall` in
`tools/dispatch.ts`).

Why stdio and not HTTP:

- ACP's `McpServer` union includes a **stdio** variant (`McpServerStdio` = `{name, command,
  args, env}`). `sessionInit.mcpServers` is forwarded verbatim into the in-sandbox `newSession`
  (sandbox-agent `normalizeSessionInit` deep-clones it through), so the in-sandbox Claude
  launches the stdio command **inside the sandbox**. That is the correct side of the boundary —
  the same place the Pi extension runs.
- The #4831 security concern about stdio MCP is about a stdio child on the **runner host**
  (outside the sandbox). Here the child runs **inside** the Daytona sandbox, under the sandbox's
  own confinement, and carries only public tool metadata + the relay dir (no callRef, no code, no
  callback auth, no secrets). Every credentialed action still happens server-side in runner
  memory via the existing relay -> `/tools/call`. So this does NOT reopen #4831's hole. (The
  user-declared stdio MCP gate in `run-plan.ts` / `toAcpMcpServers` is a SEPARATE layer and stays
  disabled; this internal channel is synthesized by the runner, never user-declared — same
  two-layers rule as gateway-tool-mcp.)
- Local stays HTTP-on-loopback (already works); Daytona uses the stdio shim. Same split as
  #4844: HTTP advertisement for local, file relay for Daytona — now with a real advertiser on the
  Daytona side.

### Shape of the shim

A new standalone script `src/tools/relay-mcp-stdio.ts`, esbuild-bundled to
`dist/tools/relay-mcp-stdio.js` (same pattern as the Pi extension's
`scripts/build-extension.mjs`), reading everything from env:

- `AGENTA_TOOL_PUBLIC_SPECS` — JSON `[{name, description, inputSchema}]` (public only; reuse
  `publicToolSpecs`).
- `AGENTA_TOOL_RELAY_DIR` — the in-sandbox relay dir (`plan.relayDir`, nested under the cwd).

It speaks MCP **stdio** JSON-RPC: `initialize`, `tools/list` (from the public specs), and
`tools/call` (write `<id>.req.json` `{toolName, toolCallId, args}`, poll `<id>.res.json`
`{ok, text|error}`, mirroring `relayToolCall`). It launches no network and holds no secret.

### Wiring (Daytona, non-Pi only)

1. **Upload** the bundled `relay-mcp-stdio.js` into the sandbox (best-effort, like
   `uploadPiExtensionToSandbox`), when `isDaytona && !isPi && executableToolSpecs.length > 0`.
2. **Advertise** it: in `buildSessionMcpServers`, when `isDaytona && !isPi && capabilities.mcpTools`
   and there are executable specs, return an `McpServerStdio` entry
   `{name: "agenta-tools", command: "node", args: [<sandbox path to the shim>], env: [{AGENTA_TOOL_PUBLIC_SPECS}, {AGENTA_TOOL_RELAY_DIR}]}`
   instead of the empty list. (Local non-Pi keeps the loopback HTTP server; Pi keeps `[]`.)
3. **Execute** unchanged: `plan.useToolRelay` already starts `startToolRelay` with the
   `sandboxRelayHost` on Daytona. It already polls the sandbox FS and runs the resolved spec.
   No change to the relay loop, callback dispatch, permissions (Layer 3 still enforced in the
   relay loop), or tracing.

Net: one new bundled script + one new upload helper + a non-Pi/Daytona branch in
`buildSessionMcpServers`. The execution path, the security model, and the local path are all
unchanged.

See [`plan.md`](./plan.md) for the file-by-file change list, the security argument in full, the
test plan, and the open questions.

## Smallest correct option (why this one)

| Option | Cost | Verdict |
| --- | --- | --- |
| In-sandbox stdio MCP relay shim (recommended) | one bundled script + upload + a session branch; reuses the entire relay execution path; no new network path | **chosen** — smallest change that actually advertises tools to a non-Pi harness on Daytona |
| Sandbox-reachable HTTP MCP (tunnel/preview into the sandbox) | needs an inbound path the SDK doesn't expose; drop below sandbox-agent into the raw Daytona SDK; new network surface | rejected — bigger, new attack surface, no reverse tunnel exists |
| Make Claude a "Pi-extension-like" via the Claude SDK MCP config files | Claude-specific config plumbing; still needs an in-sandbox process to write relay reqs | rejected — converges on the same shim but harness-coupled |

## Verification status

- Code-path analysis: complete (this doc + plan).
- Live Daytona run: **NOT done** (per task; no Daytona tonight). The fix must be verified with a
  real Claude + Daytona + callback-tool `/run` before it can be called done — repro recipe is in
  F-042 and in [`plan.md`](./plan.md).
