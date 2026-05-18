# `ts-sdk-tracing` Pain Log

Structured friction log from spike apps under `web/examples/*`. Each entry captures one awkward moment encountered while wiring raw OpenTelemetry + Vercel AI SDK across framework patterns. This log becomes the requirements input for the SDK.

## Schema (every entry MUST follow this)

```markdown
## P-{FRAMEWORK}-NN: <one-line title>

**Framework:** <node | app-router-raw | app-router-vercel | pages-router-raw | pages-router-vercel | tanstack | nuxt | mastra | common>
**Severity:**
  - User impact: <high | med | low>          // would a real user hit this?
  - Self-recoverable: <yes | partially | no>  // can they fix it from docs alone?
  - Silent failure: <yes | no>                // does it pass tests but produce wrong/missing data?

**The friction (code that exists today):**
\`\`\`ts
// 7-15 lines max showing the awkward thing
\`\`\`

**What would be ideal (sketch of how the SDK would hide this):**
\`\`\`ts
// 2-5 lines showing the proposed shape
\`\`\`

**Notes:** <one paragraph context — when discovered, what was tried, why it matters>
```

## Numbering scheme

Per-framework prefix to prevent merge conflicts on numeric IDs. Each framework numbers independently from `01`:

- `P-NODE-NN` — Node.js standalone
- `P-APP-RAW-NN` — Next.js App Router with raw OTel
- `P-APP-VERCEL-NN` — Next.js App Router with `@vercel/otel`
- `P-PAGES-RAW-NN` — Next.js Pages Router with raw OTel
- `P-PAGES-VERCEL-NN` — Next.js Pages Router with `@vercel/otel`
- `P-TANSTACK-NN` — React TanStack Start
- `P-NUXT-NN` — Nuxt 3/4 (Vue + Nitro)
- `P-MASTRA-NN` — Mastra (agent framework on top of AI SDK v1 vendored)
- `P-COMMON-NN` — Cross-framework / backend-side findings (Agenta UI, adapter, attribute schema)

## Quality bar

Every entry must include both a **code excerpt** (the awkward thing) and an **ideal sketch** (what the SDK would hide). If you can't articulate what would be ideal, the friction isn't structured enough yet — keep thinking before writing.

## Cadence rule

At the end of each work session, the engineer commits at least one new pain entry OR explicitly writes "no new friction this session" in the commit message. No silent skipping. Pre-commit hook (`scripts/validate-pain-log.ts`) validates schema on every commit that touches this file.

## "Done" signal

Stop the spike when **2 consecutive work sessions yield only DUPLICATE friction** (no new entries, only restating existing ones across frameworks). May trigger before all 6 apps are built — partial coverage with saturated pain log beats full coverage with diluted log.

---

## Entries

<!-- Entries are appended below this line. New entries go at the end of their framework's section. -->

### Node.js standalone (P-NODE-*)

> **Distinction (added 2026-05-10):** the pain log is for friction REAL USERS will hit when using `ts-sdk-tracing`. Self-inflicted SDK gaps that we'd obviously fix as part of building the SDK (e.g., "the SDK ships a `dist/`", "init accepts and propagates `projectId`", "host normalization") are **SDK requirements**, not pain entries. Those go in [status.md](./status.md) under "SDK requirements" so they don't crowd out genuine ecosystem friction we have to live with.

## P-NODE-01: OTel `Resource` attributes (incl. `service.name`) don't survive Agenta's adapter pipeline

**Framework:** node
**Severity:**
  - User impact: high
  - Self-recoverable: no
  - Silent failure: yes

**The friction (code that exists today):**

```ts
// Standard OTel pattern: tag your traces with service.name on the Resource:
const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "vercel-ai-spike-node",
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
})

// Then query Agenta for spans matching your service:
await ag.traces.querySpans({
    filtering: {operator: "and", conditions: [
        {field: "attributes", key: "service.name", value: "vercel-ai-spike-node", operator: "is"},
    ]},
})
// → count: 0. Spans arrived (you can see them under the user.id filter), but
//   service.name is GONE — Agenta's adapter doesn't forward Resource attrs to
//   the queryable span attributes. They aren't anywhere in `attributes.ag.*`
//   nor at the top level of the span. Just dropped.
```

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// Agenta should preserve service.name (and other Resource attrs) under a
// known path — e.g., `attributes.ag.resource.service.name` — so the standard
// OTel "tag your service" pattern Just Works.
await ag.traces.querySpans({
    filtering: {filterByService: "vercel-ai-spike-node"},
    // ↑ even better: the SDK exposes a typed helper that hides whatever path
    //   Agenta uses internally
})
```

**Notes:** **Silent failure: yes** — your spans arrive in Agenta and look fine in the UI, but you can't programmatically query by service. Workaround during the spike: every assertion sets `experimental_telemetry.metadata.userId` to a unique-per-run UUID, and verifies/filters on `ag.user.id`. That works because per-call metadata IS preserved (verified by assertion-3), but it's a workaround that breaks down anywhere a user expects standard OTel resource semantics. **Implication for `ts-sdk-tracing`:** either the SDK must expose service-tag helpers that map to whatever attribute path Agenta uses, OR Agenta's adapter must start preserving `service.name` (and other standard Resource attrs) under a documented path. The first is cheaper; the second is more correct.

**Backend-fixable: yes (2026-05-12 analysis).** Pure ingest-side change. The OTLP adapter currently discards Resource attributes; preserving them under `ag.resource.*` is a backend-only fix that benefits every Agenta customer (Python SDK, raw OTel, AI SDK, Mastra). Recommended as part of the "backend wins" tranche before any JS SDK work. See `summary.md` § "Backend-fixable subset (AI SDK)" for the full matrix.

## P-NODE-02: `BatchSpanProcessor` + AI SDK v6 `streamText` silently loses spans — `forceFlush()` doesn't help

**Framework:** node
**Severity:**
  - User impact: high
  - Self-recoverable: partially
  - Silent failure: yes

**The friction (code that exists today):**

The published Agenta + Vercel AI SDK example uses `SimpleSpanProcessor`. But every "production-ready" OTel guide recommends `BatchSpanProcessor` for performance (batch + async ship vs sync ship per span). When you follow that recommendation with AI SDK v6 + `streamText`, spans silently disappear:

```ts
import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-proto"
import {BatchSpanProcessor} from "@opentelemetry/sdk-trace-base"
import {NodeTracerProvider} from "@opentelemetry/sdk-trace-node"
import {streamText} from "ai"

const provider = new NodeTracerProvider({
    resource: ...,
    spanProcessors: [new BatchSpanProcessor(exporter)],  // ← THE PROBLEM
})
provider.register()

const stream = streamText({
    model: openai("gpt-4o-mini"),
    messages: [...],
    experimental_telemetry: {isEnabled: true, metadata: {userId: "test"}},
})
for await (const chunk of stream.textStream) { process.stdout.write(chunk) }

// Even with explicit force flush:
await trace.getTracerProvider().forceFlush()
process.exit(0)
// → ZERO `ai.streamText` spans arrive in Agenta. Process exited cleanly,
//   no errors, no warnings. The traces are just gone.
//
// Same code with `generateText`: spans arrive correctly.
// Same `streamText` code with SimpleSpanProcessor: spans arrive correctly.
// Same `streamText` code in AI SDK v4 + SimpleSpanProcessor: spans arrive correctly.
```

**Verified isolation (2026-05-10):**
- AI SDK v4 + SimpleSpanProcessor + streamText → spans arrive ✓
- AI SDK v6 + SimpleSpanProcessor + streamText → spans arrive ✓
- AI SDK v6 + BatchSpanProcessor + streamText → **spans LOST** (silent)
- AI SDK v6 + BatchSpanProcessor + generateText → spans arrive ✓

So the failure mode is specifically: `BatchSpanProcessor` + `streamText` (in any AI SDK v6+ version we tested).

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK ships an opinionated span processor that handles streamText's
// `endWhenDone: false` semantics correctly:
import {init, agentaSpanProcessor} from "@agenta/sdk"
const provider = new NodeTracerProvider({
    resource: ...,
    spanProcessors: [agentaSpanProcessor({exporter})],  // handles batching + streamText flush
})

// OR: SDK's instrumentation helper sets up the right processor automatically:
import {initInstrumentation} from "@agenta/sdk/otel"
initInstrumentation({apiKey, host}) // chooses processor based on env / batch needs
```

**Notes:** Discovered during assertion-2 (stream flush on mid-abort). Initially blamed the abort, then v6 itself, then mid-stream abort semantics. Final root cause isolated by comparing against the published v4 example (which uses `SimpleSpanProcessor` — and works). Switched our v6 spike to `SimpleSpanProcessor` and assertion-2 immediately passed.

**Why this matters:** the canonical "production OTel" guidance is `BatchSpanProcessor`. Every blog post, every OTel doc, every cargo-culted setup. Users who follow that guidance with AI SDK + Agenta will silently lose all their streaming traces. Streaming chat IS the dominant AI SDK use case. **Implication for `ts-sdk-tracing`:** the SDK MUST either (a) ship a span processor that handles `streamText`'s `endWhenDone: false` flush correctly, (b) ship a `streamText` wrapper that owns the span lifecycle itself, or (c) document loudly that BatchSpanProcessor doesn't work with streamText today and force users onto SimpleSpanProcessor (with the per-call latency cost that implies — bad). Option (a) or (b) is the right answer.

**SimpleSpanProcessor cost:** synchronous export per span = each `generateText` call adds an HTTP round-trip to Agenta before returning. ~50-200ms per call. Acceptable for spike scope, NOT acceptable for production chat apps. The SDK has to solve this for real.

**Docs-coverage clarification (2026-05-12):** Agenta's docs (`docs/docs/integrations/frameworks/vercel-ai-sdk/observability.mdx` line 74) already use `SimpleSpanProcessor` in the canonical example. **Users following the docs end-to-end will NOT hit this bug.** The pain is for users who follow general OTel "production-grade" guidance (which recommends Batch) without reading Agenta's specific docs, or for users on `@vercel/otel` who get Batch by default. **The strategic framing is therefore "performance optimisation on top of a docs-recommended workaround," not "bug in the canonical Agenta integration path":** the SDK should ship a streaming-aware Batch processor that gets Batch's latency benefits WITHOUT Simple's per-span HTTP tax. Minimum docs fix: the existing observability.mdx should explicitly explain WHY Simple is used (not just demonstrate it by example) so users don't naively replace it with Batch.

**Backend-fixable: no (2026-05-12 analysis).** Spans never reach the backend. The streamText parent span ends async after the `BatchProcessor`'s flush window has closed, so the OTLP exporter has nothing to ship at process exit. Backend can't fix what doesn't arrive. JS-side wedge: streamText lifecycle wrapper. See `summary.md` § "Backend-fixable subset (AI SDK)".

## P-NODE-03: Per-call metadata doesn't propagate to all child spans (no way to filter "this run's trace")

**Framework:** node
**Severity:**
  - User impact: med
  - Self-recoverable: partially
  - Silent failure: no

**The friction (code that exists today):**

