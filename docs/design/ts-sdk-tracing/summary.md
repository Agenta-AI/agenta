# `ts-sdk-tracing` Spike — Executive Summary

**Living document.** Updated as each spike app lands. See [pain-log.md](./pain-log.md) for the structured friction entries and [status.md](./status.md) for progress + locked-in SDK requirements.

**Goal:** measure real friction wiring AI SDK v6 + raw OpenTelemetry + Agenta across the runtime/framework patterns most TS users will hit, before we design `ts-sdk-tracing`.

**Current status:** Phase 1 (Node) + Phase 2a (Next.js App Router raw OTel) complete. 8/8 nodejs-runtime assertions green against live Agenta across both apps. **4 ecosystem pain entries** so far, 3 silent-failure-shaped (the class the SDK must hide). 3 separate self-inflicted SDK gaps captured as locked-in requirements in [status.md](./status.md), not as pain entries. Edge runtime path (`runtime = 'edge'` in App Router) **silently emits zero spans** despite documented setup — captured as P-APP-RAW-01 pending Phase 2b's `@vercel/otel` A/B comparison.

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

### Canonical assertions (each spike app's `pnpm test` runs all four)
1. **Cold-start trace completeness** — fresh process / fresh request produces a complete trace with model + tokens + metadata
2. **Mid-stream client-abort flush** — streamed call aborted 500ms in still produces a queryable parent span within 5s
3. **Metadata round-trip** — `experimental_telemetry.metadata.userId/sessionId` lands as `ag.user.id` / `ag.session.id` in Agenta
4. **Instrumentation runs before first handler** — sentinels prove `instrumentation.ts` register hook fired before any AI handler ran

## What worked

- 8/8 nodejs-runtime canonical assertions GREEN across both apps (Node Phase 1 + App Router Phase 2a)
- `generateText` traces arrive with full attribute payload (`ag.{data,meta,metrics,type,user,session}`) under v4, v6, and Next.js App Router
- `streamText` traces arrive (with `SimpleSpanProcessor` — see P-NODE-02) including from `useChat` consumers in App Router
- Tool-call output captured under the parent span's `ag.data.outputs.toolCalls`
- Per-call metadata (`userId`, `sessionId`) round-trips correctly across all three contexts (Node, Server Action, App Router HTTP route)
- Mid-stream client abort still flushes the parent `ai.streamText` span within ≤5s (Node and App Router both)
- Instrumentation registers before the first handler fires in both apps — verified via per-app namespaced sentinels (`globalThis[__agenta_instr_${APP_NAME}]`)
- v4 published example still runs cleanly — confirms backend compatibility hasn't drifted

## What didn't, and why

| ID | Symptom | Root cause | Implication for `ts-sdk-tracing` |
|----|---------|-----------|----------------------------------|
| **P-NODE-01** (silent) | OTel `service.name` (and other Resource attrs) can't be queried in Agenta | Agenta's adapter pipeline drops Resource attributes — they aren't preserved under any queryable path on the span | SDK must expose service-tag helpers OR backend adapter must preserve these under a documented path |
| **P-NODE-02** (silent) | `streamText` spans never arrive when using `BatchSpanProcessor` + `forceFlush()` (the production-recommended setup) | AI SDK v6's `streamText` root span has `endWhenDone: false` — it ends asynchronously after stream completion, after the BatchProcessor's flush window has already passed at exit | SDK must ship a span processor that knows about streamText's lifecycle, OR ship a streamText wrapper that owns span end + flush itself. Current workaround (`SimpleSpanProcessor`) costs a synchronous HTTP round-trip per span — unacceptable for production chat |
| **P-NODE-03** | Per-call metadata (`userId`) doesn't appear on sibling child spans like `ai.toolCall` | AI SDK only attaches metadata to the parent span, not children of the same trace | SDK should propagate metadata to all spans of a trace OR provide a "find full trace by metadata" helper |
| **P-APP-RAW-01** (silent) | Edge runtime route (`runtime = 'edge'` in App Router) emits ZERO spans even with the documented setup (fetch-based exporter, `SimpleSpanProcessor`, `waitUntil(forceFlush())`) | Unknown — Phase 2b's `@vercel/otel` A/B test will isolate whether this is a raw-OTel-on-edge issue, an Agenta backend issue, or an AI SDK edge integration issue | Edge runtime is what Vercel pushes users toward by default for AI routes. SDK MUST ship an edge-runtime instrumentation helper that just works — every Vercel user with `runtime = 'edge'` silently loses every trace today |

Full entries with code samples, severity tags, and ideal-API sketches in [`pain-log.md`](./pain-log.md).

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

- **Phase 2b** — `nextjs-app-router-vercel/` using `@vercel/otel`. Primary purpose: A/B test against Phase 2a to isolate the root cause of P-APP-RAW-01 (edge spans never arrive). If `@vercel/otel` works on edge, the SDK ts-sdk-tracing should likely wrap @vercel/otel rather than reimplement edge handling
- **Phase 3a/3b** — Pages Router raw + vercel-otel variants. Lower priority than 2b
- **Phase 4** — TanStack Start (highest unknown). Hour-budget capped per design doc
- **SDK design now has enough input to start a serious draft** — 4 pain entries + 3 SDK requirements is enough material to sketch the SDK API surface even before phases 2b/3/4 land. The remaining phases tighten/extend rather than redirect
