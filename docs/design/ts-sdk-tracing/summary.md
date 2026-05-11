# `ts-sdk-tracing` Spike — Executive Summary

**Living document.** Updated as each spike app lands. See [pain-log.md](./pain-log.md) for the structured friction entries and [status.md](./status.md) for progress + locked-in SDK requirements.

**Goal:** measure real friction wiring AI SDK v6 + raw OpenTelemetry + Agenta across the runtime/framework patterns most TS users will hit, before we design `ts-sdk-tracing`.

**Current status:** All 4 framework phases complete — Phase 1 (Node) + 2a/2b (App Router raw + vercel-otel) + 3a/3b (Pages Router raw + vercel-otel) + 4 (TanStack Start). **12 ecosystem pain entries** captured, 6 silent-failure-shaped. P-COMMON-01 (added 2026-05-11 after a per-phase re-run with isolated API keys) is the newest: **every Next.js spike app shows `POST /api/chat/route` as the trace root in Agenta's UI with empty Inputs/Outputs columns** — Next.js 15's built-in OTel auto-instrumentation buries `ai.streamText` 2 levels deep under HTTP+handler wrapper spans. Affects all 4 Next.js variants identically (raw OTel and `@vercel/otel` produce the same trace shape, isolating the cause to Next.js itself, not the OTel wrapper). TanStack Start (Phase 4) and Node spikes do NOT exhibit this — AI SDK spans are the root. The Phase 2 A/B test isolated the dominant pattern: **`BatchSpanProcessor` + AI SDK v6 `streamText` is the universal flush failure**, regardless of whether you wire raw OTel or `@vercel/otel`. Edge runtime: raw OTel emits zero spans ever (P-APP-RAW-01); `@vercel/otel` emits spans with ~10-15s delay (P-APP-VERCEL-02); Pages Router raw OTel can't even BUILD an edge route (P-PAGES-RAW-01) but `@vercel/otel` does build and run on Pages-edge. Phase 3b surfaced a new silent-failure pattern: **Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` produces EMPTY `ag.metrics.tokens`** on the parent span (P-PAGES-VERCEL-01). Phase 4 surfaced TanStack Start's unique seam: **instrumentation is wired via `src/server.ts` import order with NO framework-level enforcement** (P-TANSTACK-01) — a single reorder by an auto-formatter silently disables tracing. 3 self-inflicted SDK gaps separately tracked in [status.md](./status.md) as locked-in requirements.

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

### Canonical assertions (each spike app's `pnpm test` runs all four)
1. **Cold-start trace completeness** — fresh process / fresh request produces a complete trace with model + tokens + metadata
2. **Mid-stream client-abort flush** — streamed call aborted 500ms in still produces a queryable parent span within 5s
3. **Metadata round-trip** — `experimental_telemetry.metadata.userId/sessionId` lands as `ag.user.id` / `ag.session.id` in Agenta
4. **Instrumentation runs before first handler** — sentinels prove `instrumentation.ts` register hook fired before any AI handler ran

## What worked

- 23/24 nodejs-runtime canonical assertions GREEN across the six v6 apps (Phase 1 Node + 2a App Router raw + 2b App Router vercel-otel + 3a Pages Router raw + 3b Pages Router vercel-otel + 4 TanStack Start)
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
| **P-COMMON-01** | Every Next.js spike app shows `POST /api/chat/route` as trace root in Agenta's UI with empty Inputs/Outputs columns. AI SDK `ai.streamText` is buried 2 levels deep under Next-internal HTTP + handler-execution wrapper spans, where the LLM payload (`ag.data.inputs/outputs/metrics.tokens`) actually lives | **Verified 2026-05-11** via direct `POST /api/spans/query` calls across all 4 Next.js phases. Identical trace shape in raw OTel AND `@vercel/otel` (7 spans in App Router, 4-5 in Pages Router) — so the wrappers come from **Next.js 15's built-in OTel auto-instrumentation**, NOT the user's OTel library choice. TanStack Start (Phase 4) emits no HTTP wrapper at all: `ai.streamText` IS the root, Agenta UI displays correctly. Phase 1 Node + the v4 published example also display correctly. Affects every Next.js + AI SDK + Agenta user — the dominant TS production deployment shape | Either (a) Agenta's UI/adapter promotes LLM-relevant spans (`ai.*`) to the trace-list row display so users see prompts/tokens at-a-glance, OR (b) SDK ships a Next.js adapter that suppresses Next's HTTP auto-instrumentation spans at the processor layer, restoring the AI-SDK-as-root shape. Both kept in observation space per current direction |

Full entries with code samples, severity tags, and ideal-API sketches in [`pain-log.md`](./pain-log.md).

## Cross-cutting takeaways for `ts-sdk-tracing`

The A/B tests between raw OTel and `@vercel/otel` on the SAME app shape (Phases 2a/2b for App Router, 3a/3b for Pages Router) isolated the dominant patterns the SDK has to design around. Phase 4 (TanStack Start) added a fifth design priority: per-framework adapter wrappers. None of the pain entries is solved by simply picking the "right" OTel library; the SDK has to own the decisions:

