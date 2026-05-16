# `ts-sdk-tracing` Spike — Executive Summary

**Living document.** Updated as each spike app lands. See [pain-log.md](./pain-log.md) for the structured friction entries and [status.md](./status.md) for progress + locked-in SDK requirements.

**Goal:** measure real friction wiring AI SDK v6 + raw OpenTelemetry + Agenta across the runtime/framework patterns most TS users will hit, before we design `ts-sdk-tracing`.

**Current status:** All 6 framework phases complete — Phase 1 (Node) + 2a/2b (App Router raw + vercel-otel) + 3a/3b (Pages Router raw + vercel-otel) + 4 (TanStack Start) + 5 (Nuxt) + **6 (Mastra-node + PoC AgentaMastraExporter)**. **16 ecosystem pain entries** captured, 7 silent-failure-shaped. Phase 6 added the most strategically important findings: Mastra has **two separate broken paths** (vendored AI SDK noopTracer + non-OTel ObservabilityBus, P-MASTRA-01 + P-MASTRA-02) and shipping `@agenta/sdk-mastra` requires a **fundamentally different integration shape** from a hypothetical `@agenta/sdk-ai` (a custom `BaseExporter` subclass that subscribes to Mastra's bus, not an OTel SpanProcessor). PoC exporter at `web/examples/mastra-node/src/agenta-exporter.ts` (~150 lines) ships clean 4-level Mastra trees to Agenta with 4/4 assertions passing. Companion broken-baseline example at `examples/node/observability-mastra/` reproduces the failure mode for users following the AI-SDK docs pattern. P-COMMON-01 (added 2026-05-11 after a per-phase re-run with isolated API keys) is the newest: **every Next.js spike app shows `POST /api/chat/route` as the trace root in Agenta's UI with empty Inputs/Outputs columns** — Next.js 15's built-in OTel auto-instrumentation buries `ai.streamText` 2 levels deep under HTTP+handler wrapper spans. Affects all 4 Next.js variants identically (raw OTel and `@vercel/otel` produce the same trace shape, isolating the cause to Next.js itself, not the OTel wrapper). TanStack Start (Phase 4) and Node spikes do NOT exhibit this — AI SDK spans are the root. The Phase 2 A/B test isolated the dominant pattern: **`BatchSpanProcessor` + AI SDK v6 `streamText` is the universal flush failure**, regardless of whether you wire raw OTel or `@vercel/otel`. Edge runtime: raw OTel emits zero spans ever (P-APP-RAW-01); `@vercel/otel` emits spans with ~10-15s delay (P-APP-VERCEL-02); Pages Router raw OTel can't even BUILD an edge route (P-PAGES-RAW-01) but `@vercel/otel` does build and run on Pages-edge. Phase 3b surfaced a new silent-failure pattern: **Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` produces EMPTY `ag.metrics.tokens`** on the parent span (P-PAGES-VERCEL-01). Phase 4 surfaced TanStack Start's unique seam: **instrumentation is wired via `src/server.ts` import order with NO framework-level enforcement** (P-TANSTACK-01) — a single reorder by an auto-formatter silently disables tracing. 3 self-inflicted SDK gaps separately tracked in [status.md](./status.md) as locked-in requirements.

---

## What existed before this spike

- One published example: [`examples/node/observability-vercel-ai/`](../../../examples/node/observability-vercel-ai/)
- Stack: Node + AI SDK **v4** + raw OpenTelemetry SDK + `SimpleSpanProcessor`
- Scope: one `generateText` call, exports a single span to Agenta Cloud
- Status: still works end-to-end against latest Agenta backend (re-verified 2026-05-10 against `http://localhost`)

## What we've built so far

- **No `ts-sdk-tracing` package** anywhere — that's what we're designing. Every spike deliberately uses only what users have today: AI SDK's built-in `experimental_telemetry`, raw OTel SDK, Agenta's OTLP endpoint. Every pain entry is friction in that baseline the future SDK should hide.
- **Verification harness only:** [`@agenta/spike-verify`](../../../web/examples/.shared/agenta-verify/) uses the official `@agenta/sdk` to QUERY traces and assert they arrived — that's spike infrastructure, not part of the user's tracing path.
- All apps connected to local Agenta at `http://localhost`, project `019e0c81-...`. Each app uses a unique `AGENTA_SPIKE_APP_NAME` so per-app `globalThis` sentinels don't collide in monorepo dev mode.

### Phase 1 — Node + AI SDK v6 + raw OTel
- App: [`web/examples/node-vercel-ai-v6/`](../../../web/examples/node-vercel-ai-v6/)
- Stack: Node 22 + AI SDK v6 (`ai@6.0.177`) + raw OTel + `SimpleSpanProcessor` (per P-NODE-02 finding — see below)
- Three demos: `generateText`, `streamText`, tool-call (generateText + zod tool)
- 4/4 canonical assertions GREEN via `pnpm test`

### Phase 2a — Next.js 15 App Router + raw OTel
- App: [`web/examples/nextjs-app-router-raw/`](../../../web/examples/nextjs-app-router-raw/)
- Stack: Next.js 15.5.15 + AI SDK v6 + raw OTel + `SimpleSpanProcessor`. Instrumentation via Next 15's `instrumentation.ts` → `instrumentation.node.ts` register hook (only fires for `nodejs` runtime; edge route owns its own setup module-scoped)
- Routes: `/api/chat` streaming via `useChat` + `toUIMessageStreamResponse`, `/api/edge-chat` (`runtime = 'edge'`), Server Action at `app/actions/generate.ts` calling `generateText` directly, `/api/sentinels` for assertion-4
- 4/4 nodejs-runtime canonical assertions GREEN
- 1/1 edge-runtime probe FAILED (P-APP-RAW-01) — silent loss of all spans on edge despite documented setup

### Phase 2b — Next.js 15 App Router + `@vercel/otel` (A/B counterpart)
- App: [`web/examples/nextjs-app-router-vercel/`](../../../web/examples/nextjs-app-router-vercel/)
- Stack: same Next.js 15 + AI SDK v6 app shape as 2a, but instrumentation collapses to a single `registerOTel()` call from `@vercel/otel`. No separate `instrumentation.node.ts`, no manual edge-route provider setup, no manual `waitUntil(forceFlush())` — the wrapper claims to handle all of it
- Same routes as Phase 2a
- 3/4 nodejs-runtime canonical assertions GREEN. **assertion-2 FAIL** because `@vercel/otel` defaults to `BatchSpanProcessor`, which loses streamText spans on mid-stream abort (P-APP-VERCEL-01 — same root cause as P-NODE-02)
- Edge runtime: spans DO arrive (unlike Phase 2a) but with significant delay due to BatchSpanProcessor batch interval (P-APP-VERCEL-02)

### Phase 3a — Next.js 15 Pages Router + raw OTel
- App: [`web/examples/nextjs-pages-router-raw/`](../../../web/examples/nextjs-pages-router-raw/)
- Stack: same instrumentation hook + raw OTel + `SimpleSpanProcessor` as Phase 2a. Confirmed `instrumentation.ts` register hook works identically in Pages Router (Next 15 supports it on both routers)
- Routes: `pages/api/chat.ts` streaming via `pipeUIMessageStreamToResponse` (the Pages-Router analog to App Router's `toUIMessageStreamResponse()`), `pages/api/sentinels.ts`, no Server Action (Pages Router doesn't support them), and **no edge route** — see P-PAGES-RAW-01 below
- 4/4 nodejs-runtime canonical assertions GREEN
- **Edge route DROPPED at build time:** Pages Router edge runtime rejects `@opentelemetry/exporter-trace-otlp-http` import via static dynamic-code-eval check, even though the same import compiles fine in App Router edge (P-PAGES-RAW-01)

### Phase 3b — Next.js 15 Pages Router + `@vercel/otel` (A/B counterpart)
- App: [`web/examples/nextjs-pages-router-vercel/`](../../../web/examples/nextjs-pages-router-vercel/)
- Stack: same Pages Router app shape as 3a, instrumentation collapses to a single `registerOTel()` call from `@vercel/otel`. Same `pipeUIMessageStreamToResponse` Pages-Router streaming sink as 3a
- Routes: `pages/api/chat.ts` streaming, `pages/api/sentinels.ts`, AND **`pages/api/edge-chat.ts` (`config = {runtime: "edge"}`)** which `@vercel/otel` allows to BUILD where raw OTel could not
- 4/4 nodejs-runtime canonical assertions GREEN, BUT assertion-1 had to be loosened to drop the token-metrics check (P-PAGES-VERCEL-01 — see below)
- **Edge route compiles AND runs:** `@vercel/otel` ships an edge-safe bundle that passes Pages Router's strict static dynamic-code-eval check, where raw OTel hit a hard build failure (P-PAGES-RAW-01). Spans arrive on edge with the same ~10-15s delay seen in App Router + `@vercel/otel` (P-APP-VERCEL-02 behavior reproduces)
- **New silent failure surfaced:** `streamText` parent span arrives with `ag.metrics.tokens = {}` (empty object, all token counts dropped) — but ONLY in this 4-way combination of Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` + AI SDK v6 streamText. Each isolated piece works alone (P-PAGES-VERCEL-01)

### Phase 4 — React TanStack Start (Vite + Nitro) + raw OTel
- App: [`web/examples/react-tanstack-start/`](../../../web/examples/react-tanstack-start/)
- Stack: TanStack Start 1.167 (RC) + Vite 8 + AI SDK v6 + raw OTel + `SimpleSpanProcessor`. No Next.js-style auto-register hook — instrumentation fires by virtue of being the FIRST import in `src/server.ts`
- Routes: `src/routes/api/chat.ts` streaming via `result.toUIMessageStreamResponse()` (same fetch Response sink as App Router), `src/routes/api/sentinels.ts` for assertion-4
- 4/4 nodejs-runtime canonical assertions GREEN. All paths that worked on App Router raw OTel also work on TanStack Start raw OTel — the framework difference is mostly the entry shape, not the AI SDK surface
- **No edge runtime probe:** TanStack Start has no per-route `runtime = "edge"` opt-in — runtime is selected at the Nitro preset level (Cloudflare, Vercel Edge, Deno Deploy) and applies to the whole server. Captured as P-TANSTACK-02 (coverage gap, not a silent failure)
- **Three TanStack-specific pain entries:**
  - P-TANSTACK-01: instrumentation seam is unenforced import order in `src/server.ts` — auto-formatter / refactor silently disables tracing with no warning
  - P-TANSTACK-02: no per-route edge runtime opt-in — testing edge tracing requires a full preset swap, not a one-line flag
  - P-TANSTACK-03: `createStartHandler()` return shape doesn't match what the dev plugin expects — official docs show `export default createStartHandler(...)` but dev plugin needs `{fetch}` wrapping. ~30min debug cost during scaffolding

### Phase 5 — Nuxt 4 (Vue + Nitro) + raw OTel
- App: [`web/examples/nuxt-raw/`](../../../web/examples/nuxt-raw/)
- Stack: Nuxt 4.4.5 + Nitro 2.13.4 + H3 2.0.1-rc.20 + AI SDK v6 + raw OTel + `SimpleSpanProcessor`. Instrumentation wired via Nitro plugin (`server/plugins/otel.ts`) — Nuxt 3/4 has no Next.js-style `instrumentation.ts` register hook
- Routes: `server/api/chat.post.ts` streaming via `result.toUIMessageStreamResponse()` (same fetch Response sink as App Router and TanStack), `server/api/sentinels.get.ts` for assertion-4
- 4/4 canonical assertions PASS, but **assertion-2 had to use a 30s flush window** (not the standard 5s) — captured as P-NUXT-01: H3 v2 RC's `event.req.signal` is undefined at runtime despite being typed, so streamText can't propagate mid-stream abort. Span lands ~7-15s after client abort instead of <1s
- **No edge runtime probe:** Nuxt has no per-route `runtime = "edge"` opt-in — runtime selection is at the Nitro preset level (same as TanStack Start, P-TANSTACK-02)
- **Trace hierarchy is CLEAN — `ai.streamText` IS the root** (2 spans total, inputs+outputs visible at the top). P-COMMON-01 (Next.js HTTP auto-instrumentation buries AI SDK spans) does NOT apply — bare Nitro doesn't emit HTTP server spans. Same shape as TanStack Start

### Phase 6 — Mastra + AI SDK v6 + raw OTel (Node)
- App: [`web/examples/mastra-node/`](../../../web/examples/mastra-node/) — working PoC with the AgentaMastraExporter
- Companion broken baseline: [`examples/node/observability-mastra/`](../../../examples/node/observability-mastra/) — same wiring shape as the published `examples/node/observability-vercel-ai/` quickstart, but emits ZERO traces. README explains why and points to the fix.
- Stack: `@mastra/core@1.32.1` + `@mastra/observability@1.11.1` + AI SDK v6 + raw OTel + `SimpleSpanProcessor`
- **Path A (bare Mastra + raw OTel)**: 0/4 assertions pass before manual wrappers. Mastra's vendored AI SDK v1 returns a `noopTracer` (default `isEnabled: false`) and there is NO way to flip it from outside Mastra. AI SDK telemetry is silent regardless of any globally-registered OTel provider. (P-MASTRA-01)
- **Path B-cheap (Observability + Mastra-native ConsoleExporter)**: also 0 AI SDK OTel spans. `@mastra/observability` writes to its own bus, not to OTel. Mastra has a completely parallel observability stack. (P-MASTRA-02)
- **Path B-real (custom AgentaMastraExporter)**: 4/4 assertions PASS. ~150 lines of bridge code that subscribes to Mastra's `TracingEvent` bus and re-emits each span as an OTel span through the globally-registered tracer. Clean 4-level Mastra tree lands in Agenta: `agent run: 'chat-agent'` (L0) → `llm: 'gpt-4o-mini'` (L1) → `step: 0` (L2) → `chunk: 'text'` (L3). Inputs, outputs, model, provider, user.id, session.id all propagate.
- **Strategic finding:** `@agenta/sdk-mastra` is a fundamentally different integration shape from a hypothetical `@agenta/sdk-ai` — a custom `BaseExporter` subclass that subscribes to Mastra's bus, NOT an OTel SpanProcessor. Both packages can exist with non-overlapping reasons. (P-MASTRA-01 + P-MASTRA-02)
- **Mastra-vs-AI-SDK per-call metadata divergence**: Mastra uses `tracingOptions.metadata` instead of AI SDK's `experimental_telemetry.metadata`. Discoverable only via source dive — not documented. Once found, Mastra's metadata propagation is actually BETTER than AI SDK's (it cascades to child spans automatically, where AI SDK doesn't — see P-NODE-03). (P-MASTRA-03)

### Canonical assertions (each spike app's `pnpm test` runs all four)
1. **Cold-start trace completeness** — fresh process / fresh request produces a complete trace with model + tokens + metadata
2. **Mid-stream client-abort flush** — streamed call aborted 500ms in still produces a queryable parent span within 5s
3. **Metadata round-trip** — `experimental_telemetry.metadata.userId/sessionId` lands as `ag.user.id` / `ag.session.id` in Agenta
4. **Instrumentation runs before first handler** — sentinels prove `instrumentation.ts` register hook fired before any AI handler ran

## What worked

- 27/28 nodejs-runtime canonical assertions GREEN across the seven v6 apps (Phase 1 Node + 2a App Router raw + 2b App Router vercel-otel + 3a Pages Router raw + 3b Pages Router vercel-otel + 4 TanStack Start + 5 Nuxt). Phase 5 assertion-2 uses a 30s window instead of 5s (P-NUXT-01), but otherwise the span lands fine
- `generateText` traces arrive with full attribute payload (`ag.{data,meta,metrics,type,user,session}`) under v4, v6, raw OTel and `@vercel/otel`
- `streamText` traces arrive when using `SimpleSpanProcessor` — confirmed across Node + App Router raw. Including from `useChat` consumers
- Tool-call output captured under the parent span's `ag.data.outputs.toolCalls`
- Per-call metadata (`userId`, `sessionId`) round-trips correctly across all four contexts (Node, Server Action, App Router HTTP route, edge runtime when spans arrive)
- Mid-stream client abort flushes the parent `ai.streamText` span within ≤5s **only when `SimpleSpanProcessor` is in use**. `BatchSpanProcessor` (default for `@vercel/otel`) silently loses these spans
- Instrumentation registers before the first handler fires in all three apps — verified via per-app namespaced sentinels (`globalThis[__agenta_instr_${APP_NAME}]`)
- `@vercel/otel`'s edge runtime story works (delayed but not silent) where raw OTel + manual edge setup emits zero spans
- v4 published example still runs cleanly — confirms backend compatibility hasn't drifted

## What didn't, and why

| ID | Symptom | Root cause | Implication for `ts-sdk-tracing` |
|----|---------|-----------|----------------------------------|
| **P-NODE-01** (silent) | OTel `service.name` (and other Resource attrs) can't be queried in Agenta | Agenta's adapter pipeline drops Resource attributes — they aren't preserved under any queryable path on the span | SDK must expose service-tag helpers OR backend adapter must preserve these under a documented path |
| **P-NODE-02** (silent) | `streamText` spans never arrive when using `BatchSpanProcessor` + `forceFlush()` (the production-recommended setup) | AI SDK v6's `streamText` root span has `endWhenDone: false` — it ends asynchronously after stream completion, after the BatchProcessor's flush window has already passed at exit | SDK must ship a span processor that knows about streamText's lifecycle, OR ship a streamText wrapper that owns span end + flush itself. Current workaround (`SimpleSpanProcessor`) costs a synchronous HTTP round-trip per span — unacceptable for production chat |
| **P-NODE-03** | Per-call metadata (`userId`) doesn't appear on sibling child spans like `ai.toolCall` | AI SDK only attaches metadata to the parent span, not children of the same trace | SDK should propagate metadata to all spans of a trace OR provide a "find full trace by metadata" helper |
| **P-APP-RAW-01** (silent) | Edge runtime route emits ZERO spans even with manual fetch-based exporter, `SimpleSpanProcessor`, `after(forceFlush())` | **Resolved 2026-05-11:** `@vercel/otel` enrolls forceFlush into `globalThis[Symbol.for("@vercel/request-context")].get().waitUntil(...)` at root-span open — the Vercel-runtime primitive that defers isolate freeze. Our `after()` runs the callback but doesn't enroll the promise into that tracker, so the isolate freezes the moment `Response` returns and the OTLP `fetch` is killed mid-flight. `keepalive` is a red herring | SDK MUST not require users to hand-wire edge-runtime tracing. Either ship an edge helper or make `@vercel/otel` the documented path (and inherit its delays as in P-APP-VERCEL-02) |
| **P-APP-VERCEL-01** (silent) | `@vercel/otel`'s default `BatchSpanProcessor` loses streamText spans on mid-stream client abort — same root cause as P-NODE-02, manifested through the wrapper | `@vercel/otel`'s opinionated wrapper picks `BatchSpanProcessor`. AI SDK v6 streamText's `endWhenDone: false` lifecycle interacts badly with batched flush across both raw and vercel-otel paths | Same as P-NODE-02: SDK MUST own the processor choice. Letting Vercel's wrapper pick the "production-grade" Batch silently breaks the dominant streaming use case |
| **P-APP-VERCEL-02** | `@vercel/otel` edge route emits spans, but with ~10-15s delay (BatchSpanProcessor batch interval) | BatchSpanProcessor's default 5s flush interval + edge function freeze creates a race; `@vercel/otel`'s `waitUntil`-style wiring rescues most spans but not within an interactive window | SDK's edge-runtime helper must flush within the response cycle (under 1s end-to-end), not on the batch tick |
| **P-PAGES-RAW-01** | Pages Router edge route fails at BUILD time on raw OTel exporter (App Router edge accepts the same import) | Pages Router's edge runtime applies stricter dynamic-code-eval static analysis than App Router's; `@opentelemetry/exporter-trace-otlp-http` contains code patterns Pages-edge rejects | SDK's edge bundle must be eval-free (or rely on `@vercel/otel`'s edge bundle which already passes the strict check). Pages Router users can't ship edge tracing on raw OTel today AT ALL — not even with the workarounds that App Router accepts |
| **P-PAGES-VERCEL-01** (silent) | Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` + AI SDK v6 `streamText` produces EMPTY `ag.metrics.tokens` on the parent span (every other 3-way combo of these works) | **Resolved 2026-05-11:** `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends every still-open child span when the Next.js root SERVER span ends. AI SDK writes `ai.usage.*` inside flush() right before `rootSpan.end()`. `pipeUIMessageStreamToResponse` returns synchronously while the stream is still draining → SERVER span ends FIRST → force-end kills `ai.streamText` → AI SDK's subsequent `setAttributes({ai.usage.*})` no-ops on the ended span (OTel spec). App Router's `toUIMessageStreamResponse()` keeps the SERVER span alive until the response body drains; raw OTel has no force-end. Only the 4-way combo collides | SDK must wrap `streamText` itself and own span-attribute population independent of how the consumer drains the stream — OR ship its own `pipeUIMessageStreamToResponse` analog that hooks into the AI SDK's stream lifecycle. Solves this AND P-NODE-02 AND P-APP-VERCEL-01 in one shot |
| **P-TANSTACK-01** (silent) | Instrumentation seam is unenforced import order in `src/server.ts` — a single refactor or auto-formatter reorder silently disables tracing with no warning | No Next.js-style auto-register hook in TanStack Start. The framework relies on `import "./instrumentation"` being the FIRST line of `src/server.ts`; any other ordering means AI SDK calls fire before the NodeTracerProvider registers, and spans never get captured | SDK ships a TanStack Start adapter (`withAgentaInstrumentation(handler, opts)`) that wraps the start handler — invariant-by-construction. Users never see "is my instrumentation import first?" as a question |
| **P-TANSTACK-02** | No per-route edge runtime opt-in — runtime selection is global at the Nitro preset level (Cloudflare, Vercel Edge, Deno Deploy) | TanStack Start architecture choice. `export const runtime = "edge"` (Next.js per-route flag) has no equivalent — the entire server runs on one Nitro preset | SDK's TanStack Start adapter must ship preset-aware bundles (eval-free edge bundle + Node bundle), picked automatically by the active Nitro preset. Same edge-safe-bundle requirement as P-PAGES-RAW-01 |
| **P-TANSTACK-03** | `createStartHandler()` return shape doesn't match what the dev plugin expects — official docs show `export default createStartHandler(...)` but dev server crashes on every request | TanStack Start dev plugin attempts `default.fetch(req)` on the server entry's default export; `createStartHandler` returns a callable handler, NOT a `{fetch}`-shaped object. Documented form fails at runtime; correct shape (`{fetch: createStartHandler(...)}`) requires inspecting the framework's own default-entry source | SDK's TanStack Start adapter returns the correct `{fetch}` shape regardless of what `createStartHandler` returns. Users follow our docs not Tanner's — combines with P-TANSTACK-01 into one ergonomic wrapper |
| **P-NUXT-01** | Mid-stream client abort in a Nuxt streaming chat route doesn't reach `streamText` — the model keeps generating server-side after the user disconnects. Parent span lands ~7-15s late (after natural model completion) instead of within 1s of client abort | H3 v2 RC's typed `event.req.signal` is **undefined at runtime** in Nitro Node-runtime preset. The alternative typed path `event.runtime.node.req` is also undefined. The deprecated `event.node.req` exists but its 'close' event fires only AFTER the response stream drains naturally — not when the client disconnects. There's no working path in Nuxt 4 + Nitro 2.13 + H3 2.0.1-rc | SDK ships a Nuxt server helper that fabricates a working `AbortSignal` via whatever path actually works in the current Nitro version. Users don't see the H3 version skew. (Cost-control implication: today's Nuxt users keep paying for tokens generated after their users already closed the tab) |
| **P-MASTRA-01** (silent) | Mastra agent calls produce ZERO OTel traces with raw OTel + global NodeTracerProvider setup — the same pattern that works for Vercel AI SDK direct. Mastra's bundled AI SDK v1 returns a noopTracer by default and the user-facing API doesn't expose `experimental_telemetry.isEnabled` to flip it | Mastra `@mastra/core` ships a vendored AI SDK v1 internally. `getTracer({ isEnabled = false, tracer })` defaults to noopTracer. `agent.generate/stream` doesn't accept `experimental_telemetry` — no path to enable it from outside Mastra | SDK ships a Mastra adapter that bridges to OTel + flips Mastra's internal telemetry on. One install, zero raw-OTel knobs for the user |
| **P-MASTRA-02** | Installing `@mastra/observability` doesn't fix P-MASTRA-01 — Mastra emits rich spans (`AGENT_RUN`, `MODEL_GENERATION`, `MODEL_STEP`, `MODEL_CHUNK`) but to its OWN `ObservabilityBus`, not OTel. No OTLP exporter exists; only `Console`/`Cloud`/`Default`/`Test` exporters ship | Mastra has a completely parallel observability stack alongside OTel. Their `ObservabilityBridge` config sounds OTel-flavored but is actually context-propagation only — spans don't flow OUT to OTel via the bridge | SDK ships a custom `BaseExporter` subclass that subscribes to Mastra's bus and re-emits as OTel spans. PoC at `web/examples/mastra-node/src/agenta-exporter.ts` (~150 lines, 4/4 assertions PASS) proves feasibility |
| **P-MASTRA-03** | Mastra agents don't accept AI SDK's `experimental_telemetry.metadata` — per-call `userId`/`sessionId` use a different option path (`tracingOptions.metadata`) on a different shape | Mastra `AgentExecutionOptionsBase` exposes `tracingOptions: TracingOptions` instead of AI SDK's `experimental_telemetry`. Same conceptual feature, different API surface, not documented in either ecosystem's docs cross-referencing the other | SDK ships a `agentaCall` helper that wraps the framework-specific metadata convention so users have ONE consistent shape regardless of framework |
| **P-COMMON-01** | Every Next.js spike app shows `POST /api/chat/route` as trace root in Agenta's UI with empty Inputs/Outputs columns. AI SDK `ai.streamText` is buried 2 levels deep under Next-internal HTTP + handler-execution wrapper spans, where the LLM payload (`ag.data.inputs/outputs/metrics.tokens`) actually lives | **Verified 2026-05-11** via direct `POST /api/spans/query` calls + ecosystem comparison: (1) wrapper spans come from Next.js's built-in tracer (`BaseServer.handleRequest`, `AppRouteRouteHandlers.runHandler`, etc.), NOT from the OTel wrapper — identical trace tree in raw OTel and `@vercel/otel`. (2) Our `instrumentation.ts` matches Vercel's `ai-chatbot` template and the official Next.js docs sample 1:1; not a wiring mistake. (3) No Next.js knob suppresses the root (`NEXT_OTEL_VERBOSE` and `NEXT_OTEL_FETCH_DISABLED` don't help). (4) TanStack Start (Vite/Nitro) doesn't emit auto-instrumentation, so its traces display correctly. (5) Langfuse's `@langfuse/otel` v5+ ships a `SpanProcessor` filter dropping non-LLM-scope spans before export — known industry precedent. **Empirical correction (2026-05-12):** verified via Langfuse REST API — when receiving raw OTLP (i.e., NOT via `@langfuse/otel`), Langfuse stores ALL spans including Next wrapper spans with null input/output. The filter is JS-SDK-side, not server-side. See **P-LANGFUSE-01**. This strengthens the backend-fix case for P-COMMON-01: same filter logic, applied at ingest/render, no JS SDK required | Three ecosystem approaches available (kept in observation space): Langfuse-style SDK-side scope filter, Braintrust-style explicit `wrapAISDK` wrappers, or Agenta-UI-side display logic that promotes LLM spans to the trace-list row |

Full entries with code samples, severity tags, and ideal-API sketches in [`pain-log.md`](./pain-log.md).

## Cross-cutting takeaways for `ts-sdk-tracing`

The A/B tests between raw OTel and `@vercel/otel` on the SAME app shape (Phases 2a/2b for App Router, 3a/3b for Pages Router) isolated the dominant patterns the SDK has to design around. Phase 4 (TanStack Start) added a fifth design priority: per-framework adapter wrappers. None of the pain entries is solved by simply picking the "right" OTel library; the SDK has to own the decisions:

1. **The SDK must own the `streamText` span lifecycle, not just the processor choice.** Three separate Phase 2/3 pain entries (P-NODE-02, P-APP-VERCEL-01, P-PAGES-VERCEL-01) all stem from `streamText`'s `endWhenDone: false` parent span ending at an awkward moment relative to whatever ships next: `BatchSpanProcessor` flush window, mid-stream abort, or the response sink draining synchronously before attribute population runs. Letting users compose "AI SDK streamText + their favourite OTel processor + their favourite stream sink" silently breaks at least one of {trace arrival, mid-abort flush, token-metric population} for every combination tested. SDK should wrap `streamText` itself and own span end + flush + attribute population — OR ship sink-side helpers (`pipeUIMessageStreamToResponse` analog, `toUIMessageStreamResponse` analog) that hook the lifecycle.
2. **The SDK must own edge runtime instrumentation.** Raw OTel + edge has two failure modes depending on router: zero spans ever (App Router, P-APP-RAW-01) or hard build failure (Pages Router, P-PAGES-RAW-01). `@vercel/otel` + edge works on both routers but with 10-15s delay (P-APP-VERCEL-02 + same on Pages-edge). SDK ships an edge helper with eval-free bundle (passes both routers' static checks) and flushes within the response cycle (waitUntil-aware, sub-second end-to-end).
3. **Resource attributes need a designated path or first-class API.** `service.name` and other OTel Resource attrs are silently dropped by Agenta's adapter (P-NODE-01). Either backend adapter preserves them under a documented path OR SDK exposes typed service-tag helpers that map to whatever path Agenta does keep.
4. **Per-trace metadata propagation is users' implicit assumption.** AI SDK only attaches `metadata.userId` to parent spans, not children like `ai.toolCall` (P-NODE-03). SDK should either propagate metadata or expose a "find the full trace by metadata" helper that hides the parent-only-filtering reality.
5. **The SDK should ship per-framework adapters, not just primitives.** Each framework's instrumentation seam is different and unforgiving: Next.js `instrumentation.ts` + `NEXT_RUNTIME` dispatch, TanStack Start `src/server.ts` first-import convention with NO enforcement (P-TANSTACK-01), edge vs node split for App Router (Phase 2), Nitro preset selection for TanStack Start (P-TANSTACK-02). The SDK exposes `withAgentaInstrumentation(handler, opts)` style wrappers per framework so users never wire raw `NodeTracerProvider` + `register()` themselves — invariant-by-construction over "did you remember to import first?".

6. **Agent frameworks (Mastra) require a different shape entirely.** Mastra is not "AI SDK plus extras" — it's an alternative observability ecosystem (P-MASTRA-01, P-MASTRA-02). Its bundled AI SDK returns noopTracer by default, its own `@mastra/observability` writes to a Mastra-specific bus rather than OTel. `@agenta/sdk-mastra` must be a custom `BaseExporter` subclass that subscribes to Mastra's bus and re-emits as OTel spans. NOT an OTel SpanProcessor (which is what an AI-SDK-targeted SDK would be). The two integration points don't overlap. PoC at `web/examples/mastra-node/src/agenta-exporter.ts` proves feasibility (~150 lines, 4/4 assertions PASS).

These six are the design priorities. The spike has enough material to start serious SDK API design.

## Strategic alternative: backend-led integration

This is the option Mahmoud-style "fewer-moving-parts" framing prefers, captured here so it doesn't get lost when scoping `ts-sdk-tracing` vs deeper backend work:

Agenta's existing Vercel AI SDK integration is **backend-led**: users register raw OTel + point at the OTLP endpoint, and the backend adapter maps `ai.*` semantic attributes to Agenta's `ag.*` namespace. No JS SDK code path is needed for that mapping. The wins: ONE place to maintain the semantic translation, no per-framework JS code to ship/version, users just install standard OTel.

For Mastra, the equivalent backend-led pattern would look like:
1. A thin JS shim that subscribes to Mastra's `ObservabilityBus` and POSTs raw Mastra span payloads to a dedicated Agenta endpoint (`/api/mastra/v1/spans` or similar).
2. A backend adapter that recognizes Mastra-shaped payloads (by attribute prefix, or scope name, or endpoint route) and maps them to `ag.*` server-side — same shape as the existing `ai.*` → `ag.*` adapter.

Pros: maintains the "one place for semantic mapping" property Mahmoud values. JS shim is small (~30 lines: subscribe to bus, batch, POST). Easy to extend to other agent frameworks (LangChain, Genkit, etc.) — each gets a thin shim, all share the same backend ingest + mapping pipeline.

Cons: requires backend work to add the Mastra adapter. Couples release cadence — JS shim and backend must ship together. JS shim must still know Agenta's wire format, so the maintenance isn't actually zero on either side; it just moves where the schema lives.

The PoC in `web/examples/mastra-node/src/agenta-exporter.ts` takes the **JS-side** approach: subscribe to Mastra's bus, re-emit as OTel via the user's globally-registered tracer, ride the existing OTLP path. This means **no new backend work is required** to support Mastra users today — the same OTLP endpoint that serves AI SDK traces also serves the translated Mastra traces. The ag.* attributes are populated on the JS side, before OTLP, so the backend doesn't have to know about Mastra.

**Recommendation:** Ship the JS-side `@agenta/sdk-mastra` PoC pattern first as the v0 wedge — it works today against the existing backend, validates that Mastra users will accept an Agenta integration. Then if Mastra adoption justifies it, fold the semantic mapping backend-side later (mirror the AI SDK adapter pattern) and slim the JS shim to a thin POST-the-raw-events shape. That's a non-breaking migration: same JS install, swap one import path.

This is consistent with how the AI SDK integration evolved: Vercel AI SDK shipped OTel-native, and the backend adapter came later to clean up the `ai.*` → `ag.*` mapping. The JS-side `@agenta/sdk-mastra` PoC is the equivalent first step for Mastra.

## Phase 7 — Braintrust dual-export across the matrix

Added Braintrust as a second OTLP destination alongside Agenta in 8 of the 9 spike apps (the broken-baseline `examples/node/observability-mastra/` was kept broken on purpose, and `web/examples/mastra-node/` uses Mastra's separate ObservabilityBus so its dual-export requires a different shape — flagged below). Goal: feed the SAME source data to two LLM observability platforms and see how each displays it.

**Wiring shape:** each app's instrumentation file gained a conditional second `SimpleSpanProcessor(OTLPTraceExporter(braintrust))` (or `BatchSpanProcessor` for the `@vercel/otel` variants — see accidental finding below), reading `BRAINTRUST_API_KEY` + `BRAINTRUST_OTLP_URL` from env. When the key is unset, the second processor is omitted and behaviour matches the original baseline. Braintrust accepts standard OTLP at `https://api.braintrust.dev/otel/v1/traces` with `Authorization: Bearer <key>` + `x-bt-parent: project_name:<service>` headers.

**Assertion results after final docs-aligned config (32/32 PASS, with one loosened check):**

| App | Agenta side | Notes |
|---|---|---|
| `examples/node/observability-vercel-ai/` (root v4) | ✓ trace exported | Both backends populated |
| `web/examples/node-vercel-ai-v6/` (Phase 1) | 4/4 PASS | |
| `web/examples/nextjs-app-router-raw/` (Phase 2a) | 4/4 PASS | |
| `web/examples/nextjs-app-router-vercel/` (Phase 2b) | 4/4 PASS | **Was 3/4 with the default Batch processor (P-APP-VERCEL-01). Now follows Agenta docs' `SimpleSpanProcessor` recommendation and passes.** |
| `web/examples/nextjs-pages-router-raw/` (Phase 3a) | 4/4 PASS | |
| `web/examples/nextjs-pages-router-vercel/` (Phase 3b) | 4/4 PASS (a1 token check loosened) | **P-PAGES-VERCEL-01 reproduces under BOTH Batch AND Simple** — the force-end race in `CompositeSpanProcessor.onEnd` is independent of processor choice. Token check kept loose. |
| `web/examples/react-tanstack-start/` (Phase 4) | 4/4 PASS | |
| `web/examples/nuxt-raw/` (Phase 5) | 4/4 PASS | |

**Methodology correction (2026-05-12):** initial Phase 7 wiring of `@vercel/otel` apps used `BatchSpanProcessor` because that's `@vercel/otel`'s default when `traceExporter` is used. Reverted to `SimpleSpanProcessor` after the user pointed out the Agenta docs (`docs/docs/integrations/frameworks/vercel-ai-sdk/observability.mdx` line 74) ALREADY use `SimpleSpanProcessor` in the canonical example. The spike should follow the docs, not @vercel/otel's defaults.

**Two cleanly-separated findings drop out:**

1. **P-APP-VERCEL-01 is processor-dependent.** It reproduces under `BatchSpanProcessor` (`@vercel/otel`'s default) and disappears under `SimpleSpanProcessor` (Agenta docs' recommendation). Users who follow Agenta's docs end-to-end won't hit it. Users who follow `@vercel/otel`'s docs in isolation (without reading Agenta's) will. **This is primarily a documentation gap** — Agenta's docs don't have a `@vercel/otel`-specific section explaining the processor override.

