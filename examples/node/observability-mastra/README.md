# Agenta Observability — Mastra (broken baseline)

> ⚠️ **This is a problematic baseline, not a stable template.** It demonstrates the broken default behaviour of wiring Mastra agents to Agenta the same way you'd wire the Vercel AI SDK. **Running this app will produce zero traces in Agenta.** This is by design — see [Why this is broken](#why-this-is-broken).
>
> If you want a working setup, jump to [The fix](#the-fix) below. If you want to understand the underlying mechanics first, read on.

This example pairs with [`observability-vercel-ai/`](../observability-vercel-ai/) (the canonical AI SDK quickstart). It shows that the same instrumentation pattern — raw OpenTelemetry SDK, globally-registered `NodeTracerProvider`, OTLP exporter pointed at Agenta — **does not produce any traces** when the user is calling [Mastra](https://mastra.ai) agents instead of bare Vercel AI SDK functions.

## What this app does

- Registers a global OpenTelemetry `NodeTracerProvider` with an OTLP/proto exporter pointed at Agenta (`instrumentation.js`)
- Defines one Mastra `Agent` and calls `agent.generate(...)` to write a two-sentence story (`app.js`)
- Tries to flush traces on exit

This is the natural Mastra adaptation of the Vercel AI SDK example. Same env vars, same OTel setup, same code shape. The Mastra docs lead users to roughly this setup.

## Run it (to see the failure)

```bash
npm install
cp .env.example .env   # fill in AGENTA_API_KEY, OPENAI_API_KEY
npm start
```

You will see:

```
OpenTelemetry instrumentation initialized
(Note: this baseline does NOT produce Mastra traces — see README)
Running Mastra agent...

A small robot named Pixel discovered an old set of brushes in a dusty
attic. With careful, deliberate strokes it painted the first sunrise it
had ever seen — and learned that creation can be its own quiet kind of joy.

Flush attempted. Check your Agenta dashboard...
Spoiler: nothing arrived. The agent ran successfully but no traces went anywhere.
```

The agent worked. The OpenAI API call worked. The OTLP exporter registered cleanly. **No traces show up in your Agenta dashboard.** No errors, no warnings, no diagnostic. That's the failure mode this example demonstrates.

## Why this is broken

There are two distinct things going wrong, both silent.

### 1. Mastra's bundled AI SDK returns a noop tracer by default

Mastra `@mastra/core` ships a vendored copy of the Vercel AI SDK v1 internally. Every time an `Agent` calls the underlying model, Mastra invokes that vendored code path. The vendored AI SDK checks an internal `experimental_telemetry.isEnabled` flag — and **defaults it to `false`**:

```js
// node_modules/@mastra/core/dist/chunk-VXOFGYGF.js:3359
function getTracer({ isEnabled = false, tracer } = {}) {
    if (!isEnabled) return noopTracer
    return tracer ?? trace.getTracer("ai")
}
```

When that flag is `false`, the vendored AI SDK returns a `noopTracer` — every `tracer.startSpan(...)` call becomes a no-op. **No OTel spans are ever created**, so the globally-registered `NodeTracerProvider` in `instrumentation.js` has nothing to export.

Mastra's user-facing `Agent` API (`agent.generate`, `agent.stream`) does **not** expose this flag to callers. There is no way to pass `experimental_telemetry: { isEnabled: true }` through `agent.generate(...)`. You can't enable AI SDK telemetry from outside Mastra.

### 2. Mastra has its own observability bus, not OTel

Mastra ships a separate package, `@mastra/observability`, that builds an internal `ObservabilityBus`. When you wire it up (`new Mastra({ observability: new Observability({...}) })`), Mastra emits rich `TracingEvent` payloads to its own bus with span types like `AGENT_RUN`, `MODEL_GENERATION`, `MODEL_STEP`, `MODEL_CHUNK`.

But the bus is **not** OpenTelemetry. The events go to Mastra-specific exporters (`ConsoleExporter`, `CloudExporter`, `DefaultExporter`, `TestExporter`) — none of which speak OTLP. The globally-registered OTel `NodeTracerProvider` is invisible to this bus.

So even if you install `@mastra/observability` and configure it, **Mastra still does not emit OpenTelemetry spans**. Mastra has a parallel observability stack that lives next to OTel, not on top of it.

### Combined result

- Path 1 broken: AI SDK telemetry is gated off by an internal flag the user can't reach.
- Path 2 broken: Mastra's own observability writes to its own bus, not to OTel.
- Net: zero OTel spans, empty Agenta dashboard.

## The fix

A working setup needs a custom Mastra exporter that subscribes to the `ObservabilityBus` and re-emits each `TracingEvent` as an OTel span through the globally-registered tracer. This is exactly what the spike app under [`web/examples/mastra-node/src/agenta-exporter.ts`](../../../web/examples/mastra-node/src/agenta-exporter.ts) implements (~150 lines).

Wired in, the same Mastra agent call produces a clean 4-span tree in Agenta:

```
L0: agent run: 'chat-agent'        ⭐ input + output + user.id
L1: llm: 'gpt-4o-mini'             ⭐ input + output + user.id
L2: step: 0                        ⭐ output + user.id
L3: chunk: 'text'                  ⭐ output + user.id
```

— with prompts, response text, model name, and per-call metadata all visible.

This is the proof-of-concept for what `@agenta/sdk-mastra` would package as a one-line install:

```ts
// future
import {AgentaMastraExporter} from "@agenta/sdk/mastra"

new Mastra({
    agents: {chatAgent},
    observability: new Observability({
        configs: {
            default: {
                name: "default",
                serviceName: "my-app",
                sampling: {type: SamplingStrategyType.ALWAYS},
                exporters: [
                    new AgentaMastraExporter({
                        host: process.env.AGENTA_HOST,
                        apiKey: process.env.AGENTA_API_KEY,
                        projectId: process.env.AGENTA_PROJECT_ID,
                    }),
                ],
            },
        },
    }),
})
```

Until that package exists, see [`web/examples/mastra-node/`](../../../web/examples/mastra-node/) for the working spike implementation. It has the canonical 4 assertions (cold-start, mid-stream abort, metadata round-trip, instrumentation-before-first-handler) all passing.

## Where this came from

This baseline + fix combo was discovered during the [`ts-sdk-tracing` design spike](../../../docs/design/ts-sdk-tracing/). Full pain-entry context: [P-MASTRA-01](../../../docs/design/ts-sdk-tracing/pain-log.md).

There is an open architectural question, captured in the design docs, about whether the Mastra → Agenta translation should live in a JS-side SDK (this exporter) or in a backend adapter that recognizes raw Mastra span payloads — mirroring how Agenta's backend already maps Vercel AI SDK's `ai.*` attributes to its own `ag.*` namespace. Both options are documented in the design files; the spike implementation here proves the JS-side path is feasible.
