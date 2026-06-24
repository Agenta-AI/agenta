# Runner Engine Internals

Inside the Node runner, the HTTP server and the CLI share one engine seam. Both entrypoints
parse a request and call the one engine with the same signature. The runner drives one engine,
the sandbox-agent ACP path; the request's `harness` field selects the ACP agent, so there is
no engine selector. This page is the runner-internal contract that keeps HTTP and CLI behaving
identically. The wire shape they exchange is
[Service to agent runner](../cross-service/service-to-agent-runner.md); this page is the
function seam behind it.

## The contract

```typescript
type RunAgent = (
  request: AgentRunRequest,
  emit?: EmitEvent,            // live event sink; drives the stream
  signal?: AbortSignal,        // HTTP streaming only; the CLI has none
) => Promise<AgentRunResult>;

type EmitEvent = (event: AgentEvent) => void;
```

Both entrypoints route the same way:

```typescript
return runSandboxAgent(request, emit, signal);   // the one engine; signal optional
```

The HTTP server detects streaming from `Accept: application/x-ndjson`, wires an
`AbortController` to the response close, and writes NDJSON or a single JSON response. The CLI
reads the request from stdin, detects streaming from `--stream`, writes NDJSON or single JSON
to stdout, and exits `0` on `ok: true`, `1` otherwise.

## Owned by

- `services/agent/src/server.ts`: the HTTP entrypoint.
- `services/agent/src/cli.ts`: the CLI entrypoint.
- `services/agent/src/engines/sandbox_agent.ts`: the one ACP engine.

## Watch for when changing

- **The engine seam.** Both entrypoints call `runSandboxAgent` with the same signature. The
  `harness` field, not an engine selector, picks the ACP agent.
- **Event emission timing.** `emit` drives the live stream; when the engine calls it changes
  what the client sees and when.
- **Error conversion.** HTTP maps failures to status codes; the CLI maps them to exit codes.
  Keep the two consistent.
- **Abort propagation.** Only HTTP streaming has a signal. The CLI cannot be cancelled mid-run
  the same way.
- **The terminal result.** Streaming ends with exactly one result record; both entrypoints
  must guarantee it.
