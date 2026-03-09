# Plan: Vercel AI SDK Adapter

## Architecture

A new adapter at `api/oss/src/apis/fastapi/otlp/extractors/adapters/vercelai_adapter.py`, registered in `AdapterRegistry._register_default_adapters()`.

It follows the same pattern as all other adapters:
1. Scan `bag.span_attributes` for `ai.*` keys
2. Map them to `ag.*` canonical keys
3. Use `NAMESPACE_PREFIX_FEATURE_MAPPING` + `process_attribute()` to populate `SpanFeatures`

### Registration Order

Insert **before** `DefaultAgentaAdapter` (which is always last), and **after** `LogfireAdapter`:

```
1. OpenLLMmetryAdapter     (handles gen_ai.*, llm.*, traceloop.*)
2. OpenInferenceAdapter     (handles input.value, output.value, llm.*, openinference.*)
3. LogfireAdapter           (handles gen_ai.*, logfire events)
4. VercelAIAdapter          (NEW — handles ai.*)
5. DefaultAgentaAdapter     (handles ag.* — always last, can override)
```

---

## Attribute Mapping

### Data Attributes (`ag.data.*`)

| Source | Target | Notes |
|--------|--------|-------|
| `ai.prompt` | `ag.data.inputs` | JSON string → parse to dict. Contains `{system?, prompt?, messages?}` |
| `ai.prompt.messages` | `ag.data.inputs.prompt` | JSON string → parse. On inner spans only |
| `ai.response.text` | `ag.data.outputs` | Plain string |
| `ai.response.object` | `ag.data.outputs` | JSON string → parse. For generateObject spans |
| `ai.response.toolCalls` | `ag.data.outputs.toolCalls` | JSON string → parse |
| `ai.response.reasoning` | `ag.data.outputs.reasoning` | Plain string |
| `ai.toolCall.name` | `ag.data.inputs.name` | Tool call span |
| `ai.toolCall.args` | `ag.data.inputs.args` | JSON string → parse |
| `ai.toolCall.result` | `ag.data.outputs` | JSON string → parse |

### Meta Attributes (`ag.meta.*`)

| Source | Target | Notes |
|--------|--------|-------|
| `ai.model.id` | `ag.meta.request.model` | |
| `ai.model.provider` | `ag.meta.system` | e.g. `openai.chat` |
| `ai.response.model` | `ag.meta.response.model` | Actual model used |
| `ai.response.id` | `ag.meta.response.id` | Provider response ID |
| `ai.response.timestamp` | `ag.meta.response.timestamp` | ISO 8601 string |
| `ai.response.finishReason` | `ag.meta.response.finish_reasons` | Wrap in array: `[value]` |
| `ai.settings.temperature` | `ag.meta.request.temperature` | |
| `ai.settings.topP` | `ag.meta.request.top_p` | |
| `ai.settings.topK` | `ag.meta.request.top_k` | |
| `ai.settings.maxOutputTokens` | `ag.meta.request.max_tokens` | |
| `ai.settings.frequencyPenalty` | `ag.meta.request.frequency_penalty` | |
| `ai.settings.presencePenalty` | `ag.meta.request.presence_penalty` | |
| `ai.settings.stopSequences` | `ag.meta.request.stop_sequences` | |
| `ai.settings.seed` | `ag.meta.request.seed` | |
| `ai.settings.maxRetries` | `ag.meta.request.max_retries` | |

### Metrics Attributes (`ag.metrics.*`)

| Source | Target | Notes |
|--------|--------|-------|
| `ai.usage.promptTokens` | `ag.metrics.unit.tokens.prompt` | generateText naming |
| `ai.usage.completionTokens` | `ag.metrics.unit.tokens.completion` | generateText naming |
| `ai.usage.inputTokens` | `ag.metrics.unit.tokens.prompt` | streamText naming |
| `ai.usage.outputTokens` | `ag.metrics.unit.tokens.completion` | streamText naming |
| `ai.usage.totalTokens` | `ag.metrics.unit.tokens.total` | streamText only |
| `ai.usage.reasoningTokens` | `ag.metrics.unit.tokens.reasoning` | If present |
| `ai.usage.cachedInputTokens` | `ag.metrics.unit.tokens.cached` | If present |

### Type Attributes (`ag.type.*`)

| Source | Target | Notes |
|--------|--------|-------|
| `ai.operationId` | `ag.type.node` | Map: `ai.generateText` → `task`, `ai.streamText` → `task`, `ai.toolCall` → `tool`, `ai.embed*` → `embedding` |

### Session/User Attributes

| Source | Target | Notes |
|--------|--------|-------|
| `ai.telemetry.metadata.userId` | `ag.user.id` | If present in metadata |
| `ai.telemetry.metadata.sessionId` | `ag.session.id` | If present in metadata |

### Attributes NOT Mapped (left as raw `ai.*` in JSONB)

