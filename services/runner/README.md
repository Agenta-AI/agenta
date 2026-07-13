# Agent runner (TypeScript)

The Node side of the agent workflow service. It runs the actual agent loop and serves one
contract: a JSON request in, a structured result out. The Python service
(`services/oss/src/agent/`) decides _what_ to run (config, tools, secrets, trace) and calls
in here; this package _runs_ it. It lives in Node because the harnesses (Pi, Claude Code,
and the `sandbox-agent` package) are Node libraries with no Python SDK.

## How it is invoked

Two entrypoints, same `/run` contract (see `src/protocol.ts`):

- **`src/cli.ts`** — one JSON request on stdin, one result on stdout. The Python
  SDK adapters use this subprocess transport when `AGENTA_RUNNER_INTERNAL_URL` is unset. stdout is
  the result channel only; logs go to stderr.
- **`src/server.ts`** — the same thing as a long-lived HTTP server on `:8765`
  (`GET /health`, `POST /run`). This is the dockerized agent runner sidecar the Python SDK
  adapters call over HTTP when `AGENTA_RUNNER_INTERNAL_URL` points at it. The dev image
  (`docker/Dockerfile.dev`) runs `tsx watch src/server.ts`.

Both drive the request through the one engine (`engines/sandbox_agent.ts`); the request's
`harness` field selects which harness runs inside it.

## Layout (`src/`)

```
src/
  cli.ts              entrypoint: stdin/stdout (subprocess transport)
  server.ts           entrypoint: HTTP sidecar on :8765
  protocol.ts         the /run wire contract (request, result, events, capabilities)
  engines/
    sandbox_agent.ts  the one engine: drive a harness over ACP through sandbox-agent
  tracing/
    otel.ts           turn a run into OpenTelemetry spans nested under /invoke
  tools/
    callback.ts       the one /tools/call HTTP client
    code.ts           execute resolved code tools in a scoped subprocess
    dispatch.ts       dispatch resolved tools by executor kind
    mcp-bridge.ts     the INTERNAL gateway-tool MCP channel (loopback HTTP) — live
    mcp-server.ts     the OLD stdio MCP bridge — REMOVED (refuses to serve; no longer launched)
  extensions/
    agenta.ts         the Pi extension (tracing + tools), bundled into dist/ for Pi to load
```

## Engine

There is one engine, `sandbox_agent.ts`: it drives any harness (`pi`, `claude`) over the Agent
Client Protocol through sandbox-agent, either local or in a Daytona sandbox.

Harness choice (`pi`, `claude`, or experimental `agenta`) and sandbox (`local` or
`daytona`, where supported) are per-run config from the Python service, carried on the
request's `harness` / `sandbox` fields.

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
`toolCallback`. The Pi extension registers them natively, and each call POSTs back to Agenta's
`/tools/call` (`tools/callback.ts`) so the provider key and connection auth stay server-side.
Non-Pi harnesses (e.g. Claude) that only accept tools over MCP get these same resolved tools
through an INTERNAL loopback HTTP MCP channel the runner serves (`tools/mcp-bridge.ts` +
`tools/tool-mcp-http.ts`) — this channel is live and is how Claude runs take custom tools.

This internal channel is a different thing from USER-declared MCP servers (a run request's own
`mcpServers`), which stay gated: stdio user MCP servers are refused for every harness
(`tools/mcp-server.ts`, the old stdio bridge, is REMOVED — it launched an unconfined child
process on the runner host, the same execution bypass that had code tools removed), and it is
_Pi_, not the sidecar broadly, that also refuses user _http_ MCP servers, because Pi delivers
tools through its bundled extension rather than over ACP MCP. Claude accepts user http MCP
servers. See `docs/design/agent-workflows/projects/sidecar-trust-and-sandbox-enforcement/`.

## The extension bundle

`scripts/build-extension.mjs` esbuild-bundles the Pi extension into
`dist/extensions/agenta.js` and the in-sandbox tool MCP shim into
`dist/tools/tool-mcp-stdio.js`. The dev image bakes both bundles; rebuild after editing the
extension, tracer, or shim:

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
echo '{"harness":"pi","sandbox":"local","messages":[{"role":"user","content":"Hi"}]}' | pnpm run run:cli
```
