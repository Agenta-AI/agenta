# Context: Vercel AI SDK Adapter

## Problem

The Vercel AI SDK emits OTel spans with `ai.*` attributes. These arrive in Agenta and are stored in the JSONB column, but no backend adapter maps them to `ag.*`. The frontend exclusively reads from `ag.*`, so all structured panels (inputs, outputs, model, tokens) appear empty.

## How Vercel AI SDK Telemetry Works

Users enable telemetry per-call:

```typescript
const result = await generateText({
    model: openai("gpt-4o-mini"),
    messages: [...],
    experimental_telemetry: {
        isEnabled: true,
        functionId: "my-fn",
        metadata: { userId: "user-123" },
    },
});
```

The SDK automatically creates OTel spans with attributes like:
- `ai.model.id`, `ai.model.provider` — model info
- `ai.prompt` or `ai.prompt.messages` — input data (JSON strings)
- `ai.response.text` — output text
- `ai.usage.promptTokens`, `ai.usage.completionTokens` — token counts
- `ai.settings.temperature`, `ai.settings.topP` — model parameters

No external instrumentation library needed — the SDK does it natively.

## Key Complication: Dual Attribute Namespaces

The Vercel AI SDK emits **both** `ai.*` and `gen_ai.*` attributes, but on different span types:

| Span Type | `ai.*` attributes | `gen_ai.*` attributes |
|-----------|-------------------|----------------------|
| `ai.generateText` (outer) | Yes | No |
| `ai.generateText.doGenerate` (inner) | Yes | **Yes** |
| `ai.streamText` (outer) | Yes | No |
| `ai.streamText.doStream` (inner) | Yes | **Yes** |
| `ai.toolCall` | Yes (minimal) | No |

The inner/call spans (`doGenerate`, `doStream`) emit `gen_ai.*` attributes which are **already handled** by the existing OpenLLMetry and Logfire adapters. This means:

**Option B (chosen)**: The new adapter only handles `ai.*` attributes. Existing adapters handle `gen_ai.*`. The adapters run sequentially and merge features — no conflict.

## Token Usage Naming Inconsistency

The SDK has an inconsistency (there's a TODO in their code to fix it):

| Context | Input Tokens | Output Tokens |
|---------|-------------|---------------|
| `generateText` spans | `ai.usage.promptTokens` | `ai.usage.completionTokens` |
| `streamText` spans | `ai.usage.inputTokens` | `ai.usage.outputTokens` |
| `gen_ai.*` (inner spans) | `gen_ai.usage.input_tokens` | `gen_ai.usage.output_tokens` |

The adapter must handle both naming conventions.

## Goals

1. Map `ai.*` attributes to `ag.*` so the frontend displays Vercel AI SDK spans correctly
2. Don't duplicate what existing adapters already handle (`gen_ai.*`)
3. Add proper unit tests for the adapter
4. Keep the adapter focused — only handle attributes the SDK actually emits

## Non-Goals

1. Frontend changes (not needed — once `ag.*` is populated, existing UI works)
2. Handling `gen_ai.*` attributes (existing adapters do this)
3. Supporting deprecated `ai.generateObject`/`ai.streamObject` (deprecated in SDK)
