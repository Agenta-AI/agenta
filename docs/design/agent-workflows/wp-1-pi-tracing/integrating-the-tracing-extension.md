# Integrating the Pi tracing extension into the agent runtime

Status: ready to integrate. Audience: whoever builds the Dockerized Pi agent runtime
(WP-2 service, WP-3 sandbox). Source of the working code: [`poc/`](poc/).

## What this gives you

A Pi extension that turns Pi's `pi.on(...)` lifecycle events into OpenTelemetry spans and
ships them to Agenta over OTLP/HTTP protobuf. Once it is loaded, every agent run shows up
in Agenta observability as a clean span tree with inputs, outputs, token usage, cost, and
latency, and runs in the same session are grouped by `session.id`.

It is one self-contained file, `poc/agenta-otel.ts`. Copy it into the runtime as is. It is
written to be embedded, not just demoed. `poc/run.ts` is only an example driver; you will
write your own runner, but you can copy its wiring.

This was verified end to end against the dev box: complex multi-tool runs, parallel tool
calls, structured returns, and multi-prompt sessions all trace correctly, and the agent
root reports the correct whole-run token and cost totals.

## The span tree it produces

```
invoke_agent              openinference.span.kind = AGENT   (root, one per user prompt)
  turn N                  CHAIN
    chat <model>          LLM    model, latency, token usage, finish reason, messages
    execute_tool <name>   TOOL   args in, result out
```

Agenta types nodes from `openinference.span.kind` (AGENT to agent, CHAIN to chain, LLM to
chat, TOOL to tool) and groups sessions from `session.id`. No backend change is needed.

## How to wire it in

The runtime is Node embedding Pi through the SDK, so use the SDK path. It is the one the
extension is built for, and it is the only path where session id and model name reach the
spans.

```ts
import {
  AuthStorage, createAgentSession, DefaultResourceLoader,
  getAgentDir, ModelRegistry, SessionManager,
} from "@earendil-works/pi-coding-agent";
import agentaOtel, { runConfig, shutdownTracing } from "./agenta-otel";

const loader = new DefaultResourceLoader({
  cwd,
  agentDir: getAgentDir(),
  extensionFactories: [agentaOtel],   // <-- register the extension in-process
});
await loader.reload();

const { session } = await createAgentSession({
  cwd, model, authStorage, modelRegistry,
  tools: ["read", "bash", "edit", "write", "ls"],
  sessionManager: SessionManager.inMemory(cwd),
  resourceLoader: loader,
});

// Hand the session id and model to the extension so spans carry them.
runConfig.sessionId = session.sessionId;
runConfig.provider = model.provider;
runConfig.requestModel = model.id;

await session.prompt(userPrompt);     // run one or more prompts in the session
// ...
await shutdownTracing();              // flush before the process or container exits
```

If you instead run Pi from the CLI (`pi -e ./agenta-otel.ts ...`), the extension still
emits spans and flushes on `session_shutdown`, but `runConfig` is never set, so spans lose
`session.id` and the model name in the span title. Prefer the SDK path.

## What you must not change, and why

These five choices are load bearing. They were each found by reading how Agenta ingests
and normalizes spans. Changing them silently drops data.

1. **Atomic, parent-first export per trace.** The extension uses a small custom
   `TraceBatchProcessor`, not the OTel `BatchSpanProcessor`. It buffers a trace and exports
   all of its spans in one OTLP request when the root span ends, ordered parent before
   child. Agenta rolls token and cost totals up the tree by sorting spans on
   millisecond-resolution `start_time` and attaching a span only once its parent is
   present. The default batch processor splits long runs on its 5 second timer, and
   same-millisecond siblings (`agent_start` and `turn_start` fire in the same millisecond)
   tie and drop a subtree. Either one makes the agent root undercount, showing only the
   last turn instead of the whole run. Keep the custom processor.

2. **`ag.data.inputs` must be a JSON object.** Agenta moves any non-object input to
   `ag.unsupported`. The agent and tool spans emit `input.value` as a JSON object. The chat
   span emits OpenInference `llm.input_messages.*` and `llm.output_messages.*` so it renders
   as a real message thread. Do not emit a raw string as `input.value`.

3. **Both token naming conventions.** The extension writes token usage under the current
   GenAI names (`gen_ai.usage.input_tokens` / `output_tokens`) and the legacy names
   (`prompt_tokens` / `completion_tokens`). Agenta's default `semconv.py` only maps the
   legacy names today. Emit both or token metrics drop.

4. **`openinference.span.kind` on every span.** This is what types the node in the UI.

5. **`session.id` and `gen_ai.conversation.id` on the root.** Both map to `ag.session.id`,
   which groups runs into a session. Set them from the Pi `sessionId`.

## Configuration

All config is read from the environment at first use, so set it before the first run.