```ts
// Set metadata on the call:
await generateText({
    ...,
    tools: {getWeather: tool({...})},
    experimental_telemetry: {
        isEnabled: true,
        metadata: {userId: "run-abc-123"},  // unique-per-run
    },
})

// Query Agenta for spans matching this run:
await ag.traces.querySpans({
    filtering: {operator: "and", conditions: [
        {field: "attributes", key: "ag.user.id", value: "run-abc-123", operator: "is"},
    ]},
})
// → Returns parent (`ai.generateText`) and inner provider call
//   (`ai.generateText.doGenerate`). Both carry `ag.user.id`.
// → Does NOT return `ai.toolCall` even though it's part of the same trace.
//   Tool call spans don't inherit parent metadata.
```

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// Either: SDK helper that propagates metadata to all children automatically
ag.traces.findByMetadata({userId: "run-abc-123"}) // returns the full trace, every span
//
// Or: SDK exposes a "find related spans" by trace_id helper:
const parent = await ag.traces.querySpans({...filterByMetadata})
const fullTrace = await ag.traces.fetchTrace({trace_id: parent.spans[0].trace_id})
```

**Notes:** Hit during assertion-1 development. Workaround: assertion-1 only checks for `ai.generateText` (the parent), not its sibling `ai.toolCall`. Tool call presence is verified via the parent's `ag.data.outputs.toolCalls` payload instead. **Implication for `ts-sdk-tracing`:** users will reasonably expect `metadata.userId` to propagate to every span in the trace. Either the SDK helper auto-fills it, OR the SDK exposes a "find full trace by metadata" pattern that hides the parent-only-filtering reality.

**Backend-fixable: yes (2026-05-12 analysis).** Trace-level enrichment at ingest. When all spans of a trace arrive, the backend can cascade the root span's `ag.user.id` / `ag.session.id` to children that lack them. The backend already groups spans by `trace_id`; this is a one-time enricher pass during ingest (or a query-time view). Benefits all Agenta customers regardless of SDK path. See `summary.md` § "Backend-fixable subset (AI SDK)" for the full matrix.

> **Phase 0 setup notes (NOT pain log entries — preserved in code comments for context):**
> Three Phase 0 frictions were captured but excluded from the pain log because they're spike-tooling friction (vitest setup, turbo lint scope, prettier `semi: false`), not Vercel AI SDK / observability friction. Their fixes live in:
> - `web/examples/.shared/agenta-verify/vitest.config.ts` — pinned `root` to avoid monorepo-wide tsconfig inheritance OOM
> - `web/examples/.shared/agenta-verify/package.json` — explicit `lint` script (turbo doesn't auto-exclude)
> - `pnpm lint:fix` was needed once to fix `semi: false` formatting
>
> The pain log stays focused on what `ts-sdk-tracing` should design around. Tooling friction stays in code comments.

### Next.js App Router — raw OTel (P-APP-RAW-*)

## P-APP-RAW-01: Edge runtime route emits ZERO spans even with the documented setup

**Framework:** app-router-raw
**Severity:**
  - User impact: high
  - Self-recoverable: no
  - Silent failure: yes

**The friction (code that exists today):**

The full documented incantation for edge-runtime tracing — fetch-based OTLP exporter, BasicTracerProvider, SimpleSpanProcessor, AND `waitUntil(forceFlush())` via Next 15's `after()` — produces ZERO spans in Agenta:

```ts
// app/api/edge-chat/route.ts
export const runtime = "edge"

import {trace} from "@opentelemetry/api"
import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-http"  // fetch-based
import {BasicTracerProvider, SimpleSpanProcessor} from "@opentelemetry/sdk-trace-base"
import {after} from "next/server"
import {generateText} from "ai"
import {openai} from "@ai-sdk/openai"

let providerInitialized = false
function ensureProvider() {
    if (providerInitialized) return
    providerInitialized = true
    const exporter = new OTLPTraceExporter({
        url: `${AGENTA_HOST}/api/otlp/v1/traces?project_id=${PROJECT_ID}`,
        headers: {Authorization: `ApiKey ${AGENTA_API_KEY}`},
        keepAlive: true,
    })
    const provider = new BasicTracerProvider({resource, spanProcessors: [new SimpleSpanProcessor(exporter)]})
    trace.setGlobalTracerProvider(provider)  // OTel v2 dropped .register()
}

export async function POST(req: NextRequest) {
    ensureProvider()
    const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [{role: "user", content: "hi"}],
        experimental_telemetry: {isEnabled: true, metadata: {userId: "edge-test-1"}},
    })
    after(async () => {
        const tp = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
        if (typeof tp.forceFlush === "function") await tp.forceFlush()
    })
    return NextResponse.json({text: result.text, runtime: "edge"})
}

// Request returns 200 with the generated text. runtime:"edge" confirms it
// actually ran on edge (not silently downgraded). But:
//   curl /api/spans/query → 0 spans for user.id "edge-test-*" or
//   service.name "vercel-ai-spike-app-router-raw" or functionId
//   "app-router-edge-generate". Just gone.
```

**Verified isolation (2026-05-10):**
- Same App Router app's nodejs `/api/chat` route → spans arrive (assertions 1-3 PASS)
- Edge `/api/edge-chat` route → returns 200 with correct payload, runtime confirmed `"edge"` → ZERO spans ever arrive
- No errors logged on the dev server side

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK provides an edge-runtime instrumentation helper that handles
// (a) the right exporter (fetch-based, not buffer-based)
// (b) per-cold-start provider init
// (c) waitUntil-based flush
// (d) whatever else is silently blocking flush today
//
import {initEdgeInstrumentation} from "@agenta/sdk/edge"

export const runtime = "edge"
initEdgeInstrumentation()  // runs once per cold start

export async function POST(req: NextRequest) {
    const result = await generateText({...})
    return NextResponse.json({text: result.text})  // SDK hooks the response to flush
}
```

**Notes:** Discovered immediately on first edge route probe. The route's `runtime: "edge"` field in the response body confirms Next.js DID run it on edge runtime (not silently downgraded), so the issue is genuinely in OTel + edge + Agenta interaction. **Highest-severity finding from Phase 2a** because edge runtime is what Vercel pushes users toward by default for AI routes (lower latency, distributed). If the SDK doesn't fix this, every Vercel user with `runtime = "edge"` silently loses every trace.

**Phase 2b A/B verdict (2026-05-10):** `@vercel/otel` (P-APP-VERCEL-02) DOES emit edge spans, just delayed. So the root cause of THIS entry (raw-OTel-on-edge emits ZERO spans EVER) is something specific to the manual `BasicTracerProvider` + `SimpleSpanProcessor` + `after()` setup, NOT a fundamental limitation of edge runtime + AI SDK + Agenta. Three hypotheses were posed at the time:

1. `SimpleSpanProcessor` + edge `keepAlive: true` fetch — the request handler may complete and return BEFORE the underlying fetch's promise resolves, and the edge function freezes immediately on response
2. `after()` callback executes too late — Next 15's `after()` runs the callback AFTER the response is sent but the edge function may freeze before the forceFlush completes
3. `trace.setGlobalTracerProvider()` not registering the provider in the right way for the AI SDK's auto-instrumentation to pick it up — the AI SDK might use a tracer captured at module load time

**Root cause resolved (2026-05-11)** via source-dive of `@vercel/otel@2.1.2`'s edge bundle (`node_modules/@vercel/otel/dist/edge/index.js`). **None of the three hypotheses as originally written; hypothesis 2 is closest but mechanism-wrong.** The actual mechanism:

- `@vercel/otel` wraps user-supplied span processors in a `CompositeSpanProcessor` whose `onStart` hook, **on every root span open**, reaches into `globalThis[Symbol.for("@vercel/request-context")].get()` and calls `requestContext.waitUntil(forceFlush)`. This is the same primitive backing Next.js `unstable_after()`, but reached directly at the OTel layer, the moment the span opens, before the route handler does anything.
- `waitUntil(promise)` is how the Vercel edge runtime tracks unfulfilled work and defers freezing the isolate until that work completes. The export promise gets enrolled into the isolate's lifetime tracker.
- Our raw setup uses `after(() => provider.forceFlush())`. `after()` runs the callback as Next.js drains its outbound queue, but **does not enroll the resulting promise into the runtime's lifetime tracker** — so the isolate freezes the moment `Response` returns and the OTLP `fetch` is killed mid-flight. Zero spans land.
- `keepalive: true` is a red herring — `@vercel/otel`'s edge exporter doesn't set it either (`grep keepalive` on the edge bundle returns nothing). Protocol-level keepalive isn't the lever; runtime-level `waitUntil` is.
- OTel global provider registration is fine. AI SDK does pick up the global provider; the AI SDK creating a span IS what fires `onStart` and gives `@vercel/otel` its hook in the first place.

So the failure is structural to ANY manual edge OTel wiring that doesn't reach `requestContext.waitUntil`: the isolate freezes before the export `fetch` resolves. **What's still uncertain:** whether the `@vercel/request-context` symbol is populated in `next dev` (our local-only spike scope per Decision 4) or only on deployed Vercel infrastructure. We never confirmed our `@vercel/otel` edge spans actually came through `waitUntil` vs by some other path during local `next dev`; the 10-15s arrival could be incidental (e.g. BatchSpanProcessor's 5s scheduledDelay + retry timing) rather than the `waitUntil`-enrolled flush.

**Backend-fixable: no (2026-05-12 analysis).** Edge isolate freezes before the OTLP fetch resolves; spans never leave the user's process. Backend invisible. JS-side wedge: edge runtime helper that enrolls `forceFlush` into `requestContext.waitUntil` (mirror `@vercel/otel`'s mechanism). See `summary.md` § "Backend-fixable subset (AI SDK)".

### Next.js App Router — `@vercel/otel` (P-APP-VERCEL-*)

## P-APP-VERCEL-01: `@vercel/otel` defaults to BatchSpanProcessor → mid-stream abort flush still loses spans

**Framework:** app-router-vercel
**Severity:**
  - User impact: high
  - Self-recoverable: partially
  - Silent failure: yes

**The friction (code that exists today):**

`@vercel/otel`'s opinionated `registerOTel()` call uses `BatchSpanProcessor` internally — same root cause as P-NODE-02. Mid-stream client abort on `streamText` doesn't ship the trace within the 5s assertion window:

```ts
// app/instrumentation.ts — the entire @vercel/otel setup is one call:
import {registerOTel, OTLPHttpProtoTraceExporter} from "@vercel/otel"

export function register() {
    registerOTel({
        serviceName: "vercel-ai-spike-app-router-vercel",
        traceExporter: new OTLPHttpProtoTraceExporter({url: ..., headers: {...}}),
    })
}

// Then in app/api/chat/route.ts the streamText route mid-aborts via the
// test client's AbortController. assertion-2 polls Agenta for the
// streamText span tagged with the abort run's userId — same as Node v6 +
// Batch + streamText, the trace doesn't appear inside the 5s window.
//
// Confirmed by direct A/B against nextjs-app-router-raw which uses
// SimpleSpanProcessor and PASSES the same assertion in the same test
// fixture. Only variable: processor strategy.
```

