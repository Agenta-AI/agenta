# Agent runner (TypeScript)

The Node side of the agent workflow service. It runs the actual agent loop and serves one
contract: a JSON request in, a structured result out. The Python service
(`services/oss/src/agent/`) decides *what* to run (config, tools, secrets, trace) and calls
in here; this package *runs* it. It lives in Node because the harnesses (Pi, Claude Code,
rivet's `sandbox-agent`) are Node libraries with no Python SDK.

## How it is invoked

Two entrypoints, same `/run` contract (see `src/protocol.ts`):

- **`src/cli.ts`** — one JSON request on stdin, one result on stdout. The Python
  `SubprocessHarness` spawns this for local runs. stdout is the result channel only; logs
  go to stderr.
- **`src/server.ts`** — the same thing as a long-lived HTTP server on `:8765`
  (`GET /health`, `POST /run`). This is the **dockerized sidecar** the Python `HttpHarness`
  calls in-network. The dev image (`docker/Dockerfile.dev`) runs `tsx watch src/server.ts`.

Both route to an engine by the request's `backend` field.

## Layout (`src/`)

```
src/
  cli.ts              entrypoint: stdin/stdout (subprocess transport)
  server.ts           entrypoint: HTTP sidecar on :8765
  protocol.ts         the /run wire contract (request, result, events, capabilities)
  engines/
    pi.ts             legacy engine: drive the Pi SDK in-process
    rivet.ts          engine: drive a harness over ACP via a rivet sandbox-agent daemon
  tracing/
    otel.ts           turn a run into OpenTelemetry spans nested under /invoke
  tools/
    client.ts         the one /tools/call HTTP client
    mcp-bridge.ts     build the MCP server config that exposes tools to a harness
    mcp-server.ts     the stdio MCP server itself (launched per session by the daemon)
  extensions/
    agenta.ts         the Pi extension (tracing + tools), bundled into dist/ for Pi to load
```

## Engines

- **`pi`** (`engines/pi.ts`) — the legacy path. Drives the Pi SDK directly in-process.
- **`rivet`** (`engines/rivet.ts`) — drives any harness (`pi`, `claude`) over the Agent
  Client Protocol through a rivet `sandbox-agent` daemon, either local or in a Daytona
  sandbox. This is the default on the platform.

The engine is a deployment choice (`backend` on the wire / `AGENT_BACKEND` env), not a
harness. Harness choice (pi/claude) and sandbox (local/daytona) are per-run config the
Python service sends.

## Result

```json
{
  "ok": true,
  "output": "Rome",
  "messages": [{ "role": "assistant", "content": "Rome" }],
  "events": [{ "type": "message", "text": "Rome" }, { "type": "done" }],
  "usage": { "input": 1297, "output": 5, "total": 1302, "cost": 0.0066 },
  "stopReason": "end_turn",
  "capabilities": { "mcpTools": false, "images": true, "...": "..." },
  "sessionId": "...",
  "model": "openai-codex/gpt-5.5",
  "traceId": "..."
}
```

`runRivet` probes the harness's capabilities and branches on them (for example, tools go
over MCP only when the harness advertises `mcpTools`); usage and the structured event log
come back on every run.

## Tracing

When the request carries a `trace` block, the run is exported to Agenta as OpenTelemetry
spans nested under the caller's `/invoke` span. The Pi path self-instruments via the
bundled extension (`extensions/agenta.ts`); other harnesses are traced from the rivet ACP
event stream (`tracing/otel.ts`). The Python `tracing` module fills `trace` in from the
live workflow span.

## Tools

Tools are resolved in the Python backend and arrive on the request as `customTools` plus a
`toolCallback`. Delivery is capability-routed: the Pi extension registers them natively;
other harnesses get them over MCP through `tools/mcp-bridge.ts` + `tools/mcp-server.ts`.
Either way each call POSTs back to Agenta's `/tools/call` (`tools/client.ts`), so the
provider key and connection auth stay server-side.

## The extension bundle

`scripts/build-extension.mjs` esbuild-bundles `src/extensions/agenta.ts` into one
self-contained `dist/extensions/agenta.js` that Pi can load anywhere (host, the sidecar, a
Daytona snapshot). The dev image bakes it; rebuild after editing the extension or the
tracer:

```bash
pnpm run build:extension
```

## Auth

Provider keys arrive as `request.secrets` (resolved from the project vault) or fall back to
the harness's own login: Pi reads `~/.pi/agent/auth.json` (`pnpm exec pi` then `/login`),
Claude Code reads `~/.claude`. Set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` to override.

## config/

`config/AGENTS.md` and `config/agent.json` are a fallback "hello-world" agent, used only
when a request arrives with no config. In practice the playground always sends the agent
revision's config, so these are rarely hit.

## Local use

```bash
pnpm install
echo '{"backend":"pi","messages":[{"role":"user","content":"Hi"}]}' | pnpm run run:cli
```