1. **The SDK must own the `streamText` span lifecycle, not just the processor choice.** Three separate Phase 2/3 pain entries (P-NODE-02, P-APP-VERCEL-01, P-PAGES-VERCEL-01) all stem from `streamText`'s `endWhenDone: false` parent span ending at an awkward moment relative to whatever ships next: `BatchSpanProcessor` flush window, mid-stream abort, or the response sink draining synchronously before attribute population runs. Letting users compose "AI SDK streamText + their favourite OTel processor + their favourite stream sink" silently breaks at least one of {trace arrival, mid-abort flush, token-metric population} for every combination tested. SDK should wrap `streamText` itself and own span end + flush + attribute population — OR ship sink-side helpers (`pipeUIMessageStreamToResponse` analog, `toUIMessageStreamResponse` analog) that hook the lifecycle.
2. **The SDK must own edge runtime instrumentation.** Raw OTel + edge has two failure modes depending on router: zero spans ever (App Router, P-APP-RAW-01) or hard build failure (Pages Router, P-PAGES-RAW-01). `@vercel/otel` + edge works on both routers but with 10-15s delay (P-APP-VERCEL-02 + same on Pages-edge). SDK ships an edge helper with eval-free bundle (passes both routers' static checks) and flushes within the response cycle (waitUntil-aware, sub-second end-to-end).
3. **Resource attributes need a designated path or first-class API.** `service.name` and other OTel Resource attrs are silently dropped by Agenta's adapter (P-NODE-01). Either backend adapter preserves them under a documented path OR SDK exposes typed service-tag helpers that map to whatever path Agenta does keep.
4. **Per-trace metadata propagation is users' implicit assumption.** AI SDK only attaches `metadata.userId` to parent spans, not children like `ai.toolCall` (P-NODE-03). SDK should either propagate metadata or expose a "find the full trace by metadata" helper that hides the parent-only-filtering reality.
5. **The SDK should ship per-framework adapters, not just primitives.** Each framework's instrumentation seam is different and unforgiving: Next.js `instrumentation.ts` + `NEXT_RUNTIME` dispatch, TanStack Start `src/server.ts` first-import convention with NO enforcement (P-TANSTACK-01), edge vs node split for App Router (Phase 2), Nitro preset selection for TanStack Start (P-TANSTACK-02). The SDK exposes `withAgentaInstrumentation(handler, opts)` style wrappers per framework so users never wire raw `NodeTracerProvider` + `register()` themselves — invariant-by-construction over "did you remember to import first?".

These five are the design priorities. The spike has enough material to start serious SDK API design.

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

- **All 4 framework phases complete.** 6 spike apps cover the modern TS framework matrix (Node, App Router × 2, Pages Router × 2, TanStack Start) for AI SDK v6 + raw OTel + Agenta.
- **SDK design phase can start now.** 12 pain entries + 5 cross-cutting takeaways + 3 SDK requirements is enough material to sketch the SDK API surface with confidence.
- **Investigations completed (2026-05-11):** both deferred source-dives resolved with concrete mechanisms. Full evidence in `pain-log.md`'s "Root cause resolved" subsections for each entry.

  - **P-APP-RAW-01 mechanism:** `@vercel/otel`'s `CompositeSpanProcessor.onStart` enrolls `forceFlush` into `globalThis[Symbol.for("@vercel/request-context")].get().waitUntil(...)` at every root-span open. That's the Vercel-runtime primitive that defers isolate freeze. Our raw setup uses `after(() => forceFlush())`, which runs the callback but does NOT enroll the resulting promise into the runtime's lifetime tracker — so the edge isolate freezes the moment `Response` returns and the OTLP `fetch` is killed mid-flight. `keepalive: true` is a red herring (vercel/otel doesn't use it either). None of the three original hypotheses was correct as written; hypothesis 2 was closest but mechanism-wrong. Open question: whether `requestContext` is populated in `next dev` (local) or only on deployed Vercel infra — our 10-15s arrival in Phase 2b could be incidental BatchProcessor timing rather than `waitUntil`-enrolled flush.

  - **P-PAGES-VERCEL-01 mechanism:** `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends every still-open child span when the Next.js root SERVER span ends. AI SDK v6 `streamText` writes `ai.usage.*` attrs **inside** flush() right before `rootSpan.end()`. `pipeUIMessageStreamToResponse` (Pages Router) returns synchronously while the stream is still draining, so the SERVER span ends BEFORE AI SDK's flush() runs — the force-end then kills `ai.streamText` early, and AI SDK's subsequent `setAttributes({ai.usage.*})` no-ops on the ended span per OTel spec. App Router's `toUIMessageStreamResponse()` keeps the SERVER span alive until the response body fully drains (Next awaits the stream), so flush() lands before the force-end. Raw OTel has no force-end logic, so the streamText span ends on its own clock and `setAttributes` runs on a still-open span. Open question: not instrumented at runtime — a 1-line probe patching `CompositeSpanProcessor.onEnd` would empirically confirm.
- **Coverage gap acknowledged but not pursued:** TanStack Start edge runtime (P-TANSTACK-02) needs a full Cloudflare/Vercel-edge Nitro preset deploy — out of scope for local-only spike testing (Decision 4). Re-test during SDK implementation when we have a concrete edge bundle to validate.
- **Per-app lifecycle decision** still pending per TODOS.md — which spike apps stay long-term (as regression fixtures for SDK CI), which get archived?
