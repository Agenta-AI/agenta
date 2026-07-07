> **Historical record.** This is a work-package note. It describes the design as it was at the time and may reference components that no longer exist. For the current design see the [agent-workflows docs](../../README.md); for the live state see [sdk-local-backend/status.md](../sdk-local-backend/status.md).
# Tracing the agent run into the response, like completion and chat

Status: built and verified end to end against the dev box (2026-06-15). Audience:
whoever works on the agent service (WP-2) and its tracing.

This is the follow-on to [integrating-the-tracing-extension.md](integrating-the-tracing-extension.md).
That doc made a standalone Pi run show up in Agenta as its own trace. This one wires
the same extension into the WP-2 agent service so the agent's whole run becomes part
of the `/invoke` trace, the way completion and chat nest their LLM spans under the
workflow span.

## What changed and why

Completion and chat are traced as one tree: the SDK opens a workflow span for the
`/invoke` request, the LLM call nests under it, and the response carries that
`trace_id`. Open the trace and you see the whole call.

The agent service runs the model work in a separate Node process (the Pi wrapper), so
its spans were not part of that tree. The WP-1 doc flagged the fix as future work:
thread a W3C `traceparent` across the boundary and start the agent span as its child.
That is what this change does.

The result is one tree under the response's `trace_id`:

```
_agent                 workflow   (the Python /invoke span, root)
  invoke_agent         AGENT      (the Pi run, now a child of _agent)
    turn N             CHAIN
      chat <model>     LLM        model, tokens, cost, message thread
      execute_tool ... TOOL
```

Verified shape from a live run (trace `0f47e5f5...`): four spans, one trace, the
`chat` span carrying `ag.data.inputs`/`outputs` as a message thread, token usage
(598/21/619), and cost, with nothing in `ag.unsupported`.

## How it works

Three seams carry the context from the Python service to the Pi spans.

1. **Capture (Python, `services/oss/src/agent.py`).** Inside the instrumented
   `_agent` handler the current OpenTelemetry span is the workflow span. `_trace_context()`
   reads it with the SDK's `propagation.inject()`, which yields the `traceparent`,
   `baggage`, and the request `Authorization`. It also reads the OTLP endpoint from
   `ag.tracing.otlp_url`, the exact URL the Python spans use. This is best effort: if
   capture fails the run still works, just without cross-trace linking.

2. **Carry (`services/oss/src/agent_pi`).** `HarnessRequest` gains a `TraceContext`
   (`ports.py`). `TraceContext.to_wire()` serializes it to the camelCase shape the
   wrapper expects, and both harness adapters send it: the local subprocess one
   (`pi_harness.py`) and the HTTP sidecar one (`pi_http_harness.py`).

3. **Consume (Node, `services/agent/src/agenta-otel.ts`).** When a `traceparent` is
   present the extension starts `invoke_agent` as a child of that remote span, so the
   whole Pi subtree shares the caller's `trace_id`. It exports each trace to the
   endpoint and with the `Authorization` the caller passed, falling back to env. The
   runner (`runPi.ts`) flushes the trace before it returns the result.

Because the Python span and the Pi spans share one `trace_id` and the Pi root points
at the Python span, Agenta merges them into one tree at ingest. No backend change.

## What is different from the POC extension

The service build keeps the POC's span tree and every load-bearing attribute choice
(read the [five rules](integrating-the-tracing-extension.md#what-you-must-not-change-and-why)
again before touching attributes). It adds three things the service needs:

- **Per-run state, not module globals.** The POC ran one prompt at a time. The HTTP
  sidecar can drive several runs in one process, so all span state lives in the
  closure `createAgentaOtel()` returns. Only the tracer, provider, and exporter cache
  stay process wide.
- **A remote parent.** `invoke_agent` nests under the incoming `traceparent` instead
  of starting a fresh root. The parent has no end event in this process, so the
  per-trace batch flushes by trace id after the run rather than only on root-end.
- **Per-trace export target.** The OTLP endpoint and `Authorization` come from the run
  config, so one shared process can serve more than one project. They fall back to
  `AGENTA_HOST` / `AGENTA_API_KEY` when the caller passes nothing.

## Auth and endpoint

The Node side ships spans to the same place and with the same credentials as the
Python span. When the request carries `Authorization` (the project key or service
secret) the wrapper uses it verbatim, matching how the SDK exporter authorizes per
trace. With auth disabled locally there is no request credential, so the wrapper falls
back to the container's `AGENTA_API_KEY`. Set `AGENTA_AGENT_CAPTURE_CONTENT=0` on the
Python service to drop prompts, completions, and tool I/O from the spans.

For the HTTP sidecar the endpoint passed from Python is the URL the Python container
uses to reach Agenta. The sidecar must be able to reach the same host. On one Docker
network the internal hostname resolves from both; if it does not, the sidecar's
`AGENTA_HOST` fallback applies.

## How to verify

1. Start the services app (`entrypoints.main:app`, which mounts the agent at
   `/agent/v0`) with `AGENTA_HOST` and `AGENTA_API_KEY` set and a Pi login or provider
   key available.
2. POST a chat-style body to `/agent/v0/invoke` and read `x-ag-trace-id` from the
   response headers (it equals `trace_id` in the body).
3. Fetch the trace and confirm the merged tree and the totals:
   ```
   curl -s "${AGENTA_HOST}/api/spans/?trace_id=<id>" -H "Authorization: ApiKey ${AGENTA_API_KEY}"
   ```
   Expect `_agent` (workflow) over `invoke_agent` (agent) over `turn N` (chain) over
   `chat` (chat), all sharing one `trace_id`, with token usage and cost on the `chat`
   span and nothing under `ag.unsupported`.

## Files

- `services/oss/src/agent.py` — `_trace_context()` captures the workflow span context.
- `services/oss/src/agent_pi/ports.py` — `TraceContext` and `HarnessRequest.trace`.
- `services/oss/src/agent_pi/pi_harness.py`, `pi_http_harness.py` — forward the context.
- `services/agent/src/agenta-otel.ts` — the service build of the extension.
- `services/agent/src/runPi.ts` — registers the extension, sets run config, flushes.