| Env var | Meaning |
|---|---|
| `AGENTA_HOST` | Agenta base URL, for example `http://144.76.237.122:8280`. A trailing slash is stripped. |
| `AGENTA_API_KEY` | Agenta project API key. The project is resolved from the key, so no `project_id` is needed. |
| `PI_OTEL_CAPTURE_CONTENT` | Set to `0` to drop prompts, completions, and tool I/O from spans. Default is on. |
| `OTEL_SERVICE_NAME` | Resource `service.name`, default `pi-agent`. |

The exporter posts to `${AGENTA_HOST}/api/otlp/v1/traces`. Note the `/api` prefix. The
transport is OTLP/HTTP protobuf only (`@opentelemetry/exporter-trace-otlp-proto`), with
header `Authorization: ApiKey <key>`. JSON OTLP and gRPC are rejected.

These are the same env vars whether the runtime runs locally or in a container, which keeps
local and server behavior identical.

## Dockerized runtime notes

- **Inject the two Agenta env vars** (`AGENTA_HOST`, `AGENTA_API_KEY`) into the container as
  secrets at start. They are separate from the LLM provider credentials.
- **Allow outbound network** from the sandbox to the Agenta host over HTTP or HTTPS.
- **Flush before the container exits.** Call `shutdownTracing()` at the end of the run. The
  per-trace processor already exports each trace when its root span ends, so a completed
  trace is usually shipped mid-run, but a final flush guards the last trace. If the
  container is killed before the flush, the last trace can be lost. If you cannot call
  `shutdownTracing()`, make sure `SIGTERM` triggers Pi's `session_shutdown`, which the
  extension also flushes on.
- **Node 22 or newer** is required by Pi 0.79.4.
- **LLM auth in the sandbox is your concern, not the tracing.** The interactive ChatGPT
  Codex login used in the POC is local only. In the container use a non-interactive
  credential (an API key or a transplanted token).
- **Trace context across the boundary is done for the WP-2 service.** The agent service
  threads a W3C `traceparent` into the run and starts the agent span as a child of the
  Agenta `/invoke` span, so the whole agent run is part of the response trace. See
  [tracing-in-the-agent-service.md](tracing-in-the-agent-service.md). Standalone runs (no
  `traceparent`) still create their own root and correlate by `session.id`.

## Dependencies

Pin these in the runtime image (the OTel versions are a known-compatible set):

```
@earendil-works/pi-coding-agent  0.79.4
@opentelemetry/api               1.9.0
@opentelemetry/exporter-trace-otlp-proto  0.54.0
@opentelemetry/resources         1.28.0
@opentelemetry/sdk-trace-base    1.28.0
@opentelemetry/sdk-trace-node    1.28.0
@opentelemetry/semantic-conventions  1.28.0
```

## How to verify it works

1. On startup you should see `[agenta-otel] exporting spans to .../api/otlp/v1/traces`.
2. After a run, fetch the trace and check the tree and totals:
   ```
   curl -s "${AGENTA_HOST}/api/spans/?trace_id=<id>" -H "Authorization: ApiKey ${AGENTA_API_KEY}"
   ```
   Expect `invoke_agent` (agent) over `turn N` (chain) over `chat` (chat) and
   `execute_tool` (tool). Expect `ag.data.inputs` and `ag.data.outputs` on the agent, chat,
   and tool spans, and nothing under `ag.unsupported`. Expect the agent root's
   `ag.metrics.tokens.cumulative` to equal the sum of the chat spans' incrementals.
3. Or open Agenta observability and confirm the trace reads well and the root shows the
   full-run token count and cost.

## Reference: attributes per span

| Span | Key attributes the extension sets |
|---|---|
| `invoke_agent` (AGENT) | `openinference.span.kind=AGENT`, `gen_ai.operation.name=invoke_agent`, `session.id`, `gen_ai.conversation.id`, `input.value` as `{prompt}`, `output.value` final text |
| `turn N` (CHAIN) | `openinference.span.kind=CHAIN`, `pi.turn.index` |
| `chat <model>` (LLM) | `openinference.span.kind=LLM`, `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.finish_reasons`, `gen_ai.usage.{input,output,prompt,completion,total}_tokens`, `llm.input_messages.*`, `llm.output_messages.*` |
| `execute_tool <name>` (TOOL) | `openinference.span.kind=TOOL`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `input.value` as the args object, `output.value` the result |

## One known gap, not on the agent side

The Agenta Sessions tab groups our `session.id` correctly, and the per-session API
(`POST /api/traces/query` filtering `ag.session.id`) returns the right traces with costs,
but the Sessions table's aggregate columns render empty on the current dev build. The data
is correct and queryable. This is a frontend rendering gap, not something the instrumentation
or the runtime can fix.
