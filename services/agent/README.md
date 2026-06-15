# Agent service: Pi wrapper (WP-2)

This is the TypeScript side of the agent workflow service. It is a thin wrapper that
drives the [Pi](https://pi.dev) agent harness for a single run. The Python service
(`services/oss/src/agent.py`) calls it; see
`docs/design/agent-workflows/wp-2-agent-service/`.

## What it does

`src/cli.ts` reads one JSON request on stdin, runs Pi once via the SDK
(`createAgentSession`), and writes one JSON result on stdout. AGENTS.md is injected in
memory; the session and working dir are throwaway. stdout is the result channel only,
logs go to stderr.

Request (stdin):

```json
{
  "agentsMd": "You are a hello-world agent.",
  "model": "gpt-5.5",
  "prompt": "Hi there",
  "messages": [{"role": "user", "content": "Hi there"}],
  "tools": []
}
```

Result (stdout):

```json
{ "ok": true, "output": "Hello! ...", "sessionId": "...", "model": "openai-codex/gpt-5.5", "traceId": "..." }
```

## Tracing

When the request carries a `trace` block, the run is traced into Agenta as
OpenTelemetry spans and nested under the caller's `/invoke` span, so the agent's whole
run is part of the same trace (the way completion/chat nest their LLM spans). The
Python service fills `trace` in from the live workflow span; see
`docs/design/agent-workflows/wp-1-pi-tracing/tracing-in-the-agent-service.md`.

```json
{
  "prompt": "Hi there",
  "trace": {
    "traceparent": "00-<32hex trace>-<16hex span>-01",
    "endpoint": "https://host/api/otlp/v1/traces",
    "authorization": "ApiKey ...",
    "captureContent": true
  }
}
```

With no `trace` block the run is traced standalone using `AGENTA_HOST` /
`AGENTA_API_KEY`, or not at all when neither is set. The extension lives in
`src/agenta-otel.ts`.

## Auth

`AuthStorage.create()` reads `~/.pi/agent/auth.json`. Log in once with `pnpm exec pi`
then `/login`, or set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.

## Local use

```bash
pnpm install
echo '{"agentsMd":"You are a hello-world agent.","prompt":"Hi"}' | pnpm run run:cli
```

## Config

`config/AGENTS.md` and `config/agent.json` hold the hardcoded MVP config. They are read
by the Python service and passed into the request, so editing them changes the agent
without a code change.
