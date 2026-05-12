# Competitive Analysis: Braintrust vs Langfuse TS SDKs

> **Purpose.** Input for the agenta TS SDK RFC. Compares the two closest competitors that ship TypeScript SDKs covering the full surface area agenta is rebuilding — tracing, prompts, datasets, evals, scoring, media, annotations, sessions, plus the platform-glue (auth, multi-project, CLI, query). Findings are framed against the `ts-sdk-tracing` spike's 11 pain entries AND agenta's existing Python SDK managers (`AppManager`, `VariantManager`, `DeploymentManager`, `ConfigManager`, `SecretsManager`, `VaultManager`, `testsets`).
>
> **Methodology.** Four audit passes:
> - **v1** (2026-05-11): web research synthesis. Multiple wrong claims.
> - **v2** (2026-05-11): source-code audit of tracing + export surfaces, both repos cloned locally, file:line citations. Corrected ~18 v1 claims.
> - **v3** (2026-05-11): source audit of every NON-tracing surface — prompts, datasets, evals/experiments, scoring, media, annotations, sessions, functions, CLI, auth, configuration, cost tracking, query/read-back. File:line citations throughout.
> - **v4** (2026-05-12, this version): **empirical evidence** from the `ts-sdk-chore/example-apps` branch — eight spike apps fan IDENTICAL OTel span data out to Agenta + Braintrust + Langfuse in parallel via `SimpleSpanProcessor`s on a shared `NodeTracerProvider`. Real trace counts pulled via REST API. Two new pain entries discovered (P-BRAINTRUST-01 silent data-plane mismatch, P-LANGFUSE-01 no server-side scope filter). One v3 claim corrected.
>
> **Sources audited.**
> - Braintrust: `braintrust` v3.10.0 — [`github.com/braintrustdata/braintrust-sdk-javascript`](https://github.com/braintrustdata/braintrust-sdk-javascript). 193 ts files in `js/src/`, 8 satellite packages in `integrations/`. Core entrypoint: `js/src/exports.ts` (288 lines re-exporting from `logger.ts` (~8700 lines), `framework.ts`, `framework2.ts`).
> - Langfuse: `@langfuse/*` v5.3.0 — [`github.com/langfuse/langfuse-js`](https://github.com/langfuse/langfuse-js). Six scoped packages. Composition root: `packages/client/src/LangfuseClient.ts` mounts five named managers (`prompt`, `dataset`, `score`, `media`, `experiment`) + raw Fern-generated `api.*` (24 resource namespaces).
> - GitHub issue [#12643](https://github.com/langfuse/langfuse/issues/12643) — verified OPEN, body confirms AI SDK v6 abort failure mode.
> - **Empirical layer** (v4): companion doc [`docs/design/ts-sdk-tracing/sdk-comparison.md`](../ts-sdk-tracing/sdk-comparison.md) on branch `ts-sdk-chore/example-apps`. Tri-export wired across 8 spike apps. Trace counts verified via Agenta `POST /api/spans/query`, Braintrust `POST /v1/project_logs/<id>/fetch`, Langfuse `GET /api/public/traces`.
>
> **The vendor-SDK vs raw-OTLP distinction matters.** Most of the source-audit findings (§§3-13) describe behavior that runs INSIDE each vendor's SDK. The empirical layer wires raw `@opentelemetry/exporter-trace-otlp-proto` directly to each backend's OTLP endpoint — **bypassing all vendor SDK logic**. Many features documented below (Langfuse's `isDefaultExportSpan` scope filter, Braintrust's wrap-based attribute mapping, both `propagateAttributes`) only fire when the user installs the vendor SDK. The raw OTLP path is what agenta will ship — what we ourselves emit and what backends do with it on receipt.

---

## Table of contents

0. [TL;DR](#0-tldr)
0.5. [Empirical evidence: tri-export across 8 spike apps](#05-empirical-evidence-tri-export-across-8-spike-apps)
1. [Package layout & install surface](#1-package-layout--install-surface)
2. [Initialization & state model](#2-initialization--state-model)
3. [Tracing API surface](#3-tracing-api-surface)
4. [AI provider integrations](#4-ai-provider-integrations)
5. [Export model & edge runtime](#5-export-model--edge-runtime)
6. [Prompts](#6-prompts)
7. [Datasets & testsets](#7-datasets--testsets)
8. [Evals & experiments](#8-evals--experiments)
9. [Scoring & feedback](#9-scoring--feedback)
10. [Media & attachments](#10-media--attachments)
11. [Annotations & queues](#11-annotations--queues)
12. [Sessions, users, metadata propagation](#12-sessions-users-metadata-propagation)
13. [Functions, tools, server-side invoke](#13-functions-tools-server-side-invoke)
14. [CLI & developer workflow](#14-cli--developer-workflow)
15. [Auth, multi-project, orgs](#15-auth-multi-project-orgs)
16. [Configuration, secrets, deployments](#16-configuration-secrets-deployments)
17. [Cost tracking](#17-cost-tracking)
18. [Read-back & query surface](#18-read-back--query-surface)
19. [Type safety & ergonomics](#19-type-safety--ergonomics)
20. [Notable design opinions](#20-notable-design-opinions)
21. [RFC decisions for agenta](#21-rfc-decisions-for-agenta)
22. [Differentiation opportunities](#22-differentiation-opportunities-ranked-by-leverage)
23. [Open questions](#23-open-questions-for-the-rfc)
24. [Appendix A: v1 → v2/v3 corrections summary](#appendix-a-v1--v2v3-corrections-summary)
25. [Appendix B: source-link inventory](#appendix-b-source-link-inventory)

---

## 0. TL;DR

### Cross-surface matrix

| Surface | **Braintrust** | **Langfuse v4/v5** | **Agenta parity** |
|---|---|---|---|
| **Tracing API** | Custom span impl + AsyncLocalStorage; OTel as opt-in interop | OTel `Span` underneath every `LangfuseSpan` | OTLP-emit only today |
| **Wire (tracing)** | Proprietary REST `logs3` batch | OTLP/HTTP to `/api/public/otel/v1/traces` | OTLP/HTTP (decided) |
| **AI SDK v6 abort** | **Not solved.** Zero `AbortSignal` handling in source | **Not solved.** Issue #12643 OPEN | Strongest differentiation opportunity |
| **Edge runtime** | Per-runtime bundles (`node`/`edge-light`/`workerd`/`browser`) | **Not supported** for tracing (Node ≥ 20 only) | Spike-pain captured; open |
| **Prompts** | `loadPrompt({slug|id, version|environment})` returning `Prompt` with `.build()` that emits full LLM request shape | `langfuse.prompt.get(name, {version|label, type, fallback})` returning typed `TextPromptClient`/`ChatPromptClient` | Has prompt registry (server-side) |
| **Prompt cache** | LRU memory + gzipped disk at `~/.braintrust/prompt_cache`; fallback only on server error | Stale-while-revalidate, 60s TTL default; dedupe concurrent refresh | None in TS SDK today |
| **Templating** | Mustache via plugin registry; Nunjucks deferred to separate package | Mustache (hard dep `mustache@^4.2.0`) | Currently raw (no template) |
| **Datasets** | `initDataset(...)` → `Dataset extends ObjectFetcher`. Full CRUD + snapshots + restore | `langfuse.dataset.get(name)` returns `FetchedDataset` with `runExperiment()`. CRUD lives on `api.datasets.*` | Has testsets in entities; TS SDK side TBD |
| **Dataset versioning** | Monotonic `_xact_id` transaction IDs + named snapshots | ISO timestamp snapshot pin | Has variant IDs |
| **Evals** | `Eval(name, {data, task, scores, classifiers, parameters, trialCount, maxConcurrency, ...})` — ~25 fields | `experiment.run({data, task, evaluators, runEvaluators, maxConcurrency, datasetVersion})` | Server-side today |
| **Eval concurrency** | Queue with byte-threshold backpressure flush; per-row + per-evaluator `trialCount` | `Promise.allSettled` per-batch; default `maxConcurrency=50` (docs say Infinity — bug) | TBD |
| **Scoring** | `span.log({scores})` + `logFeedback()`. No separate queue | `langfuse.score.create()` fire-and-forget; queue `MAX=100k`, `BATCH=100`. Five data types (`NUMERIC\|BOOLEAN\|CATEGORICAL\|CORRECTION\|TEXT`) | Has scoring server-side |
| **Annotations** | **None.** `logFeedback` is closest. Gap | Raw `api.annotationQueues.*` (10 methods). Annotations are `ScoreBody` with `queueId` | Has annotation entities |
| **Media** | `Attachment`/`ExternalAttachment`/`JSONAttachment` types; Azure-style blob refs | `MediaManager.resolveReferences({obj, "base64DataUri"})` + `@langfuse/otel` `MediaService` auto-scans 6 attrs for base64 | None TS-side |
| **Sessions/users** | `metadata` and `tags` only — no first-class `userId`/`sessionId` | First-class via `propagateAttributes`; unprefixed `user.id`/`session.id` OTel attrs; W3C baggage cross-service | Server-side concept |
| **Functions / tools** | First-class: `Project.tools/prompts/parameters/scorers` builders; server-side `invoke()` execution | **None** | Agenta has tools concept |
| **CLI** | `braintrust eval`, `push`, `pull` + `--dev` mode server for playground | **No CLI.** `langfuse/experiment-action` GitHub Action only | None |
| **Auth model** | API key only, no OAuth, idempotent `login()`, `BraintrustState` per-org | Public + secret key (HTTP Basic); no `init()`; one client per project | API key |
| **Multi-project** | Per-call `state: BraintrustState` arg (multi-tenant) | One `LangfuseClient` instance per project | Project-scoped |
| **Secrets/Vault/Config** | **None.** Env vars + per-call options + `environment` slug | **None.** `llmConnections.upsert` for server-stored provider keys | Python SDK has `SecretsManager`/`VaultManager`/`ConfigManager`; TS SDK gap |
| **Cost tracking** | Server-side. Client normalizes token metrics (`parseMetricsFromUsage`) | Server-side. `costDetails: Record<string, number>`; implicit USD | Server-side |
| **Query/read-back** | `ObjectFetcher` AsyncIterable; underlying BTQL AST | `api.observations.getMany`, `api.trace.get/list`, `api.metrics.metrics(query)` Cube-style | Server-side |
| **Org/SCIM** | None in SDK; org concept only via `BRAINTRUST_ORG_NAME` | `api.organizations.*` (8 methods) + `api.scim.*` (7 methods) | Has orgs |

### Headline

- **Braintrust ships its own bus + a deep developer workflow** (CLI, push/pull, server-side function invocation, dev-server-for-playground). OTel is opt-in interop.
- **Langfuse rides OTel end-to-end** and ships a discoverable manager pattern (5 named managers + raw `api.*`). No CLI, no functions concept, but cleaner separation between tracing and REST.
- **Both ship in-SDK eval orchestration.** Both have a real AI SDK v6 streaming-abort gap (source-confirmed). Both punt on secrets/config management — agenta has more existing Python-side surface here than either competitor.
- **Edge runtime tracing**: Braintrust ships per-runtime bundles; Langfuse is Node-only. Neither solves the OTel-on-edge problem cleanly.
- **Annotations**: only Langfuse ships them (raw API only, no manager). Braintrust gap.
- **Sessions/users**: only Langfuse ships them as first-class. Braintrust gap.
- **v4 empirical correction**: when wired via raw OTLP (no vendor SDK), Langfuse stores ALL spans including non-LLM wrappers — its scope filter is JS-SDK-only (P-LANGFUSE-01). Braintrust silently drops spans on data-plane mismatch with no error feedback (P-BRAINTRUST-01).

---

## 0.5 Empirical evidence: tri-export across 8 spike apps

> Source: companion doc [`docs/design/ts-sdk-tracing/sdk-comparison.md`](../ts-sdk-tracing/sdk-comparison.md). Eight spike apps on the `ts-sdk-chore/example-apps` branch fan IDENTICAL OTel span data out to all three backends via parallel `SimpleSpanProcessor` instances on the same `NodeTracerProvider`. Differences below are about what each platform DOES with that identical input, not what the SDK produces.

### Wiring cost on top of agenta baseline

Lines added to a baseline Agenta-only instrumentation file to enable each additional backend on raw OTLP. **All three backends accept standard OTLP** — no vendor SDK required.

| Backend | Env vars | Auth header | Critical config | Total LoC added |
|---|---|---|---|---|
| Agenta (baseline) | 4 (`AGENTA_HOST`, `AGENTA_API_KEY`, `AGENTA_PROJECT_ID`, `AGENTA_OTLP_PATH`) | `Authorization: ApiKey <key>` | `project_id` query param | n/a |
| + Braintrust | 2 (`BRAINTRUST_API_KEY`, `BRAINTRUST_OTLP_URL`) | `Authorization: Bearer <key>` + `x-bt-parent: project_name:<name>` | **Must match org's data plane (US `api.braintrust.dev` vs EU `api-eu.braintrust.dev`)** | ~8 |
| + Langfuse | 3 (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`) | `Authorization: Basic <base64(pk:sk)>` + optional `x-langfuse-ingestion-version: 4` | Both pk+sk required (single key fails) | ~12 (extra line for base64) |

The wiring is mechanically simple. **Strategic implication**: tri-export with one OTel pipeline is real and works. Customers can wire N observability backends in ~20 lines of additional code.

### Verified trace counts (2026-05-12, REST API)

After fixing the Braintrust data-plane URL (US → EU) and re-running all 8 apps:

| App / `service.name` | Agenta assertions | Langfuse traces | Braintrust events |
|---|---|---|---|
| `vercel-ai-quickstart` (root v4) | n/a | 1 | 2 |
| `vercel-ai-spike-node` (Phase 1) | **4/4 PASS** | 12 | 9 |
| `vercel-ai-spike-app-router-raw` (Phase 2a) | **4/4 PASS** | 5 | 33 |
| `vercel-ai-spike-app-router-vercel` (Phase 2b) | **4/4 PASS** | 11 | 33 |
| `vercel-ai-spike-pages-raw` (Phase 3a) | **4/4 PASS** | 5 | 17 |
| `vercel-ai-spike-pages-vercel` (Phase 3b) | **4/4 PASS** | 5 | 20 |
| `vercel-ai-spike-tanstack-start` (Phase 4) | **4/4 PASS** | 4 | 7 |
| `vercel-ai-spike-nuxt-raw` (Phase 5) | **4/4 PASS** | 6 | 6 |

**Why the counts differ:**
- Agenta stores spans individually.
- Langfuse groups child spans under a root trace ID. `totalItems` = root-trace count, not span count.
- Braintrust stores each span as its own event (flat). Event count = span count. Next.js apps have 6-7× more events because of HTTP-auto-instrumentation wrapper-span explosion.

### Side-by-side: same `ai.streamText` span, three backends

Pulled from each backend's REST API for the IDENTICAL span from the same `POST /api/chat` request (Phase 2b):

| Field | Agenta | Braintrust (EU) | Langfuse |
|---|---|---|---|
| Span name | `ai.streamText.doStream` | `ai.streamText` (child of HTTP wrapper) | Trace root: `POST /api/chat/route` · AI span as child observation |
| Inputs | `ag.data.inputs` = `{prompt: [{role:"user", content: [{text:"..."}]}]}` | `input` = `[{content:"...", role:"user"}]` | `input` = `{messages:[{role:"user",content:[{type:"text",text:"..."}]}]}` |
| Outputs | `ag.data.outputs` = `"ok."` | `output` = `[{content:"ok.", role:"assistant"}]` | `output` = `"ok."` |
| Token usage | `ag.metrics.tokens.incremental` = `{prompt:12, completion:3, total:15}` | `metadata.ai.usage.inputTokens=12, outputTokens=3` | Rolled up into `totalCost` |
| Cost | `ag.metrics.costs` = `{}` (**NOT computed**) | Per-event, not aggregated in default fetch | `totalCost` = `3.6e-06` (computed from `gen_ai.usage.*`) |
| Latency | Per-span `duration.cumulative` | Per-event `metrics.start/end` | `latency` = `0.973s` (rolled up trace-level) |
| Metadata propagation (`userId`, `sessionId`) | On every span | On every event | At trace root |
| Trace structure visibility | Spans flat; UI picks ONE as trace-list row (P-COMMON-01 picks wrapper, not LLM) | Flat event stream with `span_parents` to reconstruct tree | Tree-first: 1 root + N child observations. Cost/latency rollup at root |

**Empirical observations from the same span:**

1. **All three backends have the LLM payload.** Data is not lost; it's about UI surfacing.
2. **Agenta does NOT compute cost** (`ag.metrics.costs = {}`). Braintrust + Langfuse both compute `totalCost` from `gen_ai.usage.*`. **RFC implication**: cost calculation is server-side work, not SDK work.
3. **Langfuse rolls up to trace level.** Trace-list row shows totalCost + latency aggregated. Agenta's trace-list row shows the Next HTTP wrapper with empty metrics. P-COMMON-01 is the gap.
4. **Braintrust UI hierarchy comes from `span_parents`** in flat events. Same data, different rendering choice.

### Two new pain entries from the empirical work

#### P-BRAINTRUST-01: silent data-plane mismatch on US-default OTLP endpoint

**Mechanism**: Braintrust runs separate data planes (US `api.braintrust.dev`, EU `api-eu.braintrust.dev`). SDK + docs default to US. If user's org is on EU:

1. OTLP requests to US endpoint accept body and auto-create projects via `x-bt-parent` header.
2. Projects show up in US-plane `GET /v1/project` listings.
3. **But span data is silently rejected/unrouted.** `POST /v1/project_logs/<id>/fetch` on US plane returns HTTP 421 `DataPlaneRedirectError`.
4. OTLP exporter logs no error. `SimpleSpanProcessor` does not surface failure. Spans silently lost.

**Discovery cost**: ~3 hours. Pre-Phase-8 doc claimed "Live (200)" for Braintrust based on the false assumption that test PASS implied delivery.

**Generalizable lesson**: OTel exporters log HTTP errors to stderr and swallow them silently. **Multi-backend OTel pipelines need REST-API-based delivery verification, not just assertion PASS.** Applies to any future `@agenta/sdk-tracing` that ships multi-backend fan-out.

#### P-LANGFUSE-01: no server-side scope filter when receiving raw OTLP

**Earlier wrong claim** (v2/v3 of this doc, and Phase 8 of the spike): "Langfuse drops non-LLM scope spans server-side, per @langfuse/otel precedent."

**Empirical reality**: when sending raw OTLP to `https://cloud.langfuse.com/api/public/otel/v1/traces` (i.e., NOT using `@langfuse/otel`), Langfuse stores **every span** including Next.js HTTP wrapper spans with null input/output. The `isDefaultExportSpan` filter lives **inside their JS SDK**, running client-side before export. On raw OTLP, Langfuse behaves identically to Agenta — both store all spans, both have wrapper spans in the trace list.

**RFC implication**: the scope filter pattern is **portable to agenta's backend**, not unique to Langfuse. P-COMMON-01 is backend-fixable on agenta's side with the same filter logic Langfuse's SDK applies client-side. **Strictly cleaner architecture** than asking users to install a JS SDK with yet another SpanProcessor.

### Implications for the RFC

1. **Tri-export pattern works.** Users can fan one OTel pipeline out to N backends with ~10-12 LoC per extra backend. **The case for `@agenta/sdk-tracing` is no longer "wraps OTel ergonomically"** — that's not enough to differentiate. The case is "**hides config gotchas that silently lose data**" (P-BRAINTRUST-01) and "**solves what raw OTLP can't**" (the AI SDK v6 abort lifecycle bugs from §5).
2. **Same wire, three UIs.** Different rendering choices (Agenta = flat spans + UI picks one as root, Braintrust = flat + parent refs, Langfuse = tree-with-rollup) — that's a backend display question, not an SDK question.
3. **Vendor SDK features ≠ raw OTLP behavior.** Most "features" my §§3-13 source audit documented run only inside vendor SDKs. On raw OTLP (what agenta will produce + receive), most of those features don't fire. The filter logic, attribute propagation, mask functions — all of these are JS-SDK-side. The pattern is portable to agenta's backend if we want it.
4. **Cost computation is server-side.** Both competitors do it; Agenta currently doesn't. Trivial backend fix.
5. **No SDK escape from data-plane gotchas.** Whatever we ship needs to surface delivery health explicitly — `SimpleSpanProcessor`'s success callback is not proof of delivery.

---

## 1. Package layout & install surface

### Braintrust — monolith + 8 satellites

One primary npm package (`braintrust`) carries the full surface: tracing, logging, evals, CLI, prompts, datasets, 13 provider wrappers. Eight satellite packages under `integrations/`:

| Package | Status | Purpose |
|---|---|---|
| `@braintrust/otel` | live | `BraintrustSpanProcessor` + `BraintrustExporter` |
| `@braintrust/browser` | live | Browser build with AsyncLocalStorage polyfill |
| `@braintrust/vercel-ai-sdk` | **legacy** | Legacy AIStream adapter pinned `ai: "^3.2.16"`. NOT the AI SDK v5/v6 path |
| `@braintrust/openai-agents` | live | OpenAI Agents tracing |
| `@braintrust/langchain-js` | live | LangChain callback handler |
| `@braintrust/temporal` | live | Temporal workflow interceptors |
| `templates-nunjucks` | internal | Nunjucks template plugin |
| `val.town` | internal | Val.town integration |

Runtime-conditional `exports` ([`js/package.json:25-37`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/package.json)):

```json
"exports": {
  ".": {
    "edge-light": "./dist/edge-light.mjs",
    "workerd": "./dist/workerd.mjs",
    "node": { "import": "./dist/index.mjs", "require": "./dist/index.js" },
    "browser": "./dist/browser.mjs"
  },
  "./workerd": { ... }, "./edge-light": { ... }, "./browser": { ... }, "./node": { ... },
  "./instrumentation": { ... }, "./hook.mjs": "./dist/auto-instrumentations/hook.mjs",
  "./vite": { ... }, "./webpack": { ... }, "./webpack-loader": { ... },
  "./esbuild": { ... }, "./rollup": { ... }, "./dev": { ... }, "./util": { ... }
}
```

Build: `tsup`, separate `browser`, `edge-light`, `workerd` bundles with `platform: "browser"`. **`engines` and `sideEffects` NOT declared** anywhere. Runtime targeting via conditional exports only.

Dep surface is heavy due to CLI bundled into core: `express`, `cors`, `simple-git`, `esbuild`, `dotenv`, `boxen`, `chalk`, `cli-table3` — but all on CLI code paths. Zod peer dep `^3.25.34 || ^4.0`.

### Langfuse — six scoped packages

| Package | Purpose | Engines | Build |
|---|---|---|---|
| `@langfuse/core` | Shared utilities, Fern-generated REST client (24 sub-resources) | (none declared) | tsup, dual CJS+ESM |
| `@langfuse/client` | REST: 5 managers (prompt/dataset/score/media/experiment) | (none declared) | tsup |
| `@langfuse/tracing` | OTel-based tracing functions + Langfuse span wrappers | **`node: ">=20"`** | tsup |
| `@langfuse/otel` | `LangfuseSpanProcessor` + media service | **`node: ">=20"`** | tsup |
| `@langfuse/openai` | OpenAI Proxy wrapper | (none declared) | tsup |
| `@langfuse/langchain` | LangChain `CallbackHandler` | (none declared) | tsup |

Canonical install:

```bash
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

Every package: `"type": "module"`, `"sideEffects": false`, dual `dist/index.cjs` + `dist/index.mjs`. No subpath exports — each capability is its own package.

Legacy `langfuse` / `langfuse-node` are frozen-v3 for Node < 18. **Migration tax softer than commonly portrayed**: 16 deprecated method-name aliases live in `LangfuseClient` ([`packages/client/src/LangfuseClient.ts:170-232`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/LangfuseClient.ts)). `LANGFUSE_BASEURL` still read with `// legacy v2` fallback at `packages/core/src/utils.ts:1-12`.

### Implication for agenta

- **Decomposition pays for itself** once you have (a) tracing-only users, (b) prompt-only users, (c) eval users. Langfuse split is cleaner; Braintrust paid for monolith in bundle complexity (`dotenv`/`express`/`esbuild` in core install).
- **Per-runtime conditional exports are necessary**, not optional. Braintrust ships 4 builds and STILL needs `dc-browser` polyfill for `diagnostics_channel` on edge. No single bundle works everywhere.
- **Declare `engines` and `sideEffects: false`** — Braintrust's leakier approach (runtime targeting via exports only) hurts tree-shaking and version clarity.

---

## 2. Initialization & state model

### Braintrust — symbol-keyed globalThis state, three init modes

Three mode-specific init functions ([`logger.ts:3547-3564`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):

```ts
import { init, initLogger, initDataset, login } from "braintrust";

const experiment = await init({ project: "my-project", experiment: "my-exp" });
const logger    = await initLogger({ projectName: "my-project" });
const dataset   = await initDataset({ project: "my-project", dataset: "my-ds" });
```

State lives on `globalThis[Symbol.for("braintrust-state")]` ([`logger.ts:1102-1109`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) so multiple copies of `braintrust` in node_modules share one state. **Cleanest fix for the multi-copy / Next.js dev-mode / monorepo footgun.** Worth lifting.

`loginToState(options)` ([`logger.ts:4976`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) creates a fresh `BraintrustState` for multi-tenant use without touching globals. Every API accepts `state: BraintrustState` for per-call org switching.

32 env vars across `BRAINTRUST_*`. Notable: `BRAINTRUST_DISABLE_INSTRUMENTATION`, `BRAINTRUST_QUEUE_DROP_EXCEEDING_MAXSIZE`, `BRAINTRUST_SYNC_FLUSH`, `BRAINTRUST_FAILED_PUBLISH_PAYLOADS_DIR`, `BRAINTRUST_MAX_GENERATOR_ITEMS`.

### Langfuse — explicit, no globals, two-concern split

```ts
// instrumentation.ts (once)
new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] }).start();

// elsewhere
const langfuse = new LangfuseClient({ publicKey, secretKey, baseUrl });
```

**No singleton, no `init()`.** Multi-project = multiple `LangfuseSpanProcessor`s registered with one `NodeSDK`; each gets its own `OTLPTraceExporter`. Tracer-provider isolation via `setLangfuseTracerProvider(provider)` ([`packages/tracing/src/tracerProvider.ts:102-104`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/tracerProvider.ts)) is the only way to use Langfuse with `@vercel/otel`'s isolated provider.

**Bug worth noting**: `LANGFUSE_FLUSH_AT` and `LANGFUSE_FLUSH_INTERVAL` control BOTH span batching AND score queue ([`span-processor.ts:247-249, 273-276`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts); [`score/index.ts:43-49`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)) — one env change rebatches two subsystems. Footgun.

### Agenta parity

- Existing TS SDK has `init({apiKey, projectId, host})` + `getAgentaSdkClient()` singleton ([`web/packages/agenta-sdk/src/index.ts:74`](web/packages/agenta-sdk/src/index.ts)).
- Python SDK has `init()` + globally-imported singletons (`api`, `async_api`, `tracing`).

### Implication for agenta

1. **`globalThis[Symbol.for("agenta-state")]`** (Braintrust pattern). Trivial cost, kills monorepo + Next.js dev-mode bugs.
2. **Split env vars across subsystems** — `AGENTA_SPAN_FLUSH_AT` vs `AGENTA_SCORE_FLUSH_AT`. Don't repeat Langfuse's footgun.
3. **`setAgentaTracerProvider(provider)` escape hatch** for `@vercel/otel` isolated providers. Lift Langfuse pattern.
4. **Keep `init()` lean** for REST client; introduce separate `registerAgentaTracing()` or `AgentaSpanProcessor` for tracing setup. Langfuse split is right.

---

## 3. Tracing API surface

### Braintrust — three primitives, generator-aware (with caveats)

```ts
// (a) HOF wrapper — most common; alias `traceable` for LangSmith refugees
const myFunc = wrapTraced(async function myFunc(input) { return ... }, { name, type });

// (b) callback
const result = await traced(async (span) => {
  span.log({ input, metadata });
  return "result";
}, { name, type: "llm" });

// (c) imperative
const span = startSpan({ name, type });
try { ... } finally { span.end(); }
```

`wrapTraced` (`logger.ts:5422`) detects sync/async generators via `isGeneratorFunction`/`isAsyncGeneratorFunction` and dispatches to `wrapTracedSyncGenerator` (`:5262`) or `wrapTracedAsyncGenerator` (`:5329`).

**Crucial nuance**: this handles **declared `function*` / `async function*` only** — NOT arbitrary `AsyncIterable`. Vercel AI SDK's `streamText` returns an object with `.textStream` / `.fullStream` (each `AsyncIterable`), not a generator function. Stream handling for OpenAI/AI SDK goes through `diagnostics_channel.tracingChannel` (`oai.ts:272`, `ai-sdk.ts:410`) — channel subscribers handle stream lifecycle.

**Generator output silently truncated past 1000 items** (`logger.ts:5274-5296`): when `BRAINTRUST_MAX_GENERATOR_ITEMS` exceeded, `collected = []` and `truncated = true` — captured output **wiped**, debug warning only.

**Zero `AbortSignal` handling** anywhere in `js/src/wrappers/ai-sdk/` — grep returns no hits.

**11 span types** ([`js/util/span_types.ts:1-13`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/util/span_types.ts)):

```ts
"llm" | "score" | "function" | "eval" | "task" | "tool"
| "automation" | "facet" | "preprocessor" | "classifier" | "review"
```

Parent-child: AsyncLocalStorage with multi-runtime detection. OTel interop bidirectional via `getIdGenerator()` + `getContextManager()` (process-global mutation pattern — anti-pattern, don't replicate).

`asyncFlush` typed per-call arg flips return type from `F` to `Promise<F>` — elegant ergonomic for serverless without a separate "edge mode" API.

### Langfuse — three patterns, OTel-native

```ts
// (a) startObservation — manual lifecycle, no context push
const span = startObservation("user-request", { input });
const gen = span.startObservation("llm-call", { model, input }, { asType: "generation" });
gen.update({ usageDetails, output }).end();
span.end();

// (b) startActiveObservation — context push, auto-end
await startActiveObservation("user-request", async (span) => { ... });

// (c) observe — HOF wrapper
const tracedFetch = observe(fetchData, { name: "fetch-data", asType: "span" });
```

`observe()` ([`tracing/src/index.ts:1443-1456`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/index.ts)) doesn't use `startActiveObservation` — builds context manually to preserve `this` binding for class methods (fix shipped in 4.0.0-beta.3).

**10 observation types** at [`tracing/src/types.ts:12-22`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/types.ts) — but only **2 attribute shapes**: `LangfuseGenerationAttributes` (rich) vs `LangfuseSpanAttributes` (which 8 other types alias). The "10 typed subtypes" framing oversells the type strictness.

**`LangfuseEvent` auto-ends in constructor** ([`spanWrapper.ts:1451-1458`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/spanWrapper.ts)) — pattern worth mirroring for the agenta `event` type.

Underlying span is a real OTel `Span` ([`spanWrapper.ts:142-163`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/spanWrapper.ts)) so third-party processors observe everything.

`propagateAttributes(callback)` ([`packages/core/src/propagation.ts:246-397`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/propagation.ts)) — v5 observation-centric primitive. Sets attrs on current active span AND OTel context so future child spans inherit via `LangfuseSpanProcessor.onStart`. Both `@langfuse/openai` and `@langfuse/langchain` route trace-level info through this.

Silent 200-char truncation on propagateAttributes string values ([`propagation.ts:618-623`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/propagation.ts)) — `logger.warn` fires but if debug off, user sees nothing. Bad for large-payload metadata.

### Implication for agenta

1. **Ship a generator-aware HOF (`ag.trace(fn)`) on top of OTel spans** — Braintrust's primary surface. Understand it does NOT solve AI SDK v6 abort; see §5.
2. **Borrow Langfuse's observation type union as labels, not types** — only `generation` needs a rich attribute shape.
3. **Borrow Braintrust's `asyncFlush: boolean`** typed per-call arg.
4. **Adopt Langfuse-style `propagateAttributes`** for user/session/tags. Drop the silent truncation — log at WARN.
5. **Mirror agenta IDs to OTel-standard keys**: `agenta.user.id` AND `user.id` (Langfuse's undocumented dual-write).

---

## 4. AI provider integrations

### Braintrust — 13 wrappers via `diagnostics_channel`

All from main `braintrust` package ([`exports.ts:166-199`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/exports.ts)): `wrapOpenAI`, `wrapAnthropic`, `wrapAISDK`, `wrapGoogleGenAI`, `wrapMistral`, `wrapCohere`, `wrapClaudeAgentSDK`, plus Groq, Cursor, GitHub Copilot, HuggingFace, Mastra, OpenRouter, OpenRouterAgent.

Implementation: Proxy + `diagnostics_channel.tracingChannel` dispatch. `dc-browser` polyfill on edge runtimes.

**Three auto-instrumentation layers**:
1. Manual `wrapX(client)` — explicit.
2. Bundler plugins (`braintrust/vite|webpack|esbuild|rollup`) via `@apm-js-collab/code-transformer`.
3. Node `--import braintrust/hook.mjs app.js` — patches diagnostics_channel before any SDK code.

**Vercel AI SDK is messy**: `@braintrust/vercel-ai-sdk` package at v0.0.5 is a legacy AIStream adapter pinned `ai: "^3.2.16"` — NOT the AI SDK v5/v6 path. `wrapAISDK` from main package handles v5/v6 via dc; `BraintrustMiddleware` and `wrapAISDKModel` live under `wrappers/ai-sdk/deprecated/` with "TODO: remove in next major release". Three coexisting AI SDK paths, two deprecated.

### Langfuse — focused, OTel pass-through for AI SDK

- **`@langfuse/openai`** — `observeOpenAI(client)` recursive Proxy ([`observeOpenAI.ts:92-125`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/observeOpenAI.ts)). Streaming via `wrapAsyncIterable` ([`traceMethod.ts:103-104, 186-262`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/traceMethod.ts)). Optional 2nd arg accepts `traceName`, `userId`, `sessionId`, `tags`, `generationName`, `langfusePrompt`, `parentSpanContext`.
- **`@langfuse/langchain`** — `CallbackHandler` extends `BaseCallbackHandler`.
- **Vercel AI SDK** — no wrapper. `experimental_telemetry: { isEnabled: true }` direct pass-through to `LangfuseSpanProcessor`.

**The AI SDK v6 abort smoking gun** ([`traceMethod.ts:186-262`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/traceMethod.ts)):

```ts
async function* wrapAsyncIterable(...) {
  for await (const rawChunk of response as AsyncIterable<unknown>) { ... }
  // ↓ runs ONLY if the loop completes
  generation.update({...}).end();
}
```

Consumer aborts mid-stream → iterator GC'd without `.return()` → `.end()` never fires → `BatchSpanProcessor` never sees the span. Langfuse Vercel AI SDK e2e tests pass via manual `forceFlush()` ([`tests/e2e/vercel-ai-sdk.e2e.test.ts:275`](https://github.com/langfuse/langfuse-js/blob/main/tests/e2e/vercel-ai-sdk.e2e.test.ts)) — papering over the production failure mode.

### Implication for agenta

1. **OTel-only via `experimental_telemetry` for v1** (Langfuse pattern). Per-provider Proxy wrappers only if measured DX gap demands.
2. **AI SDK v6 abort is wide-open differentiation** — neither competitor handles it. See §5.

---

## 5. Export model & edge runtime

This section maps directly to the spike's pain log (P-NODE-02, P-APP-VERCEL-01, P-APP-RAW-01, P-PAGES-RAW-01, P-PAGES-VERCEL-01).

### Braintrust — proprietary batched queue + OTel as opt-in

- **Wire**: REST endpoint `logs3` (NOT `/logs`). POST at [`logger.ts:3231-3236`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts). **Empirical finding** (P-BRAINTRUST-01, v4): Braintrust runs separate data planes (US `api.braintrust.dev`, EU `api-eu.braintrust.dev`). OTLP requests to the wrong plane silently auto-create projects via `x-bt-parent` but the trace storage is unreachable. Response is HTTP 200 — OTel exporter has no signal. Multi-region OTel pipelines need explicit REST-API delivery verification, not just span-export-success.
- **Queue**: bg worker with FIFO + drop-newest-when-full ([`queue.ts:31-49`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/queue.ts)). `HTTPBackgroundLogger.defaultBatchSize = 100`. `DEFAULT_MAX_REQUEST_SIZE = 6MB`.
- **`beforeExit` flush** registered automatically ([`logger.ts:2880-2884`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)). Best-effort only (doesn't run on `process.exit()` or uncaught).
- **OTel mode**: `BraintrustExporter` wraps `BraintrustSpanProcessor` ([`integrations/otel-js/src/otel.ts:637-691`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/integrations/otel-js/src/otel.ts)); HTTP layer is upstream `OTLPTraceExporter`. POST to `${apiUrl}/otel/v1/traces` with `x-bt-parent` header.
- **`filterAISpans` is OFF by default** ([`otel.ts:307-316`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/integrations/otel-js/src/otel.ts)). Filter is opt-in, not default. Forwards everything by default.
- **`asyncFlush: boolean` typed per-call arg** — flips return type. Built for serverless without separate "edge mode" API.
- **Edge support**: dedicated `workerd.mjs` + `edge-light.mjs` bundles. Configs at `js/src/{edge-light,workerd}/config.ts:1-58` — polyfill ALS, swap `dc-browser` `tracingChannel`, non-crypto hash.

### Langfuse — OTLP-native, Node-only for tracing

- **Wire**: OTLP/HTTP via `@opentelemetry/exporter-trace-otlp-http`. Default endpoint `${baseUrl}/api/public/otel/v1/traces`.
- **Processor**: `LangfuseSpanProcessor` wraps `BatchSpanProcessor` (default) or `SimpleSpanProcessor` based on `exportMode: "batched" | "immediate"` ([`span-processor.ts:269-277`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)).
- **Default batching is upstream OTel defaults** (`maxExportBatchSize: 512`, `scheduledDelayMillis: 5000`) — NOT Langfuse-specific, only overridden if env vars set.
- **`forceFlush()` is a strict superset of OTel's** — also flushes pending media uploads ([`span-processor.ts:187, 356-379`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)).
- **Mask function** ([`span-processor.ts:444-462`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-processor.ts)) — async-aware, six attribute slots, on-throw sentinel `"<fully masked due to failed mask function>"`. Runs BEFORE media extraction.
- **Default span filter** `isDefaultExportSpan` ([`span-filter.ts:35-39`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-filter.ts)) — exports Langfuse-emitted spans, any `gen_ai.*` attribute, or known LLM scope (`ai`, `langsmith`, `openinference`, `litellm`). **This runs INSIDE `@langfuse/otel`'s `LangfuseSpanProcessor`, JS-SDK-side only.** Empirically verified (P-LANGFUSE-01, v4): when sending raw OTLP to `https://cloud.langfuse.com/api/public/otel/v1/traces` (bypassing `@langfuse/otel`), Langfuse stores ALL spans including non-LLM Next.js HTTP wrappers with null input/output. **No server-side filter exists.**
- **Edge support**: **none for tracing**. Both `@langfuse/otel` AND `@langfuse/tracing` declare `engines.node >= 20`. `@vercel/otel` explicitly recommended against in docs.

### AI SDK v6 abort — source-confirmed gap on both sides

| Spike pain | Braintrust | Langfuse | Agenta opportunity |
|---|---|---|---|
| P-NODE-02: `BatchSpanProcessor` + `streamText` loses spans on abort | No abort handling in `wrappers/ai-sdk/` | No abort handling in `wrapAsyncIterable`. Issue #12643 OPEN | Ship `AgentaSpanProcessor` that intercepts iterator `.return()`/`.throw()` + AbortSignal |
| P-APP-RAW-01: edge runtime drops spans (raw OTel) | `edge-light.mjs` bundle + proprietary wire | Not supported | Per-runtime bundle + OTLP exporter that works on edge |
| P-APP-VERCEL-02: edge tracing works but ~10-15s delay (Batch) | `asyncFlush: false` maps cleanly | Recommend `"immediate"` mode | Default `"immediate"`-equivalent on edge |
| P-PAGES-RAW-01: Pages Router edge can't BUILD raw OTel imports | `edge-light.mjs` ships edge-safe bundle | Not supported | Ship build that passes Next's static dynamic-code-eval check |
| P-TANSTACK-01: unenforced import order in `src/server.ts` | Untested | Not addressed | Ship `register()` helper that throws if called too late |

### Implication for agenta

Four ranked moves:

1. **`AgentaSpanProcessor` must handle AI SDK v6 abort.** Headline differentiator. Neither competitor does. Ship: (a) intercept `AsyncIterable` `.return()`/`.throw()`, (b) listen for `AbortSignal` from `experimental_telemetry`, (c) force-flush in-flight span. `flushOnAbort: boolean` config, default true.
2. **Per-runtime conditional exports.** 4 builds: `node`, `edge-light`, `workerd`, `browser`.
3. **`asyncFlush: boolean` typed per-call arg.** Cleaner than Langfuse's global mode switch.
4. **Mask function as part of processor config** (Langfuse pattern). Six slots: input/output/metadata × trace/observation. Apply before media extraction.

---

## 6. Prompts

### Braintrust — `loadPrompt` returns a full LLM request builder

Surface ([`logger.ts:4549-4677`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):

```ts
const prompt = await loadPrompt({
  projectName: "my-project",      // or projectId
  slug: "my-prompt",              // or id
  version: "1234abc",             // optional pin (xact id)
  environment: "production",      // optional, mutually-exclusive with version
  defaults: { /* default vars */ },
});

const compiled = prompt.build({
  customer_name: "Acme",
  // ...
});

const response = await openai.chat.completions.create(compiled);
//                                                   ↑ full ChatCompletionCreateParams
```

**`Prompt.build()` returns a fully-shaped OpenAI request**, not just a template ([`logger.ts:8087-8103`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) — chat flavor returns `{messages, tools, model, ...chat params}`; completion flavor returns `{prompt, model, ...params}`. The compiled prompt includes a `span_info` payload so `client.chat.completions.create(...compiledPrompt)` auto-attaches prompt id/version/variables to the span.

Throws "No model specified" at `logger.ts:8165` if no model.

**Versioning**: NO semver. Wire identity is `_xact_id` (transaction ID, sortable string, accessed via `loadPrettyXact`/`prettifyXact`). "Latest" = no version param. `environment` slug ("production"/"staging") is an orthogonal axis tied to deployment-style routing.

`getPromptVersions(projectId, promptId)` ([`logger.ts:8579-8643`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) builds a raw BTQL AST and POSTs to `state.apiConn().post("btql", ...)` — only public BTQL example in user-facing surface.

**Cache** — two-tier ([`logger.ts:725-746`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):
- Memory LRU (default 1024 entries, env-tunable).
- Optional disk layer at `${HOME}/.braintrust/prompt_cache`, gzipped JSON keyed on `hash(${prefix}:${slug}:${version})`.
- Eviction by mtime (not atime — noatime mounts).
- **Cache only consulted on server fault** (`logger.ts:4605-4638`). Only "latest" allowed to be stale; explicit `version`/`environment` requests throw on miss.
- **No active TTL** — refresh happens on every successful fetch.

**Template engine — Mustache via plugin registry** ([`template/registry.ts:1-133`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/template/registry.ts)):
- Mustache default (`template/plugins/mustache.ts:1-29`) with custom `jsonEscape` (string passthrough; everything else `JSON.stringify`).
- Nunjucks deferred to separate package (`@braintrust/template-nunjucks`), throws if not installed.
- `lint(template, vars)` enumerates `name`/`&` spans, walks variable path; array indices wildcarded to `.0`.

**Tools binding first-class** ([`prompt-schemas.ts:34-42`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/prompt-schemas.ts)) — `PromptDefinitionWithTools = prompt + model + params + tools[]`. Tools can be inline `ToolFunctionDefinition[]` (stored as `JSON.stringify` on `PromptBlockData.tools`) OR references to pushed `CodeFunction`s/`SavedFunctionId`s (resolved server-side).

**Push/pull via CLI**:
- `bt push` bundles `.ts/.tsx/.js/.jsx` via esbuild, walks `EvaluatorFile` (functions, prompts, parameters, evaluators), POSTs `insert-functions` ([`cli/functions/upload.ts:448`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/cli/functions/upload.ts)).
- `bt pull` GETs `v1/function` filtered by `project_id|project_name|slug|ids|version`, writes generated `${slug(projectName)}.ts` to `--output-dir` (default `./braintrust`). Refuses to overwrite files dirty in `git diff HEAD` unless `--force` ([`cli/util/pull.ts:80-130`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/cli/util/pull.ts)).

### Langfuse — `PromptManager` with stale-while-revalidate cache

Five public methods on `langfuse.prompt.*` ([`promptManager.ts:32-462`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/prompt/promptManager.ts)):

- **`create(body)`** — three overloads for `CreateChatPromptBodyWithPlaceholders`, `CreateChatPromptRequest`, `CreateTextPromptRequest`. Accepts `config`, `labels`, `tags`, `commitMessage`.
- **`update({name, version, newLabels})`** — only label edits. Invalidates cache for that name.
- **`delete(name, options?)`** — optional `version` or `label` filter; without either, all versions removed.
- **`get(name, options?)`** — three overloads typed for `text`/`chat` return:

```ts
const prompt = await langfuse.prompt.get("my-prompt", {
  version: 3,                  // or label, or both
  label: "production",
  type: "chat",                // narrows return to ChatPromptClient
  fallback: "Hello {{name}}",  // for offline/failure resilience
  cacheTtlSeconds: 60,         // 0 to bypass
  maxRetries: 3,
  fetchTimeoutMs: 5000,
});
```

**Versioning**: numeric versions. `label: "production"` is the default (when no version/label specified). Cache key: `name-version:${n}` or `name-label:${l}` ([`promptCache.ts:36-53`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/prompt/promptCache.ts)).

**Cache — stale-while-revalidate**:
- 60-second TTL default.
- `getIncludingExpired` returns stale value immediately, kicks off background refresh ([`promptManager.ts:340-411`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/prompt/promptManager.ts)).
- Concurrent refreshes deduplicated via `_refreshingKeys`.
- Failed background refresh keeps stale entry.
- `cacheTtlSeconds: 0` bypasses entirely.
- **Production callers never block on cache expiration.**

**`TextPromptClient` vs `ChatPromptClient`** ([`promptClients.ts:24-478`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/prompt/promptClients.ts)):
- Both extend `BasePromptClient`: `name`, `version`, `config: unknown`, `labels[]`, `tags[]`, `isFallback`, `type`, `commitMessage`.
- `TextPromptClient.prompt: string` → `.compile(vars)` runs `mustache.render`.
- `ChatPromptClient.prompt: ChatMessageWithPlaceholders[]` → `.compile(vars, placeholders)` resolves placeholder rows then Mustache-renders each message.
- `getLangchainPrompt({placeholders?})` converts `{{var}}` → `{var}` and handles JSON-brace doubling for LangChain f-string parsing (lines 111-163).

**Templating**: Mustache (hard dep `mustache@^4.2.0` in `packages/client/package.json:38`). HTML escaping disabled (`promptClients.ts:15`).

**No variable validation** — missing vars silently emit empty strings.

**No tools binding on prompts on the SDK side** — `resolutionGraph` field server-side, but SDK only passes a `resolve: boolean` flag.

**Linking prompt to generation span**: pass `langfusePrompt: {name, version, isFallback}` in the OpenAI integration's 2nd arg or as a generation attribute ([`tracing/src/types.ts:89-96`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/types.ts)). Server attribute: `langfuse.observation.prompt.name` + `.version`.

### Agenta parity

- **Has a prompt registry server-side** (variants + revisions).
- **No TS SDK prompt surface** today.
- **No client-side templating engine** — currently passes raw config.

### Implication for agenta

1. **Adopt Langfuse SWR cache pattern verbatim** — 60s default, dedupe concurrent refresh, `cacheTtlSeconds: 0` bypass. **Add what Langfuse skips: warn on unused/missing variables before render.**
2. **Add Braintrust-style optional disk cache** (`~/.agenta/prompt_cache`, gzipped, hash-keyed) for offline-friendly evals.
3. **Plugin registry for template engines** (Braintrust pattern, `template/registry.ts`) — Mustache default, opt-in alternatives via side-packages. Lint hook is borrow-worthy.
4. **Use transaction IDs (or variant revision IDs) as wire identity, not semver.** Agenta already has variant IDs; promote them.
5. **Layer `environment`/`deployment` slugs as orthogonal axis** — not a version.
6. **Three signature overloads typed for `text`/`chat` return** (Langfuse pattern, `promptManager.ts:235-333`).
7. **`fallback` body for offline resilience** — accept text string OR `ChatMessage[]`, synthesize a `isFallback: true` client.
8. **`prompt.build()` returns LLM request shape, NOT just template** (Braintrust pattern) — auto-attaches span metadata. Less ergonomic friction. Don't try to invoke the model client-side; that's the user's job.
9. **First-class tool binding on prompts** (Braintrust `PromptDefinitionWithTools`) — agenta has tools as a separate concept; bind them on the prompt entity.

---

## 7. Datasets & testsets

### Braintrust — `Dataset extends ObjectFetcher`, full CRUD + snapshots

Three init overloads ([`logger.ts:4129-4289`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):

```ts
const dataset = await initDataset({
  project: "my-project",         // or projectId
  dataset: "my-dataset",
  version: "1234abc",            // mutually-exclusive pin modes
  snapshotName: "v1.0-eval",     // ↑ precedence: version > snapshot > environment
  environment: "production",     // ↓
  useOutput: true,               // legacy: rename `expected` → `output`
});
```

`Dataset extends ObjectFetcher<DatasetRecord>` ([`logger.ts:7209-7695`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) — `AsyncIterable<WithTransactionId<DatasetRecord>>`.

**CRUD methods**:
- `insert({input, expected, metadata?, tags?, id?})` — upserts on `id`, bg-logged.
- `update({id, input?, expected?, metadata?, tags?})` — sets `IS_MERGE_FIELD`.
- `delete(id)` — sets `_object_delete: true`.

**Snapshots**:
- `createSnapshot({name, description?, update?})` — POSTs `api/dataset_snapshot/register` with current `_xact_id`.
- `listSnapshots()`, `getSnapshot({...lookup})`.
- `updateSnapshot(snapshotId, {name?, description?})`.
- `deleteSnapshot(snapshotId)`.

**Restore**:
- `restorePreview({version})` → `v1/dataset/{id}/restore/preview`.
- `restore({version})` → `v1/dataset/{id}/restore`.

**Summary**:
- `summarize({summarizeData=true})` → `{projectName, datasetName, projectUrl, datasetUrl, dataSummary: {newRecords, totalRecords}}`.

**Schema**: row is `{id, input, expected, metadata, tags, dataset_id, created, _xact_id, ...}` (`util/object.ts:18-33`). `metadata` keys must be strings. Tags validated for duplicates and stringness.

**Iteration**: `AsyncIterable` via parent `ObjectFetcher`. Underlying BTQL `cursor` loop, default batch 1000, hard ceiling `MAX_BTQL_ITERATIONS`.

**Versioning**: monotonic-transaction-ID. No fork/branch model. Snapshots are named pointers to xact IDs.

**Eval-time linking**: `Dataset.toEvalData()` ([`logger.ts:7276-7310`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) returns `{dataset_id, dataset_version | dataset_environment | dataset_snapshot_name, _internal_btql?}` consumed by `Eval(...)`.

**No CLI for datasets** — programmatic-only.

### Langfuse — manager has only `get`, full CRUD on raw API

`DatasetManager.get(name, {fetchItemsPageSize?, version?})` ([`dataset/index.ts:237-292`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/dataset/index.ts)) — paginates `apiClient.datasetItems.list` with default page size 50, returns `FetchedDataset`.

```ts
const dataset = await langfuse.dataset.get("my-dataset", { version: "2026-05-11T12:00:00Z" });

for (const item of dataset.items) {
  const result = await myTask(item.input);
  await item.link(result, "run-2026-05-11", { runDescription: "..." });
}

const exp = await dataset.runExperiment({ task, evaluators });
```

**`DatasetItem`** ([`commons/types/DatasetItem.ts:7-25`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/commons/types/DatasetItem.ts)): `id, status, input?, expectedOutput?, metadata?, sourceTraceId: string|null, sourceObservationId: string|null, datasetId, datasetName, createdAt, updatedAt`. **Source pointers explicitly nullable strings** — lineage first-class.

**Linking** — `item.link(obj, runName, runArgs?)` calls `apiClient.datasetRunItems.create({runName, datasetItemId, traceId: span.spanContext().traceId, runDescription, metadata})`.

**Versioning** — ISO-timestamp snapshot via `version` param. Datasets carry `inputSchema` + `expectedOutputSchema` (JSON Schema) for server-side validation.

**Full CRUD only on raw API** (`api.datasets.*`: `list/get/create/getRun/deleteRun/getRuns`; `api.datasetItems.*`: `create/get/list/delete`). **No `dataset.delete` on manager** — only `deleteRun`. Deliberate "manager = read path, raw API = admin" split.

### Agenta parity

- Has `testsets` entity (`web/packages/agenta-entities/src/testset`).
- Python SDK has `agenta.sdk.managers.testsets` module.
- TS SDK starts fresh.

### Implication for agenta

1. **Don't expose full CRUD on the high-level manager** — Langfuse's "manager = opinionated read path, raw `api.*` = admin" is a clean split.
2. **`AsyncIterable` + cursor + per-page paging** (Braintrust `ObjectFetcher` pattern). Default batch 1000, hard ceiling.
3. **`sourceTraceId` + `sourceObservationId` as first-class nullable strings on dataset items** (Langfuse pattern) — lineage tracking from prod span → dataset.
4. **`item.link(obj, runName)` returns a `DatasetRunItem`** with traceId snapped from active span.
5. **Snapshot CRUD as named pointers to a version** (Braintrust pattern). Three pin modes: `version > snapshot > environment` precedence.
6. **JSON Schema for `inputSchema` / `expectedOutputSchema`** — server-side validation of dataset items (Langfuse pattern).

---

## 8. Evals & experiments

### Braintrust — `Eval(name, evaluator, opts?)` with ~25 fields

The richest eval surface among any SDK in this audit. Full `Evaluator` interface ([`framework.ts:225-372`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/framework.ts)):

```ts
Eval("Say Hi Bot", {
  data,                              // EvalCase[] | async iter | BaseExperiment ref | fn returning any
  task,                              // (input, hooks) => Output | Promise<Output>
  scores,                            // EvalScorer[] returning OneOrMoreScores
  classifiers,                       // optional EvalClassifier[]
  parameters,                        // Zod schema OR RemoteEvalParameters
  experimentName, description, metadata, tags, isPublic, update, projectId,
  trialCount,                        // repetitions per input; per-row override via EvalCase.trialCount
  maxConcurrency,                    // queue width
  timeout,                           // ms
  signal,                            // AbortSignal
  state,                             // BraintrustState override (multi-tenant)
  baseExperimentName, baseExperimentId,  // comparison baseline
  gitMetadataSettings, repoInfo,
  errorScoreHandler,                 // custom missing-score fallback
  summarizeScores, flushBeforeScoring,
});
```

Plus `EvalOptions` ([`framework.ts:558-634`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/framework.ts)): `reporter, noSendLogs, onStart, stream, parent, progress, parameters, returnResults, enableCache`.

**Hooks** (`EvalHooks` at `framework.ts:129-167`) expose to the task: `metadata`, `expected`, `span`, `parameters`, `reportProgress`, `trialIndex`, `tags`.

**Concurrency** ([`framework.ts:1529-1604`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/framework.ts)) — async queue at `maxConcurrency`. Per-row `trialIndex` iteration. **Byte-threshold backpressure flush** (`framework.ts:1519-1525`) — flushes whenever pending log bytes exceed `flushBackpressureBytes`. Rolling concurrency, not batch-then-batch.

**Scorers**: `OneOrMoreScores = Score | number | null | Array<Score>` (`framework.ts:180-189`). Bare `number` → score. `Score = {name, score, metadata?}`. `autoevals` package (separate npm, `js/package.json:179` `^0.0.131`) ships pre-built scorers (`Levenshtein`, `Factuality`, `ClosedQA`, `NumericDiff`, `EmbeddingSimilarity`, ...). LLM-as-judge scorers are just code using the OpenAI client + `wrapOpenAI`.

**Summary** — server-driven: `experiment.summarize({summarizeScores?, comparisonExperimentId?})` calls `GET /experiment-comparison2` and returns `{scores, metrics}` with `diff`, `improvements`, `regressions` per name ([`logger.ts:6439-6506`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)).

**Reproducibility** — git capture ([`gitutil.ts:151-224`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/gitutil.ts)): commit, branch, tag, dirty, author_name, author_email, commit_message, commit_time, git_diff (truncated 64KB if dirty). Org-level settings: `collect: "all"|"none"` or `fields: [...]` subset.

**`Reporter`** type — pluggable. Multiple built-in reporters; user can supply own.

**Failure handling** — `errorScoreHandler` config; `defaultErrorScoreHandler` logs 0 for skipped scorers.

### Langfuse — `experiment.run({data, task, evaluators, runEvaluators, maxConcurrency, datasetVersion})`

Surface at [`ExperimentManager.ts:174-320`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/experiment/ExperimentManager.ts):

```ts
const result = await langfuse.experiment.run({
  name: "my-experiment",
  runName: "run-2026-05-11",    // default: `${name} - ${ISO timestamp}`
  description, metadata,
  data,                          // dataset items array OR Langfuse dataset items
  task,                          // ExperimentTask: (item) => Promise<any>
  evaluators,                    // Evaluator[]: per-item, returns Evaluation | Evaluation[]
  runEvaluators,                 // RunEvaluator[]: aggregate, receives {itemResults}
  maxConcurrency,                // default 50 (JSDoc says Infinity — bug)
  datasetVersion,
});

const formatted = result.format({ includeItemResults: true });
```

**Types** ([`experiment/types.ts:82-161`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/experiment/types.ts)):
- `ExperimentTask = (item) => Promise<any>` — task receives FULL item, not just input.
- `Evaluator = (params: {input, output, expectedOutput?, metadata?}) => Promise<Evaluation | Evaluation[]>`.
- `RunEvaluator = (params: {itemResults}) => Promise<Evaluation | Evaluation[]>` — aggregate-only.
- `Evaluation = Pick<ScoreBody, "name" | "value" | "comment" | "metadata" | "dataType" | "configId">` — note `dataType` + `configId` thread through so evaluator results pin to server-side `ScoreConfig`.

**Concurrency**: manual `Promise.allSettled` per-batch (`ExperimentManager.ts:208-247`). Default `maxConcurrency = 50` ([`ExperimentManager.ts:189`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/experiment/ExperimentManager.ts)) **contradicts JSDoc claim of `Infinity` at `types.ts:234`** — known bug. Each batch awaits before starting the next — **no rolling concurrency**, unlike Braintrust.

**IDs** ([`packages/core/src/utils.ts:94-119`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/utils.ts)):
- `createExperimentId()` — 16 random hex chars (no server-side run linkage).
- `createExperimentItemId(input)` — first 16 hex of SHA-256(serialized input). **Identical inputs across runs share an item ID** — deliberate dedupe.

**Tracing integration**: each item runs inside `startActiveObservation("experiment-item-run", ...)`. Root span gets `langfuse.environment = "sdk-experiment"`. Children inherit via `propagateAttributes({_internalExperiment: {...}}, fn)` (marked `**INTERNAL USE ONLY**` at `propagation.ts:132-141`).

**Failure semantics**:
- Task failures caught at batch boundary, logged "Skipping item." (`ExperimentManager.ts:233-240`).
- Evaluator failures swallowed by `Promise.allSettled`; **only fulfilled evaluations kept** (`ExperimentManager.ts:504-513`). **Failed evaluators silently absent from results** — no error score. Bad pattern.

**Run-level evaluations** only enqueued when `datasetRunId` set (`ExperimentManager.ts:292-296`). `score.flush()` called before return.

**Result formatting**: `ExperimentResult.format({includeItemResults?})` produces Markdown-ish summary with emoji headers, truncated 50-char preview, per-item dataset+trace URLs, averaged numeric scores.

**AutoEvals adapter** ([`experiment/adapters.ts:58-78`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/experiment/adapters.ts)) — `createEvaluatorFromAutoevals(autoevalEvaluator, params?)` maps `{input, output, expected}` → `{input, output, expectedOutput}`.

**CI integration**: `RunnerContext` ([`experiment/RunnerContext.ts:38-87`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/experiment/RunnerContext.ts)) — "Intended for use with the `langfuse/experiment-action` GitHub Action."

### Agenta parity

- Has evaluation server-side (`api/oss/src/core/evaluations`).
- Has `evaluator` decorator in Python SDK.
- TS SDK starts fresh.

### Implication for agenta

1. **Adopt Braintrust's full `Evaluator` field set, not Langfuse's**. Specifically borrow:
   - `trialCount` (per-row AND per-evaluator).
   - `maxConcurrency` with **rolling** (not batched) concurrency + byte-threshold backpressure flush.
   - `OneOrMoreScores` return type (`number | Score | Score[] | null`).
   - `errorScoreHandler` for graceful partial failure (don't silently drop like Langfuse).
   - `returnResults: false` for million-row evals.
   - `enableCache` for span disk cache.
   - `EvalHooks` carrying `metadata`, `span`, `reportProgress` for intermediate state.
2. **Surface failed evaluator errors as `dataType: "ERROR"` scores**, NOT silently dropped (Langfuse anti-pattern).
3. **Default `maxConcurrency` = 50** (match Langfuse), document correctly (their JSDoc bug → don't repeat).
4. **Content-addressed item IDs** (Langfuse pattern, SHA-256 prefix) for dedup across runs.
5. **`format({includeItemResults})` text summary** for CI output (Langfuse pattern).
6. **Server-driven summary endpoint** (Braintrust pattern). Don't compute diffs/improvements/regressions client-side — load whole dataset is the footgun.
7. **AutoEvals adapter as a documented integration point** — both competitors converge.
8. **Ship eval scorers in a separate package** (`@agenta/evals` or similar) — Braintrust `autoevals` model. Keeps core lean of LLM-as-judge deps.
9. **Git metadata capture** (Braintrust pattern, `gitutil.ts:151-224`). Org-level settings: `collect: "all"|"none"` or `fields: [...]` subset. Truncate diff at 64KB.

---

## 9. Scoring & feedback

### Braintrust — span-attached, no separate queue

Scores ride spans:

```ts
span.log({
  scores: { quality: 0.85, helpfulness: 0.7 },
  metadata: { ... },
});
```

Aggregated server-side. `logFeedback()` for post-hoc adjustment. No separate `score.create` queue — scores share the span queue.

### Langfuse — fire-and-forget queue with rich data types

```ts
langfuse.score.create({
  name: "quality",
  value: 0.85,
  traceId: "trace-123",
  observationId: "obs-456",     // optional
  comment: "High quality",
  metadata: { ... },
  dataType: "NUMERIC",          // or BOOLEAN | CATEGORICAL | CORRECTION | TEXT
  configId: "score-config-id",  // pin to server-side ScoreConfig
});
```

**Five `ScoreDataType` values** ([`commons/types/ScoreDataType.ts:5-15`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/commons/types/ScoreDataType.ts)): `NUMERIC | BOOLEAN | CATEGORICAL | CORRECTION | TEXT`. `ScoreConfigDataType` is same set minus `CORRECTION`.

**`ScoreConfig`** ([`commons/types/ScoreConfig.ts:7-25`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/commons/types/ScoreConfig.ts)): server-defined schemas with `id`, `name`, `dataType`, `isArchived`, optional `minValue`, `maxValue`, `categories: ConfigCategory[]`, `description`. CRUD on `api.scoreConfigs.*`.

**Convenience overloads** ([`score/index.ts:133-270`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)):
- `score.observation({otelSpan}, data)` — auto-extracts `traceId` + `observationId`.
- `score.trace({otelSpan}, data)` — `traceId` only.
- `score.activeObservation(data)` — reads `trace.getActiveSpan()`; warns if none.
- `score.activeTrace(data)`.

**Queue** ([`score/index.ts:14-15, 46-49`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)):
- `MAX_QUEUE_SIZE = 100_000`, `MAX_BATCH_SIZE = 100`.
- Default `flushAtCount = 10`, `flushIntervalSeconds = 1`.
- Env: `LANGFUSE_FLUSH_AT`, `LANGFUSE_FLUSH_INTERVAL` (also affects span batching — see §2 footgun).
- POSTs via `apiClient.ingestion.batch`.
- On queue full: dropped silently with `logger.error(...)` ([`score/index.ts:89-94`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/score/index.ts)). No retry, no backpressure, no exception.

**`score.create` returns `void`** (not `Promise<void>`) — fire-and-forget. Separate `score.flush()` for explicit drain.

### Agenta parity

- Has scoring server-side as part of evaluations.
- No client-side scoring API.

### Implication for agenta

1. **Adopt Langfuse's five `ScoreDataType`s** — agenta likely has similar enums server-side; align.
2. **Server-side `ScoreConfig` for schema enforcement** — pin scores to a config ID for validation.
3. **Fire-and-forget queue with explicit `flush()`** (Langfuse pattern). `MAX_QUEUE_SIZE = 100_000`, `MAX_BATCH_SIZE = 100` are sensible defaults.
4. **Convenience overloads** `score.observation(span, data)`, `score.trace(span, data)`, `score.activeObservation(data)` — match Langfuse.
5. **Don't silently drop on overflow.** Expose drop metric / callback hook `onScoreQueueOverflow(score) => void` so users can alert.
6. **Don't reuse env vars across subsystems** — `AGENTA_SCORE_FLUSH_AT` separate from span flush.
7. **Allow attaching scores to spans inline** (Braintrust pattern, `span.log({scores})`) as a discoverability win — internally route to the same queue.

---

## 10. Media & attachments

### Braintrust — attachment refs with provider-side upload

Five attachment types exported ([`exports.ts:52-77`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/exports.ts)): `Attachment`, `ExternalAttachment`, `BaseAttachment`, `JSONAttachment`, `ReadonlyAttachment`. Azure-style blob refs with `addAzureBlobHeaders` helper.

**No auto-extraction from span attributes.** Users must explicitly create `Attachment` instances and reference them in event payloads.

`resolveAttachmentsToBase64` ([`logger.ts:8112-8135`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) — used by `Prompt.buildWithAttachments` to hydrate `Attachment` values in prompt variables back to base64 before Mustache render.

### Langfuse — auto-extraction from span attributes + presigned upload

`MediaManager.resolveReferences({obj, resolveWith: "base64DataUri", maxDepth?})` ([`media/index.ts:81-173`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/media/index.ts)) — recursively walks strings/arrays/objects, regex-matches `/@@@langfuseMedia:.+?@@@/g`, fetches each via `apiClient.media.get(mediaId)` → presigned URL → `data:` URI replacement. Default `maxDepth = 10`. Failures log warning and leave reference untouched.

Static helper `MediaManager.parseReferenceString` parses the `@@@langfuseMedia:type=...|id=...|source=...@@@` envelope.

**OTel-side auto-extraction** ([`packages/otel/src/MediaService.ts:11-200+`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/MediaService.ts)) — `process(span)` scans **six span attributes**: trace/observation × input/output/metadata. Regex `/data:[^;]+;base64,[A-Za-z0-9+/]+=*/g` extracts base64 URIs, spawns `LangfuseMedia` per unique URI, swaps URI for `@@@langfuseMedia:...@@@` tag, schedules upload to presigned URL.

**Vercel AI SDK special case** ([`MediaService.ts:99-185`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/MediaService.ts)) — when `span.instrumentationScope.name === "ai"`, additionally parses `ai.prompt.messages` / `ai.prompt` JSON and harvests base64 from `FilePart.data` / `ImagePart.image`.

**Upload flow** ([`MediaService.ts:211-288`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/MediaService.ts)):
1. `media.getSha256Hash()` for integrity.
2. Request presigned URL: `apiClient.media.getUploadUrl({contentLength, traceId, observationId, field, contentType, sha256Hash})`.
3. Server may return `uploadUrl: undefined` for already-uploaded (sha-dedup).
4. Mismatch between SDK-computed and server-computed media ID aborts upload.
5. Exponential backoff, max 3 retries, base delay 1000 ms.
6. Status report back: `apiClient.media.patch(mediaId, {uploadedAt, uploadHttpStatus, uploadHttpError, uploadTimeMs})`.

**47 MIME types enumerated** ([`media/types/MediaContentType.ts:7-58`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/media/types/MediaContentType.ts)) — images, audio, video, text/code, PDFs, Office docs, archives. No file-size limit visible in source.

### Agenta parity

- No TS SDK media surface today.

### Implication for agenta

1. **Auto-extraction from span attributes** is the better DX (Langfuse pattern) — agenta should scan attrs for base64 URIs and swap for refs, not require explicit `Attachment` instances.
2. **Six attribute slots** to scan: input/output/metadata × trace/observation.
3. **Per-`instrumentationScope` adapter pattern** for third-party SDKs (Langfuse's Vercel AI SDK special case). Reserve a hook for `agenta-{scope}` handlers.
4. **Presigned URL upload + sha256 dedup**. Exponential backoff. Status patch-back.
5. **47 MIME types** is a reasonable enumeration to copy.

---

## 11. Annotations & queues

### Braintrust — none

`logFeedback()` is closest analog. No annotation queue concept. **Gap.**

### Langfuse — raw API only, annotations are scores with `queueId`

Only `api.annotationQueues.*` (10 methods at [`annotationQueues/client/Client.ts:78-1259`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/annotationQueues/client/Client.ts)):

- Queue CRUD: `listQueues`, `createQueue`, `getQueue`.
- Item CRUD: `listQueueItems`, `getQueueItem`, `createQueueItem`, `updateQueueItem`, `deleteQueueItem`.
- Assignment: `createQueueAssignment`, `deleteQueueAssignment`.

**Types**:
- `AnnotationQueue = {id, name, description, scoreConfigIds[], createdAt, updatedAt}`.
- `AnnotationQueueObjectType: "TRACE" | "OBSERVATION" | "SESSION"`.
- `AnnotationQueueStatus: "PENDING" | "COMPLETED"`.

**Annotations flow back as `ScoreBody` with `queueId` field set** ([`ingestion/types/ScoreBody.ts:89`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/ingestion/types/ScoreBody.ts)). **Annotations ARE scores** — unified data model.

No high-level manager — only raw API.

### Agenta parity

- Has annotation entity (`web/packages/agenta-entities/src/annotation`).
- Has annotation queue v2 design doc.

### Implication for agenta

1. **Unify annotations with scores at the data layer** (Langfuse pattern) — annotation = score with a `queueId`. Single write path (ingestion.batch / score queue), single read path (`scores.getMany`).
2. **Three queue-item types**: TRACE | OBSERVATION | SESSION (Langfuse pattern).
3. **Pin queue items to `scoreConfigIds[]`** for schema enforcement of acceptable scores.
4. **Status enum**: PENDING | COMPLETED — minimal lifecycle.
5. **Worth a high-level manager** (`langfuse.annotation.*`) — Langfuse only exposes raw API, which is a friction point. Agenta should improve here.

---

## 12. Sessions, users, metadata propagation

### Braintrust — no first-class, metadata only

`metadata` and `tags` only. No `userId`/`sessionId` as facet fields. Users typically store `metadata.user_id` and pivot in the UI.

Read-side: `SpanFetcher`, `CachedSpanFetcher`, `Trace`, `GetThreadOptions` ([`exports.ts:250-251`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/exports.ts)) for thread queries. **No `session.start()` write API** — wire your own `parent` exports.

### Langfuse — first-class via `propagateAttributes`

```ts
propagateAttributes(
  {
    userId: "user-123",
    sessionId: "session-456",
    tags: ["production", "tier-2"],
    metadata: { region: "us-west" },
    traceName: "user-checkout-flow",
    asBaggage: true,  // cross-service via W3C baggage
  },
  async () => {
    // every span created here inherits the above
    await myAgentRun();
  },
);
```

Surface ([`packages/core/src/propagation.ts:81-142`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/propagation.ts)) — writes `user.id` and `session.id` to **unprefixed OTel attrs** ([`constants.ts:13-14`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/constants.ts)), with `langfuse.user.id` / `langfuse.session.id` compat aliases at `constants.ts:59-60`. **Undocumented deliberate move** — existing OTel tooling picks up these IDs without configuration.

**Validation**: 200-char limit on string values, dropped with `logger.warn` (`propagation.ts:618-624`). **Silent if debug logging off.**

**Cross-service baggage**: `asBaggage: true` propagates via W3C baggage with snake-case keys for Python-SDK cross-compat ([`propagation.ts:670-705`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/propagation.ts)).

**No `session.create`** — sessions are implicit, materialized server-side when traces carry `session.id`. Read-side `api.sessions.list/get` only.

`Session = {id, createdAt, projectId, environment}` ([`commons/types/Session.ts`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/commons/types/Session.ts)).

### Agenta parity

- Has user/session concept server-side.
- Python SDK has session helpers.

### Implication for agenta

1. **First-class `userId`/`sessionId`** — don't make them metadata (Braintrust's gap).
2. **Mirror to OTel-standard `user.id` / `session.id` keys** (Langfuse undocumented dual-write).
3. **`propagateAttributes(...)` HOF** for scope-bound metadata propagation.
4. **Sessions materialized server-side from `session.id`** — no explicit `session.create()` needed.
5. **W3C baggage opt-in for cross-service** — useful for distributed agent systems.
6. **Validation: 200-char limit BUT log at WARN, not silently** — fix Langfuse's footgun.

---

## 13. Functions, tools, server-side invoke

### Braintrust — first-class "function" abstraction

A "Function" is the server-side noun for anything pushable: prompt, tool, scorer, task, classifier, parameters.

**Project DSL** ([`framework2.ts:48-145`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/framework2.ts)):

```ts
import { projects } from "braintrust";
import { z } from "zod";

const project = projects.create({ name: "my-project" });

project.tools.create({
  name: "get-weather",
  parameters: z.object({ city: z.string() }),
  returns: z.object({ temperature: z.number() }),
  handler: async ({ city }) => { /* ... */ },
});

project.prompts.create({
  slug: "my-prompt",
  prompt: [{ role: "system", content: "..." }],
  model: "gpt-4o",
  tools: [project.tools.get("get-weather")],
});

project.scorers.create({
  name: "factuality-llm",
  messages: [...],          // LLM-classifier mode
  model: "gpt-4o",
  useCot: true,
  choiceScores: { "yes": 1, "no": 0 },
});
```

**Sub-builders**: `tools`, `prompts`, `parameters`, `scorers` ([`framework2.ts:147-295`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/framework2.ts)). Each has `.create()` returning a typed handle usable in code AND pushable via `bt push`.

**`ToolBuilder.create({handler, parameters: Zod, returns?, name, slug, description, ifExists, tags, metadata})`** — schema conversion to JSON Schema happens at upload via `zodToJsonSchema`.

**`ScorerBuilder` has two modes**:
- Code mode: `{handler, parameters, returns}` → `CodeFunction` with `type:"scorer"`.
- LLM-classifier mode: `{messages | prompt, model, useCot, choiceScores, params}` → `CodePrompt` with `parser:{type:"llm_classifier", use_cot, choice_scores}`. Server runs this.

**Server-side `invoke()`** ([`functions/invoke.ts:143-234`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/functions/invoke.ts)):

```ts
const result = await invoke({
  function_id: "...",            // OR (projectName|projectId)+slug, OR globalFunction+functionType
  version,
  input,
  messages: [...],               // extra OpenAI messages
  metadata, tags,
  parent: spanExport,            // distributed tracing
  stream: true,                  // returns BraintrustStream
  mode: "auto",
  strict: true,                  // strict Mustache var check
  schema: z.object({...}),       // response parsed through this if non-streaming
});
```

POSTs `function/invoke` through Braintrust's AI proxy (`proxyConn()`).

**`initFunction({projectName, slug, version?})`** ([`invoke.ts:267-296`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/functions/invoke.ts)) — returns a curried async fn usable directly as `Eval` task or scorer:

```ts
const myScorer = initFunction({projectName: "p", slug: "my-scorer"});
await Eval("test", { task, scores: [myScorer] });
```

Disables span cache (remote spans won't be locally cached).

### Langfuse — no functions concept

**None.** No "Function" abstraction, no server-side `invoke()`, no tools-as-pushable-entities. Tools exist only as a parameter on the OpenAI request (the user owns them).

### Agenta parity

- Has tools concept server-side.
- Python SDK has `tool` registrations via `workflow` decorator framework.

### Implication for agenta

1. **First-class tools and scorers as pushable entities** (Braintrust pattern) — agenta already has tools; promote them. Single `Project` DSL with sub-builders.
2. **Two-mode scorer**: code (`handler` function) + LLM-classifier (`messages` + `model` + `choiceScores`). Server runs the classifier path.
3. **Server-side `invoke({function_id | (project,slug)+version, input, schema, parent, stream})`** — covers the "run my pushed agent from another env" case.
4. **`initFunction(...)` as a curry helper** — handle returned is usable as Eval task or as a callable.
5. **Zod schemas converted to JSON Schema at upload via `zodToJsonSchema`** — borrow.

---

## 14. CLI & developer workflow

### Braintrust — `braintrust eval`, `push`, `pull`

CLI binary is `braintrust` (NOT `bt` — common misconception). `js/package.json:20-22`. Three subcommands ([`cli/index.ts:1069-1190`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/cli/index.ts)).

**`braintrust eval`** ([`cli/index.ts:1073-1134`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/cli/index.ts)):
- Discovers `**/*.eval.{ts,tsx,js,jsx}` in input paths (excludes `node_modules/dist/build`).
- Bundles each via esbuild (`platform:"node"`, `treeShaking:true`, `external:["node_modules/*"]`).
- `globalThis._lazy_load=true` during import → `Eval(...)` / `projects.create(...)` register into `globalThis._evals` instead of executing.
- Then for each evaluator: `initExperiment(...)` → `runEvaluator(...)` → reporter.
- Flags: `--api-key`, `--org-name`, `--app-url`, `--env-file`, `--debug-logging error|warn|info|debug`, `--filter <regex...>`, `--list`, `--jsonl`, `--terminate-on-failure`, `--tsconfig`, `--external-packages`, `--watch`, `--no-send-logs`, `--no-progress-bars`, `--bundle` (experimental), `--push`, `--dev/--dev-host/--dev-port/--dev-org-name`.
- `--watch`: esbuild context watch; on rebuild re-runs all evals in touched file.

**`braintrust eval --dev`** — starts an Express server ([`dev/server.ts:57`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/dev/server.ts)) exposing:
- `GET /list` — each evaluator's `parameters`, `scores`, `classifiers` shapes.
- `POST /eval` — accepts `{name, parameters, parent, experiment_name, project_id, data, scores, stream}`, validates params against Zod schema, optional SSE stream.

**This is what the Braintrust playground's "Remote evals" tab talks to.** Local eval files become live-runnable from the web UI — non-obvious feature, worth flagging.

**`braintrust push`** ([`cli/index.ts:1136-1151`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/cli/index.ts)):
- Bundles ALL `.ts/.tsx/.js/.jsx` (not just `.eval.*`) via esbuild.
- Uploads prompts, tools, scorers, tasks, classifiers, parameters.
- Flags: `--if-exists error|replace|ignore`.

**`braintrust pull`** ([`cli/index.ts:1153-1179`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/cli/index.ts)):
- Pulls functions from server, writes one `.ts` per project.
- Flags: `--output-dir` (default `./braintrust`), `--project-name`, `--project-id`, `--id`, `--slug`, `--version`, `--force`.
- Refuses to overwrite files dirty in `git diff HEAD` unless `--force`.
- Generated file uses `braintrust.projects.create(...)` skeleton.
- Formatted with Prettier if available.

**Missing**: no `bt init` scaffolding, no `bt datasets`/`bt experiments`/`bt secrets` subcommands.

### Langfuse — no CLI

**No CLI.** Confirmed by `scripts/` inspection and `package.json` `bin` fields in all six packages. The `langfuse/experiment-action` GitHub Action ([`RunnerContext.ts:31-32`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/experiment/RunnerContext.ts)) is the closest thing.

### Agenta parity

- No TS CLI today.
- Python SDK has no CLI either (just imports).

### Implication for agenta

1. **CLI is meaningful differentiator** but expensive to maintain. Decide based on user value, not parity.
2. **If shipping CLI: three subcommands max for v1** — `eval`, `push`, `pull`. Skip `init` scaffolding.
3. **`--dev` mode server is the highest-value differentiator** — local eval files runnable from web playground. Concrete UX moment.
4. **esbuild bundling + `globalThis._lazy_load` pattern** for registration without execution. Same code runs locally AND pushes.
5. **`bt pull` git-dirty check before overwrite** ([`cli/util/pull.ts:80-130`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/cli/util/pull.ts)) — nice safety.
6. **`--if-exists error|replace|ignore`** for push — explicit conflict resolution.

---

## 15. Auth, multi-project, orgs

### Braintrust — API key, idempotent login, per-call state for multi-tenant

`login(options)` ([`logger.ts:4934-4974`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) — idempotent. Throws if re-login with different `appUrl`/`apiKey`/`orgName` unless `forceLogin:true`.

`loginToState(options)` ([`logger.ts:4976`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) — creates fresh `BraintrustState`, no global side effect. Multi-tenant use.

Endpoint: `POST /api/apikey/login` with `Authorization: Bearer ${apiKey}`. Response: `{ org_info: [{id, name, api_url, proxy_url, git_metadata?}] }`.

`_saveOrgInfo`: if `orgName` passed, picks that one; else first; throws `LoginInvalidOrgError` if not found or user has zero orgs.

**Env vars**: `BRAINTRUST_API_KEY`, `BRAINTRUST_ORG_NAME`, `BRAINTRUST_APP_URL`, `BRAINTRUST_API_URL`, `BRAINTRUST_APP_PUBLIC_URL`, `BRAINTRUST_PROXY_URL`.

**API key only.** No OAuth, no token refresh. Test mode uses sentinel `TEST_API_KEY`.

**Multi-org switching**: pass `state: stateArg` (a fresh `BraintrustState` from `loginToState`) into any of `init/initDataset/initLogger/initExperiment/loadPrompt/loadParameters/invoke`. State holds its own login token + caches.

**Project switching**: per-call `project | projectId | projectName`. No "current project" global. `currentExperiment()`/`currentLogger()`/`currentSpan()` are AsyncLocalStorage-backed.

**No workspace concept beyond `organization`.** Permissions live server-side.

### Langfuse — public+secret HTTP Basic, one client per project

`new LangfuseClient({publicKey, secretKey, baseUrl, timeoutSeconds, additionalHeaders})` ([`LangfuseClient.ts:254-318`](https://github.com/langfuse/langfuse-js/blob/main/packages/client/src/LangfuseClient.ts)):

- `publicKey` → HTTP Basic auth username + `X-Langfuse-Public-Key` header.
- `secretKey` → HTTP Basic auth password.
- Env fallback: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (→ legacy `LANGFUSE_BASEURL` → `"https://cloud.langfuse.com"`).
- **Missing keys log warnings only — no throw.**
- `timeoutSeconds` default 5, override via `LANGFUSE_TIMEOUT`.

**No singleton, no `init()`.**

**Multi-project**: no per-call project override. **Each project requires its own `LangfuseClient` instance** (different keys). `projectId` is lazy-fetched once via `api.projects.get()` only when constructing trace URLs.

**Org/project admin APIs** (`api.organizations.*` 8 methods, `api.projects.*` 7 methods) require org-scoped key — throw `MethodNotAllowedError` for project-scoped keys.

**SCIM support** — 7 methods at [`scim/client/Client.ts:77-823`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/scim/client/Client.ts) covering ServiceProviderConfig, ResourceTypes, Schemas, User CRUD (no `updateUser`). EE feature.

**`X-Langfuse-Sdk-*` headers** on every request ([`Client.ts:39-44`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/Client.ts)): `X-Langfuse-Sdk-Name`, `X-Langfuse-Sdk-Version`, `X-Langfuse-Public-Key`. Useful for server-side per-SDK observability.

### Agenta parity

- Has API key auth.
- Has orgs + workspaces server-side.

### Implication for agenta

1. **`globalThis[Symbol.for("agenta-state")]` for primary state** (Braintrust pattern). Singleton + multi-tenant escape hatch via `agenta.loginToState(...)`.
2. **API key only for v1.** No OAuth. Mimics both competitors.
3. **Per-call `project | projectId` arg** (Braintrust pattern, NOT Langfuse's "one client per project"). Multi-project from single client is the common case.
4. **`X-Agenta-Sdk-Name`, `X-Agenta-Sdk-Version`, `X-Agenta-Project-Id` headers** on every request — bake in from day one.
5. **SCIM support is EE-only** — defer to v2.
6. **Org admin endpoints behind `client.admin.*`** (Langfuse flags this implicitly with `MethodNotAllowedError` for project-scoped keys; agenta should make scope explicit at the surface).

---

## 16. Configuration, secrets, deployments

### Braintrust — none

**No `SecretsManager`/`VaultManager`/`ConfigManager` equivalents.** Everything is env-var or per-call options.

- `BRAINTRUST_API_KEY`, `BRAINTRUST_ORG_NAME` — auth.
- `BRAINTRUST_APP_URL`/`API_URL`/`APP_PUBLIC_URL`/`PROXY_URL` — endpoints.
- `BRAINTRUST_DEBUG_LOG_LEVEL` — log level.
- `BRAINTRUST_PROMPT_CACHE_DIR/MEMORY_MAX/DISK_MAX` — cache.
- `BRAINTRUST_VERBOSE` — cancellation debug.

**Per-environment overrides via `environment` slug** on prompts/parameters/datasets — config-by-data-binding, not config-by-env-file.

No `.env` convention beyond CLI's `loadEnvConfig` (Next.js's env loader) at `cli/index.ts:922`.

**No deployment manager.** Deployment is a Braintrust UI action; SDK only sees resulting `environment` slug.

### Langfuse — none, but server-side `llmConnections` for provider keys

**No `SecretsManager`/`VaultManager`/`ConfigManager`.**

Secrets exist *implicitly* via `api.llmConnections.upsert({secretKey})` ([`llmConnections/types/UpsertLlmConnectionRequest.ts:16`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/llmConnections/types/UpsertLlmConnectionRequest.ts)) — secret stored server-side, only masked form returned (`LlmConnection.displaySecretKey`). Used by Langfuse's dashboard/playground for LLM calls. **Not a client-side declarative-config or vault interface.**

**No config manager.** Application config lives in two places: (a) `Prompt.config: unknown` (opaque per-prompt JSON bag), (b) `Project.metadata: Record<string, unknown>`. Neither is declarative.

**Blob storage** — `api.blobStorageIntegrations.*` ([4 methods](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/blobStorageIntegrations/client/Client.ts)) configures **destinations** (S3/S3_COMPATIBLE/AZURE_BLOB_STORAGE) for trace exports. JSON/CSV/JSONL, gzip, cron-style export modes. **Configures destination, not source.** Not a "secrets vault" for general-purpose use.

### Agenta parity

- **Has `SecretsManager`, `VaultManager`, `ConfigManager` in Python SDK** (`agenta/sdk/managers/{secrets,vault,config}.py`). TS SDK gap.
- Has `DeploymentManager` in Python SDK.

### Implication for agenta

This is the biggest **divergence** from both competitors. Agenta's Python SDK has surfaces neither competitor ships. RFC decision:

**Option A — Match competitors, drop the managers from TS SDK.** Use env vars + `environment` slug for config. Keep `SecretsManager` Python-only.

**Option B — Port the managers.** Adds maintenance cost but maintains Python ↔ TS parity. Users on both runtimes get consistent surfaces.

**Recommendation: Option A for v1.** Reasoning:
- Both competitors converged on "env-var + per-call options + environment slug" — strong signal it's enough for ~90% of cases.
- `SecretsManager`/`VaultManager` in Python SDK are thin wrappers over agenta's API; nothing prevents Python and TS users from using the API directly via raw client.
- TS users rarely need declarative-config-from-yaml at SDK load — they tend to be application code, not infra.
- **Defer to v2** if measured user demand exists. Don't pre-commit to maintaining ConfigManager parity.

For v1: ship `client.api.secrets.*` raw API access (matching Langfuse's `llmConnections.upsert` pattern), but no high-level manager.

---

## 17. Cost tracking

### Braintrust — server-computed, client normalizes token metrics

**No client-side cost calculation.** SDK extracts token counts from provider usage objects ([`openai-utils.ts:34-64`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/wrappers/openai-utils.ts)) via `parseMetricsFromUsage` — converts OpenAI's `input_tokens`/`output_tokens`/`total_tokens` to canonical `prompt_tokens`/`completion_tokens`/`tokens`, flattens `*_tokens_details` (`cached_tokens`, etc.) into per-metric keys.

`anthropic-tokens-util.ts:8-30` normalizes Anthropic's `input_tokens` + `cache_*` fields, producing `prompt_tokens = input + cache_creation + cache_read` plus `prompt_cached_tokens` metric.

**`cached` boolean** emitted for HTTP-level prompt-cache hits via `x-bt-cached` / `x-cached` response headers ([`openai-utils.ts:8-9, 75-88`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/wrappers/openai-utils.ts)).

**Model pricing NOT in JS SDK at all** — no hardcoded price table, no fetch. Server owns the price model.

### Langfuse — server-computed, client provides untyped USD bag

`Observation.costDetails: Record<string, number>` ([`commons/types/Observation.ts:47`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/commons/types/Observation.ts)) — free-form key-value bag, computed server-side from `Model.pricingTiers` × `usageDetails`.

Client can set at span-creation: `LangfuseGenerationAttributes.costDetails?: {[k: string]: number}` ([`tracing/src/types.ts:85-87`](https://github.com/langfuse/langfuse-js/blob/main/packages/tracing/src/types.ts)).

**Implicit USD currency** — no `currency` field on `costDetails` itself. Doc example shows `costDetails: { totalCost: 0.002, currency: 'USD' }` but `currency: 'USD'` would coerce to NaN (type is `Record<string, number>`). **Known typing gap.**

**Model pricing**: `Model.pricingTiers: PricingTierInput[]` ([`models/types/CreateModelRequest.ts:22-42`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/models/types/CreateModelRequest.ts)) supports conditional tiers with `priority`, `isDefault`, `conditions`. Flat `inputPrice`/`outputPrice`/`totalPrice` are deprecated.

### Agenta parity

- Server-side cost in `evaluations` / `traces`.
- **Empirical finding (v4, 2026-05-12)**: from real tri-export data on the same `ai.streamText` span — `ag.metrics.costs = {}` (NOT computed); Langfuse server returns `totalCost = 3.6e-06` (computed from `gen_ai.usage.*`); Braintrust per-event metrics. **Agenta currently doesn't compute cost server-side**, but the raw token data IS landing (`ag.metrics.tokens.incremental = {prompt:12, completion:3, total:15}`). Trivial backend fix to add.

### Implication for agenta

1. **No client-side cost calculation.** Send normalized token metrics, compute server-side. Both competitors converge.
2. **Mirror `parseMetricsFromUsage` and `parseCachedHeader` helpers** (Braintrust pattern) — 40 lines each, cover OpenAI/Anthropic shapes including cached tokens.
3. **`costDetails: Record<string, number>` server-returned, untyped USD bag** (Langfuse pattern). Don't model currency at type level — Langfuse tried and quietly broke it.
4. **`Model.pricingTiers` with conditional tiers from day one** — Langfuse hit migration pain when adding tiered pricing on top of flat. Don't repeat.
5. **Wire `gen_ai.usage.*` → cost computation on the backend.** Token data already lands; just need a pricing table + rollup. Closes the empirically-observed gap with both competitors.

---

## 18. Read-back & query surface

### Braintrust — `ObjectFetcher` AsyncIterable + BTQL AST

Unified read API: `ObjectFetcher<RecordType>` ([`logger.ts:6044-6212`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):

```ts
class ObjectFetcher<T> {
  fetch({batchSize?}): AsyncGenerator<WithTransactionId<T>>;
  fetchedData({batchSize?}): Promise<T[]>;      // eager + cached
  version({batchSize?}): Promise<string>;
  clearCache(): void;
}
```

`objectType: "dataset" | "experiment" | "project_logs" | "playground_logs"`.

Under the hood: **BTQL** (Braintrust Query Language) AST POSTed to `btql` endpoint ([`logger.ts:6101-6138`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)):

```ts
{
  query: {
    select: [{op:"star"}],
    from: {op:"function", name:{op:"ident",name:[objectType]}, args:[{op:"literal",value:objectId}]},
    cursor, limit,
    ...internalBtqlWithoutReservedKeys  // raw AST passthrough
  },
  use_columnstore: false, brainstore_realtime: true,
  query_source: "js_sdk_object_fetcher_<type>",
  version?: pinnedVersion
}
```

**`_internal_btql` escape hatch** — accepts arbitrary BTQL filters/projections (reserves `cursor/limit/select/from`).

`getPromptVersions(projectId, promptId)` ([`logger.ts:8579-8643`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/main/js/src/logger.ts)) is the only public BTQL example in user-facing surface — filters for `audit_data.action in ("upsert","merge")`.

**No SQL/Lucene DSL, no full-text.** BTQL is the SQL-ish AST that Braintrust's columnstore exposes.

### Langfuse — typed `client.api.*` endpoints + Cube-style metrics

Read endpoints via `client.api.*`:

- `api.observations.getMany`, `api.legacy.observationsV1.get` (singular get via legacy path).
- `api.trace.get`, `api.trace.list`, `api.trace.delete`, `api.trace.deleteMultiple`. Note: singular `trace` namespace (real, not typo).
- `api.scores.getMany`, `api.scores.getById`.
- `api.sessions.list`, `api.sessions.get`.
- `api.datasets.list`, `api.datasetItems.list`.

**`api.metrics.metrics(GetMetricsV2Request)`** ([`metrics/client/requests/GetMetricsV2Request.ts:12-62`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/api/api/resources/metrics/client/requests/GetMetricsV2Request.ts)) — **Cube-style query DSL** as JSON-stringified arg:

```ts
{
  view,
  dimensions: [{name: "..."}],
  metrics: [{aggregation: "...", measure: "..."}],
  filters: [{column, operator, value, type}],
  timeDimension: {granularity, dateRange},
  fromTimestamp, toTimestamp,
  orderBy: [{column, direction}],
  config: {bins?, rowLimit?}
}
```

**`api.comments.*`** (3 methods) — comment on TRACE | OBSERVATION | SESSION | PROMPT.

### Agenta parity

- Has query endpoints server-side.
- No TS SDK read-back surface today.

### Implication for agenta

1. **`AsyncIterable` + cursor + per-page paging** as the primary read shape (Braintrust pattern).
2. **Cube-style metric DSL** (Langfuse `api.metrics.metrics`) is mature and well-typed — borrow the request shape for agenta's metrics endpoint.
3. **Single `client.api.*` surface for raw access**; 5 high-level managers for the opinionated read path (Langfuse split).
4. **No SQL/Lucene** — too much surface to maintain. Cube-style or BTQL-style filter object is enough.

---

## 19. Type safety & ergonomics

### Braintrust

- **Generics-heavy.** `init`/`initLogger`/`initDataset` carry `IsOpen extends boolean = false` and `IsAsyncFlush extends boolean = true`. `wrapTraced` returns conditional types based on `IsAsyncFlush`.
- **Zod hard peer dep** `^3.25.34 || ^4.0`. Parallel test suites for v3 + v4. Internally imports `zod/v3`.
- **Flat namespace** — `import * as braintrust from "braintrust"` works.
- **Error handling**: throws by default; instrumentation paths swallow via `debug-logger.ts` + `NOOP_SPAN` fallback.

### Langfuse

- **Strict hand-written types** for observation attributes (`LangfuseGenerationAttributes` with typed `model`, `modelParameters`, `usageDetails`, `costDetails`, `prompt: { name, version, isFallback }`).
- **Constants enum is canonical** ([`packages/core/src/constants.ts:10-61`](https://github.com/langfuse/langfuse-js/blob/main/packages/core/src/constants.ts)) — `LangfuseOtelSpanAttributes`. `langfuse.trace.*` for trace, `langfuse.observation.*` for observation, unprefixed `user.id`/`session.id` (lines 13-14).
- **`completionStartTime` for streaming** — set on first chunk receipt ([`traceMethod.ts:205`](https://github.com/langfuse/langfuse-js/blob/main/packages/openai/src/traceMethod.ts)).
- **Discoverability** — namespace on `LangfuseClient` (`langfuse.prompt.*` etc.); tracing functions top-level.
- **Silent fail by default.** Score queue drops on overflow. HTTP failures logged, never throw.

### Implication for agenta

1. **Silent fail on instrumentation paths.** Both converge.
2. **Mirror agenta IDs to OTel-standard keys.**
3. **`completionStartTime` for streaming TTFT.**
4. **Use canonical constants enum** for attribute keys, not magic strings scattered across code.

---

## 20. Notable design opinions

### Braintrust

- **OTel is a peer, not the bus.** Own bg logger, queue, span impl. OTel offered as opt-in interop.
- **`diagnostics_channel.tracingChannel` as unified instrumentation seam** — across manual wraps, AST transforms, bundler plugins, Node `--import` hook. Cross-runtime via `dc-browser` polyfill.
- **Symbol-keyed `globalThis` state** — `Symbol.for("braintrust-state")` for cross-bundle survival.
- **`asyncFlush` typed per-call arg** — elegant return-type flip.
- **Three layers of "auto":** manual → bundler plugin → `--import` hook.
- **CLI bundled in runtime package** (with `dotenv`, `express`, `esbuild`, `chalk`) — cautionary tale.
- **`traceable` alias for LangSmith refugees** — small but telling.
- **First-class "Function" abstraction** — prompts/tools/scorers/tasks/classifiers all pushable.
- **Server-side `invoke()`** — pushes the function/prompt/agent, executes there, returns typed value or stream.
- **Two-tier prompt cache** (LRU memory + gzipped disk).
- **Dev-mode server for playground integration.**
- **No `engines` declaration** — runtime targeting via conditional exports only. Leakier.

### Langfuse

- **OTel is the design.** Not "OTel-compatible" — OTel-native end-to-end.
- **Two transports, one product.** Spans over OTLP, REST for scores/prompts/datasets/etc.
- **5 named managers + raw `client.api.*`** — opinionated read paths + escape hatch for everything else.
- **10 observation types but only 2 attribute shapes** — overstated taxonomy.
- **`propagateAttributes` v5 primitive** — observation-centric trace-level info via OTel context + optional W3C baggage.
- **Stale-while-revalidate prompt cache** — production-grade DX.
- **Eval orchestration in-SDK** — `ExperimentManager`.
- **Migration tax softer than commonly portrayed** — 16 deprecated method aliases preserved.
- **Annotations = scores with `queueId`** — unified data model.
- **Sessions/users as first-class via unprefixed OTel attrs** — undocumented but deliberate.
- **No CLI, no functions concept, no server-side invoke** — much smaller surface than Braintrust.
- **Node-only tracing.** Deliberate split — `@langfuse/otel` and `@langfuse/tracing` both `engines.node >= 20`.

---

## 21. RFC decisions for agenta

Consolidated decision points across all surfaces. Updated to 26 from v2's 17.

### Tracing + export (D1–D6 carried from v2)

- **D1. Wire**: OTLP/HTTP (decided). Split spans vs REST for scores/prompts/datasets — don't force everything through OTel.
- **D2. Package decomposition**: Langfuse-style scoped packages (`@agenta/tracing`, `@agenta/otel`, `@agenta/client`, `@agenta/openai`). Keep CLI separate.
- **D3. State**: `globalThis[Symbol.for("agenta-state")]` (Braintrust pattern).
- **D4. Tracing API shape**: hybrid — generator-aware HOF (`ag.trace(fn)`) on OTel spans + `startSpan`/`startActiveSpan` imperative.
- **D5. AI SDK v6 abort handling**: `AgentaSpanProcessor` intercepts `AsyncIterable.return()/.throw()` + `AbortSignal`. Headline differentiator.
- **D6. Edge runtime**: 4 conditional builds (`node`/`workerd`/`edge-light`/`browser`).

### Tracing API details

- **D7. Attribute propagation**: Langfuse `propagateAttributes` pattern. OTel context + optional W3C baggage. WARN on truncation, don't silent-drop.
- **D8. Provider integration**: OTel-only via `experimental_telemetry` for v1. Per-provider Proxy wrappers in v2 only if measured DX gap.
- **D9. Mask function**: async-aware, six attribute slots, sentinel on throw, applied before media extraction (Langfuse pattern).
- **D10. `asyncFlush: boolean` typed per-call arg** (Braintrust pattern).
- **D11. Env var design**: namespace per subsystem (`AGENTA_SPAN_FLUSH_AT` vs `AGENTA_SCORE_FLUSH_AT`).

### Prompts

- **D12. Prompt cache: SWR + optional disk**. Langfuse SWR pattern + Braintrust disk-cache layer. Default 60s TTL, 0 to bypass. Disk at `~/.agenta/prompt_cache`, gzipped, eviction by mtime.
- **D13. Templating: plugin registry, Mustache default**. Lint hook for variable validation. Nunjucks/other engines opt-in via side-packages.
- **D14. `prompt.build()` returns LLM request shape** (Braintrust pattern), not just template. Auto-attaches span metadata. Don't invoke model client-side.
- **D15. Three signature overloads typed for chat/text** (Langfuse pattern). Include `fallback` body for offline resilience.
- **D16. Use variant revision IDs as wire identity**, NOT semver. Layer `environment`/`deployment` slugs as orthogonal axis.
- **D17. Tools binding on prompts** (Braintrust `PromptDefinitionWithTools`) — inline + references to pushed tools.
- **D18. Add what Langfuse skips**: warn on unused/missing variables before render.

### Datasets

- **D19. Manager = opinionated read path, raw `api.*` = admin** (Langfuse split). Don't expose full CRUD on high-level manager.
- **D20. `AsyncIterable` + cursor + per-page paging** (Braintrust `ObjectFetcher`). Default batch 1000.
- **D21. `sourceTraceId`/`sourceObservationId` first-class nullable strings on items** (Langfuse) — lineage tracking.
- **D22. `item.link(obj, runName)` snaps active span trace ID** — single call from task code.
- **D23. Three pin modes for dataset version**: `version > snapshot > environment` precedence.
- **D24. JSON Schema input/expected validation** (Langfuse pattern).

### Evals

- **D25. Adopt Braintrust's `Evaluator` field set, not Langfuse's lighter version**. Key fields: `trialCount`, rolling `maxConcurrency` with byte backpressure, `OneOrMoreScores`, `errorScoreHandler`, `returnResults`, `enableCache`, `EvalHooks`.
- **D26. Failed evaluator errors → `dataType: "ERROR"` scores**, NOT silently dropped (Langfuse anti-pattern).
- **D27. Content-addressed item IDs** (Langfuse pattern, SHA-256 prefix) for dedup.
- **D28. Server-driven `summarize()`** (Braintrust pattern) — don't compute diffs/improvements/regressions client-side.
- **D29. AutoEvals adapter as documented integration**.
- **D30. Eval scorers in separate package** (`@agenta/evals`) — Braintrust `autoevals` model.
- **D31. Git metadata capture** (Braintrust pattern) — commit/branch/diff if dirty (truncated 64KB), org-level settings for opt-out.
- **D32. `format({includeItemResults})` text summary** for CI.

### Scoring

- **D33. Five `ScoreDataType`s**: `NUMERIC | BOOLEAN | CATEGORICAL | CORRECTION | TEXT` (Langfuse).
- **D34. Server-side `ScoreConfig` schemas**, pin scores via `configId`.
- **D35. Fire-and-forget queue, explicit `flush()`**. `MAX=100k`, `BATCH=100`. Don't silently drop on overflow — expose `onScoreQueueOverflow(score)` hook.
- **D36. Convenience overloads**: `score.observation(span, data)`, `score.trace(span, data)`, `score.activeObservation(data)`.
- **D37. Allow attaching scores inline via `span.log({scores})`** (Braintrust pattern) for discoverability.

### Media

- **D38. Auto-extraction from span attributes** (Langfuse pattern), not explicit `Attachment` instances. Six attribute slots to scan.
- **D39. Per-`instrumentationScope` adapter for third-party SDKs** (Langfuse `ai` special-case pattern).
- **D40. Presigned URL upload + sha256 dedup + exponential backoff + status patch-back**.

### Annotations

- **D41. Annotations = scores with `queueId`** (Langfuse pattern) — unified data model.
- **D42. Ship a high-level manager** (Langfuse only exposes raw API — friction point to improve on).
- **D43. Queue item types**: TRACE | OBSERVATION | SESSION. Status: PENDING | COMPLETED.
- **D44. Pin to `scoreConfigIds[]`** for schema enforcement.

### Sessions, users, metadata

- **D45. First-class `userId`/`sessionId`** — don't make them metadata (Braintrust's gap).
- **D46. Mirror to OTel-standard `user.id`/`session.id` keys** (Langfuse undocumented dual-write).
- **D47. `propagateAttributes(...)` HOF** for scope-bound metadata propagation.
- **D48. Sessions materialized server-side** — no explicit `session.create()`.
- **D49. W3C baggage opt-in for cross-service** propagation.
- **D50. 200-char validation BUT log at WARN**, not silently.

### Functions, tools

- **D51. First-class tools and scorers as pushable entities** (Braintrust pattern). Single `Project` DSL with `tools/prompts/parameters/scorers` sub-builders.
- **D52. Two-mode scorer**: code handler + LLM-classifier (`messages` + `model` + `choiceScores`).
- **D53. Server-side `invoke({function_id | (project,slug)+version, input, schema, parent, stream})`**.
- **D54. `initFunction(...)` curry helper** — handle usable as Eval task or callable.

### CLI

- **D55. CLI is optional but high-leverage.** Three subcommands max for v1: `eval`, `push`, `pull`.
- **D56. `--dev` mode server is the highest-value differentiator** — local eval files runnable from web playground.
- **D57. esbuild bundling + `globalThis._lazy_load` pattern** for registration without execution.
- **D58. `bt pull` git-dirty check before overwrite** — safety.
- **D59. `--if-exists error|replace|ignore`** for push.

### Auth + multi-project

- **D60. API key only for v1.**
- **D61. Per-call `project | projectId` arg** (Braintrust pattern), NOT one-client-per-project (Langfuse pattern).
- **D62. `X-Agenta-Sdk-Name/Version/Project-Id` headers** on every request.
- **D63. Org admin endpoints behind `client.admin.*`** to make scope explicit.

### Configuration

- **D64. No `SecretsManager`/`VaultManager`/`ConfigManager` in TS SDK v1.** Use env vars + per-call options + `environment` slug. Defer to v2.
- **D65. Ship `client.api.secrets.*` raw API** matching Langfuse `llmConnections` pattern.

### Cost

- **D66. Server-side cost calculation.** Send normalized token metrics.
- **D67. Mirror `parseMetricsFromUsage` + `parseCachedHeader`** helpers.
- **D68. `Model.pricingTiers` with conditional tiers from day one**.

### Query / read-back

- **D69. `AsyncIterable` + cursor paging** as primary read shape.
- **D70. Cube-style metric DSL** (Langfuse `metrics.metrics`) for the metrics endpoint.

### Cross-cutting

- **D71. Silent fail on instrumentation paths.** Debug logger gated on `AGENTA_DEBUG=1`.
- **D72. `engines: node >= 18` + `sideEffects: false` declared** on every package.
- **D73. Canonical constants enum** for attribute keys.
- **D74. Migration plan: one consolidated v1→v2 cut**, with `bind()` re-export compat shim. Don't repeat Langfuse's three-release tax.
- **D75. In-repo `MIGRATION.md`** alongside CHANGELOG.

### Empirical-evidence-driven (v4)

- **D76. Surface per-destination delivery health.** P-BRAINTRUST-01 lesson generalizes: OTel exporters return success on HTTP 200 even when the gateway accepts the request but storage is unreachable. If `@agenta/sdk-tracing` fans out to multiple backends, surface explicit delivery status per destination (e.g., periodic health-ping via REST API; warning log on first failure; opt-in metrics callback). `SimpleSpanProcessor`'s success callback is not proof of delivery.
- **D77. Document data-plane / multi-region selection loudly.** Don't bury alternative endpoints in docs. If agenta ever ships an EU/US data plane split, default to a config error (not silent US fallback) when ambiguous. If agenta documents fan-out to Braintrust, lead with the data-plane callout — saves users the ~3 hours of empirical discovery.
- **D78. Scope-filter logic belongs at ingest/render, NOT as a JS SpanProcessor.** P-LANGFUSE-01 confirms: Langfuse's `isDefaultExportSpan` filter is JS-SDK-only. Raw OTLP to Langfuse stores everything. The pattern is portable to agenta's backend with the same effect — clean trace lists in the UI without requiring users to install yet another SDK. **Cleaner architecture than the Langfuse SpanProcessor approach.**
- **D79. The tri-export pattern is real.** Customers can wire Agenta + Braintrust + Langfuse + others in ~10-12 LoC per extra backend via `SimpleSpanProcessor` fan-out on one `NodeTracerProvider`. **The case for `@agenta/sdk-tracing` is no longer "wraps OTel ergonomically"** (insufficient differentiation) — it's "hides config gotchas that silently lose data" + "solves what raw OTLP can't" (AI SDK v6 abort lifecycle bugs).
- **D80. Cost computation server-side, populated from `gen_ai.usage.*`.** Empirical gap: agenta currently returns `ag.metrics.costs = {}` while Langfuse computes `totalCost` from the same wire data. Trivial backend fix. Don't move cost to the SDK.

---

## 22. Differentiation opportunities (ranked by leverage)

1. **AI SDK v6 streamText + abort flush correctness.** Source confirms neither competitor handles this. Langfuse issue #12643 OPEN. Braintrust no `AbortSignal` handling in `wrappers/ai-sdk/`. **Headline.**
2. **Edge runtime tracing that actually works.** Langfuse not supported. Braintrust ships per-runtime bundles but proprietary wire. Spike-validated pain.
3. **Multi-backend delivery health verification (v4).** P-BRAINTRUST-01 proves OTel exporters silently lose data on data-plane mismatch. **No vendor SDK surfaces this**; raw OTel doesn't either. A wrapper SDK that ping-checks each destination via REST API and surfaces failures explicitly is concrete differentiation. The pain is real and the solution is small.
4. **Server-side scope filter (v4)** for P-COMMON-01 (Next.js wrapper-span clutter). P-LANGFUSE-01 confirms Langfuse only does this JS-SDK-side, NOT server-side. Agenta can match the UX with a backend filter — strictly cleaner architecture, helps Python SDK + raw OTel users too. Zero JS SDK code required.
5. **Annotation queues with a high-level manager.** Langfuse only exposes raw API. Friction point.
6. **First-class scope-bound user/session propagation + W3C baggage** + 200-char-WARN-not-silent.
7. **Stale-while-revalidate prompt cache + optional disk layer** (Langfuse + Braintrust combined).
8. **Failed evaluator → `dataType: "ERROR"` score**, not silently dropped (Langfuse anti-pattern fix).
9. **Cost computation server-side from `gen_ai.usage.*` (v4)** — empirical gap with both competitors. Token data lands; just needs pricing table + rollup. Closes a visible regression on the trace-list UI.
10. **TanStack Start documentation + helper.** Neither competitor documents it. P-TANSTACK-01 captured. Low-effort win.
11. **One consolidated v1→v2 migration** with `bind()` compat shim, not three breaking releases.
12. **`asyncFlush` per-call typed boolean** (Braintrust pattern, lift).
13. **`--dev` mode server for web playground integration** if shipping CLI.
14. **Manager + raw API split** (Langfuse 5-manager pattern) — discoverable + escape hatch.
15. **Symbol-keyed globalThis state for cross-bundle survival** (Braintrust pattern).

---

## 23. Open questions for the RFC

- Do we ship a CLI in v1, or defer to v2?
- Do we ship Functions/Tools/Server-side invoke as first-class (Braintrust shape) or punt and let users go through API directly?
- Do we adopt `diagnostics_channel.tracingChannel` for instrumentation, or stick with OTel `SpanProcessor` + Proxy wrappers?
- Browser support: AsyncLocalStorage polyfill or punt browser tracing entirely?
- Do we port `SecretsManager`/`VaultManager`/`ConfigManager` from Python SDK, or accept divergence?
- Annotations: high-level manager or raw API only?
- Eval scorers: in `@agenta/sdk` or separate `@agenta/evals` package?
- Prompt templating: Mustache default + plugin registry, or pick one and lock?
- How aggressive is the v1 cut? Match every Python SDK manager, or trim to "tracing + prompts + datasets + evals" for v1?

---

## Appendix A: v1 → v2/v3/v4 corrections summary

**v1** (web research): ~18 wrong/imprecise claims.
**v2**: source-audited tracing + export, corrected ~18 claims.
**v3**: source-audited every non-tracing surface (prompts, datasets, evals, scoring, media, annotations, sessions, functions, CLI, auth, config, cost, query) and added entire new sections (§§6-18).
**v4**: empirical verification via tri-export to all 3 backends on 8 spike apps. Trace counts pulled from REST API. Two new pain entries (P-BRAINTRUST-01, P-LANGFUSE-01). One v3 claim corrected.

### Notable corrections in v4 (beyond v3)

| Surface | Wrong (v3 implied or stated) | Source-confirmed empirically (v4) |
|---|---|---|
| Langfuse scope filter | "`isDefaultExportSpan` filters non-LLM spans" framed as a Langfuse-platform feature | **JS-SDK-only.** Lives inside `@langfuse/otel`'s `LangfuseSpanProcessor`. Raw OTLP to Langfuse cloud stores ALL spans including non-LLM wrappers — no server-side filter exists. P-LANGFUSE-01. |
| Cross-vendor wire | "Vendor-specific" framing of attribute mappings | **All three backends accept raw OTLP** with ~10-12 LoC additional wiring per backend. The vendor SDKs are layered on top, but the bus is the same. |
| Delivery confirmation | Implicit assumption that exporter-success = delivery | P-BRAINTRUST-01: OTel exporters return HTTP 200 even when the gateway accepts the request but storage is on a different data plane. Spans silently lost. Multi-backend OTel pipelines need explicit REST-API verification, not just span-export-success. |
| Cost computation | v3 said "Langfuse `costDetails` server-returned" | v4 confirms with real data: Langfuse server returns `totalCost = 3.6e-06` computed from `gen_ai.usage.*`. **Agenta server currently returns `ag.metrics.costs = {}`** — gap is on agenta's side, not in the SDK. |
| Trace structure rendering | v3 didn't quantify | v4 has side-by-side: same `ai.streamText` span, three backends. Same data, three rendering choices. Agenta picks the wrong span as trace-list row (P-COMMON-01); Langfuse rolls up to trace level; Braintrust flat events with `span_parents`. |
| Multi-backend wiring cost | Not measured in v3 | v4: ~8 LoC for +Braintrust, ~12 LoC for +Langfuse on top of agenta baseline. Tri-export pattern works. |

### Notable corrections in v3 (beyond v2)

| Surface | Wrong (or missing in v2) | Source-confirmed (v3) |
|---|---|---|
| Prompts (Braintrust) | "Prompt registry similar to Langfuse" | Versions are `_xact_id` transaction IDs, NOT semver. `build()` returns full LLM request shape, not just template. Two-tier cache (memory + gzipped disk). Cache only on server fault. |
| Prompts (Langfuse) | "Cache with 60s TTL" | Stale-while-revalidate with concurrent-refresh dedup. `getIncludingExpired` returns stale, refreshes in background. `cacheTtlSeconds: 0` bypass. |
| Datasets (Braintrust) | Brief mention of `initDataset` | Full CRUD + snapshots + restore + `summarize` + three pin modes. `AsyncIterable` via `ObjectFetcher`. |
| Datasets (Langfuse) | "Manager has CRUD" | Manager only has `get`. CRUD on raw `api.datasets.*`. Deliberate split. |
| Evals (Braintrust) | "`Eval(name, opts)` is good" | ~25 fields in `Evaluator` interface. Rolling concurrency with byte backpressure. `OneOrMoreScores` return type. `errorScoreHandler` for graceful failure. |
| Evals (Langfuse) | "`ExperimentManager.run` in-SDK" | Default `maxConcurrency = 50` (JSDoc bug says Infinity). Batched not rolling. Failed evaluators silently absent. |
| Scoring | "Both have queue" | Braintrust has NO separate score queue — scores ride spans. Langfuse has dedicated queue with 5 data types and `ScoreConfig` server schemas. |
| Annotations | Not covered in v2 | Braintrust has NONE. Langfuse has raw API only (no manager). Annotations = scores with `queueId`. |
| Sessions/users | Not covered in v2 | Braintrust has NO first-class. Langfuse has via `propagateAttributes` → unprefixed OTel `user.id`/`session.id`. |
| Functions | Not covered in v2 | Braintrust has first-class `Project.tools/prompts/parameters/scorers` + server-side `invoke()`. Langfuse has NONE. |
| CLI | Brief mention in v2 | Braintrust has `eval/push/pull` + `--dev` mode server for playground. Langfuse has NO CLI. |
| Configuration | Not covered in v2 | NEITHER competitor has `SecretsManager`/`VaultManager`/`ConfigManager`. Both punt to env vars + `environment` slug. Agenta Python SDK is the outlier. |
| Cost | Not covered in v2 | Both server-side. Braintrust normalizes token metrics. Langfuse `costDetails: Record<string, number>`, implicit USD. |

### Verified v2 corrections (still hold in v3)

- Braintrust span types: 11 not 6.
- Braintrust wire endpoint: `logs3` not `/logs`.
- Braintrust `wrapTraced` handles declared generators only, not arbitrary `AsyncIterable`.
- Both lack `AbortSignal` handling for AI SDK v6 streams.
- Langfuse `@langfuse/tracing` is Node ≥ 20, not Universal.
- Langfuse 10 observation types but only 2 attribute shapes.

---

## Appendix B: source-link inventory

### Braintrust

- Repo: [`github.com/braintrustdata/braintrust-sdk-javascript`](https://github.com/braintrustdata/braintrust-sdk-javascript) (v3.10.0)
- Key files audited:
  - `js/package.json` — exports, deps, no `engines`/`sideEffects`
  - `js/src/exports.ts` (288 lines) — full re-export sheet
  - `js/src/logger.ts` (~8700 lines) — state, queue, prompts, datasets, login, `wrapTraced`, `traceable`, `loadPrompt`, `initDataset`, `ObjectFetcher`, `Eval` impl
  - `js/src/framework.ts` — `Eval`, `Evaluator`, `EvalOptions`, `EvalHooks`, `runEvaluator`
  - `js/src/framework2.ts` — `Project`, `tools/prompts/parameters/scorers` builders, `CodePrompt`, `CodeFunction`
  - `js/src/wrappers/{oai,anthropic,ai-sdk,...}.ts` — provider wrappers
  - `js/src/cli/index.ts` — `eval/push/pull` commands
  - `js/src/cli/functions/upload.ts` — push bundling
  - `js/src/cli/util/pull.ts` — pull + git-dirty check
  - `dev/server.ts` — `--dev` mode Express app
  - `js/src/functions/invoke.ts` — server-side function execution
  - `js/src/runtime-async-local-storage.ts` — runtime detection
  - `js/src/template/{registry,plugins/mustache}.ts` — template plugin registry
  - `js/src/prompt-cache/{prompt-cache,disk-cache}.ts` — two-tier cache
  - `js/util/span_types.ts` — 11 span types
  - `js/src/auto-instrumentations/hook.mts` — Node `--import` hook
  - `js/src/edge-light/config.ts`, `js/src/workerd/config.ts` — per-runtime configs
  - `js/src/gitutil.ts` — git metadata capture
  - `integrations/otel-js/src/otel.ts` — `BraintrustSpanProcessor`, `BraintrustExporter`
  - `integrations/otel-js/src/index.ts` — `setupOtelCompat`
  - `integrations/browser-js/src/index.ts` — browser polyfill
- Docs: [`braintrust.dev/docs`](https://www.braintrust.dev/docs/reference/libs/nodejs)
- External: [`autoevals`](https://github.com/braintrustdata/autoevals) (separate npm package)

### Langfuse

- Repo: [`github.com/langfuse/langfuse-js`](https://github.com/langfuse/langfuse-js) (v5.3.0)
- Six published packages:
  - [`@langfuse/core`](https://www.npmjs.com/package/@langfuse/core)
  - [`@langfuse/client`](https://www.npmjs.com/package/@langfuse/client)
  - [`@langfuse/tracing`](https://www.npmjs.com/package/@langfuse/tracing)
  - [`@langfuse/otel`](https://www.npmjs.com/package/@langfuse/otel)
  - [`@langfuse/openai`](https://www.npmjs.com/package/@langfuse/openai)
  - [`@langfuse/langchain`](https://www.npmjs.com/package/@langfuse/langchain)
- Key files audited:
  - All six `package.json`s — engines, peerDeps, exports
  - `packages/tracing/src/index.ts` — `startObservation`, `startActiveObservation`, `observe`, `createTraceId`, `getActiveTraceId`
  - `packages/tracing/src/types.ts` — 10 observation types, `LangfuseGenerationAttributes`
  - `packages/tracing/src/spanWrapper.ts` — `LangfuseSpan`, `LangfuseGeneration`, `LangfuseEvent`
  - `packages/tracing/src/tracerProvider.ts` — `setLangfuseTracerProvider`, isolation warning
  - `packages/otel/src/span-processor.ts` — Batch/Simple, mask, media, pendingEndedSpans
  - `packages/otel/src/span-filter.ts` — `isDefaultExportSpan`
  - `packages/otel/src/MediaService.ts` — base64 regex, AI SDK special case
  - `packages/client/src/LangfuseClient.ts` — managers + 16 deprecated aliases
  - `packages/client/src/prompt/promptManager.ts` — `get/create/update/delete`, SWR cache integration
  - `packages/client/src/prompt/promptCache.ts` — TTL, refresh dedup
  - `packages/client/src/prompt/promptClients.ts` — `TextPromptClient`, `ChatPromptClient`, `getLangchainPrompt`
  - `packages/client/src/dataset/index.ts` — `get`, `FetchedDataset`, `link`
  - `packages/client/src/score/index.ts` — queue, fire-and-forget, convenience overloads
  - `packages/client/src/media/index.ts` — `MediaManager.resolveReferences`
  - `packages/client/src/experiment/ExperimentManager.ts` — `run`, batching, propagation, format
  - `packages/client/src/experiment/types.ts` — `ExperimentTask`, `Evaluator`, `RunEvaluator`, `Evaluation`
  - `packages/client/src/experiment/RunnerContext.ts` — CI integration
  - `packages/client/src/experiment/adapters.ts` — `createEvaluatorFromAutoevals`
  - `packages/core/src/propagation.ts` — `propagateAttributes`, baggage
  - `packages/core/src/constants.ts` — `LangfuseOtelSpanAttributes` enum
  - `packages/core/src/api/Client.ts` — Fern-generated, 24 sub-resources
  - `packages/core/src/api/api/resources/*` — Fern-generated request/response types
  - `packages/openai/src/observeOpenAI.ts` — recursive Proxy
  - `packages/openai/src/traceMethod.ts` — `wrapAsyncIterable` (the abort gap)
  - `packages/openai/src/types.ts` — `LangfuseConfig`
  - `packages/langchain/src/CallbackHandler.ts` — LangChain callback
  - `packages/core/src/logger/index.ts` — `LoggerSingleton`, env-driven config
  - `tests/e2e/vercel-ai-sdk.e2e.test.ts` — manual `forceFlush()` confirms abort gap
- Docs: [`langfuse.com/docs/observability/sdk/typescript`](https://langfuse.com/docs/observability/sdk/typescript/instrumentation)
- AI SDK v6 IO bug: [`github.com/langfuse/langfuse/issues/12643`](https://github.com/langfuse/langfuse/issues/12643) (OPEN, assigned hassiebp, 2026-03-17)

### Agenta context

- [`docs/design/ts-sdk-tracing/summary.md`](../ts-sdk-tracing/summary.md) — spike status, 11 pain entries
- [`docs/design/ts-sdk-tracing/pain-log.md`](../ts-sdk-tracing/pain-log.md) — full pain entries
- [`web/packages/agenta-sdk/src/index.ts`](../../../web/packages/agenta-sdk/src/index.ts) — current SDK entry
- [`web/packages/agenta-entities/src/`](../../../web/packages/agenta-entities/src/) — entity layer (annotation, testset, trace, workflow, etc.)
- [`sdks/python/agenta/sdk/`](../../../sdks/python/agenta/sdk/) — Python SDK reference (managers, decorators, types)