- `ai.prompt.tools` — tool definitions (complex, not needed for display)
- `ai.prompt.toolChoice` — tool choice config
- `ai.response.providerMetadata` — provider-specific (already JSON string)
- `ai.request.headers.*` — request headers
- `ai.telemetry.functionId` — already used as span name via `operation.name`
- `ai.telemetry.metadata.*` (except userId/sessionId) — preserved in raw attrs
- `ai.settings.timeout` — not useful for display
- `ai.schema`, `ai.schema.name`, `ai.schema.description` — object generation (deprecated)
- `ai.value`, `ai.values`, `ai.embedding`, `ai.embeddings` — embedding data (large)
- Streaming metrics (`ai.response.msToFirstChunk`, `ai.response.msToFinish`, `ai.response.avgOutputTokensPerSecond`) — could be added later

---

## Implementation Phases

### Phase 1: Adapter Implementation

**File**: `api/oss/src/apis/fastapi/otlp/extractors/adapters/vercelai_adapter.py`

Structure follows existing adapters (OpenLLMmetryAdapter pattern):
```python
class VercelAIAdapter:
    feature_name = None  # Contributes to multiple top-level keys

    EXACT_MAPPINGS = [...]
    DYNAMIC_MAPPINGS = [...]

    def process(self, bag: CanonicalAttributes, features: SpanFeatures) -> None:
        for key, value in bag.span_attributes.items():
            if not key.startswith("ai."):
                continue
            # ... mapping logic
```

### Phase 2: Registration

**File**: `api/oss/src/apis/fastapi/otlp/extractors/adapter_registry.py`

Add to `_register_default_adapters()`:
```python
from .adapters.vercelai_adapter import VercelAIAdapter
# Insert before DefaultAgentaAdapter
```

### Phase 3: Unit Tests

**File**: `api/oss/tests/pytest/unit/otlp/test_vercelai_adapter.py`

Test categories:
1. Model info mapping (`ai.model.id`, `ai.model.provider`)
2. Input extraction (`ai.prompt` JSON, `ai.prompt.messages`, `ai.toolCall.args`)
3. Output extraction (`ai.response.text`, `ai.response.object`, `ai.toolCall.result`)
4. Token usage — generateText naming (`ai.usage.promptTokens`, `ai.usage.completionTokens`)
5. Token usage — streamText naming (`ai.usage.inputTokens`, `ai.usage.outputTokens`, `ai.usage.totalTokens`)
6. Settings mapping (`ai.settings.temperature`, `ai.settings.topP`, etc.)
7. Operation type mapping (`ai.operationId` → `ag.type.node`)
8. JSON string parsing (verify `ai.prompt` parsed to dict)
9. Malformed JSON (graceful handling)
10. Unrelated attributes ignored (`gen_ai.*`, `llm.*`)
11. Missing attributes (empty features when no `ai.*`)
12. Metadata extraction (`ai.telemetry.metadata.userId` → `ag.user.id`)
13. Full realistic span — generateText outer span with all attributes
14. Full realistic span — tool call span

### Phase 4: E2E Tests

**File**: `api/oss/tests/pytest/acceptance/tracing/test_vercelai_ingestion.py`

Tests that exercise the full OTLP → adapter → storage → query pipeline:

1. **Ingest + query generateText span** — POST Vercel AI-style attributes via `/preview/tracing/spans/ingest`, poll until queryable, verify `ag.*` fields in returned span
2. **Ingest + query streamText span** — Same but with streamText token naming
3. **Ingest + query tool call span** — Verify tool inputs/outputs mapped

Uses the same `authed_api` / `wait_for_response` patterns as existing E2E tests.

### Phase 5: Run E2E Tests Against Deployed Worktree

Run the E2E tests against the deployed instance at `http://144.76.237.122:8480`.

### Phase 6: Integration Docs

**Directory**: `docs/docs/integrations/frameworks/vercel-ai-sdk/`

Files:
- `_category_.json` — Sidebar label and position
- `overview.mdx` — What is Vercel AI SDK, link to tracing guide
- `observability.mdx` — Full setup guide: install, configure OTel, `experimental_telemetry`, example code, screenshot placeholder

Pattern: follows the same structure as `openai-agents/` docs.

Also update `docs/docs/integrations/overview.mdx` to add a Vercel AI SDK card in the Frameworks section.

### Phase 7: Example Refinement

**Directory**: `examples/node/observability-vercel-ai/`

The example already exists and works. Minor refinements:
- Ensure README matches the docs content
- Remove `node_modules/` and `package-lock.json` from tracking

### Phase 8: Live Verification

Run the real Vercel AI SDK example against the deployed worktree (`http://144.76.237.122:8480`) so the user can visually verify that inputs, outputs, model, and token panels are now populated.

---

## Testing Strategy

### Test Levels

| Level | What | How | Needs Server? |
|-------|------|-----|---------------|
| **Unit** | Adapter `process()` method | Construct `CanonicalAttributes` + `SpanFeatures`, call `process()`, assert | No |
| **Integration** | Full adapter registry | Construct bag, call `registry.extract_features()`, assert | No |
| **E2E** | Full ingestion pipeline | POST spans to API, poll query, verify stored `ag.*` | Yes |
| **Live** | Real SDK → Agenta | Run actual Vercel AI SDK example, verify in UI | Yes + OpenAI key |

All four levels will be implemented.
