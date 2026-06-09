# Cross-SDK Comparison: 8 Spike Apps × 3 Backends

**Last updated:** 2026-05-12 (Phase 8 Langfuse tri-export · revised after empirical data-plane investigation)
**Scope:** Side-by-side comparison of how Agenta, Braintrust, and Langfuse handle the IDENTICAL OTel span data fanned out from each of the 8 spike apps in this design.

All three backends receive the same OTel spans via parallel `SimpleSpanProcessor` instances on the same `NodeTracerProvider`. The same span ends, the same exporters fire in parallel. Differences below are about what each platform *does* with that identical input.

> **Methodology note.** An earlier revision of this doc reported Braintrust as "Live (200)" based on the assumption that `SimpleSpanProcessor` would surface HTTP failures as test failures. **That was wrong.** OTel exporters log HTTP errors to stderr and swallow them silently — assertion-based tests (which only query the Agenta side) PASS even when secondary backends reject 100% of spans. All trace counts below were re-verified by querying each backend's REST API directly. See "Pain Entries Discovered" section.

---

## Project ↔ App mapping

The user's `tracing-N` projects on Langfuse correspond to spike apps in this order. There is no `tracing-1` (the numbering skips it):

| User's Langfuse project | Spike app | `service.name` | Braintrust project (EU) |
|---|---|---|---|
| `tracing` | `examples/node/observability-vercel-ai/` (root v4) | `vercel-ai-quickstart` | `vercel-ai-quickstart` |
| `tracing-2` | `web/examples/node-vercel-ai-v6/` (Phase 1) | `vercel-ai-spike-node` | `vercel-ai-spike-node` |
| `tracing-3` | `web/examples/nextjs-app-router-raw/` (Phase 2a) | `vercel-ai-spike-app-router-raw` | `vercel-ai-spike-app-router-raw` |
| `tracing-4` | `web/examples/nextjs-app-router-vercel/` (Phase 2b) | `vercel-ai-spike-app-router-vercel` | `vercel-ai-spike-app-router-vercel` |
| `tracing-5` | `web/examples/nextjs-pages-router-raw/` (Phase 3a) | `vercel-ai-spike-pages-raw` | `vercel-ai-spike-pages-raw` |
| `tracing-6` | `web/examples/nextjs-pages-router-vercel/` (Phase 3b) | `vercel-ai-spike-pages-vercel` | `vercel-ai-spike-pages-vercel` |
| `tracing-7` | `web/examples/react-tanstack-start/` (Phase 4) | `vercel-ai-spike-tanstack-start` | `vercel-ai-spike-tanstack-start` |
| `tracing-8` | `web/examples/nuxt-raw/` (Phase 5) | `vercel-ai-spike-nuxt-raw` | `vercel-ai-spike-nuxt-raw` |

---

## Trace counts (empirically verified via REST API, 2026-05-12)

After fixing the Braintrust data-plane URL (US → EU, see pain entries) and re-running all 8 apps. Langfuse `totalItems` = root-trace count; Braintrust `events` = total spans (each span is a separate event).

| App / `service.name` | Agenta assertions | Langfuse traces | Braintrust events |
|---|---|---|---|
| `vercel-ai-quickstart` (root v4) | n/a (not in harness) | 1 | 2 |
| `vercel-ai-spike-node` (Phase 1) | **4/4 PASS** | 12 | 9 |
| `vercel-ai-spike-app-router-raw` (Phase 2a) | **4/4 PASS** | 5 | 33 |
| `vercel-ai-spike-app-router-vercel` (Phase 2b) | **4/4 PASS** | 11 | 33 |
| `vercel-ai-spike-pages-raw` (Phase 3a) | **4/4 PASS** (nodejs) | 5 | 17 |
| `vercel-ai-spike-pages-vercel` (Phase 3b) | **4/4 PASS** with `a1` token loose | 5 | 20 |
| `vercel-ai-spike-tanstack-start` (Phase 4) | **4/4 PASS** | 4 | 7 |
| `vercel-ai-spike-nuxt-raw` (Phase 5) | **4/4 PASS** | 6 | 6 |

**Why the row-count shapes differ across backends:**

- **Agenta** stores spans individually (queried via `POST /api/spans/query`).
- **Langfuse** groups child spans under a root trace ID. `totalItems` is the trace count, not the span count. Each Next.js trace has ~5-7 child observations because of the framework-emitted wrapper spans.
- **Braintrust** stores each span as its own event (flat). Event count = span count. Next.js apps have ~6-7× more events than non-Next.js apps because of the wrapper-span explosion. TanStack (no auto-instrumentation) and Nuxt (clean Nitro tree) have the lowest event counts per assertion.

---

## Same trace, three backends: Phase 2b `ai.streamText` span side-by-side

Pulled from each backend's REST API (Agenta `POST /api/spans/query`, Braintrust `/v1/project_logs/.../fetch`, Langfuse `/api/public/traces`). All three are looking at the SAME span from the same `POST /api/chat` request.