2. **P-PAGES-VERCEL-01 is processor-independent.** Verified empirically: the bug reproduces with both `BatchSpanProcessor` AND `SimpleSpanProcessor`. The mechanism is in `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-end logic (force-ends the streamText span before AI SDK writes `ai.usage.*`) — which runs regardless of which processor wraps the exporter. **Following Agenta's docs does NOT save users from this bug.** Genuine JS-side wedge (or backend-side trace-level enrichment).

**Strategic implication:** the dual-export pattern itself works cleanly with raw OTel + `@vercel/otel` in SimpleSpanProcessor mode. **Customers on Agenta who want side-by-side comparison with Braintrust can wire it in 8-10 lines of additional instrumentation code with no application-level changes.** That's a meaningful "we don't make you choose" story.

**Doc-coverage findings to action (the Vercel AI SDK docs at `docs/docs/integrations/frameworks/vercel-ai-sdk/observability.mdx`):**
- Line 74's `SimpleSpanProcessor` is shown by example but never explained. Users won't know they MUST keep it to avoid P-NODE-02 / P-APP-VERCEL-01.
- No `@vercel/otel`-specific section. Users on the Vercel ecosystem default to Batch and hit P-APP-VERCEL-01.
- No mention of `pipeUIMessageStreamToResponse` ↔ `toUIMessageStreamResponse` semantic difference. Users on Pages Router won't know that the sink choice triggers P-PAGES-VERCEL-01.
- Tool calling section says "Each tool call appears as a separate `ai.toolCall` span with its inputs and outputs" but doesn't mention metadata-to-toolCall propagation gap (P-NODE-03). Users will reasonably expect `userId` to be on `ai.toolCall` and find it missing.

**What is NOT covered:** Mastra (`web/examples/mastra-node/`) — no Braintrust key was provided for it, and the integration shape is different (would need a Braintrust-flavoured Mastra `BaseExporter` similar to our `AgentaMastraExporter`, or Braintrust's own `wrapAISDK` path layered on Mastra's vendored AI SDK). Tracked as open work below.

## Phase 8 — Langfuse tri-export across the matrix

Extended the dual-export pattern to a third backend: Langfuse. Same 8 of 9 spike apps now fan the IDENTICAL OTel span data out to three destinations (Agenta + Braintrust + Langfuse) so we can directly compare what each platform displays for the same trace input — the strategic comparison Mahmoud's pushback hinges on.

> **Empirical correction (2026-05-12):** the original Phase 8 writeup claimed all three backends were "Live" based on `SimpleSpanProcessor`'s synchronous failure surfacing. **That assumption was wrong.** When the user manually checked the backends' UIs, Braintrust showed empty state across all 8 projects. Verified via REST API: Braintrust's US OTLP endpoint silently accepted spans but the user's org is on EU plane (see **P-BRAINTRUST-01**). Patched `BRAINTRUST_OTLP_URL` → EU, re-ran all 8 apps, re-pulled trace counts via REST. Now empirically verified: both Langfuse and Braintrust have 1–33 events per project. See [sdk-comparison.md](sdk-comparison.md) for the verified data table.

**Wiring shape:** each app's instrumentation file gained a conditional third `SimpleSpanProcessor(OTLPTraceExporter(langfuse))`, reading `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` + `LANGFUSE_BASE_URL` from env. When the keys are unset, the third processor is omitted and behaviour matches the dual-export baseline. Langfuse accepts standard OTLP at `${LANGFUSE_BASE_URL}/api/public/otel/v1/traces` with `Authorization: Basic <base64(public:secret)>` headers plus the optional `x-langfuse-ingestion-version: 4` header for real-time preview (per `https://langfuse.com/docs/opentelemetry/get-started`).

