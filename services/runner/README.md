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

This internal channel is different from external user MCP servers in `mcpServers`. The public
contract accepts HTTP only. Pi currently refuses external MCP because it delivers tools through
its bundled extension rather than ACP MCP; Claude accepts the HTTP entries.

## The extension bundle

`scripts/build-extension.mjs` esbuild-bundles the Pi extension into
`dist/extensions/agenta.js` and the in-sandbox tool MCP shim into
`dist/tools/tool-mcp-stdio.js`. The dev image bakes both bundles; rebuild after editing the
extension, tracer, or shim:

```bash
pnpm run build:extension
```

## Auth

Credentials arrive grouped by the consumer that owns them, not as one flat map. The model's
key and route ride `request.modelConnection`; each MCP server's key rides its own
`mcpServers[].connection.credentials`. That grouping is what lets the runner know which host a
given key is allowed to reach, which the section below depends on. A request that still sends
the retired flat fields (`secrets`, `provider`, `deployment`, `credentialMode`, `endpoint`) is
rejected outright rather than run without the credential it meant to supply.

A run can also carry no key and fall back to the harness's own login: Pi reads
`~/.pi/agent/auth.json` (`pnpm exec pi` then `/login`), Claude Code reads `~/.claude`, Codex
reads `CODEX_HOME`. Set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` to override locally.

### Hiding keys from the sandbox

By default a key reaches the sandbox as an ordinary environment variable or HTTP header, so the
agent running there can read it. That matters because an agent writes and runs its own code: a
prompt injection that convinces it to print its environment prints the key.

Set `AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS=process_local` and, on Daytona, the runner instead
stores each key as a Daytona Secret restricted to the one hostname that key authenticates
against, and puts a placeholder in the sandbox. Daytona substitutes the real value into outbound
requests to that host, so the model call and the MCP call still work while the agent only ever
holds a placeholder. A request to any other host carries the placeholder, which is what makes
exfiltration fail.

Three things to know:

- The runner's Daytona API key needs permission to manage Secrets. A key that can create
  sandboxes does not automatically have it. Without it, every run carrying a model or MCP key
  fails at sandbox creation; the runner never quietly falls back to plaintext. The error names
  the variable and the permission (`DAYTONA_SECRETS_PERMISSION_MESSAGE` in `daytona-secrets.ts`).
- `process_local` names the guarantee: the runner tracks the Secret records it created in its own
  memory and deletes them when the sandbox goes away. Restart the runner while sandboxes are live
  and those records are orphaned until someone removes them.
- Keys a provider SDK signs with locally instead of sending, which today means the AWS keys behind
  Bedrock, cannot be hidden this way. There is no outbound request to substitute them into, so the
  sandbox holds the real value. They are marked `usage: "local_use"` and the set of names allowed
  to claim that is a short explicit allowlist in `daytona-secret-plan.ts`.

The local sandbox is unaffected: the harness runs inside the runner container, so its keys never
leave the deployment. See
[the configuration reference](../../docs/docs/self-host/reference/01-configuration.mdx) for the
operator-facing version.

## config/

`config/AGENTS.md` and `config/agent.json` are a fallback "hello-world" agent, used only
when a request arrives with no config. In practice the playground always sends the agent
revision's config, so these are rarely hit.

## Local use

```bash
pnpm install
echo '{"harness":"pi","sandbox":"local","messages":[{"role":"user","content":"Hi"}]}' | pnpm run run:cli
```
