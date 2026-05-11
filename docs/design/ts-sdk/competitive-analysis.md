# Competitive Analysis: Braintrust vs Langfuse TS SDKs

> **Purpose.** Input for the agenta TS SDK RFC. Compares the two closest competitors that ship TypeScript SDKs covering tracing + evals + prompts on the same surface area we're rebuilding. Findings are framed against the `ts-sdk-tracing` spike's 11 pain entries (App Router raw/vercel-otel, Pages Router raw/vercel-otel, TanStack Start, AI SDK v6 streaming + abort, edge runtime).
>
> **Methodology.** v1 of this doc (2026-05-11) was synthesis of web research. v2 (this version, 2026-05-11) is a **source-code audit** of both repos cloned locally — every load-bearing claim has a `file:line` citation. v1's framework was kept; ~18 specific claims were corrected against source.
>
> **Sources audited.**
> - Braintrust: `braintrust` v3.10.0 — `github.com/braintrustdata/braintrust-sdk-javascript` (193 ts source files in `js/src/`, 8 satellite packages in `integrations/`).
> - Langfuse: `@langfuse/*` v5.3.0 — `github.com/langfuse/langfuse-js` (6 scoped packages).
> - GitHub issue [#12643](https://github.com/langfuse/langfuse/issues/12643) (verified OPEN, body matches).

---

## 0. TL;DR

| | **Braintrust** | **Langfuse v4/v5** | **Agenta (today + planned)** |
|---|---|---|---|
| Wire | Proprietary REST `logs3` batch [^bt-logs3] | OTLP/HTTP (`/api/public/otel/v1/traces`) for spans, REST for everything else [^lf-otlp] | OTLP/HTTP (decided) |
| Underlying span impl | Custom span + AsyncLocalStorage; OTel as opt-in interop | Real OTel `Span` underneath every `LangfuseSpan` [^lf-otel-span] | OTLP-emit only today |
| Package shape | One monolith + 8 thin integrations (3 deprecated) | Six scoped packages (`@langfuse/{core,client,tracing,otel,openai,langchain}`) [^lf-pkg] | Currently one (`@agenta/sdk`); decomposition TBD |
| Runtime-conditional bundles | `node` / `edge-light` / `workerd` / `browser` via `exports` field [^bt-exports] | None — `@langfuse/otel` declares `engines.node >= 20` [^lf-engines] | Spike pain captured; open question |
| Tracing API | `wrapTraced` HOF (alias `traceable`), `traced` callback, imperative `startSpan` | `observe` HOF, `startActiveObservation` (context), `startObservation` (manual), 10 typed observation classes [^lf-types] | TBD |
| Span types | **11 values**: `llm/score/function/eval/task/tool/automation/facet/preprocessor/classifier/review` [^bt-spantypes] | **10 observation types**, but only 2 attribute shapes (span-like, generation-like) — the other 8 are semantic labels [^lf-attrs] | `ag.type.*` |
| AI SDK v6 streaming abort | **Not solved.** `wrapAISDK` dispatches via `diagnostics_channel`. Zero `AbortSignal` handling in source [^bt-noabort] | **Not solved.** Issue #12643 OPEN. `wrapAsyncIterable` ends generation only if for-await loop completes; e2e tests pass via manual `forceFlush()` [^lf-noabort] | This is the spike's central finding — strongest differentiation opportunity |
| Eval orchestration | In-SDK (`Eval(...)`) + CLI runner (`braintrust eval foo.eval.ts`) [^bt-cli] | In-SDK (`ExperimentManager`), no dedicated runner | Server-side today |
| Provider wrappers | 13 wrappers in main package (OpenAI, Anthropic, AISDK, GoogleGenAI, Mistral, Cohere, ClaudeAgentSDK, Groq, Cursor, HuggingFace, Mastra, OpenRouter, OpenRouterAgent) [^bt-wrappers] | OpenAI (Proxy), LangChain (callback handler); Vercel AI SDK = pure OTel pass-through, no wrapper [^lf-noaisdk] | None today |
| Auto-instrument | Node `--import` hook + Vite/Webpack/esbuild/Rollup plugins via `@apm-js-collab/code-transformer` [^bt-autoinstrument] | None — relies on OTel ecosystem instrumentations | None |

**Headline.** Braintrust ships its own bus and treats OTel as opt-in interop; Langfuse rides OTel end-to-end. Both ship eval orchestration in-SDK. Both have a documented gap on AI SDK v6 streaming abort, and **source confirms neither codebase contains any abort-handling logic**. Braintrust's "generator-aware `wrapTraced`" handles only declared `function*`/`async function*` (not arbitrary `AsyncIterable`), so it doesn't solve the AI SDK v6 case either. **Neither solves edge runtime tracing cleanly** — Braintrust ships per-runtime bundles using its proprietary wire; Langfuse is Node-only for tracing.

---

## 1. Package layout & install surface

### Braintrust — monolith + 8 satellites (verified)

One primary npm package (`braintrust`) carries the full surface: logging, tracing, evals, CLI, all 13 provider wrappers. Eight satellite packages live under `integrations/`:

| Package | Status | Purpose |
|---|---|---|
| `@braintrust/otel` | live | `BraintrustSpanProcessor` + `BraintrustExporter` |
| `@braintrust/browser` | live | Browser build with AsyncLocalStorage polyfill (5-line index re-exporting `braintrust`) |
| `@braintrust/vercel-ai-sdk` | **legacy** | Legacy AIStream adapter pinned to `ai: "^3.2.16"`. Not the AI SDK v5/v6 path |
| `@braintrust/openai-agents` | live | OpenAI Agents tracing |
| `@braintrust/langchain-js` | live | LangChain callback handler |
| `@braintrust/temporal` | live | Temporal workflow interceptors |
| `templates-nunjucks` | internal | Template helpers |
| `val.town` | internal | Val.town integration |

The big tell is `exports` in [`js/package.json:25-37`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/package.json):

```json
"exports": {
  ".": {
    "edge-light": "./dist/edge-light.mjs",
    "workerd": "./dist/workerd.mjs",
    "node": { "import": "./dist/index.mjs", "require": "./dist/index.js" },
    "browser": "./dist/browser.mjs"
  },
  "./workerd": { ... },
  "./edge-light": { ... },
  "./browser": { ... },
  "./node": { ... },
  "./instrumentation": { ... },
  "./hook.mjs": "./dist/auto-instrumentations/hook.mjs",
  "./vite": { ... }, "./webpack": { ... }, "./webpack-loader": { ... },
  "./esbuild": { ... }, "./rollup": { ... },
  "./dev": { ... }, "./util": { ... }
}
```

Dedicated `workerd`, `edge-light`, `node`, `browser` conditional builds. Six bundler-plugin subpaths. A Node `--import` hook at `braintrust/hook.mjs`. Build tool is **`tsup`** ([`js/tsup.config.ts:62-75`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/tsup.config.ts)) — separate `browser`, `edge-light`, `workerd` bundles built with `platform: "browser"`.

**Notable: `engines` and `sideEffects` are NOT declared.** Grep of every `package.json` returns zero hits. Braintrust targets runtimes via conditional exports rather than `engines`. Tree-shaking is on the user's bundler. The dependency surface is heavy — `express`, `cors`, `simple-git`, `esbuild`, `boxen`, `chalk`, `cli-table3` are pulled because the CLI lives in the same package, but they're only used on CLI code paths — `dotenv` is only imported in `js/src/cli/index.ts:4` and `js/src/cli/util/bundle.ts:2`. The runtime entrypoints never import it. The doc-folklore "dotenv auto-loaded by the SDK" is **wrong** (v1 of this doc claimed it; corrected here).

Types: hand-written TS with generated OpenAPI types alongside. Zod is a hard peer dep at `^3.25.34 || ^4.0` ([`js/package.json:230-232`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/package.json)); internally `logger.ts:143` imports `zod/v3`.

### Langfuse — six scoped packages, one job each (verified)

| Package | Purpose | Engines | Build |
|---|---|---|---|
| `@langfuse/core` | Shared utilities, Fern-generated REST client (27 sub-resources) | not declared (Node-only in practice) | tsup, dual CJS+ESM |
| `@langfuse/client` | REST client: prompts, datasets, scores, media, experiments | not declared | tsup |
| `@langfuse/tracing` | OTel-based tracing functions + Langfuse span wrappers | **`node: ">=20"`** | tsup |
| `@langfuse/otel` | `LangfuseSpanProcessor` over Batch/Simple processors + media extraction | **`node: ">=20"`** | tsup |
| `@langfuse/openai` | OpenAI Proxy wrapper | not declared | tsup |
| `@langfuse/langchain` | LangChain `CallbackHandler` | not declared | tsup |

Canonical install (the only documented path):

```bash
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

Every package declares `"type": "module"`, `"sideEffects": false`, dual `dist/index.cjs` + `dist/index.mjs` ([`packages/tracing/package.json:15-19`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/package.json), identical pattern across all six). **No subpath exports** — every package's `exports` map has a single `"."` entry.

**Correction from v1 of this doc:** `@langfuse/tracing` is Node ≥ 20 ([`packages/tracing/package.json:11-13`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/package.json)), not "Universal" as v1 claimed. The TS source uses only universal APIs (`crypto.subtle`, `TextEncoder`), so the `engines` gate is policy-driven rather than technical — but the gate is declared.

Legacy `langfuse` / `langfuse-node` are frozen-v3 for Node < 18. The v3 → v4 migration cost is **softer than commonly portrayed**: 16 deprecated method-name aliases live in `LangfuseClient` ([`packages/client/src/LangfuseClient.ts:170-232`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/LangfuseClient.ts)) so v3 calls like `langfuse.getPrompt(...)` and `langfuse.fetchTrace(...)` still work. `LANGFUSE_BASEURL` is still read with a `// legacy v2` fallback at `packages/core/src/utils.ts:1-12` — only the recommended env var name changed.

### Implication for agenta

Both demonstrate that a single monolith doesn't survive once you have (a) tracing-only users, (b) prompt-only users, (c) eval users. **The decomposition pays for itself in DX** — install only what you need — at the cost of more packages to release in lock-step.

The Langfuse split is cleaner and closer to where agenta is heading; tracing is separated from REST CRUD. Braintrust's CLI-in-runtime-package decision is paid for in bundle complexity — though `dotenv`/`express`/`esbuild` only hit CLI code paths, they're still installed.

**Runtime-conditional bundles (Braintrust's `workerd` / `edge-light` exports) are the right shape for our spike findings.** Even with separate edge bundles, Braintrust still needs a `dc-browser` polyfill for `diagnostics_channel` on edge ([`js/src/edge-light/config.ts:8`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/edge-light/config.ts), [`js/src/workerd/config.ts:8`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/workerd/config.ts)). No single bundle works everywhere — plan for at least 4 builds (`node`, `edge-light`, `workerd`, `browser`).

---

## 2. Initialization & state model

### Braintrust — three init modes, globally-shared symbol-keyed state

There is no single client. Init is mode-specific:

```ts
import { init, initLogger, initDataset, login } from "braintrust";

const experiment = await init({ project: "my-project", experiment: "my-exp" }); // eval mode
const logger    = await initLogger({ projectName: "my-project" });               // prod tracing
const dataset   = await initDataset({ project: "my-project", dataset: "my-ds" }); // test data
```

Behind the scenes: `BraintrustState` lives on `globalThis[Symbol.for("braintrust-state")]` ([`js/src/logger.ts:1102-1109`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):

```ts
const sym = Symbol.for("braintrust-state");
let existing = (globalThis as any)[sym];
if (!existing) {
  const state = new BraintrustState({});
  (globalThis as any)[sym] = state;
  existing = state;
}
_globalState = existing;
```

**This is the cleanest fix for the multi-copy-in-node_modules + Next.js dev mode footgun** — multiple bundled copies of the SDK share one state, one queue, one flush lifecycle. Worth lifting directly.

`_internalGetGlobalState` / `_internalSetInitialState` ARE exported (logger.ts:1098/:1114, re-exported via exports.ts:80-82) — escape hatches marked `@internal`.

`init` is **overloaded** three ways: `init(options)`, `init(project, options)` (legacy form preserved with explanatory comment at `logger.ts:3555-3558`), and a third overload. So "three init modes" is correct in spirit (`init`/`initLogger`/`initDataset`) — but `init` itself is internally trilingual.

Env vars: grep across `js/src/` finds **32 unique `BRAINTRUST_*` env vars** — including `BRAINTRUST_DISABLE_INSTRUMENTATION` (comma-separated names to skip), `BRAINTRUST_QUEUE_DROP_EXCEEDING_MAXSIZE`, `BRAINTRUST_SYNC_FLUSH`, `BRAINTRUST_FLUSH_BACKPRESSURE_BYTES`, `BRAINTRUST_FAILED_PUBLISH_PAYLOADS_DIR` (debug-dump targets for failed payloads), `BRAINTRUST_MAX_GENERATOR_ITEMS` (default 1000). More configurable than typical observability SDKs.

**Correction from v1:** `BRAINTRUST_PARENT` is NOT read by the core SDK. It only appears in `@braintrust/otel` at [`integrations/otel-js/src/otel.ts:280`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/integrations/otel-js/src/otel.ts). Core SDK targets routing via `init({project})` / explicit args.

### Langfuse — explicit, no globals, two-concern split

Two separate concerns:

1. **Tracing**: a Node OTel `NodeSDK` with `LangfuseSpanProcessor` registered. Lives in `instrumentation.ts` and starts before app code.
2. **Non-tracing API access**: explicit `new LangfuseClient(...)`.

```ts
// instrumentation.ts (once)
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});
sdk.start();

// elsewhere
import { LangfuseClient } from "@langfuse/client";
const langfuse = new LangfuseClient({
  publicKey: "pk-lf-...",
  secretKey: "sk-lf-...",
  baseUrl: "https://cloud.langfuse.com",
});
```

**No singleton, no `init()`** — confirmed by grepping `packages/client/src/index.ts:1-9`. Multi-project = register multiple `LangfuseSpanProcessor`s with different credentials in the same `NodeSDK`. Each instance gets its own `OTLPTraceExporter` ([`packages/otel/src/span-processor.ts:257`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)).

Tracer-provider isolation has an escape hatch: `setLangfuseTracerProvider(provider)` ([`packages/tracing/src/tracerProvider.ts:102-104`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/tracerProvider.ts)) is **the only way** to use Langfuse with `@vercel/otel`'s isolated (non-global) provider. Without it, `getLangfuseTracer()` falls through to `trace.getTracerProvider()` (line 128), which on Vercel returns the no-op tracer. The function ships with a 36-line warning block (lines 62-98) explaining that even with this set, context (trace IDs, parent spans) is **still shared with the global provider** — so it's not true isolation.

Env vars: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (with `LANGFUSE_BASEURL` legacy fallback), `LANGFUSE_TRACING_ENVIRONMENT`, `LANGFUSE_RELEASE`, `LANGFUSE_FLUSH_AT`, `LANGFUSE_FLUSH_INTERVAL`.

**Bug worth noting:** `LANGFUSE_FLUSH_AT` and `LANGFUSE_FLUSH_INTERVAL` control **two different things**:
- `LangfuseSpanProcessor` ([`span-processor.ts:247-249, 273-276`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)): `flushAt` → `BatchSpanProcessor.maxExportBatchSize`; `flushInterval` → `scheduledDelayMillis` in seconds × 1000.
- `ScoreManager` ([`score/index.ts:43-49`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)): same env vars, defaults `flushAtCount = 10`, `flushIntervalSeconds = 1`, applied to score queue independently.

One env change rebatches both subsystems. Footgun — agenta should namespace.

### Implication for agenta

Three concrete moves from this section:

1. **`globalThis[Symbol.for("agenta-state")]` for state.** Braintrust pattern at `logger.ts:1102-1109`. Trivial cost, kills multi-copy / Next.js dev-mode footguns.
2. **Split env var consumption.** Don't reuse one env var across processor + score queue (Langfuse's bug). Namespace: `AGENTA_SPAN_FLUSH_AT` vs `AGENTA_SCORE_FLUSH_AT`.
3. **`setAgentaTracerProvider(provider)` escape hatch** for `@vercel/otel`-isolated providers. Lift Langfuse's signature literally — same `Symbol.for("agenta")` slot, same `Object.defineProperty` lock.

---

## 3. Tracing API surface

### Braintrust — three primitives, generator-aware (with important caveats)

```ts
// (a) HOF wrapper — most common
const myFunc = wrapTraced(async function myFunc(input: string) {
  return input.toUpperCase();
}, { name: "myFunc", type: "function" });

// (b) callback
const result = await traced(async (span) => {
  span.log({ input, metadata: { model: "gpt-4o" } });
  return "result";
}, { name: "op", type: "llm" });

// (c) imperative
const span = startSpan({ name: "custom", type: "llm" });
try { /* ... */ } finally { span.end(); }
```

`wrapTraced` is aliased as `traceable` ([`js/src/logger.ts:5506`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) — explicit nod to LangSmith refugees in the comment.

**Generator handling — what it actually does:** `wrapTraced` ([`logger.ts:5422-5499`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) detects sync/async generators via `isGeneratorFunction`/`isAsyncGeneratorFunction` (`Object.prototype.toString.call(fn)` at lines 5243/5254-5256). If matched, it routes to `wrapTracedSyncGenerator` (line 5262) or `wrapTracedAsyncGenerator` (line 5329).

**Important corrections from v1 of this doc:**

1. **This handles declared `function*` / `async function*` only** — NOT arbitrary `AsyncIterable` returns. Vercel AI SDK's `streamText` returns an object with `.textStream` / `.fullStream` properties (each an `AsyncIterable`), **not** a generator function. So `wrapTraced` does not solve the AI SDK v6 case via generator detection.
2. **Generator output is silently truncated past 1000 items** ([`logger.ts:5274-5296`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)). When `BRAINTRUST_MAX_GENERATOR_ITEMS` is exceeded, `collected = []` and `truncated = true` — captured output is **wiped**, not partially kept. A debug warning fires only if debug logging is on.
3. **Stream handling for OpenAI / AI SDK v5/v6 goes through `diagnostics_channel.tracingChannel`**, not `wrapTraced`. The provider wrappers build a Proxy that dispatches via channel: `wrapOpenAI` → `tracePromiseWithResponse(openAIChannels.chatCompletionsCreate, ...)` at [`js/src/wrappers/oai.ts:272`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/wrappers/oai.ts); `wrapAISDK` → `aiSDKChannels.streamText` at [`js/src/wrappers/ai-sdk/ai-sdk.ts:410`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/wrappers/ai-sdk/ai-sdk.ts). Channel subscribers handle the stream lifecycle.
4. **There is NO `AbortSignal` handling anywhere in `ai-sdk.ts`** — `grep -i "abort|abortSignal|signal" js/src/wrappers/ai-sdk/` returns zero hits. Stream flushing on Braintrust's side relies on the diagnostics_channel `end`/`error` event, not on abort signal interception.

So the "Braintrust solves AI SDK v6 abort via generator detection" framing in v1 of this doc was **wrong**. They don't.

**Span types — 11 values, not 6** ([`js/util/span_types.ts:1-13`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/util/span_types.ts)):

```ts
export const spanTypeAttributeValues = [
  "llm", "score", "function", "eval", "task", "tool",
  "automation", "facet", "preprocessor", "classifier", "review",
] as const;
```

V1 listed six. Source has eleven. The extras (`automation`, `facet`, `preprocessor`, `classifier`, `review`) cover use cases agenta will hit.

**Parent-child propagation**: AsyncLocalStorage with multi-runtime detection ([`runtime-async-local-storage.ts:13-54`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/runtime-async-local-storage.ts)) — probes `globalThis.AsyncLocalStorage`, falls back to `process.getBuiltinModule("node:async_hooks")`. Silent failure on browsers without polyfill. `startSpan` does NOT push onto context; only `traced`/`wrapTraced` do.

**OTel interop is bidirectional**: `getIdGenerator()` (`id-gen.ts:49`) + `getContextManager()` (`logger.ts:516-520`). When `@braintrust/otel` is loaded, `setupOtelCompat()` writes to `globalThis.BRAINTRUST_CONTEXT_MANAGER`, `globalThis.BRAINTRUST_ID_GENERATOR` ([`integrations/otel-js/src/index.ts:30-38`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/integrations/otel-js/src/index.ts)). **This global mutation prevents multi-tenant tracing in one process** — bad pattern, don't replicate.

**Span cache auto-disables when OTel is active**: `registerOtelFlush(callback)` ([`logger.ts:1127-1131`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) disables the local `spanCache` because OTel spans aren't in the local cache. BTQL "what's in this trace tree" queries force OTel flush first. Useful pattern for agenta when bridging to user-managed OTel.

**`asyncFlush` as typed per-call arg** ([`logger.ts:5422-5433`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):

```ts
function wrapTraced<F extends (...args: any[]) => any,
                    IsAsyncFlush extends boolean = true>(
  fn: F, args?: ...
): IsAsyncFlush extends false
  ? (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>
  : F
```

Flipping `asyncFlush: false` changes return type from `F` to `(...): Promise<Awaited<F>>`. Cleanly handles serverless without a separate "edge mode" API. `PromiseUnless<B, R>` helper at line 1365: `B extends true ? R : Promise<Awaited<R>>`.

**`NOOP_SPAN`** exists (`logger.ts:525-610`, singleton at :612, exported via `exports.ts:69`) — fallback when no logger is initialized.

### Langfuse — three patterns, OTel-native end-to-end

```ts
// (a) startObservation — manual lifecycle, no context push
const span = startObservation("user-request", { input: { query: "..." } });
const gen = span.startObservation(
  "llm-call",
  { model: "gpt-4", input: [...] },
  { asType: "generation" }
);
gen.update({ usageDetails: { input: 10, output: 5 }, output: { content: "Paris." } }).end();
span.end();

// (b) startActiveObservation — context push, auto-end
await startActiveObservation("user-request", async (span) => {
  const gen = startObservation("llm-call", { model: "gpt-4", input: [...] }, { asType: "generation" });
  gen.update({ output: { content: "Paris." } }).end();
});

// (c) observe — HOF wrapper
const tracedFetch = observe(fetchData, { name: "fetch-data", asType: "span" });
```

Implementations at [`packages/tracing/src/index.ts:356-443, 770-877, 1423-1517`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/index.ts).

**`observe()` doesn't actually use `startActiveObservation`** — it builds context manually ([`packages/tracing/src/index.ts:1443-1456`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/index.ts)). Calls `startObservation(...)` then manually `context.with(activeContext, () => fn.apply(this, args))`. Preserves `this` binding for class methods (a fix shipped in 4.0.0-beta.3 per CHANGELOG).

**Ten observation types, but only TWO typed shapes** ([`packages/tracing/src/types.ts:99-109`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/types.ts)):

```ts
export type LangfuseObservationType =
  | "span" | "generation" | "event" | "embedding"
  | "agent" | "tool" | "chain"
  | "retriever" | "evaluator" | "guardrail";
```

`LangfuseGenerationAttributes` has rich generation fields (`completionStartTime`, `model`, `modelParameters`, `usageDetails | OpenAiUsage`, `costDetails`, `prompt: { name, version, isFallback }`). The other eight types (`agent`, `tool`, `chain`, `retriever`, `evaluator`, `guardrail`, `event`, `embedding`) are **type aliases of `LangfuseSpanAttributes`**, distinguished only by the `OBSERVATION_TYPE` field. So the "10 typed subtypes" framing from v1 of this doc was overstated — there are 2 structural shapes with 8 semantic labels riding on top.

**`LangfuseEvent` auto-ends in its constructor** ([`spanWrapper.ts:1451-1458`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/spanWrapper.ts)) — calls `this.otelSpan.end(params.timestamp)` immediately. Every other observation type requires manual `.end()`. Useful pattern for the agenta `event` type if we borrow the taxonomy.

**Underlying span is a real OTel `Span`** ([`spanWrapper.ts:142-163`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/spanWrapper.ts)) — `LangfuseBaseObservation` holds `public readonly otelSpan: Span`. Third-party processors observe everything. Tracer obtained via `@opentelemetry/api` ([`tracerProvider.ts:150-155`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/tracerProvider.ts)).

**Distributed tracing**: `createTraceId(seed?)` ([`index.ts:1604-1617`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/index.ts)) — SHA-256(seed) sliced to 32 hex chars when seed provided, else 16 random bytes. Deterministic IDs from external IDs (e.g., ticket numbers).

**`propagateAttributes(callback)`** ([`packages/core/src/propagation.ts:246-397, 532-548`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/propagation.ts)) — the v5 observation-centric attribute primitive. Sets attributes on (a) the currently active span if `isRecording()`, AND (b) the OTel context so future child spans inherit them via `LangfuseSpanProcessor.onStart` ([`span-processor.ts:324-333`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)).

**Hidden gotcha**: `propagateAttributes` silently truncates string values over 200 chars ([`propagation.ts:618-623`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/propagation.ts)) — a `logger.warn` fires, but if debug logging is off the user sees nothing. Bad for large-payload metadata.

**Trace-level info flows via context, not generation attributes**: both `@langfuse/openai` ([`traceMethod.ts:65-71`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/traceMethod.ts)) and `@langfuse/langchain` ([`CallbackHandler.ts:24-25`](https://github.com/langfuse/langfuse-js/blob/main/packages/langchain/src/CallbackHandler.ts)) wrap their work in `propagateAttributes({ userId, sessionId, tags, traceName }, () => ...)`. This is the v5 paradigm.

**Cross-process propagation via W3C baggage**: optional `asBaggage: true` on `propagateAttributes` ([`propagation.ts:131, 551-569`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/propagation.ts)) with all-snake-case keys for Python-SDK cross-compat (lines 670-673).

### Implication for agenta

Five concrete moves from this section:

1. **Ship a generator-aware HOF (`ag.trace(fn)`) on top of OTel spans** — but understand it doesn't solve AI SDK v6 abort. The abort fix needs separate processor-level logic (Section 6).
2. **Borrow Langfuse's typed observation subtypes as labels** — only `generation` needs a typed attribute shape; the rest can ride a common `span-like` shape with a `type:` field. Don't overstate the type strictness.
3. **Borrow Braintrust's `asyncFlush: boolean` typed per-call arg** — elegant return-type flip, single API for serverless + long-running.
4. **Adopt `propagateAttributes`-style observation-centric propagation** for user/session/tags. Borrow the OTel-context + baggage dual write. Don't borrow the silent 200-char truncation — log at WARN, not silently.
5. **Mirror `agenta.user.id` / `agenta.session.id` to OTel-standard `user.id` / `session.id` keys** ([Langfuse does this](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/constants.ts) at `constants.ts:13-14, 60-61`) — undocumented design move that makes existing OTel tooling pick up these IDs without config.

---

## 4. AI provider integrations

### Braintrust — 13 wrappers via diagnostics_channel

All from the main `braintrust` package ([`js/src/exports.ts:166-199`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/exports.ts)):

```ts
import {
  wrapOpenAI, wrapAnthropic, wrapAISDK, wrapGoogleGenAI,
  wrapMistral, wrapCohere, wrapClaudeAgentSDK,
  // also: Groq, Cursor, GitHub Copilot, HuggingFace, Mastra,
  //       OpenRouter, OpenRouterAgent
} from "braintrust";

const openai = wrapOpenAI(new OpenAI());
const ai = wrapAISDK(require("ai"));
```

`wrapOpenAI` builds a Proxy ([`oai.ts:85-106`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/wrappers/oai.ts)): `new Proxy(typedOpenai.chat.completions, { get(...) })` returning `wrapChatCompletion(baseVal.bind(target))` for `create`/`parse`/`stream`. Same proxy pattern recursive for `.beta.chat.completions`.

**Underlying mechanism is `diagnostics_channel.tracingChannel`** — `wrapChatCompletion` dispatches via `tracePromiseWithResponse(openAIChannels.chatCompletionsCreate, traceContext, completionPromise)` at [`oai.ts:272`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/wrappers/oai.ts). Stream consumers live in channel subscribers. Cross-runtime polyfill via `dc-browser` on edge/workerd ([`edge-light/config.ts:8`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/edge-light/config.ts)).

**Why this matters**: Braintrust unified its manual-wrap path with its AST-transformed and bundler-injected paths around `diagnostics_channel`. Less common than Proxy-based wrappers; more uniform across runtimes. **Heavier complexity** — `dc-browser` polyfill plus `@apm-js-collab/code-transformer` AST machinery. For agenta: probably skip in favor of straight OTel `SpanProcessor` + Proxy wrappers when needed.

**Three auto-instrumentation layers**:
1. Manual `wrapX(client)` — explicit.
2. Bundler plugins: `braintrust/vite`, `/webpack`, `/webpack-loader`, `/esbuild`, `/rollup` — implementation via `@apm-js-collab/code-transformer` ([`bundler/plugin.ts:18`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/auto-instrumentations/bundler/plugin.ts)).
3. Node `--import` hook: `node --import braintrust/hook.mjs app.js` ([`auto-instrumentations/hook.mts:38-46, 101-104`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/auto-instrumentations/hook.mts)). Reads `BRAINTRUST_DISABLE_INSTRUMENTATION`, registers ESM loader + CJS `ModulePatch.patch()`, patches `diagnostics_channel.tracingChannel`.

**Vercel AI SDK story is messy**: the `@braintrust/vercel-ai-sdk` package at v0.0.5 is a **legacy AIStream adapter** pinned to `ai: "^3.2.16"` ([`integrations/vercel-ai-sdk/src/adapter.ts:11-21`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/integrations/vercel-ai-sdk/src/adapter.ts)) — converts a `BraintrustStream` into AI-SDK-compatible `ReadableStream`. NOT the AI SDK v5/v6 path. The real wrapper is `wrapAISDK` from the main package ([`wrappers/ai-sdk/ai-sdk.ts:95`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/wrappers/ai-sdk/ai-sdk.ts)). The middleware module `BraintrustMiddleware` and `wrapAISDKModel` live under `wrappers/ai-sdk/deprecated/` with TODO "remove in next major release". Three coexisting AI SDK paths, two deprecated, one current. Documentation hazard.

AI SDK v5 + v6 are both tested ([`wrappers/ai-sdk/tests/v5/package.json`, `tests/v6/package.json`](https://github.com/braintrustdata/braintrust-sdk-javascript/tree/main/js/src/wrappers/ai-sdk/tests)) — but **the test fixtures don't exercise the mid-stream abort path** (grep returns no abort handling in `js/src/wrappers/ai-sdk/`).

### Langfuse — focused, with one big OTel pass-through bet

- **`@langfuse/openai`** — `observeOpenAI` is a recursive Proxy ([`observeOpenAI.ts:92-125`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/observeOpenAI.ts)). Streaming intercepted via `wrapAsyncIterable` ([`traceMethod.ts:103-104, 186-262`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/traceMethod.ts)). Optional 2nd arg accepts `traceName`, `userId`, `sessionId`, `tags`, `generationName`, `langfusePrompt`, `generationMetadata`, `parentSpanContext` ([`types.ts:12-37`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/types.ts)).
- **`@langfuse/langchain`** — `CallbackHandler` extends `BaseCallbackHandler` ([`CallbackHandler.ts:56`](https://github.com/langfuse/langfuse-js/blob/main/packages/langchain/src/CallbackHandler.ts)).
- **Vercel AI SDK = pure OTel pass-through, no wrapper.** Confirmed by `find packages -name "*.ts"` — no `@langfuse/vercel-ai-sdk` exists. The e2e test ([`tests/e2e/vercel-ai-sdk.e2e.test.ts:253-263`](https://github.com/langfuse/langfuse-js/blob/main/tests/e2e/vercel-ai-sdk.e2e.test.ts)) uses `experimental_telemetry: { isEnabled: true }` directly with `LangfuseSpanProcessor`.

**The smoking gun on AI SDK v6 abort**: `wrapAsyncIterable` ([`traceMethod.ts:186-262`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/traceMethod.ts)) does NOT handle abort. The `for await (const rawChunk of response as AsyncIterable<unknown>)` loop at line 204 will receive the iterator's abort exception, fall through, and `generation.update({...}).end()` on lines 251-258 will execute **only if the for-await loop completes**. If the consumer aborts mid-stream and the iterator is GC'd without `.return()`, `.end()` never fires — and `BatchSpanProcessor` never sees the span.

**This is exactly the AI SDK v6 abort failure mode from issue #12643** — and source confirms there's no in-SDK guard against it. The Vercel AI SDK e2e tests pass because they explicitly `await testEnv.spanProcessor.forceFlush()` at [test:275](https://github.com/langfuse/langfuse-js/blob/main/tests/e2e/vercel-ai-sdk.e2e.test.ts), papering over the failure mode.

**Media auto-extraction is hard-coded to AI SDK scope name `"ai"`** ([`MediaService.ts:55, 98-100`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/MediaService.ts)) — regex `/data:[^;]+;base64,[A-Za-z0-9+/]+=*/g` scans every attribute value, with special-case walking of `ai.prompt.messages` / `ai.prompt` for Vercel AI SDK.

### Comparison

| | Braintrust | Langfuse |
|---|---|---|
| OpenAI | `wrapOpenAI` (Proxy via dc) | `observeOpenAI` (Proxy via async iter wrap) |
| Anthropic | `wrapAnthropic` | (none — OTel pass-through) |
| Vercel AI SDK | `wrapAISDK` + deprecated middleware + legacy adapter (3 paths) | None — `experimental_telemetry` pass-through |
| LangChain | `@braintrust/langchain-js` | `@langfuse/langchain` |
| Google GenAI | `wrapGoogleGenAI` | (none) |
| Other wrappers | Mistral, Cohere, Groq, Cursor, HF, Mastra, OpenRouter, etc. | (none) |
| Auto-instrument | `--import` hook + 4 bundler plugins + AST transform | None |
| AI SDK v6 streaming abort | **Not handled** in source | **Not handled** in source (issue #12643) |

### Implication for agenta

Two clear takeaways:

1. **Both competitors converge on `experimental_telemetry` + OTel for Vercel AI SDK** — this is the industry-default path. Agenta's spike is already in this lane. Neither offers a first-class `wrapAISDK` that solves the abort problem; Braintrust's exists but is implemented through diagnostics_channel without abort awareness.
2. **AI SDK v6 streaming abort is a wide-open differentiation opportunity, confirmed at source.** Section 6 unpacks this.

For provider wrapper roster: Braintrust's "13 first-class wrappers via diagnostics_channel" is a deep investment with maintenance cost per provider. Langfuse's "Proxy + OTel pass-through" is simpler. **Recommend Langfuse's path for v1** — OTel-only via `experimental_telemetry` for AI SDK v6; add per-provider Proxy wrappers in v2 only if measured DX gap demands them.

---

## 5. Evals, datasets, prompts

### Braintrust

Eval = a function in the SDK, run via a dedicated CLI ([`framework.ts:643-700`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/framework.ts)):

```ts
import { Eval } from "braintrust";
import { LevenshteinScorer, Factuality } from "autoevals";

Eval("Say Hi Bot", {
  data: () => [
    { input: "Foo", expected: "Hi Foo" },
    { input: "Bar", expected: "Hello Bar" },
  ],
  task: (input) => "Hi " + input,
  scores: [LevenshteinScorer, Factuality],
});
```

**CLI binary is `braintrust`, not `bt`** — `js/package.json:20-22` declares `"bin": { "braintrust": "./dist/cli.js" }`. The README example uses `npx braintrust eval hello.eval.ts`. (V1 of this doc said `bt eval` — wrong.) Subcommands at [`cli/index.ts:1069-1190`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/cli/index.ts): `eval`, `push` (bundles prompts/tools/scorers), `pull` (retrieves them into source). The `eval` command supports `--dev` mode running an HTTP server (`--dev-host`, `--dev-port`) at lines 1116-1132 — **local eval files become live, interactively-runnable from the Braintrust web playground**. Non-obvious feature.

CLI uses esbuild (`cli/index.ts:3, 347, 393`) for transpilation + watch mode. `dotenv` auto-loads at CLI invocation (not at runtime SDK load).

**Disk cache for prompts + parameters** ([`logger.ts:716-746`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)): LRU memory + optional disk layer at `~/.braintrust/prompt_cache` / `~/.braintrust/parameters_cache`. Sizes via env (`BRAINTRUST_PROMPT_CACHE_MEMORY_MAX`, etc.). Edge/browser bundles can't write disk — `iso.homedir!()` undefined there. Production DX win: offline runs hit cached prompts.

`autoevals` ships as a **separate npm package** (github.com/braintrustdata/autoevals), not in this repo.

**Templating: Mustache** ([`logger.ts:163`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts) — `./template/mustache-utils`).

### Langfuse

`LangfuseClient` has **27 sub-resources** under `client.api.*` ([`packages/core/src/api/Client.ts:6-30`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/Client.ts)) — fully Fern-generated (`/** This file was auto-generated by Fern */` header at line 1). The five managers (`prompt`, `dataset`, `score`, `media`, `experiment`) wired on `LangfuseClient` ([`LangfuseClient.ts:93-164`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/LangfuseClient.ts)) are **convenience wrappers**; users can hit the raw API at `langfuse.api.metrics.*`, `langfuse.api.scim.*`, etc.

```ts
const prompt = await langfuse.prompt.get("my-prompt", { version: "1.0" });

langfuse.score.create({
  name: "quality",
  value: 0.85,
  traceId: "trace-123",
  comment: "High quality response",
});

await langfuse.experiment.run(/* dataset + task + evaluators */);
```

**`prompt.get` is overload-typed for `text` vs `chat`** ([`promptManager.ts:235-334`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/prompt/promptManager.ts)) — three overloads narrow return type to `TextPromptClient` or `ChatPromptClient` based on `options.type`.

**Stale-while-revalidate prompt cache** ([`promptManager.ts:316-412`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/prompt/promptManager.ts)). Cache lookup at 340; if `cachedPrompt.isExpired` (line 390), the manager returns the stale cached prompt **immediately** at line 408 and kicks off a background refresh (line 392-406) only if no refresh is in flight. Cache TTL default 60s. **Production callers never pay for prompt latency on cache expiration.** Direct lift candidate for agenta.

**Templating: Mustache** (`packages/client/package.json:38` — `"mustache": "^4.2.0"`). Same engine as Braintrust.

**Score queue**: `MAX_QUEUE_SIZE = 100_000`, `MAX_BATCH_SIZE = 100` ([`score/index.ts:14-15`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)). Defaults `flushAt = 10`, `flushIntervalSeconds = 1` (lines 46-49). Overflow at 100k items → `logger.error(...)` and drop (lines 89-94). No retry, no backpressure, no exception. Silent data-loss hole, but safe for host app.

`score.create` is **fire-and-forget** (returns `void`, not `Promise<void>`). Four convenience overloads `score.observation`, `score.trace`, `score.activeObservation`, `score.activeTrace` auto-extract IDs from an OTel span and call `create()`. The `active*` variants log a warning and skip on no active span ([`score/index.ts:213-217`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)).

**Experiment** ([`packages/client/src/experiment/`](https://github.com/langfuse/langfuse-js/tree/main/packages/client/src/experiment)): `ExperimentManager` runs tasks locally, traces each, applies evaluators, batches scores. Experiment IDs are content-addressed (SHA-256(input)[0..16]). `propagateAttributes` reserves an `_internalExperiment` context for run isolation that forces environment to `"sdk-experiment"`.

### Comparison

| | Braintrust | Langfuse |
|---|---|---|
| Eval orchestration | In-SDK via `Eval(...)` | In-SDK via `ExperimentManager` |
| Eval runner | Dedicated CLI (`braintrust eval`) + `--dev` mode hosting for web playground | None — call from any TS script |
| Scorers | Separate `autoevals` package | AutoEvals integration documented |
| Templating | Mustache | Mustache |
| Prompt versioning | `loadPrompt({slug, defaults}).build({var})` | `prompt.get("name", {version, type?})` |
| Prompt cache | LRU memory + disk (`~/.braintrust/prompt_cache`) | Stale-while-revalidate, 60s TTL default |
| Dataset CRUD | `initDataset(...).insert/update/delete/fetch/summarize` | `langfuse.dataset.*` |
| Raw API access | Not exposed as cleanly | `langfuse.api.*` (27 sub-resources) |
| Wire | Proprietary REST | OTLP for spans, REST for everything else |

### Implication for agenta

Three concrete moves:

1. **Adopt Langfuse's stale-while-revalidate prompt cache** ([`promptCache.ts:5, 32-34, 67-80`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/prompt/promptCache.ts)) — lift directly. Caller never blocks on cache expiration. Combine with Braintrust's optional disk layer for offline-friendly evals.
2. **Expose `client.api.*` as the escape hatch** — Langfuse's pattern (`packages/core/src/api/Client.ts` exposing 27 sub-resources) works well. Don't try to hand-wrap every endpoint; ship the five named managers + raw `.api` access.
3. **Skip the eval CLI in v1** — both ship eval orchestration in-SDK; only Braintrust ships a CLI. The CLI's value lives in `--dev` mode (local-eval-hosted-for-web-playground). Worth scoping for v2 once tracing lands.

---

## 6. Export model & edge runtime

This is the section that maps most directly to the spike's pain log.

### Braintrust — proprietary batched queue + OTel as opt-in

**Wire**: proprietary REST endpoint `logs3` (NOT `/logs` as v1 of this doc claimed). POST target at [`logger.ts:3231-3236`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts) is literally `"logs3"` (and `"logs3/overflow"` at line 3159). Overflow reference type `"logs3_overflow"` at line 87. Oversized payloads spill to S3.

**Queue**: bg worker (`queue.ts`) with FIFO + drop-newest-when-full semantics ([`queue.ts:31-49`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/queue.ts)). `HTTPBackgroundLogger.defaultBatchSize = 100` ([`logger.ts:2788`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts), configurable via `BRAINTRUST_DEFAULT_BATCH_SIZE`). `DEFAULT_MAX_REQUEST_SIZE = 6 * 1024 * 1024` (6 MB, [`logger.ts:93`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts), comment: "for the AWS lambda gateway"). Default queue size 15000 (`queue.ts:3`).

**`beforeExit` flush** registered automatically ([`logger.ts:2880-2884`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):

```ts
if (!opts.noExitFlush) {
  iso.processOn("beforeExit", async () => {
    await this.flush();
  });
}
```

With explicit caveat in comments: doesn't run on `process.exit()` or uncaught exceptions. Best-effort only.

**OTel mode** ([`@braintrust/otel` package](https://github.com/braintrustdata/braintrust-sdk-javascript/tree/main/integrations/otel-js)):
- `BraintrustSpanProcessor` and `BraintrustExporter` at [`integrations/otel-js/src/otel.ts:238, :637`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/integrations/otel-js/src/otel.ts).
- **`BraintrustExporter` is a wrapper around `BraintrustSpanProcessor`, not a separate exporter** — it instantiates a `BraintrustSpanProcessor` (line 644) and in `export()` calls `this.processor.onEnd(span)` per span + `this.processor.forceFlush()` (lines 656-664). The actual HTTP layer is the upstream `OTLPTraceExporter` from `@opentelemetry/exporter-trace-otlp-http`, constructed inside `BraintrustSpanProcessor` at line 298. Braintrust didn't write a custom OTLP exporter — they configure the upstream one with `x-bt-parent` and `Authorization` headers.
- POST target: `${apiUrl}/otel/v1/traces` (line 299). `x-bt-parent` header (`project_name:` / `project_id:` / `experiment_id:`) set at line 294.
- **`filterAISpans` is OFF by default** ([`otel.ts:307-316`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/integrations/otel-js/src/otel.ts)) — the prefix filter (`gen_ai.`, `braintrust.`, `llm.`, `ai.`, `traceloop.` at lines 30-36) is opt-in. Default behavior forwards everything. V1 of this doc implied the filter ran by default — wrong.

**Flush semantics**: `asyncFlush: boolean` is a typed per-call arg on `traced`/`wrapTraced`. With `asyncFlush: true` (default), wrapped function returns sync, flush in background. With `asyncFlush: false`, wrapper returns a Promise resolving only after `span.flush()` completes. **Built for serverless without a separate "edge mode" API.**

**Edge runtime support**: dedicated `workerd.mjs` + `edge-light.mjs` conditional exports ([`js/package.json:25-37`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/package.json)). Configs at [`js/src/edge-light/config.ts:1-58`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/edge-light/config.ts) and [`js/src/workerd/config.ts:1-58`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/workerd/config.ts) — near-identical: polyfill ALS via `resolveRuntimeAsyncLocalStorage()`, swap in `dc-browser`'s `tracingChannel`, provide a non-crypto hash. `@braintrust/browser` adds AsyncLocalStorage polyfill for browser.

### Langfuse — OTLP-native, Node-only for tracing

**Wire**: OTLP/HTTP via `@opentelemetry/exporter-trace-otlp-http` ([`span-processor.ts:14`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)). Default endpoint built at line 258: `${baseUrl}/api/public/otel/v1/traces`. REST for scores/prompts/datasets via Fern-generated client.

**Processor**: `LangfuseSpanProcessor` wraps `BatchSpanProcessor` (default) or `SimpleSpanProcessor` based on `exportMode: "batched" | "immediate"` ([`span-processor.ts:269-277`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)):

```ts
exportMode?: "immediate" | "batched"; // default "batched"
// ...
params?.exportMode === "immediate"
  ? new SimpleSpanProcessor(exporter)
  : new BatchSpanProcessor(exporter, {...})
```

**Default batching is upstream OTel defaults, NOT Langfuse-specific** — `maxExportBatchSize` and `scheduledDelayMillis` only set when env vars are present (lines 273-277). OTel ships `maxExportBatchSize: 512`, `scheduledDelayMillis: 5000`. Score queue defaults are 10 items / 1s ([`score/index.ts:46-49`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)), independent.

**`forceFlush()` is a strict superset of OTel's**: Langfuse keeps its own `pendingEndedSpans: Set<Promise<void>>` and `mediaService.flush()` queue ([`span-processor.ts:187, 356-379`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)). `forceFlush()` awaits both before calling `this.processor.forceFlush()` — important if media uploads are in flight.

**Mask function pattern** ([`span-processor.ts:444-462`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)) — `applyMaskInPlace` targets six attributes: trace/observation × input/output/metadata. Awaited per-attribute. If user mask throws, value replaced with literal `"<fully masked due to failed mask function>"` (line 474). Sensitive-data masking runs **before** `mediaService.process(span)` (line 417-418) — correct order so masked base64 never reaches the media uploader.

**Default span filter** `isDefaultExportSpan` ([`span-filter.ts:35-39`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-filter.ts)) — exports spans that are Langfuse-emitted, contain any `gen_ai.*` attribute, or come from a known LLM scope (`ai`, `langsmith`, `openinference`, `litellm`, etc., listed at lines 4-15). Users override via `shouldExportSpan` config (line 66, applied at 283-287).

**Flush on process exit / abort**: standard OTel `processor.forceFlush()` + `sdk.shutdown()`. Default `BatchSpanProcessor` won't ship spans for an in-flight AI SDK v6 `streamText` aborted before `.end()` — exact failure mode from issue #12643. Documented mitigation: `exportMode: "immediate"`.

**Edge runtime support**: **none for tracing**. `@langfuse/otel` declares `engines.node >= 20`. `@vercel/otel` explicitly recommended against in docs ("lacks OpenTelemetry JS SDK v2 support"). Universal `@langfuse/client` works on edge for REST-only paths.

**`X-Langfuse-Sdk-*` headers**: Langfuse ships these on every request ([`packages/core/src/api/Client.ts:39-44`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/Client.ts) — `X-Langfuse-Sdk-Name`, `X-Langfuse-Sdk-Version`, `X-Langfuse-Public-Key`). Same headers used client-side and exporter-side. Worth mirroring for server-side per-SDK observability.

### The AI SDK v6 abort failure mode (source-confirmed)

Both codebases share the same gap:

**Langfuse** (`@langfuse/openai/traceMethod.ts:186-262`):
```ts
async function* wrapAsyncIterable(...) {
  for await (const rawChunk of response as AsyncIterable<unknown>) {
    // collect chunks
  }
  // ↓ runs ONLY if the loop completes
  generation.update({...}).end();
}
```

If the consumer aborts mid-stream and the iterator is GC'd without `.return()`, `.end()` never fires, `BatchSpanProcessor` never sees the span. **This is the AI SDK v6 abort failure mode from issue #12643.** Langfuse's Vercel AI SDK e2e tests pass by explicitly calling `await testEnv.spanProcessor.forceFlush()` ([`tests/e2e/vercel-ai-sdk.e2e.test.ts:275`](https://github.com/langfuse/langfuse-js/blob/main/tests/e2e/vercel-ai-sdk.e2e.test.ts)) — papering over the production failure mode.

**Braintrust** (`js/src/wrappers/ai-sdk/`): grep for `abort|AbortSignal|signal` returns zero hits in the AI SDK wrapper directory. Stream handling goes through `diagnostics_channel.tracingChannel` (`ai-sdk.ts:410`) — flushing depends on the channel emitting `end`/`error` events. **No abort-signal-aware logic.** Same failure mode.

This is **the largest open differentiation opportunity** for agenta.

### Comparison vs the spike's pain log

| Spike pain | Braintrust | Langfuse | Agenta opportunity |
|---|---|---|---|
| P-NODE-02: `BatchSpanProcessor` + `streamText` loses spans on abort | No abort handling in `wrappers/ai-sdk/` | No abort handling in `wrapAsyncIterable`. Issue #12643 OPEN | Ship `AgentaSpanProcessor` that intercepts iterator `.return()`/`.throw()` + AbortSignal + flushes in-flight span |
| P-APP-RAW-01: edge runtime drops all spans (raw OTel) | Dedicated `edge-light.mjs` bundle, proprietary wire | Not supported | Per-runtime bundle + OTLP exporter that works on edge |
| P-APP-VERCEL-02: edge tracing works but ~10-15s delay (BatchSpanProcessor) | `asyncFlush: false` maps cleanly to edge handlers | Same as P-NODE-02 — recommend `"immediate"` | Default `"immediate"`-equivalent on edge runtimes |
| P-PAGES-RAW-01: Pages Router edge can't BUILD raw OTel imports | `edge-light.mjs` ships edge-safe bundle | Not supported | Ship a build that passes Next's static dynamic-code-eval check |
| P-PAGES-VERCEL-01: Pages Router + vercel-otel loses `ag.metrics.tokens` | (untested with their stack) | Same shape — relies on `experimental_telemetry` working with `@vercel/otel`, which they advise against | Verify against agenta wire; document compatibility matrix |
| P-TANSTACK-01: instrumentation seam is unenforced import order | (untested) | Not addressed | Document; ship a `register()` helper that throws if called too late |

### Implication for agenta

Four concrete moves, ranked by leverage:

1. **`AgentaSpanProcessor` must handle AI SDK v6 abort correctly out of the box.** Neither competitor does, confirmed at source. Ship a processor that (a) intercepts AsyncIterable iterator `.return()` and `.throw()`, (b) listens for `AbortSignal` propagated through `experimental_telemetry`, (c) force-flushes the in-flight span before the OTel batch processor would normally release it. Add `flushOnAbort: boolean` config (true by default).
2. **Per-runtime conditional exports.** Borrow Braintrust's `node/edge-light/workerd/browser` pattern. Plan for at least 4 builds.
3. **`asyncFlush: boolean` as typed per-call arg.** Cleaner than Langfuse's "switch processor mode globally."
4. **Mask function as part of processor config** (Langfuse pattern). Six attribute slots: input/output/metadata × trace/observation. Async-aware. On mask failure → sentinel value. Document the mask-before-media-extraction order.

---

## 7. Type safety & ergonomics

### Braintrust

- **Generics-heavy.** `init`, `initLogger`, `initDataset` carry phantom `IsOpen extends boolean = false` and `IsAsyncFlush extends boolean = true`. `wrapTraced` returns conditional types based on `IsAsyncFlush` ([`logger.ts:5422-5433`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)).
- **Zod is a hard peer dep** (`^3.25.34 || ^4.0`); parallel test suites for v3 + v4. Internally imports `zod/v3`.
- **Flat namespace.** `import * as braintrust from "braintrust"` works — `exports.ts` is a single re-export sheet.
- **Error handling**: throws by default; instrumentation paths swallow errors silently via `debug-logger.ts` + `NOOP_SPAN` fallback. Philosophy: observability must never crash the host app. `logError(span, e)` is the explicit error-to-span path.

### Langfuse

- **Strict hand-written types** for all observation attributes (`LangfuseGenerationAttributes` with typed `model`, `modelParameters`, `usageDetails`, `costDetails`, `prompt: { name, version, isFallback }`). All other observation types share `LangfuseSpanAttributes` via type aliases — only 2 structural shapes.
- **Constants enum is the canonical attribute taxonomy** ([`packages/core/src/constants.ts:10-61`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/constants.ts)) — `LangfuseOtelSpanAttributes`. Trace attrs use `langfuse.trace.*`, observation attrs use `langfuse.observation.*`, but `user.id` and `session.id` are unprefixed (lines 13-14) — they piggyback on OTel-standard keys. Compat fallbacks `langfuse.user.id` / `langfuse.session.id` exist at lines 60-61. **Undocumented deliberate design move** — existing OTel tooling picks up user/session IDs without configuration.
- **`completionStartTime` for streaming** ([`constants.ts:30`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/constants.ts)) — set on first chunk receipt ([`traceMethod.ts:205`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/traceMethod.ts)). Captures time-to-first-token implicitly.
- **Discoverability**: namespace on `LangfuseClient` (`langfuse.prompt.*`, `langfuse.dataset.*`, `langfuse.score.*`); tracing functions are top-level imports.
- **Error handling**: silent fail by default. Score queue silently drops on overflow ([`score/index.ts:89-94`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)). HTTP failures logged but never throw into user code.

### Implication for agenta

Three concrete moves:

1. **Silent fail on instrumentation paths.** Both converge. Match. Use a debug logger gated on `AGENTA_DEBUG=1` for diagnosis.
2. **Mirror agenta IDs to OTel-standard keys.** `agenta.user.id` AND `user.id`, `agenta.session.id` AND `session.id`. Costs nothing, makes existing OTel tooling light up.
3. **`completionStartTime` for streaming.** Easy add, captures TTFT (time-to-first-token) without user config.

---

## 8. Notable design opinions

### Braintrust

- **OTel is a peer, not the bus.** Own bg logger, queue, span impl. OTel offered as opt-in `SpanProcessor`/`Exporter`.
- **`diagnostics_channel.tracingChannel` as the unified instrumentation seam** — across manual wraps, AST transforms (`@apm-js-collab/code-transformer`), bundler plugins (`braintrust/vite|webpack|esbuild|rollup`), and Node `--import` hooks. Cross-runtime via `dc-browser` polyfill on edge. Unusual design; heavy.
- **Symbol-keyed `globalThis` state** — `Symbol.for("braintrust-state")` for cross-bundle survival. Borrow-worthy.
- **`asyncFlush` typed per-call arg** — elegant return-type flip. Borrow-worthy.
- **Three layers of "auto":** manual → bundler plugin → `--import` hook. Opt-in.
- **CLI bundled in runtime package** (with `dotenv`, `express`, `esbuild`, `chalk`). Cautionary tale on bundle size; keep CLI separate.
- **`traceable` alias** for LangSmith refugees. Small but telling.
- **No `engines` declaration** — runtime targeting via conditional exports only. Leakier than Langfuse's `engines: {node: ">=20"}`.

### Langfuse

- **OTel is the design.** Not "OTel-compatible" — OTel-native end-to-end. `LangfuseSpan` is a real OTel `Span`. Wire is OTLP/HTTP.
- **Two transports, one product.** Spans over OTLP, REST for scores/prompts/datasets. Pragmatic split.
- **10 observation types but only 2 attribute shapes** — semantic labels riding on top of `span-like` / `generation-like`. Overstated as "richer semantic model" in v1 of this doc.
- **`propagateAttributes` is the v5 observation-centric primitive** — trace-level info flows via OTel context + optional W3C baggage. Both OpenAI and LangChain wrappers route everything through it.
- **Stale-while-revalidate prompt cache** — production-grade DX win.
- **Eval orchestration in-SDK** — `ExperimentManager` runs locally, traces each, batches scores.
- **Migration tax softer than commonly portrayed** — 16 deprecated method-name aliases preserved in `LangfuseClient`, `LANGFUSE_BASEURL` still read as legacy fallback. The breaking-change reputation overstates the actual surface break.
- **Two OTel processors per app** — one for `LangfuseClient`'s media service, one for `LangfuseSpanProcessor`'s MediaService. Each has its own Fern fetch agent; connection pools not shared.
- **Node-only tracing.** Deliberate split — `@langfuse/otel` and `@langfuse/tracing` both `engines.node >= 20`.

---

## 9. Decisions agenta needs to make for the RFC

Translating the source audit into explicit RFC decision points:

### D1. Wire protocol

- ✅ **Already decided: OTLP/HTTP.** Aligns with Langfuse end-to-end; Braintrust's OTel-mode interop confirms OTLP is the cross-vendor lingua franca.
- Open: do scores/prompts/datasets also go OTLP, or REST? Langfuse splits (REST for non-tracing). **Recommend split** — don't force scores through OTel attributes.

### D2. Package decomposition

- **Recommend Langfuse-style scoped packages** (`@agenta/tracing`, `@agenta/otel`, `@agenta/client`, `@agenta/openai`).
- Keep CLI separate from runtime — don't bundle `dotenv`/`express`/`esbuild` into the runtime install (Braintrust's tax).

### D3. State + multi-bundle survival

- **Adopt `globalThis[Symbol.for("agenta-state")]`** (Braintrust pattern, `logger.ts:1102-1109`).
- Fixes multi-copy in node_modules + Next.js dev mode + monorepo issues.
- Trivial cost, large bug-prevention benefit.

### D4. Tracing API surface shape

- **Recommend hybrid**: ship a generator-aware HOF (`ag.trace(fn)` or similar) on top of OTel spans as the primary surface. Provide `startSpan`/`startActiveSpan` for imperative cases.
- Borrow Langfuse's observation type union (`span | generation | event | embedding | agent | tool | chain | retriever | evaluator | guardrail`) as semantic labels — but only generation needs a typed attribute shape.
- Borrow Braintrust's 11-value `spanType` extras (`automation`, `facet`, `preprocessor`, `classifier`, `review`) where relevant.

### D5. AI SDK v6 streaming abort handling — **headline differentiator**

- Source confirms neither competitor handles this. Largest open opportunity.
- **Recommend**: `AgentaSpanProcessor` that (a) intercepts AsyncIterable `.return()`/`.throw()`, (b) listens for `AbortSignal` from `experimental_telemetry`, (c) force-flushes in-flight span before OTel batch processor would release it.
- Config: `flushOnAbort: boolean` (true by default).
- Document this as the headline feature.

### D6. Edge runtime support

- **Per-runtime conditional exports** (Braintrust pattern): separate `node`, `workerd`, `edge-light`, `browser` builds.
- Plan for 4 builds from day one — no single bundle works everywhere even with polyfills.
- Spike confirmed there's no shortcut.

### D7. Attribute propagation

- **Adopt Langfuse's `propagateAttributes`-style observation-centric propagation** for user/session/tags.
- Borrow OTel-context + optional W3C baggage dual write.
- **Don't** borrow silent 200-char truncation — log at WARN.
- Mirror agenta IDs to OTel-standard keys: `agenta.user.id` AND `user.id`.

### D8. Provider integration strategy

- **Recommend OTel-only via `experimental_telemetry` for v1** (Langfuse pattern).
- Add per-provider Proxy wrappers in v2 only if measured DX gap demands.
- Skip Braintrust's `diagnostics_channel` + AST transform machinery — heavy complexity for marginal gain.

### D9. Eval orchestration

- **In-SDK orchestration without a CLI in v1.** Keep surface lean. Users invoke from any TS script (Langfuse pattern).
- Add runner in v2 only if watch-mode / web-playground-hosted-eval ergonomics become real ask.

### D10. Initialization model

- **Langfuse split**: tracing setup via `registerAgentaTracing()` or `AgentaSpanProcessor` registered with user's `NodeSDK`; REST client via `ag.init({apiKey})` (already in place).
- Don't conflate.
- Ship `setAgentaTracerProvider(provider)` escape hatch for `@vercel/otel`-isolated providers.

### D11. Env var design

- **Namespace separately** — `AGENTA_SPAN_FLUSH_AT` vs `AGENTA_SCORE_FLUSH_AT`, not a single `AGENTA_FLUSH_AT` controlling both (Langfuse's footgun).
- Mirror Braintrust's debug knobs: `AGENTA_DEBUG`, `AGENTA_FAILED_PUBLISH_PAYLOADS_DIR`, `AGENTA_QUEUE_DROP_EXCEEDING_MAXSIZE`.

### D12. Mask function

- **Per-attribute, async-aware `mask({ data })` function** in processor config (Langfuse pattern, `span-processor.ts:444-462`).
- Six attribute slots: input/output/metadata × trace/observation.
- On mask throw → sentinel value, not crash.
- Apply mask BEFORE media extraction.

### D13. Prompt cache

- **Adopt Langfuse's stale-while-revalidate pattern** (`promptManager.ts:316-412`).
- Default 60s TTL, configurable.
- Consider Braintrust's optional disk-cache layer for offline evals.

### D14. SDK headers

- Ship `X-Agenta-Sdk-Name`, `X-Agenta-Sdk-Version`, `X-Agenta-Project-Key` on every request (Langfuse pattern, `core/src/api/Client.ts:39-44`).
- Useful for server-side per-SDK observability.

### D15. Error handling philosophy

- **Silent fail on instrumentation paths.** Both competitors converge. Match.
- Use debug logger gated on `AGENTA_DEBUG=1`.

### D16. `engines` and `sideEffects`

- **Declare both.** `engines.node >= 18` (or whatever we support), `sideEffects: false`.
- Braintrust's "target via conditional exports only" is leakier than Langfuse's `engines` declaration.

### D17. Migration story for existing users

- Agenta has a published `examples/node/observability-vercel-ai/` using v4 AI SDK + raw OTel. The TS SDK rebuild must not silently break it.
- **Ship migration guide in-repo** (`docs/migration/sdk-v1-to-v2.md`) alongside CHANGELOG — Langfuse's web-only migration guide hurts contributors.
- Preserve method-name aliases for at least one minor version (Langfuse's compat shim).

---

## 10. Opportunities to differentiate (ranked by leverage)

1. **AI SDK v6 streamText + abort flush correctness.** Source confirms neither competitor has solved this — Langfuse issue #12643 OPEN, Braintrust has no abort handling in `wrappers/ai-sdk/`. If agenta ships a span processor that flushes correctly on stream abort across all four App Router / Pages Router × raw OTel / `@vercel/otel` combinations, that's the headline.
2. **Edge runtime tracing that actually works.** Langfuse: not supported. Braintrust: proprietary wire works on edge, but OTLP-on-edge for OTel users remains messy. Spike already established the four pain modes (P-APP-RAW-01, P-APP-VERCEL-02, P-PAGES-RAW-01, P-PAGES-VERCEL-01).
3. **TanStack Start documentation + helper.** Neither competitor documents it. Spike captured P-TANSTACK-01/02/03. Lowest-effort win — write the docs and ship a `register()` helper that throws if called too late.
4. **One consolidated migration, not three.** Langfuse's three breaking-change releases in nine months is a real cautionary tale (though softer than commonly portrayed — 16 method-name aliases preserved). Land the new SDK once.
5. **`asyncFlush` per-call typed boolean.** Braintrust pattern, lift directly. Cleaner than Langfuse's "switch processor mode globally."
6. **Stale-while-revalidate prompt cache + optional disk layer.** Langfuse's pattern + Braintrust's disk-cache idea combined. Production-grade DX.

---

## 11. Open questions for the RFC

- Do we need a dedicated `agenta eval`-style CLI runner, or is "call from any TS script" enough for v1?
- Should the `ag.tracing` API expose all 10 observation subtypes as labels (Langfuse) or trim to a smaller core?
- Where do scores live? REST (Langfuse split) or OTel attributes (forced unification)?
- Do we ship bundler plugins (Braintrust pattern) or rely on framework-native instrumentation hooks (Next.js `instrumentation.ts`, TanStack Start `src/server.ts`)?
- Browser support: AsyncLocalStorage polyfill (Braintrust pattern) or punt browser tracing entirely?
- Do we adopt `diagnostics_channel.tracingChannel` (Braintrust) as the instrumentation seam, or stick with straight OTel `SpanProcessor` + Proxy wrappers (Langfuse)?

---

## Appendix A: v1 → v2 corrections summary

v1 of this doc (web research synthesis) made 18+ claims that source audit corrected:

### Braintrust corrections

| Wrong (v1) | Correct (source) | Citation |
|---|---|---|
| Span types: 6 values | 11 values incl. `automation`, `facet`, `preprocessor`, `classifier`, `review` | `js/util/span_types.ts:1-13` |
| Wire endpoint: `/logs` | `logs3` | `js/src/logger.ts:3231-3236` |
| Log upload batch size: 1000 | 100 (the 1000 was `ObjectFetcher` reads) | `logger.ts:2788` |
| `BRAINTRUST_PARENT` env var: core SDK | Only `@braintrust/otel` reads it | `integrations/otel-js/src/otel.ts:280` |
| `dotenv` auto-loaded at runtime | CLI-only | `js/src/cli/index.ts:4` |
| CLI binary: `bt eval` | `npx braintrust eval` | `js/package.json:20-22` |
| `wrapTraced` "solves AI SDK v6 abort via generator detection" | Only handles declared `function*`/`async function*`. AI SDK goes through `diagnostics_channel`. Zero abort handling. | `logger.ts:5422-5499`; `wrappers/ai-sdk/ai-sdk.ts:410` |
| `BraintrustExporter` is a separate exporter | Wraps `BraintrustSpanProcessor`; HTTP layer is upstream `OTLPTraceExporter` | `integrations/otel-js/src/otel.ts:637-691` |
| `filterAISpans` is default-on | Default-off; opt-in via `options.filterAISpans === true` | `integrations/otel-js/src/otel.ts:307-316` |
| `traceable` alias at logger.ts:5503-5506 | Actually at logger.ts:5506 | `js/src/logger.ts:5506` |
| `engines` and `sideEffects` declared | Neither declared anywhere | grep of all package.json |

### Langfuse corrections

| Wrong (v1) | Correct (source) | Citation |
|---|---|---|
| `@langfuse/tracing` runtime: Universal | Node ≥ 20 declared | `packages/tracing/package.json:11-13` |
| `LANGFUSE_BASEURL` removed in v4 | Still read as legacy fallback | `packages/core/src/utils.ts:1-12` |
| "10 typed observation subtypes" | 10 type labels, 2 attribute shapes (span-like, generation-like) | `packages/tracing/src/types.ts:99-109` |
| "Three breaking releases" framing | Softer in reality — 16 method-name aliases preserved in `LangfuseClient` | `packages/client/src/LangfuseClient.ts:170-232` |
| Default batching: Langfuse-specific | Upstream OTel defaults unless env vars set | `packages/otel/src/span-processor.ts:273-277` |
| `getTraceUrl()` async unexplained | Async because project-id lookup requires server round-trip | `LangfuseClient.ts:369-380` |
| One env var per concern | `LANGFUSE_FLUSH_AT`/`_INTERVAL` control BOTH span batching AND score queue | `span-processor.ts:247-249`, `score/index.ts:43-49` |

---

## Appendix B: source links

**Braintrust**
- Repo: [github.com/braintrustdata/braintrust-sdk-javascript](https://github.com/braintrustdata/braintrust-sdk-javascript) (audited at npm v3.10.0)
- npm: [`braintrust`](https://www.npmjs.com/package/braintrust)
- Key files audited:
  - `js/package.json` (exports, deps)
  - `js/src/logger.ts` (5500+ lines: state, queue, span lifecycle, `wrapTraced`, `traceable`)
  - `js/src/exports.ts` (re-export sheet)
  - `js/src/wrappers/ai-sdk/ai-sdk.ts` (AI SDK wrap via dc)
  - `js/src/wrappers/oai.ts` (OpenAI wrap via Proxy + dc)
  - `js/src/cli/index.ts` (CLI commands incl. `--dev` mode)
  - `js/src/framework.ts` (`Eval` implementation)
  - `js/src/runtime-async-local-storage.ts` (runtime detection)
  - `js/src/auto-instrumentations/hook.mts` (Node `--import` hook)
  - `js/src/edge-light/config.ts`, `js/src/workerd/config.ts`
  - `js/util/span_types.ts` (11 span types)
  - `integrations/otel-js/src/otel.ts` (`BraintrustSpanProcessor`, `BraintrustExporter`)
  - `integrations/otel-js/src/index.ts` (`setupOtelCompat`)
  - `integrations/browser-js/src/index.ts` (5-line re-export)
  - `integrations/vercel-ai-sdk/src/adapter.ts` (legacy AIStream, pinned to ai@3)
- Docs: [braintrust.dev/docs](https://www.braintrust.dev/docs/reference/libs/nodejs)

**Langfuse**
- Repo: [github.com/langfuse/langfuse-js](https://github.com/langfuse/langfuse-js) (audited at v5.3.0)
- npm: [`@langfuse/tracing`](https://www.npmjs.com/package/@langfuse/tracing), [`@langfuse/otel`](https://www.npmjs.com/package/@langfuse/otel), [`@langfuse/client`](https://www.npmjs.com/package/@langfuse/client), [`@langfuse/openai`](https://www.npmjs.com/package/@langfuse/openai), [`@langfuse/langchain`](https://www.npmjs.com/package/@langfuse/langchain), [`@langfuse/core`](https://www.npmjs.com/package/@langfuse/core)
- Key files audited:
  - All six packages' `package.json` (engines, peerDeps, exports)
  - `packages/tracing/src/index.ts` (`startObservation`, `startActiveObservation`, `observe`, `createTraceId`)
  - `packages/tracing/src/types.ts` (10 observation types)
  - `packages/tracing/src/spanWrapper.ts` (`LangfuseSpan`, `LangfuseGeneration`, `LangfuseEvent`)
  - `packages/tracing/src/tracerProvider.ts` (`setLangfuseTracerProvider`, isolation warning)
  - `packages/otel/src/span-processor.ts` (Batch/Simple switch, mask, media)
  - `packages/otel/src/span-filter.ts` (`isDefaultExportSpan`)
  - `packages/otel/src/MediaService.ts` (base64 regex, ai-prompt special case)
  - `packages/client/src/LangfuseClient.ts` (managers, deprecated aliases, `getTraceUrl`)
  - `packages/client/src/score/index.ts` (queue, fire-and-forget)
  - `packages/client/src/prompt/promptManager.ts` (stale-while-revalidate)
  - `packages/core/src/propagation.ts` (`propagateAttributes`, baggage)
  - `packages/core/src/constants.ts` (`LangfuseOtelSpanAttributes` enum)
  - `packages/core/src/api/Client.ts` (Fern-generated, 27 sub-resources)
  - `packages/openai/src/observeOpenAI.ts` (recursive Proxy)
  - `packages/openai/src/traceMethod.ts` (`wrapAsyncIterable` — the abort gap)
  - `packages/langchain/src/CallbackHandler.ts`
  - `tests/e2e/vercel-ai-sdk.e2e.test.ts` (manual `forceFlush()` confirming the abort gap)
- Docs: [langfuse.com/docs/observability/sdk/typescript](https://langfuse.com/docs/observability/sdk/typescript/instrumentation)
- AI SDK v6 IO bug: [github.com/langfuse/langfuse/issues/12643](https://github.com/langfuse/langfuse/issues/12643) (verified OPEN, assigned hassiebp, created 2026-03-17)

**Agenta context**
- [`docs/design/ts-sdk-tracing/summary.md`](../ts-sdk-tracing/summary.md) — spike status, 11 pain entries
- [`docs/design/ts-sdk-tracing/pain-log.md`](../ts-sdk-tracing/pain-log.md) — full pain entries
- [`web/packages/agenta-sdk/src/index.ts`](../../../web/packages/agenta-sdk/src/index.ts) — current SDK entry

---

[^bt-logs3]: `js/src/logger.ts:3231-3236` POST target `"logs3"`; overflow at `:3159` `"logs3/overflow"`.
[^lf-otlp]: `packages/otel/src/span-processor.ts:14, 258` — OTLPTraceExporter at `${baseUrl}/api/public/otel/v1/traces`.
[^lf-otel-span]: `packages/tracing/src/spanWrapper.ts:142-163` — `public readonly otelSpan: Span`.
[^lf-pkg]: `ls packages/` returns six dirs; each `package.json:2` confirms name.
[^bt-exports]: `js/package.json:25-37` — root export has `edge-light`, `workerd`, `node`, `browser` conditions.
[^lf-engines]: `packages/otel/package.json:11-13` — `"engines": { "node": ">=20" }`.
[^lf-types]: `packages/tracing/src/types.ts:12-22` — `LangfuseObservationType` exact list.
[^bt-spantypes]: `js/util/span_types.ts:1-13` — `spanTypeAttributeValues` array.
[^lf-attrs]: `packages/tracing/src/types.ts:69-97, 99-109` — generation has rich shape; others are type aliases of span-attrs.
[^bt-noabort]: grep `abort|AbortSignal|signal` in `js/src/wrappers/ai-sdk/` returns zero hits; stream handling via `diagnostics_channel` at `ai-sdk.ts:410`.
[^lf-noabort]: `packages/openai/src/traceMethod.ts:186-262` `wrapAsyncIterable` ends generation only on loop completion; `tests/e2e/vercel-ai-sdk.e2e.test.ts:275` uses manual `forceFlush()`.
[^bt-cli]: `js/package.json:20-22` `"bin": { "braintrust": "./dist/cli.js" }`; subcommands at `cli/index.ts:1069-1190`.
[^bt-wrappers]: `js/src/exports.ts:166-199` exports all wrappers; implementations in `js/src/wrappers/`.
[^lf-noaisdk]: `find packages -name "*.ts" -name "*vercel*"` returns nothing; e2e tests use `experimental_telemetry` directly.
[^bt-autoinstrument]: `js/src/auto-instrumentations/hook.mts:38-46, 101-104`; bundler plugins in `js/src/auto-instrumentations/bundler/*.ts`.