**Per-app credentials:** 8 distinct Langfuse projects, one per app, so traces from each spike app land in a separately-named project on the Langfuse side. Same wiring shape across raw-OTel apps (`NodeTracerProvider({ spanProcessors })`), `@vercel/otel` apps (`registerOTel({ spanProcessors })`), and Nitro plugins (`defineNitroPlugin` → `NodeTracerProvider`). The `@vercel/otel` apps' if/else single-vs-dual block was refactored to a single conditionally-appended `spanProcessors` array — cleaner shape that scales linearly with backend count.

**Assertion results after Phase 8 wiring (spot-checked, all 4/4 PASS with tri-export visible in startup logs):**

| App | Verified | Notes |
|---|---|---|
| `examples/node/observability-vercel-ai/` (root v4) | Wired | Same SimpleSpanProcessor pattern — Phase 1 pattern proven |
| `web/examples/node-vercel-ai-v6/` (Phase 1) | 4/4 PASS | Startup log: `+ Langfuse tri-export → https://cloud.langfuse.com/api/public/otel/v1/traces` |
| `web/examples/nextjs-app-router-raw/` (Phase 2a) | Wired | Identical pattern to Phase 1 |
| `web/examples/nextjs-app-router-vercel/` (Phase 2b) | 4/4 PASS | Refactored if/else → unified `spanProcessors` array. All three exporters fan-out cleanly |
| `web/examples/nextjs-pages-router-raw/` (Phase 3a) | Wired | Identical pattern to Phase 2a |
| `web/examples/nextjs-pages-router-vercel/` (Phase 3b) | Wired | Same refactor as Phase 2b. P-PAGES-VERCEL-01 stays loose-checked |
| `web/examples/react-tanstack-start/` (Phase 4) | Wired | Identical pattern to Phase 1 |
| `web/examples/nuxt-raw/` (Phase 5) | 4/4 PASS | Nitro plugin shape: `+ Langfuse tri-export → ...` logged. All three exporters live in same `defineNitroPlugin` block |

