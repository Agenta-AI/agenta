# `ts-sdk-tracing` Spike — Executive Summary

**Living document.** Updated as each spike app lands. See [pain-log.md](./pain-log.md) for the structured friction entries and [status.md](./status.md) for progress + locked-in SDK requirements.

**Goal:** measure real friction wiring AI SDK v6 + raw OpenTelemetry + Agenta across the runtime/framework patterns most TS users will hit, before we design `ts-sdk-tracing`.

**Current status:** Phase 1 (Node + AI SDK v6 + raw OTel) complete — 4/4 canonical assertions green against live Agenta. **3 ecosystem pain entries** so far, 2 silent-failure-shaped (the class the SDK must hide). 3 separate self-inflicted SDK gaps captured as locked-in requirements in [status.md](./status.md), not as pain entries.

---

## What existed before this spike

- One published example: [`examples/node/observability-vercel-ai/`](../../../examples/node/observability-vercel-ai/)
- Stack: Node + AI SDK **v4** + raw OpenTelemetry SDK + `SimpleSpanProcessor`
- Scope: one `generateText` call, exports a single span to Agenta Cloud
- Status: still works end-to-end against latest Agenta backend (re-verified 2026-05-10 against `http://localhost`)

## What we tested in Phase 1

- New spike app: [`web/examples/node-vercel-ai-v6/`](../../../web/examples/node-vercel-ai-v6/)
- Stack: Node + AI SDK **v6** (current GA, `ai@6.0.177`) + raw OpenTelemetry SDK
- **No `ts-sdk-tracing` package** — that's what we're designing. The spike deliberately uses only what users have today: AI SDK's built-in `experimental_telemetry`, raw OTel `NodeTracerProvider`/`OTLPTraceExporter`/`SimpleSpanProcessor`, and Agenta's OTLP endpoint. Every pain entry is friction in this baseline that the future SDK should hide.
- Three demos: `generateText`, `streamText`, tool-call (generateText + zod tool)
- Verification harness only: [`@agenta/spike-verify`](../../../web/examples/.shared/agenta-verify/) uses the official `@agenta/sdk` to QUERY traces and assert they arrived — that's spike infrastructure, not part of the user's tracing path
- Connected to local Agenta at `http://localhost`, project `019e0c81-...`
- Auto-tested via `pnpm test` against four canonical assertions:
  1. **Cold-start trace completeness** — fresh process produces a complete generateText trace with model + tokens + metadata
  2. **Mid-stream client-abort flush** — `streamText` aborted 500ms in still produces a queryable parent span within 5s
  3. **Metadata round-trip** — `experimental_telemetry.metadata.userId/sessionId` lands as `ag.user.id` / `ag.session.id`
  4. **Instrumentation runs before first handler** — `globalThis` sentinel proves `--import` order is correct

## What worked

- All 4 assertions pass (`pnpm test` from the app directory, all green)
- `generateText` traces arrive with full attribute payload (`ag.{data,meta,metrics,type,user,session}`) under both v4 and v6
- Tool-call output captured under the parent span's `ag.data.outputs.toolCalls`
- Per-call metadata (`userId`, `sessionId`) round-trips correctly
- Instrumentation registers ~60–120ms before the first handler fires (verified via per-app namespaced sentinels)
- v4 published example still runs cleanly — confirms backend compatibility hasn't drifted

## What didn't, and why

| ID | Symptom | Root cause | Implication for `ts-sdk-tracing` |
|----|---------|-----------|----------------------------------|
| **P-NODE-01** (silent) | OTel `service.name` (and other Resource attrs) can't be queried in Agenta | Agenta's adapter pipeline drops Resource attributes — they aren't preserved under any queryable path on the span | SDK must expose service-tag helpers OR backend adapter must preserve these under a documented path |
| **P-NODE-02** (silent) | `streamText` spans never arrive when using `BatchSpanProcessor` + `forceFlush()` (the production-recommended setup) | AI SDK v6's `streamText` root span has `endWhenDone: false` — it ends asynchronously after stream completion, after the BatchProcessor's flush window has already passed at exit | SDK must ship a span processor that knows about streamText's lifecycle, OR ship a streamText wrapper that owns span end + flush itself. Current workaround (`SimpleSpanProcessor`) costs a synchronous HTTP round-trip per span — unacceptable for production chat |
| **P-NODE-03** | Per-call metadata (`userId`) doesn't appear on sibling child spans like `ai.toolCall` | AI SDK only attaches metadata to the parent span, not children of the same trace | SDK should propagate metadata to all spans of a trace OR provide a "find full trace by metadata" helper |

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

## Next steps

- **Phase 2** (Next.js App Router, both raw OTel and `@vercel/otel` variants) — highest-yield phase for new pain entries (Server Actions, edge runtime, streaming `useChat` flush, RSC propagation)
- **Address SDK-REQ-01/02/03** in `ts-sdk-tracing` itself — locked-in features, no design work needed
- **P-NODE-02 deserves design attention NOW** — the span-processor + streamText interaction needs an opinion before any framework spike adds more variables on top
