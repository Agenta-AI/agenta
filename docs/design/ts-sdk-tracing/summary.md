# `ts-sdk-tracing` Spike — Executive Summary

**Living document.** Updated as each spike app lands. See [pain-log.md](./pain-log.md) for the structured friction entries and [status.md](./status.md) for progress + locked-in SDK requirements.

**Goal:** measure real friction wiring AI SDK v6 + raw OpenTelemetry + Agenta across the runtime/framework patterns most TS users will hit, before we design `ts-sdk-tracing`.

**Current status:** Phase 1 (Node) + Phase 2a/2b (App Router raw + vercel-otel) + Phase 3a (Pages Router raw) complete. **7 ecosystem pain entries** captured, 4 silent-failure-shaped. The Phase 2 A/B test isolated the dominant pattern: **`BatchSpanProcessor` + AI SDK v6 `streamText` is the universal flush failure**, regardless of whether you wire raw OTel or `@vercel/otel`. Edge runtime: raw OTel emits zero spans ever (P-APP-RAW-01); `@vercel/otel` emits spans with ~10-15s delay (P-APP-VERCEL-02); Pages Router raw OTel can't even BUILD an edge route (P-PAGES-RAW-01). 3 self-inflicted SDK gaps separately tracked in [status.md](./status.md) as locked-in requirements.

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

### Canonical assertions (each spike app's `pnpm test` runs all four)
1. **Cold-start trace completeness** — fresh process / fresh request produces a complete trace with model + tokens + metadata
2. **Mid-stream client-abort flush** — streamed call aborted 500ms in still produces a queryable parent span within 5s
3. **Metadata round-trip** — `experimental_telemetry.metadata.userId/sessionId` lands as `ag.user.id` / `ag.session.id` in Agenta
4. **Instrumentation runs before first handler** — sentinels prove `instrumentation.ts` register hook fired before any AI handler ran

## What worked

- 11/12 nodejs-runtime canonical assertions GREEN across the three v6 apps (Phase 1 Node + Phase 2a App Router raw + Phase 2b App Router vercel-otel)
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
| **P-APP-RAW-01** (silent) | Edge runtime route emits ZERO spans even with manual fetch-based exporter, `SimpleSpanProcessor`, `waitUntil(forceFlush())` | Phase 2b A/B isolated this to the manual setup itself, not the runtime/SDK/Agenta combination — `@vercel/otel` works on the same edge route. Most likely culprit: `SimpleSpanProcessor` + `keepAlive` fetch + edge function freeze ordering | SDK MUST not require users to hand-wire edge-runtime tracing. Either ship an edge helper or make `@vercel/otel` the documented path (and inherit its delays as in P-APP-VERCEL-02) |
| **P-APP-VERCEL-01** (silent) | `@vercel/otel`'s default `BatchSpanProcessor` loses streamText spans on mid-stream client abort — same root cause as P-NODE-02, manifested through the wrapper | `@vercel/otel`'s opinionated wrapper picks `BatchSpanProcessor`. AI SDK v6 streamText's `endWhenDone: false` lifecycle interacts badly with batched flush across both raw and vercel-otel paths | Same as P-NODE-02: SDK MUST own the processor choice. Letting Vercel's wrapper pick the "production-grade" Batch silently breaks the dominant streaming use case |
| **P-APP-VERCEL-02** | `@vercel/otel` edge route emits spans, but with ~10-15s delay (BatchSpanProcessor batch interval) | BatchSpanProcessor's default 5s flush interval + edge function freeze creates a race; `@vercel/otel`'s `waitUntil`-style wiring rescues most spans but not within an interactive window | SDK's edge-runtime helper must flush within the response cycle (under 1s end-to-end), not on the batch tick |
| **P-PAGES-RAW-01** | Pages Router edge route fails at BUILD time on raw OTel exporter (App Router edge accepts the same import) | Pages Router's edge runtime applies stricter dynamic-code-eval static analysis than App Router's; `@opentelemetry/exporter-trace-otlp-http` contains code patterns Pages-edge rejects | SDK's edge bundle must be eval-free (or rely on `@vercel/otel`'s edge bundle which already passes the strict check). Pages Router users can't ship edge tracing on raw OTel today AT ALL — not even with the workarounds that App Router accepts |

Full entries with code samples, severity tags, and ideal-API sketches in [`pain-log.md`](./pain-log.md).

## Cross-cutting takeaways for `ts-sdk-tracing`

The A/B test between Phases 2a (raw OTel) and 2b (`@vercel/otel`) on the SAME app shape isolated the dominant patterns the SDK has to design around. None of the four pain entries is solved by simply picking the "right" wrapper; the SDK has to own the decisions:

1. **The SDK must own the span processor choice.** Both raw OTel + Batch (P-NODE-02) and `@vercel/otel`'s default Batch (P-APP-VERCEL-01) fail mid-stream-abort flush for `streamText`. Letting users pick a "production" processor silently breaks streaming traces — and streaming chat IS the dominant AI SDK use case. SDK ships either a streamText-aware Batch processor or forces Simple with documented latency tax.
2. **The SDK must own edge runtime instrumentation.** Raw OTel + edge (P-APP-RAW-01) emits zero spans ever; `@vercel/otel` + edge (P-APP-VERCEL-02) emits spans but with 10-15s delay. Neither is acceptable for an interactive app. SDK ships an edge helper that flushes within the response cycle (waitUntil-aware, sub-second end-to-end).
3. **Resource attributes need a designated path or first-class API.** `service.name` and other OTel Resource attrs are silently dropped by Agenta's adapter (P-NODE-01). Either backend adapter preserves them under a documented path OR SDK exposes typed service-tag helpers that map to whatever path Agenta does keep.
4. **Per-trace metadata propagation is users' implicit assumption.** AI SDK only attaches `metadata.userId` to parent spans, not children like `ai.toolCall` (P-NODE-03). SDK should either propagate metadata or expose a "find the full trace by metadata" helper that hides the parent-only-filtering reality.

These four are the design priorities. Phases 3 (Pages Router) and 4 (TanStack Start) will likely surface variations on the same themes rather than fundamentally new categories.

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

- **Phase 3a/3b** — Pages Router raw + vercel-otel variants. Lower priority than Phase 2 because Pages Router is legacy; the spike's value is mostly confirming the patterns hold (or differ) on the older API surface
- **Phase 4** — TanStack Start (highest unknown). Hour-budget capped per design doc. May surface new categories around Vite SSR + worker-style edge
- **SDK design has enough input to start a serious draft.** 6 pain entries + 4 cross-cutting takeaways + 3 SDK requirements is enough material to sketch the SDK API surface. Phases 3 and 4 tighten/extend rather than redirect
- **Investigation deferred:** root-cause why raw OTel + edge emits zero spans (P-APP-RAW-01) — likely worth a 1-2 hour source dive into how `@vercel/otel` wires its edge flush to inform the SDK's own edge helper design