| Field | Agenta | Braintrust (EU) | Langfuse |
|---|---|---|---|
| Span name | `ai.streamText.doStream` | `ai.streamText` (child of HTTP wrapper) | Trace root: `POST /api/chat/route` · AI span as child observation |
| Inputs | `ag.data.inputs` = `{'prompt': [{'role':'user', 'content': [{'text':'Reply with: ok.'}]}]}` | `input` = `[{'content':'Reply with: ok.', 'role':'user'}]` | `input` = `{'messages':[{'role':'user','content':[{'type':'text','text':'Reply with: ok.'}]}]}` |
| Outputs | `ag.data.outputs` = `"ok."` | `output` = `[{'content':'ok.', 'role':'assistant'}]` | `output` = `"ok."` |
| Token usage | `ag.metrics.tokens.incremental` = `{prompt:12, completion:3, total:15}` | `metadata.ai.usage.inputTokens`=12, `ai.usage.outputTokens`=3 | Rolled up into `totalCost` (computed) |
| Cost | `ag.metrics.costs` = `{}` (NOT computed) | Per-event, not aggregated in default fetch | `totalCost` = `3.6e-06` (computed from `gen_ai.usage.*`) |
| Latency | Per-span `duration.cumulative` | Per-event `metrics.start/end` | `latency` = `0.973s` (rolled up trace-level) |
| Metadata propagation (`userId`, `sessionId`) | On every span | On every event | At trace root: `userId`=`a3-...`, `sessionId`=`a3-...` |
| Trace structure visibility | Spans listed flat; UI picks ONE as the trace-list row (P-COMMON-01 — picks wrapper, not LLM span) | Flat event stream with `span_parents` to reconstruct tree | Tree-first model: 1 root + N child observations. Cost/latency rollup at root |

**Empirical observations from the same span:**

1. **All three backends have the LLM payload.** Inputs and outputs land correctly in all three. The data is not lost; it's about UI surfacing.
2. **Agenta does NOT compute cost.** `ag.metrics.costs` is `{}`. Braintrust + Langfuse both compute `totalCost` from the `gen_ai.usage.*` attrs.
3. **Langfuse rolls up to trace level.** Its trace-list row shows totalCost=$0.0000036 and latency=973ms aggregated from child observations. Agenta's trace-list row shows the Next HTTP wrapper with empty metrics. P-COMMON-01 is the gap here.
4. **Braintrust UI hierarchy comes from `span_parents`.** Each event has a parent reference, so the trace tree reconstructs in their UI. Wrapper spans show empty input/output because they're not LLM spans — same as Langfuse.

---

## Tokens and cost: three backends, three different transformations

The same `ai.streamText` span carries these attributes from Vercel AI SDK (verified empirically by pulling the raw OTLP-ingested data from each backend):

```
ai.model.id                                       = "gpt-4o-mini"
ai.usage.inputTokens                              = 12
ai.usage.outputTokens                             = 3
ai.usage.totalTokens                              = 15
ai.usage.inputTokenDetails.cacheReadTokens        = 0
ai.usage.outputTokenDetails.reasoningTokens       = 0
```

What each backend does with them:

### Agenta — nested normalization, no cost

```jsonc
"ag.metrics.tokens.incremental": {
  "prompt": 12, "completion": 3, "total": 15,
  "cached": 0, "reasoning": 0
},
"ag.metrics.costs": {}                            // ← empty
```

- Normalizes to `ag.metrics.tokens.incremental.{prompt, completion, total, cached, reasoning}`.
- **Does not compute cost.** No model pricing table at ingest, so the dollar figure is never derived.
- Per-span only; no roll-up to trace level.

### Braintrust — dual storage (raw + flat metrics)

```jsonc
"metadata": {
  "ai.usage.inputTokens": 12,                     // verbatim from OTel
  "ai.usage.outputTokens": 3,
  "ai.usage.totalTokens": 15,
  // ...all original ai.usage.* attrs preserved
},
"metrics": {
  "prompt_tokens": 12,                            // ← Braintrust's normalized shape
  "completion_tokens": 3,
  "tokens": 15
}
```

- Keeps raw `ai.usage.*` in `metadata` verbatim.
- ALSO surfaces a flat `metrics.{prompt_tokens, completion_tokens, tokens}` (snake_case, no nesting).
- **No cost field on the event.** Their `gen_ai_*` cost metric only appears when you use their wrapper SDK (`wrapAISDK`), not on the raw OTLP path.
- Per-event only; no roll-up in the default API response.

### Langfuse — three transformations stacked

```jsonc
// Trace-level (Langfuse computes these, NOT in source OTel span)
"totalCost": 3.6e-06,
"latency": 0.973,

// Per-observation
"promptTokens": 12,
"completionTokens": 3,
"totalTokens": 15,
"model":   "gpt-4o-mini-2024-07-18",              // ← resolved from "gpt-4o-mini"
"modelId": "clyrjpbe20000t0mzcbwc42rg",           // ← Langfuse model-registry internal ID
"inputPrice":  1.5e-07,                           // ← from their pricing table
"outputPrice": 6.0e-07,
"calculatedInputCost":  1.8e-06,                  // ← computed at ingest
"calculatedOutputCost": 1.8e-06,
"calculatedTotalCost":  3.6e-06,
"usageDetails": {"input": 12, "output": 3, "input_cached_tokens": 0, "output_reasoning_tokens": 0, "total": 15},
"costDetails":  {"input": 1.8e-06, "output": 1.8e-06, "input_cached_tokens": 0, "total": 3.6e-06}
```

Three transformations stacked on the same input:

1. **Model resolution.** `gpt-4o-mini` → date-versioned `gpt-4o-mini-2024-07-18` → internal `modelId`. Preserves historical cost accuracy when OpenAI silently rolls model versions under the same name.
2. **Cost computation at ingest.** Internal pricing table per `modelId` → `inputPrice × inputTokens + outputPrice × outputTokens` → `calculatedTotalCost`. Server-side, stored on the observation.
3. **Trace-level roll-up.** Child observation costs sum to `trace.totalCost`. Same for `latency` (aggregated from child durations).

### Side-by-side capability matrix