**Verified isolation (2026-05-10):**
- `nextjs-app-router-raw` (raw OTel + SimpleSpanProcessor): assertion-2 PASS
- `nextjs-app-router-vercel` (`@vercel/otel` + default BatchSpanProcessor): assertion-2 FAIL
- Same test fixture, same Agenta backend, same AI SDK v6 streamText path

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// Either: SDK forces SimpleSpanProcessor by default (slower per-call but
// reliable), OR ships a "streaming-aware" Batch processor that flushes
// on stream abort + close events.
//
// In the @vercel/otel ecosystem the workaround would be to pass a custom
// spanProcessors array, but that defeats the purpose of using a one-line
// registerOTel() helper.
```

**Notes:** Compounds with P-NODE-02 — they're the SAME underlying problem (BatchSpanProcessor + AI SDK v6 streamText flush ordering) manifested through two different setups. Neither raw OTel nor `@vercel/otel` solves it on its own. **Implication for `ts-sdk-tracing`:** the SDK MUST own the span processor choice and ship one that handles streamText's `endWhenDone: false` lifecycle. Letting users pick a "production-grade" processor (Batch) silently breaks streaming traces — and that's the dominant AI SDK use case.

**Docs-coverage clarification (2026-05-12):** the Agenta docs (`docs/docs/integrations/frameworks/vercel-ai-sdk/observability.mdx` line 74) ALREADY use `SimpleSpanProcessor` in the canonical example. A user who follows the Agenta docs end-to-end will NOT hit this bug — `SimpleSpanProcessor` exports synchronously per span and sidesteps `BatchSpanProcessor`'s flush window race with `streamText`'s `endWhenDone: false` lifecycle. Empirically verified in Phase 7 by switching `@vercel/otel`'s `spanProcessors: [SimpleSpanProcessor(...)]` — assertion-2 went from FAIL to PASS.

**So who actually hits P-APP-VERCEL-01?** Users who follow `@vercel/otel`'s docs (default `traceExporter: x` uses `BatchSpanProcessor` internally) WITHOUT also reading Agenta's docs to override the default. The Agenta docs don't have a `@vercel/otel`-specific section, so a user composing both ecosystem docs naively gets Batch and hits the bug. **This is primarily a documentation gap, not just an SDK gap.**

**Trade-off of the docs-recommended `SimpleSpanProcessor`:** each ended span triggers a synchronous HTTP round-trip — ~50-200ms per LLM call. Acceptable for low-volume apps; expensive at scale. **The SDK wedge is therefore a streaming-aware Batch processor** (gets the latency benefits of Batch WITHOUT the `streamText` flush bug), not a bug fix.

**Minimum docs fix:** add a `@vercel/otel`-specific section that calls out the default-processor pitfall, shows how to override with `spanProcessors: [new SimpleSpanProcessor(...)]`, and warns about the latency tax. Until then, P-APP-VERCEL-01 reproduces for any user who follows `@vercel/otel`'s docs in isolation.

**Backend-fixable: no (2026-05-12 analysis).** Same root cause as P-NODE-02 (Batch flush timing on mid-stream abort). Spans don't arrive. JS-side wedge. See `summary.md` § "Backend-fixable subset (AI SDK)".

## P-APP-VERCEL-02: `@vercel/otel` edge route emits spans, but with significant delay (BatchSpanProcessor batch interval)

**Framework:** app-router-vercel
**Severity:**
  - User impact: med
  - Self-recoverable: yes
  - Silent failure: no

**The friction (code that exists today):**

A/B counterpart to P-APP-RAW-01. With `@vercel/otel`, the edge runtime route's spans DO eventually arrive in Agenta — unlike raw OTel + manual edge setup which silently emits zero spans. But arrival takes longer than the assertion-2 5s polling window because of BatchSpanProcessor's default 5-second batch interval:

```ts
// app/api/edge-chat/route.ts — runtime = "edge"
// No provider setup, just call the AI SDK:
const result = await generateText({
    model: openai("gpt-4o-mini"),
    messages: [...],
    experimental_telemetry: {isEnabled: true, metadata: {userId: runId}},
})
return NextResponse.json({text: result.text, runtime: "edge"})

// Probe edge route → response 200 with runtime="edge" ✓
// Query Agenta after 4s wait → 0 spans
// Query Agenta after ~10-15s wait → 2 spans (parent + doGenerate)
//
// The latency is structural: BatchSpanProcessor + the edge function
// freezing soon after response means the batch flush either races the
// freeze (lost) or rides on the next cold-start unfreeze (delayed).
```

**Verified isolation (2026-05-10):**
- `nextjs-app-router-raw` edge route: ZERO spans EVER (P-APP-RAW-01)
- `nextjs-app-router-vercel` edge route: 2 spans appear within ~10-15s
- Same Agenta backend, same network, same AI SDK call

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK ships an edge-aware processor that flushes within the route's
// response cycle (via waitUntil) — not on a 5s batch tick. End result:
// trace arrives in Agenta within seconds of the request, not within tens
// of seconds.
```

**Notes:** This is the GOOD news of Phase 2b: `@vercel/otel` does work on edge runtime where raw OTel doesn't, so users adopting Vercel's recommended path get observability eventually. The bad news is the latency. For "user closed tab mid-stream" scenarios, 10-15s is too long — the user's session record is already torn down before the trace lands. **Implication for `ts-sdk-tracing`:** if the SDK ships an edge-runtime helper, it must beat both raw OTel (zero spans) AND `@vercel/otel` (slow spans) — flush within the route response cycle.

**Backend-fixable: no (2026-05-12 analysis).** Delay is in JS-side `BatchProcessor.scheduledDelay` (5s default) + edge function freeze interaction. Backend processes whatever arrives whenever; can't make them arrive faster. JS-side wedge: edge-aware processor that flushes via `waitUntil` within the route response cycle. See `summary.md` § "Backend-fixable subset (AI SDK)".

### Next.js Pages Router — raw OTel (P-PAGES-RAW-*)

## P-PAGES-RAW-01: Pages Router edge runtime fails at BUILD time on raw OTel exporter (App Router edge accepts the same import)

**Framework:** pages-router-raw
**Severity:**
  - User impact: med
  - Self-recoverable: partially
  - Silent failure: no

**The friction (code that exists today):**

The same `@opentelemetry/exporter-trace-otlp-http` import that compiles fine in `nextjs-app-router-raw`'s edge route fails at `next build` time in Pages Router's edge route:

```ts
// pages/api/edge-chat.ts
export const config = {runtime: "edge"}

import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-http"  // ← BOOM
// ...

// next build output:
// ./pages/api/edge-chat.ts
// Dynamic Code Evaluation (e.g. 'eval', 'new Function', 'WebAssembly.compile')
// not allowed in Edge Runtime
//
// The error was caused by importing
// '@opentelemetry/exporter-trace-otlp-http/build/esm/index.js' in
// './pages/api/edge-chat.ts'.
//
// → Build fails. Cannot ship.
```

**Verified isolation (2026-05-11):**
- `nextjs-app-router-raw` with the same import on `runtime = "edge"` route → builds fine, runs (though emits zero spans per P-APP-RAW-01)
- `nextjs-pages-router-raw` with the same import on `config = {runtime: "edge"}` route → BUILD FAILS, app can't ship at all

So Pages Router edge has stricter static analysis at build time than App Router edge.

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK either:
// (a) ships an edge bundle that's free of dynamic-code-eval patterns
//     (so it passes Next's edge runtime static analysis), OR
// (b) documents that edge routes must use a `serverExternalPackages`-equivalent
//     pattern AND tests that the Pages Router strict path passes
//
// In the meantime, Pages Router users wanting edge-runtime tracing have
// to skip raw OTel entirely — they have to use @vercel/otel which presumably
// ships an edge-safe bundle.
```

**Notes:** Spike-time workaround was to drop the edge route from this app entirely; assertions 1-4 still pass for the nodejs path. Pages Router users on raw OTel cannot ship an edge route AT ALL today. **Implication for `ts-sdk-tracing`:** the SDK's edge helper must ship an edge-safe bundle (or rely on `@vercel/otel`'s edge-safe bundle) so users on either router can use it. Confirms the cross-cutting takeaway in summary.md: SDK has to own edge instrumentation; users wiring it themselves hit framework-specific build limits the AI SDK + Agenta ecosystem doesn't currently document.

**Backend-fixable: no (2026-05-12 analysis).** `next build` rejects the import before runtime — nothing ever ships. Backend never gets to see anything. JS-side wedge: SDK ships an eval-free edge bundle that passes Pages-edge static dynamic-code-eval check. See `summary.md` § "Backend-fixable subset (AI SDK)".

**Next.js 16 update (2026-05-18): RESOLVED at build time, RUNTIME issue persists.** Re-verified empirically on Next.js 16.2.6 (Turbopack as default builder). A new `pages/api/edge-chat.ts` was added to the spike app with the same shape as Phase 2a's App Router edge route (inline raw-OTel `BasicTracerProvider` + `OTLPTraceExporter` import). Result:
- **`next build` succeeds.** Turbopack's static analysis no longer rejects `@opentelemetry/exporter-trace-otlp-http`. Pages Router edge routes can ship raw OTel.
- **At runtime, the same edge-isolate-freeze issue that affects App Router edge (P-APP-RAW-01) applies here too.** The route returns 200 OK with the LLM response, but emits 0 spans because the OTLP `fetch` is killed mid-flight when the isolate freezes. So while the build-time barrier is gone, the runtime tracing problem persists.

Net implication for `ts-sdk-tracing` v1: the SDK still needs the eval-free edge bundle with `waitUntil` enrollment, because the runtime issue (P-APP-RAW-01) was always the harder problem. Next.js 16 makes the SDK MORE useful for Pages Router users (they can now actually use the edge bundle, not just App Router users), not less.

### Next.js Pages Router — `@vercel/otel` (P-PAGES-VERCEL-*)

## P-PAGES-VERCEL-01: Pages Router `streamText` + `pipeUIMessageStreamToResponse` produces EMPTY `ag.metrics.tokens` on the parent span

**Framework:** pages-router-vercel
**Severity:**
  - User impact: high
  - Self-recoverable: no
  - Silent failure: yes

**The friction (code that exists today):**

The Pages Router streaming path is `pipeUIMessageStreamToResponse({response: res, stream: result.toUIMessageStream({onFinish})})` because Pages handlers receive a Node `ServerResponse`, not a fetch `Response`. Same `streamText` call shape as App Router, same `@vercel/otel` instrumentation. Yet the parent `ai.streamText` span arrives in Agenta with `ag.metrics.tokens` set to an EMPTY object — no `incremental.prompt`, no `incremental.completion`, no `cumulative.*`, no token counts AT ALL:

```ts
// pages/api/chat.ts — Pages Router + @vercel/otel + AI SDK v6 streamText
const result = runStreamChat(modelMessages, {userId: runId, sessionId: runId}, reqSignal)
pipeUIMessageStreamToResponse({
    response: res,
    stream: result.toUIMessageStream({
        onFinish: async () => { await flushTraces() },
    }),
})

// Span arrives in Agenta with the rest of ag.* populated correctly:
//   ag.user.id, ag.session.id, ag.meta.request.model = "gpt-4o-mini",
//   ag.data.inputs / outputs, ag.type.* — all present
//
// But:
//   ag.metrics.tokens = {}     ← EMPTY OBJECT, not missing, not omitted
//
// In the App Router + @vercel/otel sibling app, the same streamText call
// via toUIMessageStreamResponse() populates ag.metrics.tokens.incremental.*.
// In Node v6 + raw OTel + SimpleSpanProcessor, the same streamText call
// also populates ag.metrics.tokens.incremental.*.
//
// Only the Pages Router + @vercel/otel + pipeUIMessageStreamToResponse
// combination drops the token metrics entirely.
```

**Verified isolation (2026-05-11):**
- `node-vercel-ai-v6` (raw OTel + SimpleSpanProcessor + streamText): `ag.metrics.tokens.incremental.*` populated ✓
- `nextjs-app-router-vercel` (`@vercel/otel` + streamText + `toUIMessageStreamResponse`): `ag.metrics.tokens.incremental.*` populated ✓
- `nextjs-pages-router-raw` (raw OTel + streamText + `pipeUIMessageStreamToResponse`): `ag.metrics.tokens.incremental.*` populated ✓
- `nextjs-pages-router-vercel` (`@vercel/otel` + streamText + `pipeUIMessageStreamToResponse`): **`ag.metrics.tokens = {}`** ✗

So the failure variable is the combination of `@vercel/otel`'s wrapper + Pages Router's `pipeUIMessageStreamToResponse` sink. Either alone works.

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK ships a streamText wrapper that owns span attribute population
// regardless of how the consumer drains the stream:
import {streamText} from "@agenta/sdk/ai"

const result = streamText({...})         // SDK ensures token counts always
                                         // land on the parent span before the
                                         // span ends — no matter whether the
                                         // consumer pipes via Node res, fetch
                                         // Response, useChat transport, etc.

pipeUIMessageStreamToResponse({response: res, stream: result.toUIMessageStream()})
//   → ag.metrics.tokens populated ✓
```

