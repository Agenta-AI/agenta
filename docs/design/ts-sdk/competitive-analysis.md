# Competitive Analysis: Braintrust vs Langfuse TS SDKs

> **Purpose.** Input for the agenta TS SDK RFC. Studies the two closest competitors that ship TypeScript SDKs covering tracing + evals + prompts on the same surface area we're rebuilding. Findings are framed against the `ts-sdk-tracing` spike's 11 pain entries (App Router raw/vercel-otel, Pages Router raw/vercel-otel, TanStack Start, AI SDK v6 streaming + abort, edge runtime).

**Sources.**
- Braintrust: `braintrust` v3.10.0 (npm), `braintrustdata/braintrust-sdk-javascript`, braintrust.dev docs.
- Langfuse: `@langfuse/*` v5.3.0 (npm), `langfuse/langfuse-js` monorepo, langfuse.com docs, GitHub issue [#12643](https://github.com/langfuse/langfuse/issues/12643).
- Research conducted 2026-05-11.

---

## 0. TL;DR

| | **Braintrust** | **Langfuse v4/v5** | **Agenta (today + planned)** |
|---|---|---|---|
| Wire | Proprietary REST `/logs` batch, OTel as opt-in interop | OTLP/HTTP for spans, REST for everything else | OTLP/HTTP (decided) |
| Package shape | One monolith + thin per-integration packages | Six scoped packages (`@langfuse/{core,client,tracing,otel,openai,langchain}`) | Currently one (`@agenta/sdk`); decomposition TBD |
| Tracing API | `wrapTraced` HOF (with `traceable` alias for LangSmith refugees), `traced` callback, imperative `startSpan` | `observe` HOF, `startActiveObservation` (context), `startObservation` (manual), 10 typed observation subtypes | TBD — currently raw OTel + AI SDK v6 `experimental_telemetry` only |
| Edge runtime | Dedicated `workerd.mjs` + `edge-light.mjs` conditional exports | **Not supported.** `@langfuse/otel` requires Node ≥ 20 | Spike pain captured (P-APP-RAW-01, P-APP-VERCEL-02, P-PAGES-RAW-01) — open question |
| AI SDK v6 streaming abort | Generator-aware `wrapTraced` handles sync/async generators natively; `asyncFlush: false` per-call for serverless | **Unresolved** — issue #12643 open, root-span IO loss; recommendation is `exportMode: "immediate"` (SimpleSpanProcessor) | This is the spike's central finding (P-NODE-02, P-APP-VERCEL-01) — strongest differentiation opportunity |
| Eval orchestration | In-SDK (`Eval(...)`) + CLI runner (`bt eval foo.eval.ts`) | In-SDK (`ExperimentManager`), no dedicated runner | Server-side today |
| Prompt registry | `loadPrompt({slug, defaults}).build({var})` | `langfuse.prompt.get("name", {version})` | In API |
| Provider wrappers | `wrapOpenAI`, `wrapAnthropic`, `wrapAISDK`, `wrapGoogleGenAI`, `wrapMistral`, `wrapCohere`, `wrapClaudeAgentSDK` | `observeOpenAI`, `@langfuse/langchain` callback handler; Vercel AI SDK = pure OTel pass-through | None today; AI SDK v6 via OTel emit only |
| Auto-instrument | Node `--import` hook + Vite/Webpack/esbuild/Rollup plugins | None (OTel ecosystem instrumentations only) | None |

**Headline.** Braintrust ships its own bus; Langfuse rides OTel. Both ship eval orchestration in-SDK. Both have provider wrappers. Both have a gap on AI SDK v6 streaming abort, but Braintrust's generator-aware design is closer to a real solution than Langfuse's "switch to SimpleSpanProcessor" guidance. **Neither solves edge runtime tracing cleanly** — Braintrust ships per-runtime bundles but the wire is still proprietary; Langfuse is Node-only for tracing.

---

## 1. Package layout & install surface

### Braintrust — monolith + thin satellites

One primary npm package (`braintrust`) carries the full surface: logging, tracing, evals, CLI, provider wrappers. Thin satellite packages:

- `@braintrust/browser` — browser build with AsyncLocalStorage polyfill
- `@braintrust/otel` — `BraintrustSpanProcessor` + exporter for OTel users
- `@braintrust/vercel-ai-sdk` — AI SDK middleware (at v0.0.5; docs steer users to OTel instead)
- `@braintrust/openai-agents`, `@braintrust/langchain-js`, `@braintrust/temporal`

The big tell is `exports`:

```json
"exports": {
  ".": {
    "edge-light": "./dist/edge-light.mjs",
    "workerd": "./dist/workerd.mjs",
    "node": { "import": "./dist/index.mjs", "require": "./dist/index.js" },
    "browser": "./dist/browser.mjs"
  },
  "./hook.mjs": "./dist/auto-instrumentations/hook.mjs",
  "./vite": { ... }, "./webpack": { ... }, "./esbuild": { ... }, "./rollup": { ... }
}
```

Dedicated `workerd`, `edge-light`, `node`, `browser` conditional builds. Four bundler-plugin subpaths. A Node `--import` hook at `braintrust/hook.mjs`. The dependency surface is heavy — `express`, `cors`, `simple-git`, `esbuild`, `dotenv`, `boxen`, `chalk`, `cli-table3` are bundled because the CLI lives in the same package.

Types: hand-written TS with generated OpenAPI types alongside; sibling Stainless-generated REST client lives in a separate repo (`braintrust-api-js`).

### Langfuse — six scoped packages, one each

| Package | Purpose | Runtime |
|---|---|---|
| `@langfuse/core` | Shared utilities, generated REST client | Universal |
| `@langfuse/client` | REST: prompts, datasets, scores, media, experiments | Universal |
| `@langfuse/tracing` | OTel-based tracing functions + Langfuse span wrappers | Universal |
| `@langfuse/otel` | `LangfuseSpanProcessor` over Batch/Simple OTel processors | **Node ≥ 20** |
| `@langfuse/openai` | OpenAI Proxy wrapper | Universal |
| `@langfuse/langchain` | LangChain `CallbackHandler` | Universal |

Canonical install:

```bash
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

Legacy `langfuse` / `langfuse-node` are frozen-v3 for Node < 18. No subpath exports — each capability is its own package. Dual CJS + ESM builds, `sideEffects: false`, built with `tsup`.

### Implication for agenta

Both demonstrate that a single monolith doesn't survive once you have (a) tracing-only users, (b) prompt-only users, (c) eval users. **The decomposition pays for itself in DX** (you can install only what you need) at the cost of more packages to release in lock-step.

The Langfuse split is cleaner and closer to where agenta is heading — tracing concerns are separated from REST CRUD concerns. Braintrust's bundle bloat from `express`/`esbuild`/`chalk` in the core package is a cautionary tale: keep the CLI out of the runtime install.

**Runtime-conditional bundles (Braintrust's `workerd` / `edge-light` exports) are the right shape for our spike findings.** Worth lifting into the agenta SDK regardless of how we split packages, because we know the spike already needs different code paths for App Router edge vs Pages Router edge vs Node.

---

## 2. Initialization & auth

### Braintrust — three init modes, not one client

There is no single client. Init is mode-specific:

```ts
import { init, initLogger, initDataset } from "braintrust";

const experiment = await init({ project: "my-project", experiment: "my-exp" }); // eval mode
const logger    = await initLogger({ projectName: "my-project" });               // prod tracing
const dataset   = await initDataset({ project: "my-project", dataset: "my-ds" }); // test data
```

Behind the scenes: process-global `BraintrustState` + AsyncLocalStorage. `currentLogger()`, `currentExperiment()`, `currentSpan()` resolve from it. `_internalGetGlobalState` / `_internalSetInitialState` are exported as escape hatches.

Env: `BRAINTRUST_API_KEY`, `BRAINTRUST_API_URL` (default `https://api.braintrust.dev`, EU `api-eu.braintrust.dev`), `BRAINTRUST_PARENT` (e.g. `project_name:my-project`). `dotenv` is bundled.

### Langfuse — explicit, no globals

Two separate concerns: tracing setup once at the entry, client construction per-use.

```ts
// instrumentation.ts (once)
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

export const sdk = new NodeSDK({
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

No singleton, no `init()`. Multi-project = register multiple `LangfuseSpanProcessor`s.

Env: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (renamed from `LANGFUSE_BASEURL` in v4 — migration tax), `LANGFUSE_FLUSH_AT`, `LANGFUSE_FLUSH_INTERVAL`.

### Comparison

| | Braintrust | Langfuse |
|---|---|---|
| Singleton | Yes (`BraintrustState` + AsyncLocalStorage) | No (explicit `new`) |
| Init modes | 3 (`init`/`initLogger`/`initDataset`) | 2 (NodeSDK for tracing, `LangfuseClient` for REST) |
| Multi-project | Switch `BRAINTRUST_PARENT` | Register N processors |
| `dotenv` auto-load | Yes | No |

### Implication for agenta

Agenta already has `init()` + `getAgentaSdkClient()` (singleton) in `web/packages/agenta-sdk/src/index.ts:74`. The question for the RFC is **whether tracing setup should be a separate concern from REST client construction.**

Langfuse's split (NodeSDK at boot + `LangfuseClient` everywhere else) is the right shape for OTel-native — it admits that tracing has a process lifecycle and REST does not. Braintrust's three init modes are an artifact of their non-OTel bus where everything runs through the same bg queue.

**Recommended RFC stance:** keep `init()` for the REST surface (already in place), introduce a separate `registerAgentaTracing()` or `AgentaSpanProcessor` for tracing setup. Don't conflate the two — it's a class of footguns Langfuse explicitly avoided.

---

## 3. Tracing API surface

### Braintrust — three primitives, all in the main entry

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

`wrapTraced` is aliased as `traceable` — explicit nod to LangSmith refugees. It detects sync, async, sync-generator, async-generator functions natively. The provider wrappers (`wrapOpenAI`, `wrapAISDK`) intercept stream iterators and concatenate deltas. **This is the only competitor solution I found that handles streaming as a first-class concern at the function-wrapper layer.**

Span types: `eval | task | llm | function | tool | score`.

Parent-child propagation: AsyncLocalStorage with runtime detection. `startSpan` deliberately does NOT push onto the context; only `traced`/`wrapTraced` do. OTel interop is bidirectional via `getIdGenerator()` + `getContextManager()` so an existing `NodeSDK` can share Braintrust's span IDs.

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
  span.update({ input: { query: "Capital of France?" } });
  const gen = startObservation("llm-call", { model: "gpt-4", input: [...] }, { asType: "generation" });
  gen.update({ output: { content: "Paris." } }).end();
});

// (c) observe — HOF wrapper
const tracedFetch = observe(fetchData, { name: "fetch-data", asType: "span" });
```

Ten typed observation subtypes (richer than OTel's `gen_ai.*`):

```ts
export type LangfuseObservationType =
  | "span" | "generation" | "event" | "embedding"
  | "agent" | "tool" | "chain"
  | "retriever" | "evaluator" | "guardrail";
```

`LangfuseSpan`, `LangfuseGeneration`, `LangfuseAgent`, etc. wrappers expose `.update()`, `.end()`, `.startObservation()` (children), `.setTraceIO()`. **Each wraps a vanilla OTel span underneath** — third-party processors keep working.

Streaming: `endOnExit: false` on `StartActiveObservationContext` keeps the observation open across async stream consumption. Then call `.end()` manually after the stream completes. This is the documented pattern; the bug is whether you remember to call it.

Distributed tracing: `createTraceId("ticket-54321")` produces deterministic IDs; `parentSpanContext` accepts external trace IDs.

### Comparison

| | Braintrust | Langfuse |
|---|---|---|
| Underlying span impl | Custom + OTel interop | OTel `Span` directly |
| Function wrapper | `wrapTraced` (+ `traceable` alias) | `observe` |
| Context-pushing | `traced`/`wrapTraced` push; `startSpan` doesn't | `startActiveObservation` pushes; `startObservation` doesn't |
| Span types | 6 (`eval`/`task`/`llm`/`function`/`tool`/`score`) | 10 (incl. `agent`/`retriever`/`guardrail`) |
| Streaming | Native generator detection in `wrapTraced` | `endOnExit: false` opt-out + manual `.end()` |
| Distributed trace | Span slugs (`BRAINTRUST_PARENT` env), `permalink()` | `createTraceId(seed)`, `parentSpanContext` |

### Implication for agenta

Three competing surface designs to consider:

1. **Braintrust's `wrapTraced` is the most ergonomic single API** — handles sync, async, generators all at once. The `traceable` alias is a smart product move for migration.
2. **Langfuse's 10 typed observation subtypes are a richer semantic model** than OTel's `gen_ai.*` baseline. Worth borrowing in part (agenta already maps to `ag.{data,meta,metrics,type,user,session}` — pre-existing decision).
3. **OTel-span-underneath is the right base.** Both Langfuse and Braintrust's OTel-mode reach the same answer: the span is an OTel span; the SDK is a wrapper that adds typed setters. Agenta's spike is already OTLP on the wire, so this is consistent.

**RFC recommendation:** ship the equivalent of Braintrust's `wrapTraced` (generator-aware) on top of OTel spans, with typed observation subtypes borrowed from Langfuse's taxonomy. Provide both `wrap*` and `startActive*` variants for users who need imperative control.

---

## 4. AI provider integrations

### Braintrust — broad first-class roster

```ts
import { wrapOpenAI, wrapAnthropic, wrapAISDK, wrapGoogleGenAI,
         wrapMistral, wrapCohere, wrapClaudeAgentSDK } from "braintrust";

const openai = wrapOpenAI(new OpenAI());
const ai = wrapAISDK(require("ai"));
```

All in the main package (despite OpenAI being a devDep). They capture tool calls, multi-turn messages, embeddings, token usage. Auto-instrumentation via three layers:

1. Manual `wrapX(client)` — explicit.
2. Bundler plugins: `braintrust/vite`, `/webpack`, `/esbuild`, `/rollup`.
3. Node `--import` hook: `node --import braintrust/hook.mjs app.js`.

**For Vercel AI SDK, the docs explicitly steer users away from `wrapAISDK` and toward OTel-mode setup** — register `BraintrustExporter` via `@vercel/otel` and set `experimental_telemetry: { isEnabled: true }`. That's the recommended Next.js path.

### Langfuse — focused, with one big OTel pass-through bet

- **OpenAI**: `observeOpenAI(new OpenAI())` — implemented as `new Proxy(sdk, { get(...) })` recursively. Captures streaming + non-streaming. Optional 2nd arg accepts `traceName`, `userId`, `sessionId`, `tags`, `generationName`, `langfusePrompt`.
- **LangChain**: `@langfuse/langchain` ships `CallbackHandler`.
- **Vercel AI SDK**: **no wrapper at all**. You install `@langfuse/otel`, register the span processor, set `experimental_telemetry: { isEnabled: true }`. The processor's default filter (`isDefaultExportSpan`) recognizes `gen_ai.*` attributes.

The big known issue here is **GitHub issue #12643** (opened 2026-03-17, still open as of 2026-05-11): AI SDK v6 + Langfuse v5 produces empty root-span IO even when child observations have it. Both `generateText` and `streamText` affected. The standard workarounds (custom filtering off, manual root IO set, `startActiveObservation` wrap) don't fix it. **Langfuse has not solved AI SDK v6 streaming integration.**

### Comparison

| | Braintrust | Langfuse |
|---|---|---|
| OpenAI | `wrapOpenAI` (manual proxy) | `observeOpenAI` (manual proxy) |
| Anthropic | `wrapAnthropic` | (none — must go through OTel) |
| Vercel AI SDK | `wrapAISDK` (deprioritized) → OTel-mode recommended | OTel-mode only |
| LangChain | `@braintrust/langchain-js` | `@langfuse/langchain` |
| Google GenAI | `wrapGoogleGenAI` | (none) |
| Auto-instrument | `--import` hook + 4 bundler plugins | None |
| AI SDK v6 streaming | Generator-aware wrap; OTel mode works via `@vercel/otel` | Open bug, no clean fix |

### Implication for agenta

Two clear takeaways:

1. **Vercel AI SDK integration via `experimental_telemetry` + OTel is now the industry-default story for Next.js.** Both competitors converge on this. Agenta's spike is already in this lane.
2. **AI SDK v6 streamText + Batch processor is the universal pain point.** The spike captured it as P-NODE-02 + P-APP-VERCEL-01. Langfuse hasn't solved it (issue #12643). Braintrust's generator-aware `wrapTraced` is the only design I found that addresses it structurally rather than via a "use SimpleSpanProcessor" workaround. **This is the strongest differentiation opportunity for the agenta TS SDK** — ship a span processor that correctly handles AI SDK v6 stream abort signals out of the box.

For the broader integration roster, Braintrust's bet is "broad first-class wrappers + auto-instrumentation"; Langfuse's bet is "OTel is the integration layer, we just consume it." Agenta should pick a lane:

- **OTel-only** is the lower-effort, higher-leverage path (Langfuse's bet). Wins on any framework that emits `gen_ai.*`.
- **First-class wrappers** are nicer DX but require maintaining N proxy adapters as provider SDKs change.

Recommendation: OTel-only as the v1 default, add per-provider wrappers in v2 only if measured DX gap justifies them.

---

## 5. Evals, datasets, prompts

### Braintrust

Eval = a function in the SDK, run via a dedicated CLI runner.

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

Run with `bt eval tutorial.eval.ts` (or `--watch`). The CLI uses esbuild to transpile, auto-loads `.env`, discovers `*.eval.ts` files. Scorers ship in a separate `autoevals` package (Levenshtein, Factuality, ClosedQA, BattleScorer, etc.).

Datasets: `initDataset()` → typed `Dataset` with `insert/update/delete/fetch/summarize`. Prompts: `loadPrompt({ projectName, slug, defaults })` → versioned `Prompt` with `.build({ var })`.

### Langfuse

`LangfuseClient` has five managers: `prompt`, `dataset`, `score`, `media`, `experiment`.

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

Scoring runs through a separate async queue (max 100k items, batches of 100, flush threshold via env). Experiments orchestrate dataset iteration + task tracing + evaluator scoring **in the SDK** — no separate CLI.

### Comparison

| | Braintrust | Langfuse |
|---|---|---|
| Eval orchestration | In-SDK via `Eval(...)` | In-SDK via `ExperimentManager` |
| Eval runner | Dedicated CLI (`bt eval`) | None — call from any TS script |
| Scorers | Separate `autoevals` package | AutoEvals integration documented |
| Prompt versioning | `loadPrompt({slug, defaults})` + `.build({var})` | `prompt.get("name", {version})` |
| Dataset CRUD | `initDataset(...).insert/update/delete/fetch` | `langfuse.dataset.*` |
| Wire | All over proprietary REST | Scores/prompts/datasets over REST; spans over OTLP |

### Implication for agenta

Both ship eval orchestration in-SDK. This is now table stakes — agenta should not punt evals to a server-only API surface. The question is **whether to ship a dedicated runner (Braintrust's `bt eval`) or let users invoke from any script (Langfuse's pattern).**

Braintrust's CLI gives them one surface for transpilation, env loading, watch mode, and result rendering. The cost is owning a runner. Langfuse's approach is simpler — no CLI to ship — but loses the watch/permalink ergonomics.

**Two transports under one product (Langfuse's split) is the right pragmatic call**: spans over OTLP, everything else over REST. Agenta already has the REST surface via Fern; the OTLP layer is what `ts-sdk-tracing` is building. Don't try to make scores ride OTel attributes — both competitors learned not to.

---

## 6. Export model & edge runtime

This is the section that maps most directly to the spike's pain log.

### Braintrust — proprietary batched queue + OTel as opt-in

- **Wire**: proprietary REST `/logs` batch endpoint. Bg queue worker (`queue.ts`) with `DEFAULT_FETCH_BATCH_SIZE` and `DEFAULT_MAX_REQUEST_SIZE` exported constants. Oversized payloads spill to S3 via `Logs3OverflowUpload`.
- **OTel mode**: `@braintrust/otel` ships `BraintrustSpanProcessor` + `BraintrustExporter` that POST to `https://api.braintrust.dev/otel/v1/traces` with header `x-bt-parent`. Filter by attribute prefix (`gen_ai.`, `braintrust.`, `llm.`, `ai.`, `traceloop.`) so dropping it into an existing tracer doesn't flood Braintrust with unrelated spans.
- **Flush semantics**: `asyncFlush: boolean` is a typed per-call arg on `traced`/`wrapTraced`. With `asyncFlush: true` (default), the wrapped function returns synchronously and flushing happens in the background. With `asyncFlush: false`, the wrapper returns a Promise resolving only after `span.flush()` completes. **Built for serverless without a separate "edge mode" API.**
- **Edge support**: dedicated `workerd.mjs` (Cloudflare Workers) and `edge-light.mjs` (Vercel Edge) conditional exports. `@braintrust/browser` adds an AsyncLocalStorage polyfill for browser.

### Langfuse — OTLP-native, Node-only for tracing

- **Wire**: OTLP/HTTP via `@opentelemetry/exporter-trace-otlp-http`. REST for scores/prompts/datasets.
- **Processor**: `LangfuseSpanProcessor` wraps either `BatchSpanProcessor` (default) or `SimpleSpanProcessor` based on `exportMode: "batched" | "immediate"`.
- **Flush semantics**: standard OTel `processor.forceFlush()` + `sdk.shutdown()`. Default Batch processor won't ship spans for an in-flight `streamText` aborted before `.end()` — this is the canonical AI SDK v6 + Langfuse problem. **Documented mitigation: `exportMode: "immediate"` for serverless.**
- **Edge support**: **none for tracing**. `@langfuse/otel` declares `engines.node >= 20`. `@vercel/otel` is explicitly recommended against ("lacks OpenTelemetry JS SDK v2 support"). Universal `@langfuse/client` works on edge for REST-only paths.

### Comparison vs the spike's pain log

| Spike pain | Braintrust | Langfuse | Agenta opportunity |
|---|---|---|---|
| P-NODE-02: `BatchSpanProcessor` + `streamText` loses spans on abort | Generator-aware `wrapTraced` flushes on stream completion; `asyncFlush: false` per-call | **Unresolved** (issue #12643 open). Workaround: `SimpleSpanProcessor` | Ship an `AgentaSpanProcessor` that listens to AI SDK v6 abort signals + flushes correctly |
| P-APP-RAW-01: edge runtime drops all spans (raw OTel) | Dedicated `edge-light.mjs` bundle, proprietary wire | Not supported | Same as Braintrust: ship per-runtime bundle + ensure OTLP exporter works on edge |
| P-APP-VERCEL-02: edge tracing works but ~10-15s delay (BatchSpanProcessor) | `asyncFlush: false` semantics map cleanly to edge handlers | Same as P-NODE-02 — recommend `"immediate"` | Default `"immediate"`-equivalent on edge runtimes |
| P-PAGES-RAW-01: Pages Router edge can't even BUILD raw OTel imports | `edge-light.mjs` ships an edge-safe bundle | Not supported | Ship a build that passes Next's static dynamic-code-eval check |
| P-PAGES-VERCEL-01: Pages Router + vercel-otel + pipeUIMessageStreamToResponse loses `ag.metrics.tokens` | (Untested with their stack) | (Untested — likely affected since they advise against `@vercel/otel`) | Verify against agenta wire; document in the SDK's compatibility matrix |
| P-TANSTACK-01: instrumentation seam is unenforced import order in `src/server.ts` | (Untested) | (Not addressed — no docs for TanStack Start) | Document; consider a `register()` helper that throws if called too late |

### Implication for agenta

**This is the most consequential section for the RFC.** Three concrete asks fall out:

1. **AgentaSpanProcessor must handle AI SDK v6 abort correctly out of the box.** Neither competitor does. Braintrust's generator-aware design is the closest model; Langfuse punts to "use Simple." Agenta should ship a processor that intercepts abort signals propagated through AI SDK v6 streams and flushes the in-flight span. This is the single highest-leverage piece of differentiation we can ship.
2. **Edge runtime needs a first-class story.** Per-runtime conditional exports (Braintrust's pattern) are the right shape — different code paths for `node`, `workerd`, `edge-light`, `browser`. Langfuse's "tracing is Node-only" stance is a giveaway opportunity.
3. **`asyncFlush: false` semantics are a clean ergonomic** — flipping a typed boolean changes return type from `F` to `Promise<F>`. Avoid the Langfuse-style "switch to a different processor mode globally" approach if possible.

---

## 7. Type safety & ergonomics

### Braintrust

- Generics-heavy. `init`, `initLogger`, `initDataset` carry phantom `IsOpen extends boolean = false` and `IsAsyncFlush extends boolean = true`. `wrapTraced` returns conditional types based on `IsAsyncFlush`.
- Zod is a hard peer dep (`^3.25.34 || ^4.0`); parallel test suites for v3 + v4.
- Flat namespace: `import * as braintrust from "braintrust"` gives you everything.
- Error handling: throws by default; instrumentation paths swallow errors silently via `debug-logger.ts` and `NOOP_SPAN` fallback. Philosophy: observability must never crash the host app.

### Langfuse

- Strict hand-written types for all observation attributes (`LangfuseGenerationAttributes` has typed `model`, `modelParameters`, `usageDetails`, `costDetails`, `prompt: { name, version, isFallback }`).
- Discoverability: namespace on `LangfuseClient` (`langfuse.prompt.*`, `langfuse.dataset.*`, `langfuse.score.*`); tracing functions are top-level imports.
- Error handling: silent fail by default. Queue silently drops on overflow (max 100k). HTTP failures logged but never throw into user code.
- `propagateAttributes(callback)` (v5) — attributes (userId/sessionId/tags/metadata) apply to every child observation in scope. Big v4 → v5 model shift: observation-centric, not trace-centric.

### Implication for agenta

Both converge on "silent fail by default for instrumentation paths" — this is correct and we should match. The host app must never crash because of tracing.

Langfuse's typed observation attributes (with `usageDetails`, `costDetails`, `prompt`) are richer than what `gen_ai.*` provides natively. Agenta's existing `ag.{data,meta,metrics,type,user,session}` taxonomy is in the same family.

**Naming question for the RFC:** does agenta want a discoverable namespace (`ag.tracing.*`, `ag.prompts.*`, `ag.evals.*`) or flat imports per concern (`@agenta/tracing`, `@agenta/client`, `@agenta/openai`)? The Langfuse split won here for DX. Don't try to do both.

---

## 8. Notable design opinions

### Braintrust

- **OTel is a peer, not the bus.** They ship their own bg logger, queue, span impl. OTel is offered as `SpanProcessor`/`Exporter` for users who already have a tracer.
- **Three layers of "auto":** manual wrap → bundler plugin → `node --import` hook. Each opt-in and documented.
- **One package, opinionated split.** Eval + tracing + CLI + prompts all in `braintrust`. Only browser, OTel, langchain, openai-agents, vercel-ai-sdk, temporal get separate packages.
- **Streaming via generator-aware wrappers.** Unusual — most SDKs reach for OTel context spans or AsyncIterator decoration.
- **`traceable` alias** for LangSmith refugees. A small but telling product move.
- **`asyncFlush` as a typed per-call arg.** Cleanly handles serverless without a separate "edge mode" API.

### Langfuse

- **OTel is the design.** Not "OTel-compatible" — OTel-native end-to-end. `LangfuseSpan` is a real OTel `Span`. Wire is OTLP/HTTP. Processor extends Batch/Simple.
- **Two transports, one product.** Spans over OTLP, REST for scores/prompts/datasets. They didn't try to force everything through OTel.
- **Ten typed observation subtypes** — pushes a richer semantic model than OTel's minimum.
- **Eval orchestration in-SDK.** `ExperimentManager` runs locally, traces each, batches scores.
- **Migration tax is real.** Three breaking-change releases in ~9 months (v3 → v4 → v5). Package name changes, env-var renames, API restructures. They recommend jumping v3 → v5 directly.
- **Node-only tracing.** Deliberate split — `@langfuse/otel` is Node ≥ 20; everything else is universal.

---

## 9. Decisions agenta needs to make for the RFC

Translating the comparison into explicit RFC decision points:

### D1. Wire protocol

- ✅ **Already decided: OTLP/HTTP.** Aligns with Langfuse v4/v5; Braintrust takes the opposite bet but their OTel-mode interop confirms OTLP is the cross-vendor lingua franca.
- Open: do scores/prompts/datasets also go OTLP, or REST? Langfuse splits (REST for non-tracing). **Recommend split** — don't force scores through OTel attributes.

### D2. Package decomposition

- Option A: monolith `@agenta/sdk` with subpath exports (`./tracing`, `./openai`, `./client`).
- Option B: Langfuse-style scoped packages (`@agenta/tracing`, `@agenta/otel`, `@agenta/client`, `@agenta/openai`).
- **Recommend B** — Langfuse's split paid for itself in DX. Costs more release coordination but each package has one job.

### D3. Tracing API surface shape

- Option A: Braintrust's `wrapTraced` HOF as the primary surface (generator-aware, async/sync detection).
- Option B: Langfuse's three-pattern menu (`startObservation` / `startActiveObservation` / `observe`).
- **Recommend a hybrid**: ship a generator-aware HOF (`ag.trace(fn)` or similar) as the primary, plus imperative `startSpan` / `startActiveSpan` for control cases. Borrow Langfuse's typed observation subtypes as a `type:` arg.

### D4. AI SDK v6 streaming abort handling

- This is the largest open differentiation opportunity. Neither competitor handles it well.
- **Recommend**: ship `AgentaSpanProcessor` that intercepts `AbortSignal` propagated through AI SDK v6 streams and flushes the in-flight span before the OTel processor would normally do so. Document this as the headline feature.

### D5. Edge runtime support

- Per-runtime conditional exports (Braintrust pattern): separate `node`, `workerd`, `edge-light`, `browser` builds.
- **Recommend**: ship per-runtime bundles from day one. Spike confirmed there's no single path that works everywhere.

### D6. Provider integration strategy

- Option A: Langfuse — OTel pass-through; only ship wrappers when OTel coverage is poor (OpenAI direct, LangChain).
- Option B: Braintrust — broad first-class wrappers + bundler plugins + Node hook.
- **Recommend A for v1.** OTel-only via `experimental_telemetry` for AI SDK v6. Add per-provider wrappers only when measured DX gap demands them.

### D7. Eval orchestration

- Both ship in-SDK. Difference is whether a dedicated CLI runner ships alongside (Braintrust: yes; Langfuse: no).
- **Recommend in-SDK orchestration without a CLI in v1.** Keep the surface lean. Users invoke from any TS script (Langfuse pattern). Add a runner in v2 only if watch-mode / permalink ergonomics become a real ask.

### D8. Initialization model

- **Recommend the Langfuse split**: tracing setup via `registerAgentaTracing()` or an `AgentaSpanProcessor` registered with the user's `NodeSDK` (or our own `register()` helper that wraps `NodeSDK`); REST client via `ag.init({apiKey})` (already in place). Don't conflate the two.

### D9. Error handling philosophy

- **Both competitors silent-fail on instrumentation paths.** Match this. Observability must never crash the host. Use a debug logger gated on an env var (`AGENTA_DEBUG=1` or similar) for diagnosis.

### D10. Migration story for existing users

- Agenta has a published `examples/node/observability-vercel-ai/` using v4 AI SDK + raw OTel. The TS SDK rebuild must not silently break it.
- Langfuse's three-breaking-releases-in-nine-months pattern is a cautionary tale — heavy migration tax cost them goodwill. **Plan one consolidated migration, not a sequence.**

---

## 10. Opportunities to differentiate

Ranked by leverage:

1. **AI SDK v6 streamText + abort flush correctness.** Neither competitor has solved this. Langfuse has an open bug (#12643). Braintrust's design is closest but their docs steer Vercel users to OTel-mode anyway, where the same problem reappears. If agenta ships a span processor that flushes correctly on stream abort across all four App Router / Pages Router × raw OTel / `@vercel/otel` combinations, that's the headline.
2. **Edge runtime tracing that actually works.** Langfuse: not supported. Braintrust: their proprietary wire works on edge, but pushing other users' OTel wire to edge is still a mess. Spike already established the four pain modes (P-APP-RAW-01, P-APP-VERCEL-02, P-PAGES-RAW-01, P-PAGES-VERCEL-01). Solving even two of those puts agenta ahead.
3. **TanStack Start documentation.** Neither competitor documents it. Spike captured P-TANSTACK-01/02/03. Lowest-effort win — write the docs and ship the helper that throws if instrumentation imports out of order.
4. **One consolidated migration, not three.** Langfuse's migration tax is real and people complain about it publicly. Land the new SDK once, with a clean compatibility shim for the published `observability-vercel-ai` example.
5. **`asyncFlush` as a typed per-call arg.** Braintrust pattern. Cleanly handles serverless without a separate "edge mode." Easy to lift.

---

## 11. Open questions for the RFC

- Do we need a dedicated `bt eval`-style CLI runner, or is "call from any TS script" enough for v1?
- Should the `ag.tracing` API expose observation subtypes (`agent`, `tool`, `retriever`, `guardrail`) or keep to a smaller core set (`llm`, `function`, `tool`, `eval`)?
- Where do scores live? REST (Langfuse split) or OTel attributes (forced unification)?
- Do we ship bundler plugins (Braintrust pattern) or rely on framework-native instrumentation hooks (Next.js `instrumentation.ts`, TanStack Start `src/server.ts`)?
- Browser support: do we ship an AsyncLocalStorage polyfill (Braintrust pattern) or punt browser tracing entirely?

---

## Appendix: Source links

**Braintrust**
- [`braintrust` on npm](https://www.npmjs.com/package/braintrust)
- [braintrust-sdk-javascript on GitHub](https://github.com/braintrustdata/braintrust-sdk-javascript)
- [TypeScript SDK reference](https://www.braintrust.dev/docs/reference/libs/nodejs)
- [OpenTelemetry integration docs](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)
- [Vercel AI SDK provider docs](https://ai-sdk.dev/providers/observability/braintrust)
- [`autoevals`](https://github.com/braintrustdata/autoevals)

**Langfuse**
- [langfuse-js monorepo](https://github.com/langfuse/langfuse-js)
- [v4 GA announcement (2025-08-28)](https://langfuse.com/changelog/2025-08-28-typescript-sdk-v4-ga)
- [v3 → v4 migration](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v3-to-v4)
- [v4 → v5 migration](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5)
- [TS instrumentation docs](https://langfuse.com/docs/observability/sdk/typescript/instrumentation)
- [Vercel AI SDK integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk)
- [AI SDK v6 IO bug (#12643)](https://github.com/langfuse/langfuse/issues/12643)

**Agenta context**
- [`docs/design/ts-sdk-tracing/summary.md`](../ts-sdk-tracing/summary.md) — spike status, 11 pain entries
- [`docs/design/ts-sdk-tracing/pain-log.md`](../ts-sdk-tracing/pain-log.md) — full pain entries
- [`web/packages/agenta-sdk/src/index.ts`](../../../web/packages/agenta-sdk/src/index.ts) — current SDK entry