| Concern | Agenta | Braintrust | Langfuse |
|---|---|---|---|
| **Token storage shape** | `ag.metrics.tokens.incremental.{prompt,completion,total,cached,reasoning}` (nested) | `metrics.{prompt_tokens, completion_tokens, tokens}` (flat snake_case) | `promptTokens` + `usageDetails` (camelCase + nested) |
| **Preserves raw `ai.usage.*`?** | No (only normalized) | ✅ Yes (in `metadata`) | ✅ Yes (in observation `metadata.attributes`, but as strings) |
| **Maintains a model pricing table?** | ❌ No | ❌ No (only via `wrapAISDK`) | ✅ Yes |
| **Resolves model aliases (`gpt-4o-mini` → date version)?** | ❌ No | ❌ No | ✅ Yes |
| **Computes cost at ingest?** | ❌ No | ❌ No on raw OTLP path | ✅ Yes |
| **Rolls up trace-level totals?** | ❌ Per-span only | ❌ Per-event only | ✅ `trace.totalCost`, `trace.latency` |
| **Type preservation of OTel attrs** | Numbers stay numeric | Numbers stay numeric | Raw attrs serialized as **strings** ("12", not 12); normalized fields are numeric |

### Why the differences exist — three different product positions

- **Agenta**: "store the spans, give me a query API." Token counts pass through; cost is the customer's problem.
- **Braintrust**: "store the spans + normalize the token columns for SQL-like analytics." Cost lives in their wrapper SDK pricing logic, not in raw OTLP ingest.
- **Langfuse**: "be an opinionated LLM observability product with cost dashboards out of the box." Model registry + pricing table + ingest-time cost + trace roll-up.

### What's empirically missing on Agenta's side (vs Langfuse)

Two gaps, both backend-fixable on Agenta:

1. **Cost is never computed.** `ag.metrics.costs: {}` everywhere. Customers building cost dashboards have to pull tokens + look up pricing themselves. Fix: add a pricing table keyed by `ai.model.id` (or OTel-standard `gen_ai.system` + `gen_ai.request.model`), compute `ag.metrics.costs.{input, output, total}` at ingest. ~1 day of work + a registry to maintain.
2. **No trace-level roll-up.** Each Agenta span carries its own tokens. The trace-list row (currently the Next HTTP wrapper per P-COMMON-01) has no aggregated totals. Fix: at trace ingest completion, sum tokens + cost from spans with `ai.*` / `gen_ai.*` scope onto the root. Same enricher pattern as P-NODE-03 (userId cascade).

Both pair with P-COMMON-01 (which span gets surfaced as the trace-list row). Combined fix — promote the LLM-relevant span + populate rolled-up cost — closes the visible UX gap with Langfuse in the dashboard.

### One genuine OTel pitfall

Langfuse stores the raw `ai.usage.*` attrs as **strings** (`"12"`, not `12`). Braintrust and Agenta parse them to integers. The string storage is technically correct per OTel — attributes are typed `string | number | bool | array`, and Vercel AI SDK emits some of them as strings — but it means **anyone querying `usage.inputTokens > 10` on Langfuse's raw attribute path will get unexpected behavior** unless they cast. Their `promptTokens` normalized field is the safe one to query.

Worth a footnote in any future SDK guide: "if you're filtering on token counts, use the backend's normalized field (`ag.metrics.tokens.*`, Braintrust `metrics.prompt_tokens`, Langfuse `promptTokens`), not the raw OTel attribute."

---

## Integration models: split-stack (Python example) vs JS-full-stack (spike apps)

This section reframes the spike's scope. The spike has measured the JS surface area exhaustively, but Agenta's existing `examples/python/RAG_QA_chatbot/` shows a fundamentally different integration shape — one where **JS holds no instrumentation at all**. Worth comparing the two before drawing strategic conclusions about `@agenta/sdk-tracing`.

### Architecture A — Split-stack (`examples/python/RAG_QA_chatbot/`)

```
Browser
  │  POST /api/chat  (Vercel AI SDK SSE protocol)
  ▼
Next.js frontend (port 3000) — PURE UI CONSUMER
  · @ai-sdk/react useChat hook
  · next.config.js rewrites /api/* → http://localhost:8000/api/*
  · ZERO @opentelemetry/* deps
  · ZERO @vercel/otel
  · No AGENTA_API_KEY in frontend .env
  ▼
FastAPI backend (port 8000) — PYTHON, ALL TRACING LIVES HERE
  · import agenta as ag
  · ag.init(api_key=..., host=...)
  · litellm.callbacks = [ag.callbacks.litellm_handler()]
  · @ag.instrument() on retrieve(), generate(), format_context()
  · with ag.tracer.start_as_current_span("chat_request"): ...
  · ag.tracing.store_internals({...}) and store_refs({...})
  · Streams SSE back including a custom `data-trace` event with
    https://cloud.agenta.ai/observability/traces/<traceId>
  ▼
LiteLLM → OpenAI / Qdrant
```

Frontend dependency on Agenta: **zero**. The `package.json` doesn't even include `@opentelemetry/api`. The LLM call originates in Python, so the trace originates in Python.

### Architecture B — JS-full-stack (our 8 spike apps)

```
Browser
  │  POST /api/chat  (Vercel AI SDK SSE protocol)
  ▼
Next.js / TanStack / Nuxt server route — JS, ALL TRACING LIVES HERE
  · instrumentation.ts (60-141 lines of boilerplate)
  · @opentelemetry/sdk-trace-node + OTLPTraceExporter
  · NodeTracerProvider({spanProcessors: [SimpleSpanProcessor(...)]})
  · resourceFromAttributes({ATTR_SERVICE_NAME: ...})
  · AGENTA_PROJECT_ID query-param injection
  · streamText({experimental_telemetry: {isEnabled: true}})
  · AI SDK emits ai.streamText, ai.streamText.doStream spans
  ▼
OpenAI (or whatever provider)
```

