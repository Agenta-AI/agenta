# SDK-Native Spike

Companion to [`docs/design/ts-sdk-tracing/sdk-comparison.md`](../../../docs/design/ts-sdk-tracing/sdk-comparison.md) § "Ergonomic-by-ergonomic, six implementations side-by-side".

Verifies row-by-row what `langfuse-node` and `braintrust` JS SDKs actually do at runtime — vs the raw OTLP path the rest of the spike uses.

## What it tests

Each script makes the same `streamText("Reply with: ok.")` call against `gpt-4o-mini` and exercises rows #1-#6 of the comparison table:

| Script | What it verifies |
|---|---|
| `scripts/agenta-raw-otel.ts` | Baseline: 9 functional setup statements, `experimental_telemetry: {isEnabled: true}`, hand-rolled trace URL |
| `scripts/langfuse-sdk.ts` | `new Langfuse({...})` + `observeOpenAI()` + `trace.span()` + `trace.getTraceUrl()` |
| `scripts/braintrust-sdk.ts` | `initLogger()` + `wrapAISDK(ai)` + `traced(fn, {name})` + `currentSpan().link()` |

## Running

```bash
cd web/examples/sdk-native-spike
cp .env.example .env  # fill in keys
pnpm install
pnpm run:all          # runs all three sequentially
```

Then verify the data actually landed via REST:

```bash
python3 /tmp/verify-sdk-native.py  # or roll your own with the recipes in sdk-comparison.md
```

## Empirical findings (2026-05-16)

Captured in the comparison doc. Key data:

- **Setup LoC**: Langfuse 1 statement, Braintrust 2, Agenta-raw 9.
- **Langfuse cost**: server-side at ingest. `gpt-4o-mini` → `gpt-4o-mini-2024-07-18` resolution, `calculatedTotalCost: 3e-06`.
- **Braintrust auto-metrics**: `time_to_first_token: 0.057s` emitted without asking.
- **Langfuse's `observeOpenAI` wraps the OpenAI client, NOT AI SDK** — for AI SDK use the separate `@langfuse/vercel` package.
- **Trace URL helpers**: Langfuse `trace.getTraceUrl()` and Braintrust `currentSpan().link()` both work first-class.

## Not yet tested

- **`@langfuse/vercel` `LangfuseExporter`** for AI SDK direct (vs `observeOpenAI`)
- **`@langfuse/otel` `SpanProcessor`** filter behavior on Next.js wrapper spans
- **Mastra-native** instrumentation (`new Mastra({telemetry: ...})`) — would need its own script
- **Cross-process traceparent propagation** — would need a paired Python service
