# Research: Vercel AI SDK Semantic Conventions

## Source

All data extracted directly from the Vercel AI SDK source at `packages/ai/src/` in [github.com/vercel/ai](https://github.com/vercel/ai).

Tracer name: `trace.getTracer('ai')`

---

## Span Types and Their Attributes

### `ai.generateText` (outer span)

| Attribute | Type | I/O | Description |
|-----------|------|-----|-------------|
| `ai.prompt` | string (JSON) | input | `JSON.stringify({system?, prompt?, messages?})` |
| `ai.response.text` | string | output | Generated text |
| `ai.response.reasoning` | string | output | CoT reasoning (if model supports) |
| `ai.response.toolCalls` | string (JSON) | output | Array of `{toolCallId, toolName, input}` |
| `ai.response.finishReason` | string | output | `stop`, `tool-calls`, `length`, `content-filter`, `error`, `other` |
| `ai.response.providerMetadata` | string (JSON) | output | Provider-specific metadata |
| `ai.usage.promptTokens` | number | output | Input tokens |
| `ai.usage.completionTokens` | number | output | Output tokens |
| `ai.model.id` | string | input | Model identifier |
| `ai.model.provider` | string | input | Provider identifier |
| `ai.settings.maxRetries` | number | input | Always present |
| `ai.settings.maxOutputTokens` | number | input | If set |
| `ai.settings.temperature` | number | input | If set |
| `ai.settings.topP` | number | input | If set |
| `ai.settings.topK` | number | input | If set |
| `ai.settings.presencePenalty` | number | input | If set |
| `ai.settings.frequencyPenalty` | number | input | If set |
| `ai.settings.stopSequences` | string[] | input | If set |
| `ai.settings.seed` | number | input | If set |
| `ai.operationId` | string | always | `"ai.generateText"` |
| `operation.name` | string | always | `"ai.generateText"` or `"ai.generateText {functionId}"` |
| `resource.name` | string | if set | `functionId` value |
| `ai.telemetry.functionId` | string | if set | `functionId` value |
| `ai.telemetry.metadata.{key}` | any | if set | Custom metadata |

Input gating: `ai.prompt` gated by `recordInputs` (default true).
Output gating: `ai.response.*` gated by `recordOutputs` (default true).

### `ai.generateText.doGenerate` (inner span)

Has all the above model/settings attributes, plus:

| Attribute | Type | I/O | Description |
|-----------|------|-----|-------------|
| `ai.prompt.messages` | string (JSON) | input | Normalized LanguageModelV3Prompt |
| `ai.prompt.tools` | string[] | input | JSON-stringified tool definitions |
| `ai.prompt.toolChoice` | string (JSON) | input | Tool choice config |
| `ai.response.id` | string | output | Provider response ID |
| `ai.response.model` | string | output | Actual model used |
| `ai.response.timestamp` | string (ISO) | output | Response timestamp |
| **`gen_ai.system`** | string | input | Provider (OTel semconv) |
| **`gen_ai.request.model`** | string | input | Requested model |
| **`gen_ai.request.temperature`** | number | input | If set |
| **`gen_ai.request.max_tokens`** | number | input | If set |
| **`gen_ai.request.top_p`** | number | input | If set |
| **`gen_ai.request.top_k`** | number | input | If set |
| **`gen_ai.request.frequency_penalty`** | number | input | If set |
| **`gen_ai.request.presence_penalty`** | number | input | If set |
| **`gen_ai.request.stop_sequences`** | string[] | input | If set |
| **`gen_ai.response.finish_reasons`** | string[] | output | |
| **`gen_ai.response.id`** | string | output | |
| **`gen_ai.response.model`** | string | output | |
| **`gen_ai.usage.input_tokens`** | number | output | |
| **`gen_ai.usage.output_tokens`** | number | output | |

The `gen_ai.*` attributes (bolded) are already handled by existing OpenLLMetry/Logfire adapters.

### `ai.streamText` (outer span)

Same as `ai.generateText` except token naming differs:

| Attribute | Type | I/O | Description |
|-----------|------|-----|-------------|
| `ai.usage.inputTokens` | number | output | Total input tokens (all steps) |
| `ai.usage.outputTokens` | number | output | Total output tokens (all steps) |
| `ai.usage.totalTokens` | number | output | Total all tokens |
| `ai.usage.reasoningTokens` | number | output | Reasoning tokens |
| `ai.usage.cachedInputTokens` | number | output | Cached input tokens |

### `ai.streamText.doStream` (inner span)

Same as `ai.generateText.doGenerate` plus:

| Attribute | Type | I/O | Description |
|-----------|------|-----|-------------|
| `ai.response.msToFirstChunk` | number | output | Time to first chunk (ms) |
| `ai.response.msToFinish` | number | output | Time to finish (ms) |
| `ai.response.avgOutputTokensPerSecond` | number | output | Throughput metric |

Events: `ai.stream.firstChunk`, `ai.stream.finish`

### `ai.toolCall`

Minimal span — no model/settings attributes:

| Attribute | Type | I/O | Description |
|-----------|------|-----|-------------|
| `ai.toolCall.name` | string | input | Tool name |
| `ai.toolCall.id` | string | input | Tool call ID |
| `ai.toolCall.args` | string (JSON) | output* | JSON-stringified input (*gated by recordOutputs) |
| `ai.toolCall.result` | string (JSON) | output | JSON-stringified output |
| `ai.operationId` | string | always | `"ai.toolCall"` |

### `ai.embed` / `ai.embedMany`

| Attribute | Type | Description |
|-----------|------|-------------|
| `ai.value` / `ai.values` | string (JSON) / string[] | Input values |
| `ai.embedding` / `ai.embeddings` | string (JSON) / string[] | Output embeddings |
| `ai.usage.tokens` | number | Token count |

---

## Complete Attribute Key List

Every unique `ai.*` key the SDK can emit (sorted):

```
ai.documents
ai.embedding
ai.embeddings
ai.model.id
ai.model.provider
ai.operationId
ai.prompt
ai.prompt.messages
ai.prompt.toolChoice
ai.prompt.tools
ai.ranking
ai.ranking.type
ai.request.headers.{key}
ai.response.avgOutputTokensPerSecond
ai.response.finishReason
ai.response.id
ai.response.model
ai.response.msToFinish
ai.response.msToFirstChunk
ai.response.object
ai.response.providerMetadata
ai.response.reasoning
ai.response.text
ai.response.timestamp
ai.response.toolCalls
ai.schema
ai.schema.description
ai.schema.name
ai.settings.frequencyPenalty
ai.settings.maxOutputTokens
ai.settings.maxRetries
ai.settings.output
ai.settings.presencePenalty
ai.settings.seed
ai.settings.stopSequences
ai.settings.temperature
ai.settings.timeout
ai.settings.topK
ai.settings.topP
ai.stream.msToFirstChunk
ai.telemetry.functionId
ai.telemetry.metadata.{key}
ai.toolCall.args
ai.toolCall.id
ai.toolCall.name
ai.toolCall.result
ai.usage.cachedInputTokens
ai.usage.completionTokens
ai.usage.inputTokens
ai.usage.outputTokens
ai.usage.promptTokens
ai.usage.reasoningTokens
ai.usage.tokens
ai.usage.totalTokens
ai.value
ai.values
```

Plus `gen_ai.*` on inner/call spans (handled by existing adapters).

---

## Existing Backend Adapter Interfaces

### `BaseAdapter` Protocol

```python
class BaseAdapter(Protocol):
    feature_name: str  # Or None
    def process(self, bag: CanonicalAttributes, features: SpanFeatures) -> None: ...
```

### `CanonicalAttributes` (input to process)

Key fields:
- `span_name: str`
- `span_attributes: Dict[str, Any]` — the main dict adapters read from
- `resource_attributes: Dict[str, Any]`
- `events: List[EventData]`
- `links: List[LinkData]`
- Helper: `get_attributes_in_namespace(prefix)`, `has_attributes_in_namespace(prefix)`

### `SpanFeatures` (output — mutated in-place)

Key fields: `data`, `metrics`, `meta`, `refs`, `type`, `flags`, `tags`, `session`, `user`, `exception`, `links` — all `Dict[str, Any]` or `List[Any]`.

### Existing Adapter Execution Order

1. OpenLLMmetryAdapter (`gen_ai.*`, `llm.*`, `traceloop.*`)
2. OpenInferenceAdapter (`input.value`, `output.value`, `openinference.*`)
3. LogfireAdapter (`gen_ai.*`, logfire events)
4. DefaultAgentaAdapter (`ag.*`, exception events) — always last

### Existing Tests

- **No unit tests exist** for any adapter's `process()` method
- Deleted tests in git history had the right patterns (direct `CanonicalAttributes` + `SpanFeatures` construction)
- E2E tests exist at `api/oss/tests/pytest/e2e/tracing/`
- Manual integration scripts at `api/oss/tests/manual/tracing/ingestion/`
