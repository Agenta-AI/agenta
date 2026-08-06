# Agenta Observability — Vercel AI SDK

This example shows how to send traces from the [Vercel AI SDK](https://sdk.vercel.ai/) to Agenta using its built-in OpenTelemetry support. No additional instrumentation library is needed.

## How it works

The Vercel AI SDK emits OpenTelemetry spans automatically when you pass `experimental_telemetry: { isEnabled: true }` to any generation call. This example configures an OTLP exporter that forwards those spans to Agenta.

Spans produced per `generateText` call:
- `ai.generateText` — root span for the full call
- `ai.generateText.doGenerate` — child span for the individual provider request

Each span includes model, token usage, prompt messages, and response text automatically.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```
AGENTA_HOST=https://cloud.agenta.ai   # or your self-hosted URL
AGENTA_API_KEY=...                    # from Agenta Settings → API Keys
OPENAI_API_KEY=...
```

### 3. Run

```bash
npm start
```

You should see output like:

```
OpenTelemetry instrumentation initialized
Generating story...

In a quiet workshop, a curious robot named Artie...

Traces exported to Agenta.
```

Open your Agenta project's Observability tab to see the trace.

## Files

| File | Description |
|------|-------------|
| `instrumentation.js` | Sets up the OTel `NodeTracerProvider` with an OTLP exporter pointing at Agenta. Loaded before the app via `--import`. |
| `app.js` | Calls `generateText` with `experimental_telemetry` enabled. No manual span creation needed. |

## Key concept

```js
const result = await generateText({
    model: openai("gpt-4o-mini"),
    messages: [...],
    experimental_telemetry: {
        isEnabled: true,          // enables OTel spans
        functionId: "my-fn",      // becomes the trace/span name
        metadata: { key: "val" }, // attached as span attributes
    },
});
```

That's all — the SDK handles creating, populating, and exporting the spans.