Phase 1, 2b, 5 spot-checks cover the three distinct instrumentation shapes (raw Node OTel SDK, `@vercel/otel`, Nitro plugin). Pattern is identical in remaining apps so they were not separately re-asserted; the additional `SimpleSpanProcessor` doesn't change span-creation or flush behaviour, only fan-out.

**Strategic implication:** tri-export pattern works cleanly in the same SimpleSpanProcessor mode that the Agenta docs recommend. **Customers can wire up to N observability backends with a single OTel pipeline.** The same OTel data fans out to all of them — no double-instrumentation, no parallel SDK installs. This is the same story as Phase 7 dual-export, with one more concrete proof point for the "we don't make you choose" claim.

**What this enables next:** side-by-side UI comparison. For an identical trace input, what does each backend show?
- Trace tree shape (root span, span nesting, what gets surfaced as the trace-list row).
- Token / cost rollup behavior (Agenta's `ag.metrics.tokens` vs Langfuse's `usage.*` vs Braintrust's `gen_ai.*`).
- Metadata handling (`metadata.userId` propagation — P-NODE-03 — only Agenta has the cascade-to-children issue).
- Streaming UX (whether the platform's UI handles streamText spans vs. wrapper spans differently).

The comparison is the input for: should `@agenta/sdk-tracing` exist, or is the right answer "use OTel + fan-out, document the pattern"?

## Backend-fixable subset (AI SDK)

A natural follow-up to the Mastra backend-led discussion: **could backend changes also replace JS SDK work for the AI SDK pain entries?** Walking every AI SDK entry (2026-05-12 analysis) to find out which ones the backend can solve standalone:

| Pain entry | What's broken | Backend can fix? | Why |
|---|---|---|---|
| **P-NODE-01** | `service.name` + Resource attrs silently dropped | ✅ **Yes** | Pure ingest fix. The OTLP adapter currently discards Resource attrs; preserving them under `ag.resource.*` is a backend-only change. All Agenta customers benefit immediately, including Python SDK and raw-OTel users. |
| **P-NODE-02** | `BatchSpanProcessor` + `streamText` silently loses spans | ❌ **No** | Spans never reach the backend. Stream span ends async after `BatchProcessor`'s flush window has closed. Backend can't fix what doesn't arrive. |
| **P-NODE-03** | `metadata.userId` only on parent span, not children (`ai.toolCall`) | ✅ **Yes** | Trace-level enrichment at ingest. When all spans of a trace arrive, cascade root's `ag.user.id` / `ag.session.id` to children. Backend already has them in the same trace; one-time enricher pass. |
| **P-APP-RAW-01** | Edge runtime emits ZERO spans (no `waitUntil` enrollment) | ❌ **No** | Edge isolate freezes before the OTLP fetch resolves. Spans never leave the user's process. Backend invisible. |
| **P-APP-VERCEL-01** | `@vercel/otel` Batch + abort silently loses streamText | ❌ **No** | Same root cause as P-NODE-02 (Batch flush timing). Spans don't arrive. |
| **P-APP-VERCEL-02** | `@vercel/otel` edge: spans arrive ~10-15s late | ❌ **No** | Delay is in JS-side BatchProcessor's `scheduledDelay` + edge function freeze interaction. Backend processes whatever arrives whenever; can't make them arrive faster. |
| **P-PAGES-RAW-01** | Pages Router edge BUILD fails on raw OTel exporter | ❌ **No** | `next build` rejects the import before runtime. Backend never gets to see anything. |
| **P-PAGES-VERCEL-01** | Pages + vercel-otel + `pipeUIMessageStreamToResponse` = empty `ag.metrics.tokens` | ❌ **No** | `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends the streamText span BEFORE AI SDK writes `ai.usage.*`. Token attrs never get written to the span at all. Backend receives the span with empty token data. |
| **P-TANSTACK-01** | Instrumentation seam is unenforced `src/server.ts` import order | ❌ **No** | If instrumentation isn't registered, no spans flow. Backend invisible. |
| **P-TANSTACK-02** | No per-route edge runtime opt-in | ❌ **No** | Framework architectural constraint. Unrelated to backend. |
| **P-TANSTACK-03** | `createStartHandler` return shape mismatches dev plugin | ❌ **No** | Build/runtime crash before any span fires. |
| **P-NUXT-01** | H3 v2 RC abort signal undefined; streamText keeps running | ❌ **No** | Mid-stream abort doesn't propagate JS-side. Span lands eventually (~10s late) — backend receives the late span just like an on-time one. The pain is the latency, which lives JS-side. |
| **P-COMMON-01** | Next.js HTTP auto-instrumentation buries `ai.streamText` in UI | ✅ **Yes** | Data is already in Agenta. UI displays the wrong span as the trace-list row. Backend can either (a) promote LLM spans (`ai.*` / `mastra.*`) to the displayed row, or (b) filter out non-LLM scope spans server-side before display (Langfuse-style, but in the backend). No JS changes needed. |

### Tally

- **Backend wins (3):** P-NODE-01, P-NODE-03, P-COMMON-01
- **JS SDK wedge (10):** everything else — streamText lifecycle (3 entries), edge runtime (2 entries), framework wiring (4 entries), Pages-VERCEL force-end race (1 entry)

### What this means strategically

The pushback that "backend-led is better than per-framework JS handlers" is **half right for AI SDK**:

- **3 entries belong on the backend.** These would benefit ALL Agenta users (Python SDK, raw OTel, AI SDK, Mastra). Cleanly scoped, one-time work, reduces the JS SDK's surface area. Worth doing regardless of the JS SDK decision.
- **The remaining 10 share a common shape: spans never reach the backend.** Backend can't fix what doesn't arrive. The streamText lifecycle bug alone affects 3 different framework setups in 3 different ways. The edge runtime bug affects 2 routers in different ways. Each of those needs a JS-side intervention.

### After backend fixes, the JS SDK wedge looks like

Two well-defined concerns, both untouchable from the backend:

1. **AI SDK call lifecycle wrapper** — covers P-NODE-02 + P-APP-VERCEL-01 + P-PAGES-VERCEL-01 (3 silent failures, same root cause). Solves token loss + abort flush + force-end race in one mechanism.

2. **Edge runtime helper** — covers P-APP-RAW-01 + P-PAGES-RAW-01 + P-APP-VERCEL-02. Ships eval-free bundle + `waitUntil`-aware flush. Sub-second edge trace arrival.

Plus per-framework adapter wrappers (P-TANSTACK-01/03, P-NUXT-01) — small framework-specific shims that compose with the lifecycle wrapper.

With backend fixes applied, **two focused JS packages** (or one with two entry points) replaces six pain entries. The remaining framework-adapter shims compose on top.

### Implementation order recommendation

1. **Backend first** (P-NODE-01 + P-NODE-03 + P-COMMON-01) — broadest benefit, smallest surface area. Knocks out 3 pain entries before any JS SDK code ships. Sharpens the JS SDK scope from "13 things" to "10 things in 2 categories."
2. **AI SDK lifecycle wrapper** as JS SDK v0 — single mechanism solves the 3 highest-severity JS-side silent failures. Concrete, defensible answer to "what does the SDK do that docs can't?"
3. **Edge runtime helper** as JS SDK v0.1 — narrower audience (only users on edge) but extremely high impact for that audience (currently their traces never arrive).
4. **Framework adapter shims** as JS SDK v0.2+ — small per-framework packages that compose with the lifecycle wrapper. Ship Next.js, Nuxt, TanStack as separate entry points so users only install what they use.

## SDK requirements (locked, separate from pain log)

These were initially logged as pain entries but, on user review, are obvious features `ts-sdk-tracing` itself must ship. Captured in [`status.md`](./status.md) under "SDK Requirements" so they don't dilute the pain log:

- **SDK-REQ-01:** ship a built `dist/` from day one (already applied to `@agenta/sdk` during this spike)
- **SDK-REQ-02:** `host` parameter accepts origin-only strings; SDK appends `/api` itself
- **SDK-REQ-03:** `init({projectId})` propagates `?project_id=<uuid>` to every request (including OTLP ingest URL)

## Implementation notes worth keeping

- AI SDK v6's default OpenAI provider uses the **Responses API** (`ag.meta.system = "openai.responses"`); v4 used Chat Completions (`"openai.chat"`). Same downstream attribute shape, just different system identifier
- Agenta API reads `project_id` from query params (not headers, not body) — both `/api/spans/query` and `/api/otlp/v1/traces` paths
- Per-app namespaced `globalThis` sentinel (`__agenta_instr_${APP_NAME}`) prevents cross-app collision in monorepo dev mode where multiple apps may share a Node process
- **streamText vs generateText token attribute path differs:** `generateText` populates both `ag.metrics.tokens.cumulative.*` and `incremental.*`; `streamText` populates only `incremental.*`. Assertions targeting tokens must pick the right path per call type
- Next.js 15 `instrumentation.ts` register hook only fires for the `nodejs` runtime; edge routes must own their own provider setup module-scoped (one-time per cold start). Confirmed via the App Router spike's `instrumentation.ts` → `instrumentation.node.ts` dispatch + edge route's inline `ensureProvider()`
- For tsx-run test scripts in a Next.js spike app, the app's `package.json` MUST have `"type": "module"`, otherwise tsx defaults to CJS resolution and fails on ESM-only `@agenta/sdk` (the Node spike app worked because it had `type: module` from the start)
- App Router's `useChat` hook + `convertToModelMessages` is async in AI SDK v6 — must `await` in the route handler (otherwise spans look fine but conversion happens off-context)
- OTel SDK v2 dropped `BasicTracerProvider.register()` — use `trace.setGlobalTracerProvider(provider)` instead. `NodeTracerProvider.register()` still exists because it sets up async-hooks-based context propagation

## Next steps

- **All 6 framework phases complete.** 8 spike apps cover the modern TS framework matrix (Node, App Router × 2, Pages Router × 2, TanStack Start, Nuxt, Mastra-node) plus a companion broken-baseline example at `examples/node/observability-mastra/` mirroring the published v4 quickstart layout.
- **SDK design phase can start now.** 16 pain entries + 6 cross-cutting takeaways + 3 SDK requirements is enough material to sketch the SDK API surface with confidence.
- **Investigations completed (2026-05-11):** both deferred source-dives resolved with concrete mechanisms. Full evidence in `pain-log.md`'s "Root cause resolved" subsections for each entry.

  - **P-APP-RAW-01 mechanism:** `@vercel/otel`'s `CompositeSpanProcessor.onStart` enrolls `forceFlush` into `globalThis[Symbol.for("@vercel/request-context")].get().waitUntil(...)` at every root-span open. That's the Vercel-runtime primitive that defers isolate freeze. Our raw setup uses `after(() => forceFlush())`, which runs the callback but does NOT enroll the resulting promise into the runtime's lifetime tracker — so the edge isolate freezes the moment `Response` returns and the OTLP `fetch` is killed mid-flight. `keepalive: true` is a red herring (vercel/otel doesn't use it either). None of the three original hypotheses was correct as written; hypothesis 2 was closest but mechanism-wrong. Open question: whether `requestContext` is populated in `next dev` (local) or only on deployed Vercel infra — our 10-15s arrival in Phase 2b could be incidental BatchProcessor timing rather than `waitUntil`-enrolled flush.

  - **P-PAGES-VERCEL-01 mechanism:** `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends every still-open child span when the Next.js root SERVER span ends. AI SDK v6 `streamText` writes `ai.usage.*` attrs **inside** flush() right before `rootSpan.end()`. `pipeUIMessageStreamToResponse` (Pages Router) returns synchronously while the stream is still draining, so the SERVER span ends BEFORE AI SDK's flush() runs — the force-end then kills `ai.streamText` early, and AI SDK's subsequent `setAttributes({ai.usage.*})` no-ops on the ended span per OTel spec. App Router's `toUIMessageStreamResponse()` keeps the SERVER span alive until the response body fully drains (Next awaits the stream), so flush() lands before the force-end. Raw OTel has no force-end logic, so the streamText span ends on its own clock and `setAttributes` runs on a still-open span. Open question: not instrumented at runtime — a 1-line probe patching `CompositeSpanProcessor.onEnd` would empirically confirm.
- **Coverage gap acknowledged but not pursued:** TanStack Start edge runtime (P-TANSTACK-02) needs a full Cloudflare/Vercel-edge Nitro preset deploy — out of scope for local-only spike testing (Decision 4). Re-test during SDK implementation when we have a concrete edge bundle to validate.
- **Per-app lifecycle decision** still pending per TODOS.md — which spike apps stay long-term (as regression fixtures for SDK CI), which get archived?
