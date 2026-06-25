# Service And Runner Trace Export

An agent run should show up as one nested trace, not two disconnected ones. So the service
passes trace context into the runner, the runner nests its spans under the caller's workflow
span, and those spans export back to Agenta over OTLP. This boundary is what keeps the agent
turn attached to the rest of the request and what carries usage back for accounting.

## The contract

**Context in.** The `/run` request carries a `trace` block:

```jsonc
{
  "traceparent":    "00-<traceId>-<spanId>-01",  // W3C; makes the run a child span
  "baggage":        "...",                         // W3C baggage, carried for future use
  "endpoint":       "https://.../api/otlp/v1/traces",  // OTLP target; falls back to env
  "authorization":  "ApiKey ...",                  // export auth; falls back to env
  "captureContent": true                           // false drops prompt/completion/tool I/O
}
```

**Spans back out.** The runner builds a span tree per run and exports it parent-first to the
target carried for that trace id, so Agenta can attach it under the caller's span:

```
invoke_agent (AGENT)
  └─ turn N (CHAIN)
       ├─ chat <model> (LLM)    [input/output messages, usage]
       └─ execute_tool <name> (TOOL)   [one per tool call]
```

When a `traceparent` is supplied, `invoke_agent` becomes a child and the result's `traceId`
echoes the W3C trace id. A standalone run mints a fresh one. If no spans are emitted,
`traceId` is absent.

**Usage roll-up.** The run accumulates token and cost usage and stamps it on the
`invoke_agent` span before flush, so the exported trace carries final totals. In-process Pi
reads usage from its own message stream; the ACP path pulls it from `usage_update`. Either
way it has to be stamped before the span closes.

## Owned by

- `services/oss/src/agent/tracing.py`: builds the trace context the service sends.
- `services/agent/src/tracing/otel.ts`: the runner's span building and OTLP export.
- `services/agent/src/extensions/agenta.ts`: the Pi extension that self-instruments.

## Watch for when changing

- **Context propagation.** `traceparent` is what makes the run a child. Drop it and the trace
  detaches.
- **OTLP endpoint and auth.** Per-trace target first, env fallback second. Both paths have to
  keep working.
- **Span names and semantic attributes.** Agenta's trace UI reads these; renames ripple into
  it.
- **`captureContent`.** When false, prompts, completions, and tool I/O must not be exported.
- **Usage accounting.** Usage has to be stamped before flush, or exported traces carry zero
  totals.