**Notes:** Discovered during assertion-1 in Phase 3b. Initial assertion-1 (cloned from Phase 3a) checked `ag.metrics.tokens.incremental.prompt > 0` — passed in Phase 3a (raw OTel), failed in Phase 3b (`@vercel/otel`). Loosened the assertion to verify model + metadata only and captured this as the pain entry. **Why this matters:** token counts are the #1 metric users instrument LLM calls for — cost tracking, rate limiting, model selection. If they silently disappear when wiring `pipeUIMessageStreamToResponse` (the documented Pages Router pattern) on top of `@vercel/otel` (Vercel's recommended OTel wrapper), users have built a working observability pipeline that lies about cost. Both pieces are documented best-practice in their respective ecosystems. Their combination silently breaks the most commonly-checked metric. **Implication for `ts-sdk-tracing`:** the SDK either (a) wraps `streamText` itself and owns span-attribute population, OR (b) ships its own `pipeUIMessageStreamToResponse` analog that hooks the AI SDK's stream lifecycle to ensure tokens land on the span before it ends. Option (a) is the cleaner answer because it solves this AND P-NODE-02 AND P-APP-VERCEL-01 in one shot.

**Root cause resolved (2026-05-11)** via source-dive of `@vercel/otel@2.1.2` (Node bundle) + `ai@6.0.177`'s `streamText` implementation. **Candidate (a) confirmed and sharpened — specifically a force-end race in `@vercel/otel`'s `CompositeSpanProcessor.onEnd`:**

- `@vercel/otel` wraps user processors in a `CompositeSpanProcessor`. Its `onEnd` hook, when the Next.js **root SERVER span** ends, force-ends every still-open child span via `child.end()` (`node_modules/@vercel/otel/dist/node/index.js` — see the `rootSpanIds.delete(t)` + `for(let c of i.open)... c.end()` block, around line 23 of the bundled file).
- AI SDK v6's `streamText` creates the parent span with `endWhenDone: false` (`ai/dist/index.mjs:~6972`). The parent span's token attributes (`ai.usage.inputTokens`, `gen_ai.usage.input_tokens`, etc.) are written inside the event processor's `flush()` (`ai/dist/index.mjs:~6862-6896`) via `rootSpan.setAttributes({...})`, immediately before `rootSpan.end()` runs in `finally`. So token attributes land **only when AI SDK's flush() runs to completion**.
- `pipeUIMessageStreamToResponse` (Pages Router sink) calls `writeToServerResponse` (`ai/dist/index.mjs:~4969-5003`) which fires `read()` **without awaiting** and returns synchronously. The Pages handler returns to Next.js while the stream is still being drained on a microtask. `response.end()` and Next.js's SERVER-span end happen on the Node response lifecycle, **racing** AI SDK's flush().
- When the SERVER span ends first (which it does, because the model takes hundreds of ms to seconds to finish streaming while the pipe sink returned immediately), `CompositeSpanProcessor.onEnd` force-ends `ai.streamText`. AI SDK's subsequent `rootSpan.setAttributes({ai.usage.*: ...})` then hits an already-ended span. Per OTel spec (`@opentelemetry/sdk-trace-base/Span.js:~83-103`), `setAttribute` silently returns early on an ended span. **Token attributes never reach the exporter.**
- Everything written BEFORE the force-end (operation name, `ai.prompt`, `ai.meta.request.model`, user/session metadata) is preserved on the span — exactly matching what we see in Agenta. Only the token attributes (written last, in flush()) are dropped.
- `@vercel/otel` does include a 50ms `waitUntil(...)` race in `onStart` before flushing, but typical model latency is orders of magnitude longer, so it always times out before AI SDK's flush() runs.

**Why only this 4-way combo fails:**

- **Node raw (no Next.js):** no Next.js SERVER span exists, so no `@vercel/otel` root-span tracking, no force-end. AI SDK's flush() runs at its own pace, token attrs land.
- **App Router + `@vercel/otel`:** `toUIMessageStreamResponse()` returns a fetch `Response` whose body Next.js awaits to completion as part of its request lifecycle. The SERVER span stays open until the response body stream is fully drained — which is the same `baseStream` tee that AI SDK's flush() is feeding from. So flush() (and the `ai.usage.*` writes) lands BEFORE the SERVER span ends, BEFORE `CompositeSpanProcessor.onEnd` would force-end the streamText span. AI SDK ends `ai.streamText` cleanly itself.
- **Pages Router + raw OTel:** the same synchronous-return pipe races flush(), but raw `SimpleSpanProcessor` has no root-span tracking and no force-end logic. The streamText span ends on its own clock via AI SDK's flush() → `rootSpan.end()`. `setAttributes` runs on a still-open span. Tokens recorded.
- **Pages Router + `@vercel/otel` (the failing combo):** synchronous-return pipe (SERVER span ends fast) + CompositeSpanProcessor force-end (kills `ai.streamText` early) interact. Force-end fires before AI SDK's flush(). Tokens lost.

**What's still uncertain:**

- The mechanism is traced from source, not instrumented at runtime. A 1-line runtime probe to confirm: patch `@vercel/otel`'s `CompositeSpanProcessor.onEnd` to log `span.attributes` for spans named `ai.streamText` immediately before/after the force-end loop. If `ai.usage.inputTokens` is missing both times AND present on a subsequent (no-op) `setAttributes` call from AI SDK, the mechanism is empirically confirmed.
- Untested whether AI SDK's `experimental_telemetry.tracer` injection (passing a custom tracer that wraps spans with deferred attribute application) would mask the symptom. Our spike didn't exercise that knob.

**Processor-choice independence verified (2026-05-12):** unlike P-APP-VERCEL-01 which is fixable by switching to `SimpleSpanProcessor`, **P-PAGES-VERCEL-01 reproduces under BOTH `BatchSpanProcessor` AND `SimpleSpanProcessor`.** Empirically tested: changing `@vercel/otel`'s `spanProcessors` from Batch to Simple while keeping `pipeUIMessageStreamToResponse` produces the same empty `ag.metrics.tokens` result. This makes sense from the mechanism: `CompositeSpanProcessor.onEnd` force-ends the child span BEFORE the wrapped processor sees it — so the choice of wrapped processor (Batch vs Simple) only affects EXPORT timing, not the force-end race that destroys the token writes. **Following Agenta's docs (which use `SimpleSpanProcessor`) does NOT save users from this bug.** Genuine JS-side wedge.

**Backend-fixable: no (2026-05-12 analysis).** `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends the streamText span BEFORE AI SDK writes `ai.usage.*` — the token attributes are never written to the span at all. Backend receives the span with empty token data; can't reconstruct what wasn't sent. JS-side wedge: streamText lifecycle wrapper that owns span end (same wedge as P-NODE-02). See `summary.md` § "Backend-fixable subset (AI SDK)".

**Next.js 16 re-verification (2026-05-18): mechanism worse than originally documented, fix recommendation flipped.** Re-tested on Next.js 16.2.6 (Turbopack default builder). Direct Agenta-side trace queries against the spike-emitted trace:

- `ai.streamText` parent: `ag.metrics.tokens.*` missing — expected.
- `ai.streamText.doStream` child: `ag.metrics.tokens.*` ALSO missing — **NOT expected.** The original Next 15.5.15 spike noted that the child fired earlier (from the provider call) and likely retained `ai.usage.*`. Empirically on Next 16 the child is also empty.
- `fetch POST https://api.openai.com/v1/responses` grandchild: `ag.metrics.tokens.*` ALSO missing.

