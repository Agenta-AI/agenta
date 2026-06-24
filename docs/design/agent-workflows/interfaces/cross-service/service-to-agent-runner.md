# Service To Agent Runner

The `/run` contract is the spine of the agent stack. The Python service builds a request,
the Node runner executes a turn, and the runner returns a result or a stream of events.
Everything else in this folder hangs off this contract. It is also the most pinned one: the
TypeScript types in `protocol.ts` are mirrored by hand in `wire.py`, and shared golden
fixtures byte-check the serialization. A field cannot move on one side alone.

In deployed containers the transport is HTTP to the sidecar. In local source checkouts it
can be a CLI subprocess that takes the same JSON on stdin. Both transports carry the same
payload, so the request shape is the contract and the transport is an implementation detail.

## Transports

- HTTP: `POST /run` on the sidecar, JSON body.
- HTTP streaming: same route with `Accept: application/x-ndjson`.
- CLI: JSON request on stdin, JSON result on stdout.
- CLI streaming: the `--stream` flag, NDJSON on stdout.

## The request

`AgentRunRequest` is built by `request_to_wire(...)` in `wire.py` and typed in
`protocol.ts`. Every field is optional on the wire; the runner fills defaults. The fields
group by job:

```jsonc
{
  // engine + placement
  "backend":  "sandbox-agent",          // or "pi" (legacy in-process); routed by server/cli
  "harness":  "pi",                      // "pi" | "claude" | "agenta"
  "sandbox":  "local",                   // "local" | "daytona"
  "sessionId": "sess_ab12...",           // external id; cold runtime still gets full history

  // instructions
  "agentsMd":           "...",           // AGENTS.md text, injected as instructions
  "systemPrompt":       "...",           // Pi only: replace the base prompt
  "appendSystemPrompt": "...",           // Pi only: append without replacing

  // model + connection (see service-to-vault-and-tool-providers.md)
  "model":          "openai/gpt-5.5",
  "provider":       "openai",            // present only for a structured model_ref
  "connection":     { "mode": "agenta", "slug": "..." },
  "deployment":     "direct",            // direct | azure | bedrock | vertex | custom
  "endpoint":       { "baseUrl": "...", "apiVersion": "...", "region": "...", "headers": {} },
  "credentialMode": "env",               // env | runtime_provided | none
  "secrets":        { "OPENAI_API_KEY": "..." },   // the only vault-key channel on the wire

  // turn
  "prompt":   "...",                     // explicit latest turn; falls back to last user msg
  "messages": [ /* neutral ChatMessage[] */ ],

  // tools + skills (see runner-to-tool-callback.md, runner-to-mcp-server.md)
  "tools":        [ "read", "edit" ],    // built-in tool names
  "customTools":  [ /* ResolvedToolSpec[] */ ],
  "toolCallback": { "endpoint": "...", "authorization": "..." },  // required if customTools set
  "mcpServers":   [ /* McpServerConfig[] */ ],
  "skills":       [ /* inline skill packages */ ],

  // policy + files
  "permissionPolicy":  "auto",           // "auto" | "deny"
  "sandboxPermission": { /* Layer 2 boundary; declared, not yet enforced */ },
  "harnessFiles":      [ { "path": ".claude/settings.json", "content": "..." } ],

  // tracing (see service-and-runner-trace-export.md)
  "trace": { "traceparent": "...", "endpoint": "...", "authorization": "...", "captureContent": true }
}
```

Two splits matter for back-compat. `provider` and `connection` appear only when the model
arrives as a structured `model_ref`; a plain string like `"gpt-5.5"` leaves them off so the
wire stays byte-identical to the old shape. And `secrets` is the only vault-key channel on
the runner wire. `endpoint` carries non-secret connection config, and
`ResolvedConnection.to_wire()` never emits `env`.

## The result

`AgentRunResult`, parsed by `result_from_wire(...)`. `ok: false` raises in Python.

```jsonc
{
  "ok":           true,
  "output":       "final assistant text",     // what the playground renders
  "messages":     [ /* structured assistant messages */ ],
  "events":       [ /* event log; empty on the streaming path */ ],
  "usage":        { "input": 0, "output": 0, "total": 0, "cost": 0 },
  "stopReason":   "end_turn",
  "capabilities": { /* HarnessCapabilities, probed */ },
  "sessionId":    "sess_...",                  // carried forward to the next turn
  "model":        "openai/gpt-5.5",
  "traceId":      "hex...",                     // present when a traceparent was passed
  "error":        null                          // set when ok is false
}
```

## Streaming

The streaming transports emit one JSON object per line. Each event is flushed as it is
built; the run ends with exactly one terminal `result` record.

```jsonc
{ "kind": "event",  "event":  { "type": "message_delta", "id": "m1", "delta": "Hi" } }
{ "kind": "result", "result": { "ok": true, "output": "Hi" } }
```

On the streaming path the terminal result's `events` array is empty, because the events
already went out live. A consumer that reads events off the result will get nothing on this
path; it must read them from the stream. A stream that ends without a `result` record is an
error.

## Owned by

- `services/agent/src/protocol.ts`: the TypeScript request, result, and event types.
- `sdks/python/agenta/sdk/agents/utils/wire.py`: the Python serializer that mirrors them.
- `sdks/python/agenta/sdk/agents/utils/ts_runner.py`: HTTP and subprocess transport.
- `services/agent/src/server.ts` and `cli.ts`: the runner-side HTTP and CLI entrypoints.

## Watch for when changing

- **Any wire field, event kind, capability flag, tool field, or stream record.** Change one
  and you change the contract.
- **The byte-for-byte back-compat splits.** A plain string `model` must keep `provider` and
  `connection` off the wire, or the golden fixtures break.
- **Streaming versus batch divergence.** Events ride the stream live and never echo in the
  terminal result.
- **Error and cancellation behavior.** HTTP maps `>= 400` to a runtime error; the CLI uses
  exit codes. HTTP streaming wires an `AbortSignal` to client disconnect; the CLI has none.

## Required test updates

- Python wire contract tests under `sdks/python/oss/tests/pytest/unit/agents/`.
- TypeScript wire contract tests under `services/agent/tests/unit/`.
- Golden fixtures under `sdks/python/oss/tests/pytest/unit/agents/golden/`. These pin the
  exact bytes, so regenerate and review the diff deliberately.
