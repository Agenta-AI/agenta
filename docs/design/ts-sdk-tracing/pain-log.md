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

_No entries yet._

### Next.js App Router — `@vercel/otel` (P-APP-VERCEL-*)

_No entries yet._

### Next.js Pages Router — raw OTel (P-PAGES-RAW-*)

_No entries yet._

### Next.js Pages Router — `@vercel/otel` (P-PAGES-VERCEL-*)

_No entries yet._

### React TanStack Start (P-TANSTACK-*)

_No entries yet._