Most plausible mechanism (not source-traced through Next 16's `@vercel/otel` yet): the `CompositeSpanProcessor.onEnd` force-end fires not just on the parent but also on `.doStream` (which is still open when `pipeUIMessageStreamToResponse` returns synchronously while the OpenAI Responses API stream is still draining). AI SDK's `setAttributes({ai.usage.*})` lands on an already-ended `.doStream` and is dropped.

**Consequence for the fix path.** The original P-PAGES-VERCEL-01 design recommendation (read-time enricher on the Agenta backend that rolls `.doStream`'s `incremental.*` up to the parent's `cumulative.*`) **cannot work** on Next 16 — no span has token data to roll up FROM. The fix moves to a JS-side helper (`agentaPipeUIMessageStreamToResponse`) that owns the token-attribute writes onto an Agenta-controlled span before any outer force-end fires. Promoted from contingency to v1 deliverable in [rfc.md §11.5](../ts-sdk/rfc.md#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01) and [proposal.md §5.2](../ts-sdk/proposal.md#52-javascript-track--agentasdk-tracing) based on this finding.

### React TanStack Start (P-TANSTACK-*)

## P-TANSTACK-01: Instrumentation seam is unenforced `src/server.ts` import order — silent failure on regression

**Framework:** tanstack
**Severity:**
  - User impact: high
  - Self-recoverable: partially
  - Silent failure: yes

**The friction (code that exists today):**

TanStack Start has no Next.js-style `instrumentation.ts` register hook. Instrumentation fires by virtue of being the FIRST import in `src/server.ts`. Any refactor that reorders imports — or a tool that auto-formats imports alphabetically — silently disables tracing:

```ts
// src/server.ts — CORRECT (this is what we shipped):
import "./instrumentation"

import {createStartHandler, defaultStreamHandler} from "@tanstack/react-start/server"

const fetch = createStartHandler({handler: defaultStreamHandler})
export default {fetch}

// src/server.ts — SILENTLY BROKEN: import-sorter alphabetizes,
// puts the side-effect import second. AI SDK calls now fire BEFORE
// the NodeTracerProvider is registered. Spans are never captured.
// No error, no warning, no diagnostic. Just no traces.
import {createStartHandler, defaultStreamHandler} from "@tanstack/react-start/server"

import "./instrumentation"  // ← too late
```

**Verified behavior (2026-05-11):**
- `src/instrumentation.ts` import as the first line of `src/server.ts`: 4/4 canonical assertions PASS, instrumentation registers before any handler runs (Δ ~ minutes)
- ANY other line ordering: would silently lose spans. Tested by inspection of the framework wiring; no linter catches this.

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK provides a TanStack Start adapter that wires instrumentation
// via the start handler itself, not import order:
import {createStartHandler, defaultStreamHandler} from "@tanstack/react-start/server"
import {withAgentaInstrumentation} from "@agenta/sdk/tanstack-start"

export default withAgentaInstrumentation(
    createStartHandler({handler: defaultStreamHandler}),
    {apiKey: process.env.AGENTA_API_KEY!, projectId: process.env.AGENTA_PROJECT_ID!},
)
// ↑ side-effect-free composition. SDK guarantees the provider is
// registered BEFORE the wrapped handler accepts its first request,
// regardless of import order anywhere else in the bundle.
```

**Notes:** Discovered while scaffolding Phase 4. The official TanStack Start observability docs DO call out "Initialize BEFORE importing your app" but rely entirely on a comment convention. **Implication for `ts-sdk-tracing`:** the SDK's framework adapter should accept the user's start handler as input and return a wrapped one — invariant-by-construction. Eliminates the entire class of "wait, why aren't there any spans?" debugging.

**Backend-fixable: no (2026-05-12 analysis).** If instrumentation isn't registered before the first handler, no spans flow. Backend invisible. JS-side wedge: TanStack Start adapter that wraps the start handler (invariant-by-construction). See `summary.md` § "Backend-fixable subset (AI SDK)".

## P-TANSTACK-02: No per-route edge runtime opt-in — runtime selection is global at the Nitro preset level

**Framework:** tanstack
**Severity:**
  - User impact: med
  - Self-recoverable: yes
  - Silent failure: no

**The friction (code that exists today):**

Next.js (both App Router and Pages Router) lets users opt single routes into edge runtime via `export const runtime = "edge"`. TanStack Start has no equivalent — the runtime is selected at the Nitro preset level (Cloudflare Workers, Vercel Edge, Deno Deploy, etc.) and applies to the whole server. To test edge instrumentation, you have to deploy the entire app to that preset:

```ts
// Next.js: per-route opt-in
// app/api/edge-chat/route.ts
export const runtime = "edge"   // ← granular, single route
export async function POST(req: Request) { ... }

// TanStack Start: no equivalent. Either everything's Node or everything's edge,
// at deploy time. No `export const runtime = "edge"` on a route file:
// src/routes/api/chat.ts
import {createFileRoute} from "@tanstack/react-router"
export const Route = createFileRoute("/api/chat")({
    server: {handlers: {POST: async ({request}) => {...}}},
})
// ↑ runs on whatever Nitro preset the build target is configured for.
// To probe edge tracing for THIS route specifically, you'd need a
// second deployment with a different Nitro preset.
```

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK's TanStack Start adapter exposes preset-aware instrumentation
// that DTRT for both Node and edge presets without per-route config:
import {withAgentaInstrumentation} from "@agenta/sdk/tanstack-start"

// Single adapter, ships an eval-free edge bundle and a Node bundle,
// selected automatically based on the active Nitro preset:
export default withAgentaInstrumentation(handler, {apiKey, projectId})
```

**Notes:** This isn't a silent failure — it's a coverage gap in the spike. We could deploy this app to a Cloudflare/Vercel-edge preset to verify, but that's out of scope for local-only spike testing (Decision 4 in status.md). **Implication for `ts-sdk-tracing`:** the SDK's TanStack Start adapter must pick the right bundle (eval-free, edge-safe vs Node-rich) based on the deployment target — users won't be choosing per-route. Same edge-safe bundle requirement as P-PAGES-RAW-01.

**Backend-fixable: no (2026-05-12 analysis).** TanStack Start architecture choice — no `runtime: "edge"` per-route flag. Backend has no leverage here. Workaround is JS-side: deployment-preset-aware SDK bundling. See `summary.md` § "Backend-fixable subset (AI SDK)".

## P-TANSTACK-03: `createStartHandler()` return shape doesn't match what the dev plugin expects — docs lie

**Framework:** tanstack
**Severity:**
  - User impact: med
  - Self-recoverable: partially
  - Silent failure: no

**The friction (code that exists today):**

The official TanStack Start docs show this as the server entry pattern:

```ts
// src/server.ts (per official docs)
import {createStartHandler, defaultStreamHandler} from "@tanstack/react-start/server"
export default createStartHandler({handler: defaultStreamHandler})
```

But Vite's dev plugin attempts `(await import(ENTRY_POINTS.server))["default"].fetch(webReq)` — i.e. it expects a `{fetch}` object on the default export, not a callable handler. With the documented form, every request fails:

```
TypeError: (intermediate value).default.fetch is not a function
    at .../start-plugin-core/.../dev-server-plugin/plugin.js:71:106
```

Inspecting the framework's own default entry reveals the actual working shape:

```ts
// node_modules/@tanstack/react-start/dist/default-entry/esm/server.js
var fetch = createStartHandler(defaultStreamHandler)
function createServerEntry(entry) {
    return {async fetch(...args) { return await entry.fetch(...args) }}
}
export default createServerEntry({fetch})
// ↑ default export must have a .fetch method. createStartHandler returns
// a callable that itself works as a fetch handler, so we either wrap as
// `{fetch: createStartHandler(...)}` or use the SDK's helper.
```

**Verified isolation (2026-05-11):**
- `export default createStartHandler({handler: defaultStreamHandler})`: dev server crashes on every request
- `export default {fetch: createStartHandler({handler: defaultStreamHandler})}`: dev server works, 4/4 assertions PASS

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK adapter returns the right shape so users never see the mismatch:
import {createStartHandler, defaultStreamHandler} from "@tanstack/react-start/server"
import {withAgentaInstrumentation} from "@agenta/sdk/tanstack-start"

export default withAgentaInstrumentation(
    createStartHandler({handler: defaultStreamHandler}),
    {apiKey, projectId},
)
// ↑ withAgentaInstrumentation returns a `{fetch}` object regardless
// of what `createStartHandler` returns; users follow our docs not Tanner's.
```

**Notes:** Cost us ~30 minutes of "why does every request 500?" debugging during Phase 4 scaffolding. Resolution required reading the framework's own default-entry source, not the docs. **Implication for `ts-sdk-tracing`:** combines with P-TANSTACK-01 — the SDK's TanStack Start adapter SHOULD own both the instrumentation wiring and the export-shape wrapping. Users never write `export default createStartHandler(...)` directly; they wrap it through our adapter. This is the cheapest possible value-add and dodges a documented framework foot-gun.

**Backend-fixable: no (2026-05-12 analysis).** Build/runtime crash before any span fires. Backend invisible. JS-side wedge: SDK adapter returns the correct `{fetch}` shape. See `summary.md` § "Backend-fixable subset (AI SDK)".

### Nuxt 3/4 (Vue + Nitro) (P-NUXT-*)

## P-NUXT-01: H3 v2 RC has no working abort-signal propagation — mid-stream client abort doesn't reach `streamText`

**Framework:** nuxt
**Severity:**
  - User impact: high
  - Self-recoverable: no
  - Silent failure: no

**The friction (code that exists today):**

In Nuxt 4 (`nuxt@4.4.5` + `nitro@2.13.4` + `h3@2.0.1-rc.20`), there's no working way to get an `AbortSignal` that fires when a client aborts a streaming request mid-flight. The H3 v2 RC types document THREE potential paths, all of which fail at runtime in the Nitro Node-runtime preset:

```ts
// server/api/chat.post.ts — Nuxt streaming chat
export default defineEventHandler(async (event) => {
    // (1) The typed Web Fetch shape — H3 docs comment links to MDN's
    //     `Request.signal`:
    const signal = event.req.signal
    // → undefined at runtime. event.req exists but lacks `.signal`.

    // (2) The "runtime-specific additional context" path:
    const signal = event.runtime?.node?.req?.signal
    // → undefined at runtime. event.runtime itself is undefined.

    // (3) The deprecated Node IncomingMessage path:
    event.node?.req?.on("close", () => streamCtrl.abort())
    // → 'close' event fires, but only AFTER the response stream finishes
    //   draining naturally (model completes), NOT when the client
    //   disconnects mid-stream. So it doesn't help.

    // Net effect: streamText receives no abortSignal, model keeps
    // generating after client abort, span ends ~7-15s late.
    const result = streamText({
        model: openai("gpt-4o-mini"),
        messages,
        experimental_telemetry: {isEnabled: true, metadata: {userId, sessionId}},
        // abortSignal: ??? — no working path
    })
    return result.toUIMessageStreamResponse()
})
```

**Verified isolation (2026-05-11):**

Runtime probe in `web/examples/nuxt-raw/server/api/chat.post.ts` printed:

```
[chat.post probe] {
    "event.req exists": true,
    "event.req.signal exists": false,    ← typed but missing at runtime
    "event.node exists": true,
    "event.node.req exists": true,
    "event.runtime exists": false        ← typed but missing at runtime
}
```

Empirical confirmation via assertion-2:
- `ASSERTION_FLUSH_WINDOW_S=5` (default for other phases): **FAIL** — span not in Agenta within 5s of client abort
- `ASSERTION_FLUSH_WINDOW_S=30`: **PASS** — span arrives ~7-15s after abort (= the time it takes the model to finish naturally and the streamText span to end on its own)

Compare to other phases under the same setup:
- Phase 2a Next.js App Router raw OTel: 5s window PASS — `req.signal` works in Next.js
- Phase 4 TanStack Start: 5s window PASS — different framework, abort path works
- Phase 1 Node: 5s window PASS — no framework HTTP layer, `AbortController` flows through directly

So the failing variable is specifically **H3 v2 RC's broken AbortSignal exposure on Node runtime in Nuxt 4 / Nitro 2.13**.

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK ships a Nuxt server-route helper that fabricates a working
// AbortSignal via whatever mechanism actually works in the current
// Nitro version (close event polling, Node-side response 'close',
// or whatever H3 stabilizes). Users don't see the H3 version skew.
import {agentaStreamText} from "@agenta/sdk/nuxt"

export default defineEventHandler(async (event) => {
    return agentaStreamText(event, {
        model: openai("gpt-4o-mini"),
        messages,
        metadata: {userId, sessionId},
    })
})
```

**Notes:** Discovered during Phase 5 scaffolding while running the 4 canonical assertions. Initial assertion-2 failed at 5s; raising to 30s passed. Probed the H3 event shape three different ways before confirming no working path exists. **Why this matters:** mid-stream client abort handling is the cost-control mechanism for production LLM apps — if a user closes their tab mid-generation, the server should stop generating to avoid burning tokens for nothing. Today's Nuxt 4 users can't do that. Their costs include all the streamText completions that ran to natural completion after the user already left. **Why partial-silent:** the span DOES arrive in Agenta (eventually), so observability isn't broken — but the production cost behavior IS broken, and the gap between "client aborted" and "trace lands" is much longer than other frameworks (7-15s vs <1s). **Investigation deferred:** whether H3 v2 stable (when it ships) fixes this; whether building Nuxt against `vercel-edge` preset would route through `event.web.request.signal` instead and surface a working signal. Both kept in observation space.

**Backend-fixable: no (2026-05-12 analysis).** The pain is JS-side abort propagation (or rather, its absence). Backend receives the eventual span fine — but by then the user has already closed the tab and the company has paid for tokens nobody saw. Backend can't bridge a JS-side abort gap. JS-side wedge: Nuxt server helper that fabricates a working AbortSignal via whatever H3 path actually works in the running Nitro version. See `summary.md` § "Backend-fixable subset (AI SDK)".

### Mastra (P-MASTRA-*)

## P-MASTRA-01: Mastra returns a noop tracer by default — raw OTel + Agenta produces ZERO traces

**Framework:** mastra
**Severity:**
  - User impact: high
  - Self-recoverable: no
  - Silent failure: yes

**The friction (code that exists today):**

A user reads the Agenta Vercel AI SDK docs, sees the "register raw OTel + point at our OTLP endpoint" pattern, swaps `streamText` / `generateText` for a Mastra `Agent`, and gets ZERO traces with no error or warning. The agent works perfectly. OpenAI call works perfectly. Agenta dashboard is empty.

```js
// instrumentation.js — identical to the AI SDK quickstart, registers
// a global NodeTracerProvider with an OTLP exporter pointed at Agenta.
const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(otlpExporter)],
})
provider.register()

// app.js — use Mastra instead of bare AI SDK
import {Agent} from "@mastra/core/agent"
import {Mastra} from "@mastra/core/mastra"
import {openai} from "@ai-sdk/openai"

const chat = new Agent({name: "chat", instructions: "...", model: openai("gpt-4o-mini")})
new Mastra({agents: {chat}})
const result = await chat.generate("Hi")
// → result.text is correct. Agenta dashboard shows nothing.
```

**Verified isolation (2026-05-11):**

Source dive into `@mastra/core@1.32.1`'s vendored AI SDK v1 bundle at `node_modules/@mastra/core/dist/chunk-VXOFGYGF.js:3359`:

```js
function getTracer({ isEnabled = false, tracer } = {}) {
    if (!isEnabled) return noopTracer
    return tracer ?? trace.getTracer("ai")
}
```

Mastra bundles its own AI SDK v1 internally. The vendored AI SDK checks `experimental_telemetry.isEnabled` (defaulting `false`). When false, every span op becomes a no-op. Mastra's user-facing Agent API (`AgentExecutionOptionsBase`) does not expose `experimental_telemetry` to callers — verified by grepping `node_modules/@mastra/core/dist/agent/agent.types.d.ts`. So there is no path from outside Mastra to flip `isEnabled` to true.

Empirically confirmed: `web/examples/mastra-node/` with bare Mastra (no `@mastra/observability` installed) produces ONLY the one wrapper span we manually created. Zero `ai.*` spans land in Agenta.

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK ships a one-line setup that handles both Mastra's vendored AI SDK
// telemetry AND Mastra's own observability bus. User installs it, doesn't
// need to know that Mastra has two parallel telemetry surfaces.
import {wireAgentaMastra} from "@agenta/sdk/mastra"

const mastra = new Mastra({
    agents: {chat},
    observability: wireAgentaMastra({apiKey, projectId}),
})
```

**Notes:** Discovered Phase 6.1a (bare Mastra + global OTel provider produces zero traces). Confirmed Phase 6.1b (`@mastra/observability` installed + ConsoleExporter wired still produces zero AI SDK OTel spans — Mastra's Observability layer doesn't flip the vendored AI SDK's `isEnabled` flag either; the two systems are completely parallel). **Why this matters:** every Agenta customer reading the AI SDK quickstart docs and trying to apply the same pattern to Mastra will hit this. No error, no warning, just an empty dashboard. Worst form of silent failure — the user thinks Agenta is broken or that their instrumentation is wrong, not that they need a different setup entirely.

**Backend-fixable: no (2026-05-12 analysis).** Mastra returns a noopTracer; spans are never created at all. There is no path from outside Mastra to flip the `isEnabled` flag. Backend invisible. JS-side wedge: see P-MASTRA-02 — the AgentaMastraExporter subscribes to Mastra's separate `ObservabilityBus` and re-emits as OTel. See `summary.md` § "Backend-fixable subset (AI SDK)".

## P-MASTRA-02: Mastra has a separate, non-OTel `ObservabilityBus` — no native OTLP exporter

**Framework:** mastra
**Severity:**
  - User impact: high
  - Self-recoverable: partially
  - Silent failure: no

**The friction (code that exists today):**

Mastra's blessed observability path is `@mastra/observability`. Install it, configure an `Observability` instance, pass to `new Mastra({observability})`. Mastra then emits rich `TracingEvent` payloads with span types like `AGENT_RUN`, `MODEL_GENERATION`, `MODEL_STEP`, `MODEL_CHUNK` — full input/output, model, provider, streaming flag, step indices, tool calls, the works.

**But the events are emitted to Mastra's own `ObservabilityBus`, not to OpenTelemetry.** The bus delivers to Mastra-specific exporters: `ConsoleExporter`, `CloudExporter`, `DefaultExporter`, `TestExporter`. There is no `OTLPExporter`. No `OpenTelemetryExporter`. Nothing that speaks the protocol Agenta (and Langfuse, Honeycomb, Datadog, every OTel-backed observability platform) expects.

```ts
import {Observability, ConsoleExporter, SamplingStrategyType} from "@mastra/observability"

new Mastra({
    agents: {chat},
    observability: new Observability({
        configs: {
            default: {
                name: "default",
                serviceName: "my-app",
                sampling: {type: SamplingStrategyType.ALWAYS},
                exporters: [new ConsoleExporter()],
                //         ^^^^^^^^^^^^^^^^^^^^^
                //         Only Mastra-blessed exporters exist. To ship to any
                //         OTel/OTLP backend, the user must write their own
                //         BaseExporter subclass that translates Mastra's
                //         TracingEvent → OTLP → POST.
            },
        },
    }),
})
```

**Verified isolation (2026-05-11):**

`@mastra/observability@1.11.1` exports surface (`node_modules/@mastra/observability/dist/exporters/index.d.ts`):
- `BaseExporter` (abstract — implement `_exportTracingEvent`)
- `ConsoleExporter` (stdout)
- `CloudExporter` (Mastra Cloud HTTP API — proprietary)
- `DefaultExporter` (storage-backed)
- `TestExporter` (testing)

The `ObservabilityBridge` config (`bridge?: ObservabilityBridge`) sounds OTel-flavoured ("e.g., OpenTelemetry, DataDog") but its actual interface is `executeInContext(spanId, fn)` — for **context propagation** (parent-span linkage when downstream HTTP/DB auto-instrumentation runs), NOT span export. Mastra spans don't flow OUT to OTel via the bridge.

So integrating Mastra with any OTLP backend requires a custom `BaseExporter` subclass that translates Mastra's `TracingEvent.exportedSpan` shape to OTLP.

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK ships the BaseExporter subclass + sane defaults for Agenta. User
// imports + plugs in.
import {AgentaMastraExporter} from "@agenta/sdk/mastra"

new Observability({
    configs: {
        default: {
            // ...
            exporters: [new AgentaMastraExporter({apiKey, projectId, host})],
        },
    },
})
```

**Notes:** Discovered Phase 6.1b. Implemented a working PoC at `web/examples/mastra-node/src/agenta-exporter.ts` (~150 lines) that subscribes to Mastra's `TracingEvent` bus, re-emits each ended span as an OTel span through the globally-registered tracer (so the existing OTLP exporter handles serialization/transport/batching/retries). After wiring, 4/4 canonical Mastra assertions PASS and a clean 4-level span tree (`agent run` → `llm` → `step` → `chunk`) lands in Agenta with inputs/outputs/metadata/user-id all populated. **Strategic implication:** this is a strictly different shape from the `@agenta/sdk-ai` SpanProcessor wedge (which would be a pre-export filter on OTel-native AI SDK spans). They integrate at different layers. `@agenta/sdk-mastra` is its own package, not a variant of `@agenta/sdk-ai`. Both can exist with non-overlapping reasons.

**Backend-fixable: partial (2026-05-12 analysis).** Without a JS-side bridge, Mastra spans never reach the backend at all — backend can't ingest what isn't sent. So a pure-backend fix isn't possible. **However**, the JS-side bridge can be much thinner than the AgentaMastraExporter shown here IF the backend grows a Mastra-aware adapter: ship a 30-line shim that POSTs raw Mastra `TracingEvent` payloads to a dedicated `/api/mastra/v1/spans` endpoint, and have the backend handle the semantic translation to `ag.*` (mirroring the Vercel AI SDK pattern). Discussed at length in `summary.md` § "Strategic alternative: backend-led integration". Either way, some JS code must exist; the question is fat-vs-thin and whether the schema lives in JS or backend.

## P-MASTRA-03: Mastra's user-facing Agent API hides `experimental_telemetry` — per-call metadata requires `tracingOptions.metadata`

**Framework:** mastra
**Severity:**
  - User impact: med
  - Self-recoverable: partially
  - Silent failure: no

**The friction (code that exists today):**

In every other phase of the spike, per-call metadata (`userId`, `sessionId`) is passed via the AI SDK's `experimental_telemetry.metadata` option. Mastra users can't do this — `agent.generate()` and `agent.stream()` accept `AgentExecutionOptionsBase`, which does **not** expose `experimental_telemetry`. Trying to pass it is a type error, and Mastra silently drops it at runtime even with `as any`.

Mastra's own equivalent is `tracingOptions.metadata`, which lives on a different option path and is shaped slightly differently:

```ts
// AI SDK direct (Phase 1-5):
streamText({
    model: openai("gpt-4o-mini"),
    messages: [...],
    experimental_telemetry: {
        isEnabled: true,
        metadata: {userId, sessionId},
    },
})

// Mastra (Phase 6):
chatAgent.generate(prompt, {
    tracingOptions: {
        metadata: {userId, sessionId},
    },
})
```

This is a per-framework knob users have to learn. Worse: the divergence isn't called out in Mastra docs — discoverability is by source dive (`node_modules/@mastra/core/dist/agent/agent.types.d.ts:452`).

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// SDK ships per-framework helpers that wrap the metadata convention,
// so users have ONE consistent shape regardless of framework underneath:
import {agentaCall} from "@agenta/sdk"
const result = await agentaCall(chatAgent.generate(prompt), {userId, sessionId})
```

**Notes:** Mastra's metadata path also auto-propagates to child spans (verified empirically — `userId` ends up on `agent run`, `llm`, `step`, and `chunk` spans). This is BETTER than AI SDK's behaviour (P-NODE-03: AI SDK only attaches metadata to the parent span, not children like `ai.toolCall`). So Mastra-side metadata semantics are actually superior. The friction is the discoverability gap, not the underlying capability.

**Backend-fixable: no (2026-05-12 analysis).** This is an API ergonomics gap, not a wire-format problem. Mastra's `tracingOptions.metadata` already propagates correctly once users find it. Backend has nothing to fix here. JS-side wedge: `agentaCall(agent.generate(prompt), {userId, sessionId})` helper or framework-aware overload that abstracts the metadata path divergence between AI SDK and Mastra. See `summary.md` § "Backend-fixable subset (AI SDK)".

### Cross-framework / backend findings (P-COMMON-*)

## P-COMMON-01: Next.js auto-instrumentation creates an HTTP root span that hides AI SDK data in Agenta's "Root" UI view

**Framework:** common
**Severity:**
  - User impact: high
  - Self-recoverable: partially
  - Silent failure: no

**The friction (code that exists today):**

Every Next.js 15 app with `instrumentation.ts` (whether using raw OTel or `@vercel/otel`) emits an HTTP server span + a Next-internal handler-execution span automatically — Next.js's own built-in OTel auto-instrumentation, not the user's choice. The AI SDK's `ai.streamText` / `ai.generateText` spans then become CHILDREN nested 2-3 levels deep. Agenta's UI "Root" filter shows the HTTP root as the trace's representative row, which carries only Next-internal duration data — not the LLM payload.

Verified trace shape for the SAME assertion across all four Next.js spike apps (queried via `POST /api/spans/query` filtering by `trace_id`):

```text
Phase 2a + 2b (App Router, both raw OTel and @vercel/otel — IDENTICAL trees):
└─ POST /api/chat/route                              ← Agenta UI shows THIS as root
   ├─ resolve page components
   ├─ executing api route (app) /api/chat/route
   │  ├─ ai.streamText                               ← AI SDK data lives HERE (L2)
   │  │  └─ ai.streamText.doStream
   │  │     └─ fetch POST https://api.openai.com/v1/responses
   │  └─ start response

Phase 3a + 3b (Pages Router, both raw OTel and @vercel/otel — IDENTICAL trees):
└─ POST /api/chat                                    ← Agenta UI shows THIS as root
   └─ executing api route (pages) /api/chat
      └─ ai.streamText                               ← AI SDK data lives HERE (L2)
         └─ ai.streamText.doStream
            └─ fetch POST https://api.openai.com/v1/responses

Phase 4 TanStack Start (NO HTTP auto-instrumentation):
└─ ai.streamText                                     ← AI SDK IS the root (L0) ✓
   └─ ai.streamText.doStream

Phase 1 Node (NO HTTP layer at all):
└─ ai.streamText (or ai.generateText)                ← root ✓
   └─ ai.streamText.doStream
```

Attribute payload comparison for the same trace's HTTP root vs `ai.streamText` (Phase 2a, run `a3-1778501741412`):

```text
POST /api/chat/route (UI displays this row):
  ag.type.trace = 'invocation'
  ag.metrics.duration.cumulative = 1745.926
  (no inputs, no outputs, no model, no tokens, no metadata — column shows "—")

ai.streamText (buried at depth 2, not visible in default UI view):
  ag.data.inputs.messages    = [{role: 'user', content: [...]}]  ← the prompt
  ag.data.outputs            = 'ok.'                              ← the response
  ag.meta.system             = 'openai.responses'
  ag.meta.request.model      = 'gpt-4o-mini'
  ag.meta.request.max_retries = 2
  ag.meta.response.finish_reasons = ['stop']
  ag.metrics.tokens.incremental.{total,prompt,completion,cached,reasoning}
  ag.user.id, ag.session.id
  ag.metrics.duration.cumulative
```

**Verified isolation (2026-05-11):**
- Phase 2a (raw OTel): 7 spans, AI SDK at L2 — HTTP root + Next handler wrappers present
- Phase 2b (`@vercel/otel`): 7 spans, **identical tree shape** to 2a — proves the wrappers come from Next.js itself, NOT from `@vercel/otel`
- Phase 3a (Pages raw): 4 spans, AI SDK at L2 — same `executing api route (pages)` pattern
- Phase 3b (Pages vercel): 5 spans, AI SDK at L2 — identical to 3a
- Phase 4 TanStack Start: 2 spans, AI SDK IS the root (L0) — confirms Vite/Nitro doesn't emit HTTP auto-instrumentation spans
- Phase 1 Node: AI SDK IS the root — no HTTP layer at all
- Pure Node v4 published example: same as Phase 1, AI SDK is the root

So the failing variable is **Next.js's built-in OTel auto-instrumentation**, independent of which OTel wrapper the user installs.

**Confirmed not-a-wiring-mistake (2026-05-11):** Compared our `instrumentation.ts` shape against canonical references — they match 1:1, no filtering. Our wiring is not the problem. References:
- Vercel's own `ai-chatbot` template (`github.com/vercel/ai-chatbot`) ships literally `registerOTel({serviceName: "chatbot"})` and stops
- The [Next.js OTel docs](https://nextjs.org/docs/app/guides/open-telemetry)'s "Manual OpenTelemetry configuration" sample matches our raw OTel setup line-for-line
- The same docs explicitly call out: *"the root server span labeled as `[http.method] [next.route]`. All other spans from that particular trace will be nested under it."* — confirms the root-HTTP shape is by design
- Span names we see (`POST /api/chat/route`, `executing api route (app) /api/chat/route`, `resolve page components`, `start response`) all come from Next.js internals (`packages/next/src/server/lib/trace/constants.ts`), not from `@opentelemetry/instrumentation-http` and not from `@vercel/otel`. The `@vercel/otel` README confirms it only adds fetch instrumentation; HTTP server spans are Next itself
- Documented Next env knobs that DON'T solve this: `NEXT_OTEL_VERBOSE=0` (default — keeps the 5 wrapper spans, adds more if set to 1); `NEXT_OTEL_FETCH_DISABLED=1` (suppresses only the outbound `fetch` span). Neither removes the HTTP root or the `executing api route` wrapper

**How other LLM observability SDKs handle the same symptom (2026-05-11):**

- **Langfuse** (`@langfuse/otel` v5+ for JS/TS, Python v4+): ships a `LangfuseSpanProcessor` that drops spans before export. Two verbatim quotes from their own FAQ at [langfuse.com/faq/all/unwanted-http-database-spans](https://langfuse.com/faq/all/unwanted-http-database-spans):

  > "The Python v3 and JS/TS v4 SDKs have no automatic filtering — Langfuse exports all spans it receives, including HTTP requests, database queries, and framework internals."

  > "The Langfuse Python SDK v4+ and JS/TS SDK v5+ apply a default span filter that automatically keeps only LLM-related spans and drops HTTP, database, and framework spans — no configuration needed."

  Source code (verified at [unpkg.com/@langfuse/otel/dist/index.mjs](https://unpkg.com/@langfuse/otel/dist/index.mjs)): `LangfuseSpanProcessor` applies `isDefaultExportSpan(span)` which is the OR of three checks:

  ```ts
  function isDefaultExportSpan(span) {
      return isLangfuseSpan(span) || isGenAISpan(span) || isKnownLLMInstrumentor(span)
  }
  function isGenAISpan(span) {
      return Object.keys(span.attributes).some((k) => k.startsWith("gen_ai."))
  }
  function isKnownLLMInstrumentor(span) {
      const scope = span.instrumentationScope.name
      return KNOWN_LLM_INSTRUMENTATION_SCOPE_PREFIXES.some(
          (prefix) => scope === prefix || scope.startsWith(`${prefix}.`),
      )
  }
  ```

  `KNOWN_LLM_INSTRUMENTATION_SCOPE_PREFIXES` (verbatim, 10 entries): `LANGFUSE_TRACER_NAME`, `"agent_framework"`, `"ai"`, `"haystack"`, `"langsmith"`, `"litellm"`, `"openinference"`, `"opentelemetry.instrumentation.anthropic"`, `"strands-agents"`, `"vllm"`. Next.js wrapper spans use scope `next.js` (not in the list) and lack `gen_ai.*` attrs → filtered out before export.

  **Interpretive note (not a verbatim claim):** Langfuse explicitly documenting the pre-v5 vs v5 contrast AND maintaining a dedicated FAQ page titled "unwanted-http-database-spans" is strong evidence that their users hit this pain often enough to motivate (a) the v5 filter and (b) a public FAQ entry. The FAQ does NOT contain a direct quote saying "we built this because we ran into the problem ourselves" — that's an inference from the documented behavioral change and the existence of the FAQ.

- **Braintrust**: uses wrapper-based observability (`wrapAISDK`, `traced()`) rather than `instrumentation.ts` auto-instrumentation. The AI call is wrapped explicitly, so the Braintrust span IS the root. Different paradigm — no filtering needed because the wrappers don't sit downstream of Next's auto-instrumentation. (Source: agent-research summary; not independently verified beyond the docs URL [braintrust.dev/docs/cookbook/recipes/AISDKObservabilityFeatures](https://www.braintrust.dev/docs/cookbook/recipes/AISDKObservabilityFeatures).)

- **Neither** documents a user-side `instrumentation.ts` modification for the Next.js case — the filtering (Langfuse) or wrapping (Braintrust) is SDK-side, applied uniformly across all customer apps.

**What would be ideal (sketch of how the SDK would hide this):**

Three known approaches in the LLM observability ecosystem today — all kept in observation-only form per current spike direction:

```ts
// (1) Langfuse approach: SDK-side scope filter. Their @langfuse/otel v5+
//     ships a custom SpanProcessor that drops every span whose
//     `instrumentationScope.name` is not in a known-LLM allowlist (`ai`,
//     `openinference`, `gen_ai.*` attrs, etc.). Next.js wrapper spans
//     (scope `next.js`) get dropped at the processor BEFORE export, so
//     the Langfuse backend only ever sees AI SDK spans. The dashboard
//     naturally shows ai.streamText as the trace root.
//
//     import {LangfuseSpanProcessor} from "@langfuse/otel"
//     // Inside instrumentation.ts:
//     new NodeTracerProvider({
//         spanProcessors: [new LangfuseSpanProcessor({apiKey})],
//     })

// (2) Braintrust approach: wrapper-based, not auto-instrumented. AI
//     calls are explicitly wrapped (wrapAISDK / traced()), so the
//     Braintrust span IS the trace root by construction. No filtering
//     needed because Braintrust's spans don't sit downstream of Next's
//     auto-instrumentation — they're a separate trace tree.
//
//     import {wrapAISDK} from "@braintrust/sdk"
//     const result = await wrapAISDK(streamText)({model, messages})

// (3) Backend-side UI fix: Agenta's "Root" filter promotes the deepest
//     LLM-relevant span (ai.streamText / ai.generateText) to the
//     displayed trace-list row when present — server-side aggregation
//     that hoists `ag.data.*` from the first descendant LLM span onto
//     the trace summary. Accepts the auto-instrumentation spans but
//     hides them by default; users see prompts/responses/tokens at the
//     list level. (Doesn't require any SDK changes.)
```

**Notes:** Discovered when comparing the spike's screenshots — all 4 Next.js phases showed `POST /api/chat...` / `executing api r...` / `GET /api/sentin...` rows with empty Inputs/Outputs columns, while Phase 1 (Node) and the Node v4 published example showed `ai.generateText` / `ai.streamText` rows with the prompt + response fully visible. **The data is in Agenta** (confirmed via direct `POST /api/spans/query` API calls — `ai.streamText` spans carry `ag.data.inputs/outputs/metrics.tokens/user.id/session.id`), it's just not surfaced in the default "Root" UI view. Users with hundreds of Next.js traces have to click into each `POST /api/chat/route` row, navigate two levels of children, and inspect the `ai.streamText` span to see what their LLM call did — including which prompt, which model, how many tokens, what cost. **Why this matters:** the dashboard becomes practically unusable for production triage at scale. Token-cost monitoring, prompt-regression debugging, and per-user usage breakdowns ALL depend on those payload columns being visible at the trace-list level. This affects **every Next.js + AI SDK + Agenta user equally** — the entire dominant deployment shape for AI SDK in production. **Why we missed it earlier in the spike:** our `verifyTrace` harness queries the spans API by attribute (`ag.user.id`) and matches by span name, which finds the `ai.streamText` regardless of hierarchy. Programmatic assertions pass; UI experience is degraded. The pre-existing pain log's "silent failure" entries focused on data loss (P-NODE-02, P-APP-RAW-01, P-PAGES-VERCEL-01); P-COMMON-01 is the inverse — the data is preserved, but the UI's default lens hides it.

**Backend-fixable: yes (2026-05-12 analysis).** The data is already in Agenta — this is purely a display problem, not an export problem. Two backend-side fixes work:
1. Promote LLM-relevant descendants (spans matching `ai.*` / `mastra.*` / `gen_ai.*` attrs) to the displayed trace-list row when a non-LLM span is the technical root. Hoists `ag.data.inputs/outputs/metrics.tokens` from the first descendant LLM span onto the trace summary.
2. Filter out spans whose `scope.name = "next.js"` (or carries no LLM-shaped attrs) before display — same approach Langfuse takes in `@langfuse/otel` v5+ but applied server-side at query/render time instead of pre-export at the SpanProcessor.

Either fix benefits ALL Agenta users (Python SDK, raw OTel, AI SDK, Mastra) without per-framework JS code. See `summary.md` § "Backend-fixable subset (AI SDK)" for the full matrix.

---

## P-COMMON-02: Next.js 16 / Turbopack stricter module resolution exposes missing transitive `@opentelemetry/sdk-trace-base` declarations on `@vercel/otel` apps

**Framework:** common (Next.js 16+, applies to any app using `@vercel/otel` + `SimpleSpanProcessor`)
**Severity:**
  - User impact: low
  - Self-recoverable: yes
  - Silent failure: no (build error)

**Discovered:** 2026-05-18 during the four Next.js spike apps' re-run on Next.js 16.2.6 (Turbopack as default builder).

**The friction (code that exists today):**

Spike apps `nextjs-app-router-vercel` and `nextjs-pages-router-vercel` both import `SimpleSpanProcessor` from `@opentelemetry/sdk-trace-base` inside their `instrumentation.ts` (override `@vercel/otel`'s default `BatchSpanProcessor` to avoid P-APP-VERCEL-01 / P-NODE-02). On Next.js 15.5.15 + webpack + pnpm's lenient hoisting, this worked transitively — `@vercel/otel` listed `@opentelemetry/sdk-trace-base` as a dep and pnpm hoisted it where Next's webpack could resolve it. On Next.js 16.2.6 + Turbopack:

```
./instrumentation.ts:5:0
Module not found: Can't resolve '@opentelemetry/sdk-trace-base'

> 1 | import { registerOTel } from "@vercel/otel"
> 2 | import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
       ^

Build error occurred
```

**Fix:** add `@opentelemetry/sdk-trace-base` to `dependencies` explicitly in `package.json` (alongside `@vercel/otel`). pnpm install and rebuild — Turbopack resolves it correctly. Both `nextjs-app-router-vercel/package.json` and `nextjs-pages-router-vercel/package.json` needed this on 2026-05-18.

**What would be ideal (sketch of how the SDK would hide this):**

```ts
// Users on @agenta/sdk-tracing pass an `init({...})` call instead of
// hand-wiring registerOTel + SimpleSpanProcessor:
import { init } from "@agenta/sdk-tracing"

init({ host, apiKey, projectId })
// → SDK has @opentelemetry/sdk-trace-base as a direct dep; users never
//   import it themselves. Turbopack's stricter resolution sees a single
//   declared dep on the SDK package and resolves it.
```

**Why this matters for v1 setup docs.** `@agenta/sdk-tracing` already declares `@opentelemetry/sdk-trace-base` as a direct dep (it ships `SimpleSpanProcessor` internally). So users on the SDK don't hit this. But users on the migration path (hand-wiring `@vercel/otel` + processor override per Agenta's current Vercel-AI-SDK docs) DO hit it on Next.js 16. Setup docs need an explicit "if you're on Next.js 16+ and not yet on `@agenta/sdk-tracing`, add `@opentelemetry/sdk-trace-base` to your `package.json`" callout.

**Backend-fixable: no.** Build-time module resolution; never reaches the wire.

**Implication for `ts-sdk-tracing` v1.** Reinforces the "one `init()` call" value prop. Users on the SDK never see this. Users hand-wiring keep paying the framework-tightening tax — Turbopack today, something else tomorrow.

---

## P-BRAINTRUST-01: Braintrust OTLP endpoint silently swallows spans on data-plane mismatch — projects auto-create but logs land nowhere

**Framework:** braintrust
**Severity:**
  - User impact: high
  - Self-recoverable: yes
  - Silent failure: yes

**Discovered:** Phase 8 (2026-05-12), during user-driven empirical verification of secondary backends via REST API.

**Scope:** Affects any customer wiring Braintrust as a secondary OTel destination who is NOT on Braintrust's US data plane.

**Symptom:** OTLP exporter to `https://api.braintrust.dev/otel/v1/traces` (Braintrust's default US endpoint, shown first in their docs) returns no synchronous error. Projects auto-create on US plane via the `x-bt-parent: project_name:<name>` header and appear in US-plane `GET /v1/project` listings. **But the spans themselves never reach the user's actual project storage** — because the user's org is configured for the EU plane (`https://api-eu.braintrust.dev`). The Braintrust UI shows the empty-state "waiting for traces" message across every project. The `SimpleSpanProcessor` does not surface the failure; the spike's Agenta-side assertions all PASS while 100% of Braintrust spans are lost.

**Repro:**

1. Sign up a Braintrust org on EU plane (some EU enterprise customers, GDPR-restricted setups, etc).
2. Wire `@opentelemetry/exporter-trace-otlp-proto` with the US-default URL:

   ```ts
   // The friction — docs-default URL silently swallows EU-org spans
   new OTLPTraceExporter({
       url: "https://api.braintrust.dev/otel/v1/traces", // ← US plane, default in their docs
       headers: {
           Authorization: `Bearer ${process.env.BRAINTRUST_API_KEY}`,
           "x-bt-parent": "project_name:my-app",
       },
   })
   ```

3. Generate a `streamText` call — exporter logs say "registered", no errors at runtime.
4. Open Braintrust UI → my-app project → empty.
5. `curl -X POST https://api.braintrust.dev/v1/project_logs/<project_id>/fetch -H "Authorization: Bearer <key>"` → returns **HTTP 421 `DataPlaneRedirectError`** with `RedirectUrl: https://api-eu.braintrust.dev`.

The 421 redirect is sent on the **log-fetch** path, but the **OTLP ingestion** path on US plane silently swallows the request. The OTel exporter doesn't follow the redirect because OTLP/proto doesn't expect 3xx redirects per spec — and the 421 returned to OTLP requests is undocumented behavior.

**The ideal sketch (what would close this on the user's side):**

```ts
// What the SDK would do if it knew about Braintrust's plane semantics:
//   - resolve plane from the API key (Braintrust keys are plane-scoped) OR
//   - probe the gateway and follow the 421 redirect transparently
//
// Closest pragmatic fix until Braintrust does either: pin the URL from env so
// EU orgs don't silently default to US.
new OTLPTraceExporter({
    url: process.env.BRAINTRUST_OTLP_URL ?? "https://api.braintrust.dev/otel/v1/traces",
    headers: {
        Authorization: `Bearer ${process.env.BRAINTRUST_API_KEY}`,
        "x-bt-parent": `project_name:${process.env.BRAINTRUST_PROJECT}`,
    },
})
```

**Mechanism:** Braintrust's project metadata appears to replicate across both planes (so project listing works on either side), but log/trace storage is plane-bound. OTLP requests to the wrong plane are accepted by their gateway, project auto-creation completes (presumably written to a shared metadata service), but the trace payload never makes it into the data store. The OTLP response is 200 OK so the OTel SDK has no signal to retry or redirect.

**Why silent failure:** the OTel `SimpleSpanProcessor` calls `exporter.export(spans, callback)`. The callback receives `ExportResult.SUCCESS` because the HTTP layer got a 200. No `diag.error` log fires, no exception bubbles, no test assertion fails. The user only finds out when they manually check the Braintrust UI and see the empty state.

**Fix on the user's side:** set `BRAINTRUST_OTLP_URL=https://api-eu.braintrust.dev/otel/v1/traces` (or the correct plane for their org). After patching all 8 spike `.env` files to EU and re-running assertions, all 8 Braintrust projects received 2–33 events each.

**Backend-fixable (Agenta side)?** No — third-party SDK / Braintrust infrastructure issue. **JS-side fix?** Documentation only. Braintrust's OTel docs need a "data plane selection" callout near the top. Or their US gateway should return a proper HTTP 3xx redirect on OTLP ingestion so SDKs can follow it.

**Generalization:** any OTLP export pipeline silently swallows backend-side failures unless explicit destination-side verification is done. The spike's assumption that "SimpleSpanProcessor would surface HTTP failures as test failures" was wrong — OTel exporters log to stderr and swallow errors back to the SpanProcessor. **Multi-backend OTel pipelines need REST-API-based delivery verification, not just assertion PASS.** This is a generalizable lesson that applies to ANY observability fan-out, including a future `@agenta/sdk-tracing` if it ships.

**Notes:** Took ~3 hours of empirical investigation to find. The user had to flag it ("braintrust don't have any traces [all projects etc are showing empty state]"); the spike's own tests didn't catch it. Pre-Phase-8 doc claimed "Live (200)" for Braintrust based on the false assumption that test PASS implied delivery. Doc has been corrected.

---

## P-LANGFUSE-01: Langfuse stores all spans (including non-LLM) when receiving raw OTLP — no server-side scope filter

**Framework:** langfuse
**Severity:**
  - User impact: med
  - Self-recoverable: yes
  - Silent failure: no

**Discovered:** Phase 8 (2026-05-12), during empirical UI comparison.

**Earlier wrong claim:** an earlier revision of `summary.md` P-COMMON-01 said "Langfuse's `@langfuse/otel` v5+ ships a SpanProcessor filter dropping non-LLM-scope spans before export — known industry precedent." This was used to argue P-COMMON-01 is solvable Langfuse-style.

**Empirical reality (the friction):** when sending raw OTLP to Langfuse (NOT using their JS SDK), Langfuse stores every span — including Next.js HTTP wrapper spans with null input/output.

```ts
// What we wired in Phase 8 — same SDK-less OTLP path every customer uses if
// they fan out to multiple backends from one OpenTelemetry pipeline:
new SimpleSpanProcessor(
    new OTLPTraceExporter({
        url: "https://cloud.langfuse.com/api/public/otel/v1/traces",
        headers: { Authorization: `Basic ${btoa(`${pk}:${sk}`)}` },
    }),
)
// REST verification afterwards (their GET /api/public/traces) returned 11
// traces for the Phase 2b app — multiple POST /api/chat/route and
// GET /api/sentinels/route rows with input: null, output: null.
// The scope-filter logic that produces "clean" trace lists lives only
// inside @langfuse/otel's LangfuseSpanProcessor, running client-side.
```

**The ideal sketch (what we'd want of any OTLP backend, including Agenta):**

```python
# Scope-based filter applied at the ingest / display layer, not as a
# client-side SpanProcessor. Same logic Langfuse's SDK applies — just
# applied where it actually scales (one place, all clients benefit).
def is_llm_relevant(span: Span) -> bool:
    return (
        any(k.startswith(("ai.", "gen_ai.")) for k in span.attributes)
        or "ag.data.inputs" in span.attributes
        or "ag.data.outputs" in span.attributes
    )
```

**Implication for the strategic comparison:**

- "Langfuse doesn't have the P-COMMON-01 wrapper-span clutter" is true only with their SDK.
- On raw OTLP (which is what the spike uses for tri-export), Langfuse behaves identically to Agenta — both store all spans, both have wrapper spans in the trace list.
- **The filter belongs at the ingest / display layer**, not as a JS SpanProcessor. Agenta can solve P-COMMON-01 at the backend with the same logic Langfuse's SDK applies client-side.

**Why this matters:** it strengthens the backend-fix case for P-COMMON-01 — the precedent isn't "JS-side filter via custom SDK", it's "scope-based filter logic" that can run wherever. The Agenta UI implementing it on the read path is a strictly cleaner architecture than asking users to install yet another SDK with yet another SpanProcessor.

**Backend-fixable?** Not directly (this is about Langfuse, not Agenta). But the *learning* maps to: P-COMMON-01 is backend-fixable on Agenta's side via the same filter logic Langfuse's SDK uses, just applied at query/render time.

**Notes:** Original claim was based on reading their docs without confirming behavior empirically. The user requested verification via SDK / REST API — pulling actual trace data immediately surfaced the contradiction.