The JS process IS the LLM caller. There is no Python tier. All instrumentation is JS-side. No trace URL is surfaced to the browser — it lives only in the dev console log.

### Where the two shapes diverge

| Concern | Split-stack (Python example) | JS-full-stack (spike apps) |
|---|---|---|
| **Where the LLM call originates** | Python backend (LiteLLM) | JS server route (Vercel AI SDK) |
| **Where instrumentation lives** | Python only (`agenta` SDK) | JS only (raw `@opentelemetry/*`) |
| **Frontend deps on observability** | Zero | N/A (JS app IS the backend) |
| **Setup LoC** | 3 functional lines: `import agenta as ag` + `ag.init(...)` + `litellm.callbacks = [...]` | 60-141 lines of `instrumentation.{ts,js}` boilerplate per app |
| **Token / cost capture** | Automatic via `litellm.callbacks` (works for ANY LiteLLM-routed provider) | Manual — relies on AI SDK to emit `ai.usage.*`; cost not computed (see prior section) |
| **Function-level instrumentation** | `@ag.instrument()` decorator on any function — auto-captures inputs/outputs as span attrs | Manual: `tracer.startActiveSpan(name, fn)` + `span.setAttribute(...)` for every key |
| **Semantic data API** | `ag.tracing.store_internals({...}, namespace="data")` writes typed attrs into `ag.data.*` namespace | Raw `span.setAttribute("ag.data.foo", value)` per attribute |
| **Prompt-template references** | `ag.tracing.store_refs({"prompt": template.id})` | No equivalent — must hand-roll attribute conventions |
| **Process boundaries crossed for one chat request** | 2 (browser → Next proxy → FastAPI) | 1 (browser → JS server route) |
| **`service.name` setup** | Implicit via `ag.init` defaults | Manual: `resourceFromAttributes({ATTR_SERVICE_NAME: ...})` |
| **Trace URL surfacing to client** | ✅ Yes — backend emits `data-trace` SSE event with `https://cloud.agenta.ai/observability/traces/<traceId>` | ❌ No — exists only in dev console |
| **Provider coverage** | Any model LiteLLM supports (100+) | Whatever the AI SDK adapter for that provider emits |
| **Plug-in cost** | `pip install agenta` + 3 lines | `pnpm install` 6 OTel packages + 60-141 lines wiring + 4-12 env vars |

### What the Python SDK does that JS users don't get today

The `agenta` Python SDK is **a high-level wrapper over raw OTel** that gives users:

```python
import agenta as ag

ag.init()                                          # ← one-line setup, handles provider, exporter, headers, project_id
litellm.callbacks = [ag.callbacks.litellm_handler()]   # ← auto token/cost for any LiteLLM provider

@ag.instrument()                                   # ← decorator: span name = fn name, inputs/outputs auto-captured
def retrieve(query: str) -> list[Doc]:
    docs = qdrant.search(...)
    ag.tracing.store_internals({                   # ← typed attr API into ag.data.* namespace
        "retrieved_docs_count": len(docs),
        "top_k": top_k,
    })
    return docs
```

The same workflow in JS today requires:

```ts
// 1. 141 lines of instrumentation.ts boilerplate (provider, exporter, processor,
//    resource, headers, project_id query-param, force-flush hook, sentinel)
// 2. Manual span creation per function:
async function retrieve(query: string): Promise<Doc[]> {
  return tracer.startActiveSpan("retrieve", async (span) => {
    try {
      span.setAttribute("ag.data.inputs.query", query)
      const docs = await qdrant.search(...)
      span.setAttribute("ag.data.outputs.retrieved_docs_count", docs.length)
      span.setAttribute("ag.data.outputs.top_k", top_k)
      return docs
    } finally {
      span.end()
    }
  })
}
// 3. No litellm-equivalent — every provider's OTel emission convention is bespoke
```

For users coming from the Python SDK, the JS story is jarring: same product, completely different ergonomics. **None of the high-level helpers exist** (`ag.init`, `@ag.instrument`, `store_internals`, `store_refs`, `callbacks`).

### Ergonomic-by-ergonomic, six implementations side-by-side

**Verification status (2026-05-16):** All rows below are empirically verified via the `web/examples/sdk-native-spike/` companion spike — `scripts/{agenta-raw-otel,langfuse-sdk,braintrust-sdk}.ts` exercise each ergonomic and the resulting spans are pulled back via REST API. Mastra rows are docs-based (a Mastra-native run would need its own spike). Spike output snapshots are in the section after the table.

Each row: what the Python `agenta` SDK offers, what AI SDK + Mastra users see today, and how Langfuse/Braintrust JS SDKs solve it.

#### 1. One-line setup (the entire OTel pipeline)

| Path | Setup |
|---|---|
| **Python `agenta`** | `import agenta as ag; ag.init()` — 1 line, reads env, picks defaults |
| **AI SDK + raw OTel** (today) | 60-141 lines `instrumentation.ts`: provider + processor + exporter + resource + project_id query param + auth header + force-flush hook + sentinels |
| **Mastra alone** | `new Mastra({telemetry: {serviceName, enabled: true, export: {...}}})` — OTel-passthrough; doesn't know about Agenta's `project_id` query-param convention or `SimpleSpanProcessor` preference |
| **Langfuse JS SDK** | `new Langfuse({publicKey, secretKey, baseUrl})` — 1 line; **but only captures Langfuse-formatted events** (not OTel). For OTel: separate `@langfuse/otel` package |
| **Braintrust JS SDK** | `initLogger({projectName, apiKey, appUrl})` + `const tracedAI = wrapAISDK(ai)` — 2 statements |
| **Hypothetical `@agenta/sdk-tracing`** | `init()` — single call hides processor pick, `project_id` query param, all headers |

