# Agent runner (TypeScript)

The Node side of the agent workflow service. It runs the actual agent loop and serves one
contract: a JSON request in, a structured result out. The Python service
(`services/oss/src/agent/`) decides *what* to run (config, tools, secrets, trace) and calls
in here; this package *runs* it. It lives in Node because the harnesses (Pi, Claude Code,
and the `sandbox-agent` package) are Node libraries with no Python SDK.

## How it is invoked

Two entrypoints, same `/run` contract (see `src/protocol.ts`):

- **`src/cli.ts`** — one JSON request on stdin, one result on stdout. The Python
  SDK adapters use this subprocess transport when `AGENTA_AGENT_RUNNER_URL` is unset. stdout is
  the result channel only; logs go to stderr.
- **`src/server.ts`** — the same thing as a long-lived HTTP server on `:8765`
  (`GET /health`, `POST /run`). This is the dockerized agent runner sidecar the Python SDK
  adapters call over HTTP when `AGENTA_AGENT_RUNNER_URL` points at it. The dev image
  (`docker/Dockerfile.dev`) runs `tsx watch src/server.ts`.

Both route to an engine by the request's `backend` field.

## Layout (`src/`)

```
src/
  cli.ts              entrypoint: stdin/stdout (subprocess transport)
  server.ts           entrypoint: HTTP sidecar on :8765
  protocol.ts         the /run wire contract (request, result, events, capabilities)
  engines/
    pi.ts             engine: drive the Pi SDK in-process
    sandbox_agent.ts  engine: drive a harness over ACP through sandbox-agent
  tracing/
    otel.ts           turn a run into OpenTelemetry spans nested under /invoke
  tools/
    callback.ts       the one /tools/call HTTP client
    code.ts           execute resolved code tools in a scoped subprocess
    dispatch.ts       dispatch resolved tools by executor kind
    mcp-bridge.ts     build the MCP server config that exposes tools to a harness
    mcp-server.ts     the stdio MCP server itself (launched per session by the daemon)
  extensions/
    agenta.ts         the Pi extension (tracing + tools), bundled into dist/ for Pi to load
```

## Engines

- **`pi`** (`engines/pi.ts`) — drives the Pi SDK directly in-process.
- **`sandbox-agent`** (`engines/sandbox_agent.ts`) — drives any harness (`pi`, `claude`) over the Agent
  Client Protocol through sandbox-agent, either local or in a Daytona
  sandbox. This is the default on the platform.

The engine is internal runner plumbing. The platform sends `sandbox-agent` by default.
Harness choice (`pi`, `claude`, or experimental `agenta`) and sandbox (`local` or
`daytona`, where supported) are per-run config from the Python service.

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

`runSandboxAgent` probes the harness's capabilities and branches on them (for example, tools go
over MCP only when the harness advertises `mcpTools`); usage and the structured event log
come back on every run.

## Tracing

When the request carries a `trace` block, the run is exported to Agenta as OpenTelemetry
spans nested under the caller's `/invoke` span. The Pi path self-instruments via the
bundled extension (`extensions/agenta.ts`); other harnesses are traced from the sandbox-agent ACP
event stream (`tracing/otel.ts`). The Python `tracing` module fills `trace` in from the
live workflow span.

## Tools

Tools are resolved in the Python backend and arrive on the request as `customTools` plus a
`toolCallback`. Delivery is capability-routed: the Pi extension registers them natively;
other harnesses get them over MCP through `tools/mcp-bridge.ts` + `tools/mcp-server.ts`.
Either way each call POSTs back to Agenta's `/tools/call` (`tools/callback.ts`), so the
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
echo '{"backend":"sandbox-agent","harness":"pi","sandbox":"local","messages":[{"role":"user","content":"Hi"}]}' | pnpm run run:cli
```
