# `ts-sdk-tracing` Pain Log

Structured friction log from spike apps under `web/examples/*`. Each entry captures one awkward moment encountered while wiring raw OpenTelemetry + Vercel AI SDK across framework patterns. This log becomes the requirements input for the SDK.

## Schema (every entry MUST follow this)

```markdown
## P-{FRAMEWORK}-NN: <one-line title>

**Framework:** <node | app-router-raw | app-router-vercel | pages-router-raw | pages-router-vercel | tanstack>
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

**Phase 2b A/B verdict (2026-05-10):** `@vercel/otel` (P-APP-VERCEL-02) DOES emit edge spans, just delayed. So the root cause of THIS entry (raw-OTel-on-edge emits ZERO spans EVER) is something specific to the manual `BasicTracerProvider` + `SimpleSpanProcessor` + `after()` setup, NOT a fundamental limitation of edge runtime + AI SDK + Agenta. Most likely culprits, narrowed:

1. `SimpleSpanProcessor` + edge `keepAlive: true` fetch — the request handler may complete and return BEFORE the underlying fetch's promise resolves, and the edge function freezes immediately on response
2. `after()` callback executes too late — Next 15's `after()` runs the callback AFTER the response is sent but the edge function may freeze before the forceFlush completes
3. `trace.setGlobalTracerProvider()` not registering the provider in the right way for the AI SDK's auto-instrumentation to pick it up — the AI SDK might use a tracer captured at module load time

**`@vercel/otel` works because** it likely uses a `BatchSpanProcessor` plus a `waitUntil`-aware flush hook that's wired more deeply into the edge runtime lifecycle (runs as part of the edge function's outbound work queue, not after-the-fact). Source-diving `@vercel/otel` to understand how it does this is the next investigation.

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

### Next.js Pages Router — raw OTel (P-PAGES-RAW-*)

_No entries yet._

### Next.js Pages Router — `@vercel/otel` (P-PAGES-VERCEL-*)

_No entries yet._

### React TanStack Start (P-TANSTACK-*)

_No entries yet._