**Empirically verified:** Langfuse ran with 1 statement; Braintrust ran with 2; Agenta-raw needed 9 functional statements before its first `streamText` call. Spike output in `scripts/{langfuse,braintrust,agenta-raw-otel}-sdk.ts`.

#### 2. Auto-tracing the LLM call

| Path | Pattern | Empirical result |
|---|---|---|
| **Python `agenta`** | `litellm.callbacks = [ag.callbacks.litellm_handler()]` — auto for 100+ LiteLLM providers | n/a (no Python spike run) |
| **AI SDK alone** | `streamText({..., experimental_telemetry: {isEnabled: true}})` — flag per call | ✅ Verified — `ai.streamText` + `ai.streamText.doStream` spans landed in Agenta with full `ag.data.inputs/outputs/metrics.tokens` |
| **Mastra alone** | `mastra.getAgent("x").generate(messages)` — auto-traced (Mastra wraps AI SDK internally) | (docs) |
| **Langfuse JS SDK** | `observeOpenAI(new OpenAI(), {parent: trace, generationName})` — wraps OpenAI client only | ✅ Verified — generation observation with `model: gpt-4o-mini-2024-07-18`, `promptTokens: 12`, `completionTokens: 2`, `calculatedTotalCost: 3e-06`. **Gotcha: this wraps the OpenAI client, NOT AI SDK's `streamText`.** To trace AI SDK calls in Langfuse, you need the separate `@langfuse/vercel` package. |
| **Braintrust JS SDK** | `const tracedAI = wrapAISDK(ai); tracedAI.streamText({...})` — wraps entire `ai` namespace | ✅ Verified — 3 child events emitted automatically: `streamText` root, `doStream`, `retrieve-mock`. Tokens captured. **`time_to_first_token: 0.057s` metric added automatically** (we didn't ask for it) |
| **Hypothetical `@agenta/sdk-tracing`** | Either `experimental_telemetry: {isEnabled: true}` (AI SDK passthrough) or `wrapAISDK(ai)` Braintrust-style | — |

#### 3. Decorating user-defined functions (custom workflow steps)

| Path | Pattern | Empirical result |
|---|---|---|
| **Python `agenta`** | `@ag.instrument()` decorator — args + return auto-captured | n/a |
| **AI SDK + raw OTel** | `tracer.startActiveSpan("name", async (span) => { span.setAttribute("ag.data.inputs.x", x); ...; span.end() })` | ✅ Verified — `retrieve-mock` span with inputs `{query: "..."}` and outputs `{count: 2}` landed under `ag.data.*` |
| **Mastra alone** | `createTool({id, description, execute: async ({query}) => ...})` — auto-traced only if invoked via Mastra agent | (docs) |
| **Langfuse JS SDK** | `const span = trace.span({name, input}); await ...; span.end({output})` — imperative open/close | ✅ Verified — child observation `retrieve-mock` under root trace with `input/output` populated |
| **Braintrust JS SDK** | `traced(async (span) => { span.log({input}); ...; span.log({output}) }, {name})` — functional async wrapper, span passed as arg | ✅ Verified — event with `input: {query}` and `output: {docs, count}` |
| **Hypothetical `@agenta/sdk-tracing`** | Functional wrapper: `instrument("name", async (x) => ...)` — args + return auto-captured to `ag.data.*` | — |

**No major JS SDK ships TypeScript decorator syntax.** All three SDK paths use functional wrappers or imperative open/close. The Python decorator pattern doesn't translate cleanly because TS decorators are still proposal-stage and need `experimentalDecorators`.

#### 4. Semantic context (userId, sessionId, metadata, tags)

| Path | Pattern | Empirical result |
|---|---|---|
| **Python `agenta`** | `ag.tracing.store_internals({...}, namespace="data")` + auto-cascade across spans | n/a |
| **AI SDK alone** | `experimental_telemetry: {metadata: {user_id, session_id, ...}}` — untyped bag | ✅ Verified — landed as `ai.telemetry.metadata.user_id` etc. **NOT `ag.user.id`** (no rename). Cascade missing per P-NODE-03 |
| **Mastra alone** | `agent.generate(messages, {threadId, resourceId, metadata})` — first-class `threadId`/`resourceId` (≈ user/session) | (docs) |
| **Langfuse JS SDK** | `langfuse.trace({userId, sessionId, metadata, tags})` — **all four first-class typed fields** | ✅ Verified — trace landed with `userId`, `sessionId`, `tags: ["spike", "sdk-comparison"]`, `metadata`, all properly typed |
| **Braintrust JS SDK** | `span.log({metadata, tags})` — flat KV; no first-class `userId`/`sessionId` field (convention: `metadata.user_id`) | ✅ Verified — `tags: ["spike", "sdk-comparison"]` on root event; userId stored as `metadata.runId`-style entry |
| **Hypothetical `@agenta/sdk-tracing`** | `setUser({id, session})` + `setData({...})` typed helpers for Agenta-specific namespaces | — |

**Langfuse has the strongest semantic-context API.** First-class `userId`, `sessionId`, `tags`, `metadata` — typed at the SDK boundary, not just attribute conventions.

#### 5. Token + cost capture (cross-provider)

| Path | Coverage | Cost computed? | Empirical |
|---|---|---|---|
| **Python `agenta` + LiteLLM** | 100+ providers via `litellm.callbacks` | Yes (LiteLLM-side pricing table) | n/a |
| **AI SDK alone** | AI-SDK-routed providers only | **No** — tokens captured, cost not derived | ✅ Tokens land as `ag.metrics.tokens.incremental.{prompt, completion, total}` |
| **Mastra alone** | Same as AI SDK (Mastra wraps it underneath) | No | (docs) |
| **Langfuse JS SDK** | Whatever observation you create | **Yes — server-side** at ingest, from their ~700-model registry | ✅ Verified — `model: gpt-4o-mini-2024-07-18` (resolved from `gpt-4o-mini`), `inputPrice: 1.5e-07`, `calculatedTotalCost: 3e-06` |
| **Braintrust JS SDK** | `wrapAISDK` / `wrapOpenAI` | Yes — per-event metadata via their pricing table | ✅ Token counts in `event.metrics.{prompt_tokens, completion_tokens}` |

**Langfuse is the only one that computes cost server-side at ingest from raw OTLP.** Braintrust's cost works when you use their wrapper SDKs. Agenta computes nothing — backend gap.

#### 6. Trace URL surfacing to the client

| Path | Pattern | Empirical |
|---|---|---|
| **Python `agenta`** | `format_trace_id(span.get_span_context().trace_id)` → `f"{HOST}/observability/traces/{trace_id}"` → emit as `data-trace` SSE event (per RAG_QA_chatbot example) | n/a |
| **AI SDK + raw OTel** | Hand-roll: capture `trace.getActiveSpan()?.spanContext().traceId`, build URL with host | ✅ Verified — works but is ~5 lines per app. **Zero of 8 spike apps do this today.** |
| **Mastra alone** | No built-in helper | (docs) |
| **Langfuse JS SDK** | `await trace.getTraceUrl()` | ✅ Verified — returned `https://cloud.langfuse.com/trace/89e9459b-07be-40fa-946f-b42612ad609e` |
| **Braintrust JS SDK** | `await currentSpan().link()` | ✅ Verified — returned `https://www.braintrust.dev/app/arda-test/object?object_type=project_logs&object_id=1c5baf3a-...&id=e9409bf8-...` |
| **Hypothetical `@agenta/sdk-tracing`** | `getTraceUrl()` reads active span context, builds Agenta URL | — |

**All three opinionated SDKs (Python, Langfuse, Braintrust) have first-class trace URL helpers.** AI SDK + raw OTel does not. This is the single highest-leverage UX win for `@agenta/sdk-tracing` — one helper function, one SSE event shape, debugging dashboard for free.

#### 7. Multi-destination fan-out (with config gotchas hidden)

| Path | Pattern |
|---|---|
| **Python `agenta`** | Single-destination by design (Agenta only) |
| **AI SDK + raw OTel** (today) | Manual `new NodeTracerProvider({spanProcessors: [...]}); spanProcessors.push(new SimpleSpanProcessor(braintrustExporter))` — user must know Braintrust EU plane (P-BRAINTRUST-01) and Langfuse `Basic base64(pk:sk)` auth shape |
| **Mastra alone** | Single OTel exporter slot — fan-out via raw OTel under it |
| **Langfuse JS SDK** | Single-destination (Langfuse). `@langfuse/otel` SpanProcessor can be added alongside other processors |
| **Braintrust JS SDK** | Single-destination. Multi-destination via OTel |
| **Hypothetical `@agenta/sdk-tracing`** | `init({destinations: ["agenta", {kind: "braintrust", region: "eu"}, "langfuse"]})` — data-plane gotcha + auth shape hidden |

**No existing SDK hides per-destination config gotchas.** Empirical evidence: the spike's Braintrust exporter silently 200'd 100% of spans into the wrong data plane for the entire Phase 7 run; only user-side UI inspection caught it (P-BRAINTRUST-01).

#### 8. Cross-process trace propagation (split-stack)

| Path | Pattern |
|---|---|
| **Python `agenta`** | Auto-injects W3C `traceparent` header on outbound HTTP (via `opentelemetry-instrumentation-requests`) |
| **AI SDK + raw OTel** | Install `@opentelemetry/instrumentation-fetch` manually; even then, doesn't cross JS↔Python boundary unless explicitly wired |
| **Mastra alone** | Same as AI SDK |
| **Langfuse JS SDK** | SDK-native — to stitch JS↔Python in Langfuse, both sides must use Langfuse SDK and pass `parentObservationId` explicitly |
| **Braintrust JS SDK** | Pass `parent_id` manually via custom header — no `traceparent` auto-injection |
| **Hypothetical `@agenta/sdk-tracing`** | `init({propagation: "w3c"})` — auto-installs fetch instrumentation |

**Only OTel-based paths can stitch cross-process traces via W3C `traceparent`.** This is a structural advantage of an OTel-based `@agenta/sdk-tracing` over the SDK-native approaches Langfuse/Braintrust take.

### Empirical run summary (2026-05-16 spike)

Companion spike: [`web/examples/sdk-native-spike/`](web/examples/sdk-native-spike/) with three scripts, each making the same `streamText("Reply with: ok.")` call.

| Aspect | Agenta raw OTel | Langfuse SDK | Braintrust SDK |
|---|---|---|---|
| Setup statements (functional) | 9 | 1 | 2 |
| AI-call ergonomic | `experimental_telemetry: {isEnabled: true}` flag | `observeOpenAI()` wrapper (OpenAI client only — not AI SDK) | `wrapAISDK(ai)` wrapper (whole AI SDK namespace) |
| Custom-span ergonomic | `tracer.startActiveSpan(name, async (span) => { setAttribute(...); span.end() })` | `trace.span({input}) ... span.end({output})` imperative | `traced(async (span) => { span.log({input, output}) }, {name})` functional |
| User/session typed? | No (untyped metadata bag) | **Yes (`userId`, `sessionId`, `tags`)** | No (`metadata.*` convention) |
| Cost computed? | No (`ag.metrics.costs: {}` empty) | **Yes** (`calculatedTotalCost: 3e-06` from `gpt-4o-mini-2024-07-18`) | Yes (per-event in metrics) |
| Trace URL helper? | No (hand-roll) | **`trace.getTraceUrl()`** | **`currentSpan().link()`** |
| Model alias resolution? | No | **Yes** (`gpt-4o-mini` → `gpt-4o-mini-2024-07-18`) | No |
| Auto-extra metrics? | No | No | **Yes** (`time_to_first_token: 0.057s`) |

### Tightened summary for AI-SDK + Mastra target users

Filtering for what matters for **the actual spike target** (AI SDK / Mastra / LangChain, not custom workflows), sorted by gap size:

| # | Gap | Severity | Best existing solution |
|---|---|---|---|
| 1 | One-line setup hiding processor pick + Agenta `project_id` quirk | **Highest** — 60-141 lines today | Braintrust's `initLogger() + wrapAISDK()` (2 lines) |
| 6 | Trace URL surfacing to client | **High** — single best debugging UX win | Langfuse `trace.getTraceUrl()` / Braintrust `currentSpan().link()` |
| 7 | Multi-destination + per-destination gotchas hidden | **High** — only Agenta could differentiate; nobody does it | Nobody hides it today |
| 5 | Cost computation (token capture works fine) | **Medium** — backend gap on Agenta side, not JS | Langfuse server-side ingest |
| 4 | Typed user/session/tags helpers | **Medium** — AI SDK has `experimental_telemetry.metadata` but untyped | Langfuse first-class fields |
| 8 | Cross-process `traceparent` propagation | **Medium** — only for split-stack users | OTel raw (Langfuse/Braintrust SDKs can't do it) |
| 2 | Auto-tracing the LLM call | **Low** — `experimental_telemetry: {isEnabled:true}` already works | AI SDK's flag |
| 3 | Decorating custom workflow functions | **None for spike target** — AI-SDK users don't write these | Braintrust `traced(fn)` for v2 |

### Strategic reframe

The spike's framing has been: "should `@agenta/sdk-tracing` exist, or should JS users stick with raw OTel + fan-out?"

The Python example shifts the question. The Python ecosystem ALREADY has the opinionated-SDK answer — `ag.init()` + decorator + `litellm.callbacks` is a 3-line setup that hides all the OTel boilerplate, surfaces the trace URL, normalizes attr namespaces, and auto-captures tokens/cost via LiteLLM. **Python users don't write raw OTel.** Why is that the only option we offer JS users?

The reframed question:

> **"Should JS users get the same ergonomics Python users already have?"**

Concrete deltas the spike has been measuring on the JS side would all be hidden by an `@agenta/sdk-tracing` that mirrors the Python SDK:

| Pain currently exposed to JS user | Hidden by an opinionated SDK? |
|---|---|
| 60-141 lines of `instrumentation.ts` boilerplate | ✅ One-line `agenta.init()` |
| Choosing `SimpleSpanProcessor` vs `BatchSpanProcessor` (P-NODE-02, P-APP-VERCEL-01) | ✅ SDK picks the right one |
| Knowing about `project_id` query-param convention | ✅ SDK handles |
| `BRAINTRUST_OTLP_URL` data-plane gotcha (P-BRAINTRUST-01) | ✅ Per-destination config table |
| No `@ag.instrument()` equivalent for typed inputs/outputs | ✅ Decorator/wrapper helper |
| No automatic token/cost capture for non-AI-SDK providers | ✅ Wrap fetch / wrap OpenAI client |
| No trace-URL surfacing to client | ✅ Helper to emit `data-trace` SSE event |

The case for `@agenta/sdk-tracing` is no longer about "wrapping OTel" — it's about **giving JS users feature parity with the Python SDK they already ship and document.**

### Implications for scope

The spike's 8 apps measure the JS-full-stack shape exclusively — server-side LLM calls in Next.js / TanStack / Nuxt, no Python tier. That's a real and growing customer shape (Vercel AI SDK adoption is significant), but **it is not the only one**:

- **Customers with existing Python backends** (the RAG example shape) don't need any JS-side instrumentation. They're already covered by the Python SDK. The spike's findings don't apply to them.
- **Customers with JS-only stacks** (the spike's 8 apps) face the entire surface area of raw OTel pain — and have no equivalent of the Python SDK's high-level helpers.

A future `@agenta/sdk-tracing` deliverable should be scoped specifically at customers in the second category. Customers in the first category should keep their Python SDK and treat their JS frontend as a UI-only consumer (no instrumentation).

### One pattern worth borrowing from the Python example: surface the trace URL

Regardless of whether `@agenta/sdk-tracing` ships, **every spike app should be emitting the trace URL as part of the SSE stream**, the way `examples/python/RAG_QA_chatbot/backend/main.py` does:

```python
ctx = span.get_span_context()
if ctx.is_valid:
    trace_id = format_trace_id(ctx.trace_id)
    trace_url = f"{settings.AGENTA_HOST}/observability/traces/{trace_id}"
    yield event({"type": "data-trace", "data": {"url": trace_url}})
```

This lets the frontend show a "View trace →" link per chat response — the single most useful UX feature for debugging, and effectively zero LoC. Currently zero of the 8 spike apps do this. Worth a one-line addition to the `instrumentation.ts` of each (capture root span context, expose via globalThis helper, let the route handler emit the SSE event).

---

## Wiring cost per backend

Lines added to a baseline Agenta-only instrumentation file to enable each additional backend.

| Backend | Env vars | Exporter setup | Auth header | Critical config | Total LoC added |
|---|---|---|---|---|---|
| Agenta (baseline) | 4 (`AGENTA_HOST`, `AGENTA_API_KEY`, `AGENTA_PROJECT_ID`, `AGENTA_OTLP_PATH`) | `OTLPTraceExporter({url, headers})` | `Authorization: ApiKey <key>` | `project_id` query param | n/a (baseline) |
| + Braintrust | 2 (`BRAINTRUST_API_KEY`, `BRAINTRUST_OTLP_URL`) | Same `OTLPTraceExporter` | `Authorization: Bearer <key>` + `x-bt-parent: project_name:<name>` | **Must match org's data plane (US `api.braintrust.dev` vs EU `api-eu.braintrust.dev`)** | ~8 |
| + Langfuse | 3 (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`) | Same `OTLPTraceExporter` | `Authorization: Basic <base64(pk:sk)>` + optional `x-langfuse-ingestion-version: 4` | Auth = both pk+sk required (single key fails) | ~12 (extra line for base64) |

---

## Pain entries discovered during empirical verification

### P-BRAINTRUST-01: silent data-plane mismatch on US-default OTLP endpoint

**Mechanism:** Braintrust runs separate data planes (US `api.braintrust.dev`, EU `api-eu.braintrust.dev`). The SDK and docs default to US. If the user's org is on EU plane:

1. OTLP requests to `api.braintrust.dev/otel/v1/traces` accept the body and **auto-create the project name** (via `x-bt-parent: project_name:<name>`).
2. The projects show up in US-plane `GET /v1/project` listings — confirming SOMETHING happened.
3. But the actual span data is rejected / unrouted. `POST /v1/project_logs/<id>/fetch` on the US plane returns **HTTP 421 `DataPlaneRedirectError`** with the EU URL. The project listing leaks across, but log storage does not.
4. The OTLP exporter logs no error to stdout; `SimpleSpanProcessor` does not fail the assertion. Spans are silently lost.

**Impact:** All 8 spike apps appeared "live" in Braintrust (projects existed) but had 0 events for the entire Phase 7 run. Only discovered when the user manually checked the Braintrust UI and reported empty state.

**Fix:** point `BRAINTRUST_OTLP_URL` to the correct plane explicitly. After patching all 8 `.env` files to `https://api-eu.braintrust.dev/otel/v1/traces` and re-running, all 8 projects received their spans (2-33 events each).

**Backend-fixable?** No (3rd-party). **JS-side fix?** Documentation gap — Braintrust's OTLP docs lead with the US URL; the EU mention is buried.

### P-LANGFUSE-01: no SDK-side scope filter when using raw OTLP

**Mechanism:** Earlier docs claimed Langfuse "drops non-LLM scope spans server-side" based on something we read. **This was wrong.** When sending raw OTLP via `OTLPTraceExporter` (bypassing `@langfuse/otel`), Langfuse stores ALL spans, including Next.js HTTP wrappers with null input/output. The filter that drops non-LLM scopes lives **inside their SDK**, running JS-side before export.

**Implication:** Same wrapper-span clutter as Agenta when both use raw OTLP. P-COMMON-01 is not actually solved by Langfuse out-of-the-box — only by their SDK's client-side filter. This strengthens the case that **filter logic belongs at ingest, not in JS**.

---

## Pre-existing pain entries that affect all three backends

The 3 backend-affecting issues hit different layers:

- **P-PAGES-VERCEL-01** (empty `ai.usage.*` on Pages Router + `@vercel/otel`) — **upstream of the exporter**. `CompositeSpanProcessor.onEnd` force-ends the streamText span before AI SDK writes usage attrs. All three backends receive the same broken span. JS-side fix needed.
- **P-PAGES-RAW-01** (Pages Router edge build fails on raw OTel) — **upstream of the exporter**. Build fails before runtime. All three backends invisible.
- **P-COMMON-01** (Next.js HTTP auto-instrumentation buries `ai.streamText`) — **downstream display issue**. Same data lands in all three backends. Each backend's UI handles it differently:
  - **Agenta UI**: surfaces the wrong span as the trace-list row. Input/output empty.
  - **Langfuse UI**: builds trace tree with Next wrapper as root + AI SDK span as observation. Roll-up cost/latency works; trace-list still shows wrapper.
  - **Braintrust UI**: each span is a separate event; users navigate via `span_parents` tree. Both root + child visible.

The most actionable backend-fix for Agenta: filter or de-emphasize spans where `scope.name == "next.js"` at ingest, or promote `ai.*`-scope spans to the trace-list row. Same data shape; UI-side patch.

---

## Strategic implication (revised after data-plane gotcha)

The tri-export pattern works across raw Node OTel, `@vercel/otel`, and Nitro plugin shapes — verified by REST-API trace counts on both Braintrust EU and Langfuse cloud.

**However:** the silent failure mode of OTel exporters (P-BRAINTRUST-01 mechanism applies generally) means **"the spike app's tests passed" is NOT proof that secondary backends received the data.** Any future work on multi-backend OTel pipelines needs explicit destination-side verification, not just assertion-script PASS.

This reinforces the strategic question for `@agenta/sdk-tracing`:
- The "single OTel pipe, fan out to N backends" pattern is real and works. ✓
- But it gives users **zero visibility into per-destination delivery health.** A wrapper SDK could surface that visibility.
- And users currently need to know things like "Braintrust uses different data planes per region" to wire it correctly. A wrapper SDK could codify that.

The case for `@agenta/sdk-tracing` is no longer just "wraps OTel ergonomically" — it's "**hides config gotchas that silently lose data**."

---

## See also

- [summary.md](summary.md) — full Phase 7 + Phase 8 narrative
- [pain-log.md](pain-log.md) — pain entries with backend-fixable annotations
- [status.md](status.md) — phase-by-phase progress tracker
