# Agenta TypeScript SDK v1 — Proposal

## TL;DR

We ship two new published packages plus a backend workstream.

- **`@agenta/sdk-tracing`** — a thin TypeScript package centered on edge-runtime correctness and one-line setup. Wraps no AI SDK calls; doesn't grow with Vercel AI SDK churn.
- **`@agenta/sdk-mastra`** — a separate adapter for Mastra agents, since Mastra doesn't emit OpenTelemetry.
- **Backend track** — five trace-pipeline improvements that benefit every Agenta user (Python, raw OTel, JS) regardless of which SDK they install.

The goal: replace ~80 lines of OpenTelemetry boilerplate with one `init()` call, close the silent-failure modes that production traffic hits today, and fix the shared root-span selector so the LLM call (not the framework HTTP wrapper) is what the trace-list UI, online evaluations, annotations, and invocations all point at.

**Reading order.** §1 catalogues the spike experiments app by app. §2 distills six user-visible problems. §3 sets goals. §4 covers the competition. §5 is the proposal. §6 is the practical surface. §7-§10 are review material.

---

## 1. Spike experiments — what we ran and what each example app proved

The proposal below is grounded in 12 example apps + cross-cutting experiments touched during the spike. This section catalogues each one in the format we use for communicating results. Three points per app: **what was implemented**, **how it differs from the base**, **what happened vs. what was expected**.

Readers who trust the synthesis can skip to §2 (the six problems distilled out of this work). Readers who want to verify a specific claim from §2 onwards can scroll directly to the relevant app here.

### 1.1 Base: `examples/node/observability-vercel-ai/` (published v4 quickstart)

**What was implemented.** Node + AI SDK v4 (`ai@^4.3.16`) + `@ai-sdk/openai@^1.3.22` + raw OpenTelemetry SDK + `SimpleSpanProcessor`. One `generateText` call. Exports a single span to Agenta via OTLP.

**Status: this IS the base.** Everything else in the spike compares against this. Re-verified working end-to-end against the latest Agenta backend on 2026-05-10 — backend compatibility has not drifted.

**Lessons.** Establishes the baseline mental model: ~60-80 lines of `instrumentation.ts` boilerplate, one `generateText` emits one span with `ag.data.*` populated, the resulting trace appears in Agenta. Sets the floor that everything else must improve on.

### 1.2 Base: `examples/node/observability-opentelemetry/` (OpenAI direct + OpenInference)

**What was implemented.** Node + `openai@^4.104.0` SDK direct + `@arizeai/openinference-instrumentation-openai@^2.3.1` + raw OpenTelemetry SDK + `SimpleSpanProcessor`. No Vercel AI SDK — exercises the "call OpenAI directly without an SDK wrapper" path with OpenInference's auto-instrumentation populating `gen_ai.*` semantic attributes.

**How it differs from the Vercel AI SDK base.** No `ai` package. OpenInference auto-instrumentation populates OTel-standard `gen_ai.*` attributes instead of AI SDK's `ai.*` namespace.

**Result vs expectation.** Works end-to-end. Confirms Agenta's OTLP adapter handles both `ai.*` (Vercel naming) and `gen_ai.*` (OTel-standard) attribute namespaces. No new issues from this app.

### 1.3 Phase 1: `web/examples/node-vercel-ai-v6/`

**What was implemented.** Same shape as the Vercel AI SDK base, but on AI SDK v6 (`ai@^6.0.177`). Three demos: `generateText`, `streamText`, and tool-call (`generateText` + zod tool). Per-app namespaced `globalThis` sentinels for assertion-4 (instrumentation-runs-before-first-handler). Optional tri-export to Braintrust + Langfuse via additional `SimpleSpanProcessor` instances.

**How it differs from the base.** AI SDK v4 → v6 (major version). Adds `streamText` and tool-call scenarios. Adds the assertion harness. Adds tri-export instrumentation. Instrumentation file: 141 lines (vs ~60-80 minimal).

**Result vs expectation.** 4/4 canonical assertions green. Three issues surfaced (introduced here with descriptive names used throughout the rest of the doc):

- **The batch-processor stream drop** (silent failure): `BatchSpanProcessor` + AI SDK v6 `streamText` loses spans. streamText's `endWhenDone: false` parent ends asynchronously, *after* the batch flush window has already closed. Switching to `SimpleSpanProcessor` resolves it — this is now the canonical setup Agenta docs prescribe.
- **Resource attributes silently dropped** (silent failure): OTel `Resource` attributes (`service.name`, etc.) get stripped by Agenta's OTLP adapter pipeline. The backend track (§5.1) preserves them.
- **Trace metadata stays on the parent span**: per-call `metadata.userId` lands only on the parent `ai.streamText`, not on `ai.toolCall` children. "Show me all spans for user X" misses every tool call. The backend track cascade (§5.1) propagates it.

### 1.4 Phase 2a: `web/examples/nextjs-app-router-raw/`

**What was implemented.** Next.js 16.2.6 App Router + AI SDK v6 + raw OTel + `SimpleSpanProcessor`. Instrumentation via Next.js's `instrumentation.ts` → `instrumentation.node.ts` register hook. Routes: `/api/chat` streaming (useChat + `toUIMessageStreamResponse`), `/api/edge-chat` (edge runtime probe), Server Action at `app/actions/generate.ts`, `/api/sentinels`.

**How it differs from the base.** Next.js 16.2.6 instead of bare Node. Streaming via `useChat`. Edge runtime probe. Server Action probe. Instrumentation: 24 lines (router shim) + 123 lines (`.node.ts`).

**Result vs expectation.** 4/4 nodejs assertions green; **edge-runtime probe failed.** Two issues:

- **Edge runtime drops all spans** (silent failure, new): the edge route emits zero spans even with the documented setup. Vercel edge isolates freeze the moment `Response` returns; raw OTel's OTLP `fetch` is killed mid-flight because the flush promise isn't enrolled into Vercel's `waitUntil` runtime tracker. Workaround: switch to `@vercel/otel` (Phase 2b) or hand-write a custom `waitUntil` enrollment.
- **HTTP wrapper masquerades as the trace root** (UX, new — affects all four Next.js variants): `ai.streamText` is buried two levels deep under Next.js's built-in OTel auto-instrumentation wrapper spans — `POST /api/chat/route` (HTTP) wraps `AppRouteRouteHandlers.runHandler` (handler exec) which wraps `ai.streamText` (the actual LLM call). The LLM payload (`ag.data.inputs`, `ag.data.outputs`, token usage) lives on the deeply nested `ai.streamText` span, but the trace-list UI surfaces the empty top-level `POST /api/chat/route` wrapper. Identical trace tree on raw OTel and `@vercel/otel` — confirming the cause is Next.js itself, not the OTel wrapper. No knob suppresses it (`NEXT_OTEL_VERBOSE` and `NEXT_OTEL_FETCH_DISABLED` don't help). Detailed in problem 2.4 — and as §2.4 shows, the impact reaches beyond the UI.

### 1.5 Phase 2b: `web/examples/nextjs-app-router-vercel/`

**What was implemented.** Same App Router shape as Phase 2a, but `registerOTel()` from `@vercel/otel` replaces the raw `NodeTracerProvider` boilerplate. Same Next.js 16.2.6 version. A/B counterpart to 2a.

**How it differs from Phase 2a.** Instrumentation setup collapses to 110 lines. `@vercel/otel` claims to handle Node + edge + flush hooks automatically.

**Result vs expectation.** 3/4 nodejs assertions green; the edge route arrives but with significant delay. Three issues:

- **The batch-processor stream drop, again**: `@vercel/otel` defaults to `BatchSpanProcessor`, which has the same flush-window race as the Node baseline — mid-stream abort still loses streamText spans. Same fix as in Phase 1: explicitly pass `spanProcessors: [new SimpleSpanProcessor(...)]` to override `@vercel/otel`'s default. This is what Agenta's docs prescribe.
- **Edge traces arrive 10-15 seconds late** (new): the edge route does eventually deliver spans (unlike Phase 2a's silent zero), but with ~10-15s delay due to `BatchSpanProcessor`'s `scheduledDelay`. Useless for interactive debugging.
- **HTTP wrapper masquerades as the trace root**: same wrapper-span hierarchy as Phase 2a. `ai.streamText` buried two levels under `POST /api/chat/route` + `AppRouteRouteHandlers.runHandler`. **Identical trace tree to Phase 2a** — the A/B test isolates the cause to Next.js's built-in OTel auto-instrumentation, not the OTel wrapper choice.

### 1.6 Phase 3a: `web/examples/nextjs-pages-router-raw/`

**What was implemented.** Next.js 16.2.6 Pages Router + AI SDK v6 + raw OTel + `SimpleSpanProcessor`. Routes: `pages/api/chat.ts` streaming via `pipeUIMessageStreamToResponse` (the Pages-Router analog to `toUIMessageStreamResponse`), `pages/api/sentinels.ts`, `pages/api/edge-chat.ts` (edge runtime probe with inline raw-OTel setup).

**How it differs from Phase 2a.** Pages Router instead of App Router. `pipeUIMessageStreamToResponse` instead of `toUIMessageStreamResponse`. No Server Action (Pages Router doesn't support them).

**Result vs expectation.** 4/4 nodejs assertions green. The edge route builds but emits 0 spans at runtime. Two issues:

- **Edge runtime drops all spans**: the edge route runs successfully (`200 OK` with the LLM response) but emits zero spans. Same Vercel edge isolate-freeze cause as Phase 2a — the OTLP `fetch` is killed before the flush promise resolves.
- **HTTP wrapper masquerades as the trace root**: same wrapper-span hierarchy as the App Router phases — `ai.streamText` buried under `POST /api/chat` HTTP wrapper. Pages Router emits a slightly different wrapper-span set than App Router (no `AppRouteRouteHandlers.runHandler` since Pages doesn't have that concept), but the span surfaced as the trace root is still the empty HTTP wrapper, not the LLM call. 5-span trace with `POST /api/chat` as first span.

### 1.7 Phase 3b: `web/examples/nextjs-pages-router-vercel/`

**What was implemented.** Same Pages Router shape as Phase 3a, but with `@vercel/otel`. Same Next.js 16.2.6 version. Includes `pages/api/edge-chat.ts` for the edge runtime probe.

**How it differs from Phase 3a.** `@vercel/otel` ships an edge-safe bundle and registers Node + edge tracing through one entry point.

**Result vs expectation.** 3/4 assertions pass; assertion-1 fails on the Pages Router token-drop (below). Edge route compiles and runs but emits 0 spans in dev mode at 20s+ wait. Three issues:

- **Pages Router + `@vercel/otel` drops all token attributes** (silent failure, new — this is the spike's most consequential discovery): the 4-way combination (Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` + `streamText`) drops token attributes entirely. Direct Agenta-side trace queries show that the parent `ai.streamText`, the `.doStream` child, AND the underlying `fetch POST https://api.openai.com/v1/responses` grandchild all have empty `ag.metrics.tokens.*`. There is no surviving token data anywhere in the trace. Likely mechanism: `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends not just the parent but also `.doStream` (which is still open when `pipeUIMessageStreamToResponse` returns synchronously while the OpenAI Responses API stream is still draining), so AI SDK's `setAttributes({ai.usage.*})` lands on already-ended spans and is dropped. Backend rollup cannot recover what no span carries; the fix has to own the token writes on the JS side — `agentaPipeUIMessageStreamToResponse` in §5.2. See §7.1 for the full code trace.
- **Edge traces arrive 10-15 seconds late** (dev mode showed worse): edge route returns successfully, but 0 spans visible in Agenta even at 20s after request. May be a dev-mode-only artifact — Vercel's `waitUntil` infrastructure is fully active only in production. `next build && next start` (or a real Vercel deploy) verification is a v1-kickoff follow-up.
- **HTTP wrapper masquerades as the trace root**: same wrapper-span hierarchy as Phase 3a. 5-span trace with `POST /api/chat` as first span. All four Next.js variants show the same trace tree shape.

### 1.8 Phase 4: `web/examples/react-tanstack-start/`

**What was implemented.** TanStack Start 1.167 (RC) + Vite 8 + AI SDK v6 + raw OTel + `SimpleSpanProcessor`. Instrumentation fires by virtue of being the FIRST import in `src/server.ts`. Routes: `src/routes/api/chat.ts` streaming, `src/routes/api/sentinels.ts`.

**How it differs from the base.** TanStack Start (Vite + Nitro) instead of bare Node or Next.js. No `instrumentation.ts` auto-discovery — relies on import-order convention. No per-route edge runtime opt-in — runtime selected globally at the Nitro preset level.

**Result vs expectation.** 4/4 nodejs assertions green. Three TanStack-specific issues:

- **Instrumentation depends on import order** (silent failure): the instrumentation seam is unenforced import order in `src/server.ts`. A single auto-formatter reorder or refactor silently disables tracing with no warning. A framework adapter (deferred to v2 per §6.4) would fix this invariant-by-construction.
- **Runtime is selected globally, not per-route**: testing edge tracing requires a full Nitro preset swap. Architectural constraint of TanStack; cannot be addressed from any layer.
- **`createStartHandler()` return shape doesn't match the docs**: docs show `export default createStartHandler(...)` but TanStack's dev plugin needs `{fetch}` wrapping. ~30 min debug cost during scaffolding.

### 1.9 Phase 5: `web/examples/nuxt-raw/`

**What was implemented.** Nuxt 4.4.5 + Nitro 2.13.4 + H3 2.0.1-rc.20 + AI SDK v6 + raw OTel + `SimpleSpanProcessor`. Instrumentation wired via Nitro plugin (`server/plugins/otel.ts`). Routes: `server/api/chat.post.ts` streaming, `server/api/sentinels.get.ts`.

**How it differs from the base.** Nuxt 4 (Vue + Nitro). Instrumentation via Nitro plugin — no Next-style `instrumentation.ts` register hook.

**Result vs expectation.** 4/4 assertions pass, but assertion-2 needed a 30s flush window (not 5s). One issue:

- **Client abort doesn't reach `streamText`**: H3 v2 RC's `event.req.signal` is undefined at runtime despite being typed. Mid-stream client abort never propagates to `streamText` — the model keeps generating server-side after the user disconnects, and the parent span lands 7-15s late. Cost implication: Nuxt users pay for tokens generated after the user has already closed the tab.

**Notable positive finding.** `ai.streamText` is the trace root for this app — the HTTP-wrapper-masquerades-as-root issue (problem 2.4) doesn't apply here because bare Nitro doesn't emit the HTTP server wrapper spans Next.js does.

### 1.10 Phase 6: `web/examples/mastra-node/`

**What was implemented.** Node + Mastra (`@mastra/core@1.32.1` + `@mastra/observability@1.11.1`) + AI SDK v6 + raw OTel + `SimpleSpanProcessor` + a custom `AgentaMastraExporter` (190 lines including doc block; ~120 lines of executable code). The exporter subscribes to Mastra's `ObservabilityBus` and re-emits each `TracingEvent` as an OTel span through the globally-registered tracer.

**How it differs from the base.** Uses Mastra (an agent framework) instead of calling AI SDK directly. Mastra is not OTel — it emits to its own internal event bus.

**Result vs expectation.** 4/4 assertions pass with the custom exporter. Without it (Paths A and B-cheap from the spike's investigation), all paths produce zero traces. Three Mastra-specific issues:

- **Mastra's default tracer is a no-op** (silent failure): Mastra's vendored AI SDK v1 returns a `noopTracer` by default. The user-facing Mastra API doesn't expose `experimental_telemetry.isEnabled` to flip it, so a globally-registered OTel provider sees nothing.
- **Installing `@mastra/observability` doesn't help**: Mastra has a parallel, non-OTel `ObservabilityBus`. Only Mastra-flavored exporters (`Console`, `Cloud`, `Default`, `Test`) ship; no OTLP exporter exists.
- **Per-call metadata uses a different API**: `tracingOptions.metadata` instead of AI SDK's `experimental_telemetry.metadata`. Different shape, same conceptual feature.

The 4-level Mastra trace tree (`agent run` → `llm` → `step` → `chunk`) lands in Agenta with all attributes populated, via the exporter. This exporter IS the v0 wedge for `@agenta/sdk-mastra` (§5.3).

### 1.11 Companion broken-baseline: `examples/node/observability-mastra/`

**What was implemented.** Same wiring shape as the published Vercel AI SDK quickstart (`examples/node/observability-vercel-ai/`), but with Mastra agent calls in place of direct AI SDK calls. Otherwise uses the same global OTel setup pattern users would naturally follow.

**How it differs from the Vercel AI SDK base.** Direct AI SDK calls replaced with `mastra.getAgent("x").stream()`.

**Result vs expectation.** Emits zero traces. Kept broken on purpose to document the failure mode users would hit if they tried the AI SDK quickstart pattern with Mastra. README explains why and points to Phase 6's `AgentaMastraExporter` as the fix. This app is the "what you'll see if you don't read the docs" reference.

### 1.12 SDK-native comparison: `web/examples/sdk-native-spike/`

**What was implemented.** Three scripts (`agenta-raw-otel.ts`, `langfuse-sdk.ts`, `braintrust-sdk.ts`), each making the same `streamText("Reply with: ok.")` call against `gpt-4o-mini` but using a different observability path. Not a long-running spike app — comparison scripts.

**How it differs from the other spike apps.** Doesn't ship a server. Doesn't use `@agenta/spike-verify`. Measures ergonomic surface area per SDK shape (one-line setup, custom-span shape, user/session typed, cost computed, trace URL helper, auto-extra metrics).

**Result vs expectation.** Quantified the gap claimed in [`sdk-comparison.md` § Ergonomic-by-ergonomic, six implementations side-by-side](../ts-sdk-tracing/sdk-comparison.md#ergonomic-by-ergonomic-six-implementations-side-by-side):

- **Setup statements:** Agenta raw OTel = 9; Langfuse SDK = 1; Braintrust SDK = 2.
- **Trace URL helper:** Langfuse + Braintrust both ship one; Agenta raw OTel = hand-roll.
- **User/session typed at SDK boundary:** only Langfuse.
- **Cost computed at ingest:** only Langfuse (via ~700-model registry).
- **Auto extra metrics** (e.g. `time_to_first_token` without asking): only Braintrust.

This is the empirical foundation for §4's competitive comparison and for the v1 wedge framing in §5.

### 1.13 Cross-cutting: Phase 7 (Braintrust dual-export) + Phase 8 (Langfuse tri-export)

**What was implemented.** Not new apps — modifications applied to 8 of the 9 spike apps to add Braintrust (Phase 7) and then Langfuse (Phase 8) as additional OTLP destinations alongside Agenta. Each app's instrumentation file gained one (Phase 7) or two (Phase 8) additional `SimpleSpanProcessor` instances pointed at the alternative backends. Identical spans fan out to all three destinations in parallel.

**How they differ from the base apps.** Same source spans, three destinations. Tests whether "use one OTel pipeline, fan out to N backends" is a viable customer pattern.

**Result vs expectation.** 32/32 assertions pass across the matrix once a methodology correction was applied (use `SimpleSpanProcessor` per Agenta docs, not `BatchSpanProcessor` per `@vercel/otel` defaults). Two third-party issues surfaced via cross-destination REST verification:

- **Braintrust drops spans on data-plane mismatch** (silent failure): Braintrust runs separate data planes (US `api.braintrust.dev`, EU `api-eu.braintrust.dev`); their SDK + docs default to US. If your org is on the EU plane, OTLP requests to US silently auto-create the project but the actual span data is rejected/unrouted. The OTel exporter sees HTTP 200, logs nothing, swallows the spans. Cost the spike ~3 hours of empirical debugging before catching it. Generalizable lesson: OTel exporters silently swallow HTTP errors; multi-backend OTel pipelines need explicit REST-API delivery verification, not just span-export-success.
- **Langfuse's trace-list filter is JS-SDK-only** (correction of an earlier claim): earlier drafts of `competitive-analysis.md` claimed Langfuse drops non-LLM scope spans server-side. Wrong. Raw OTLP to Langfuse stores everything (same wrapper-span clutter as Agenta). The filter that produces clean trace lists lives only inside `@langfuse/otel`'s `LangfuseSpanProcessor` — JS-SDK-only. Strengthens the argument for Agenta's §5.1 backend-side filter (cleaner than asking users to install a JS SDK).

**Strategic implication.** The tri-export pattern works: one OTel pipeline can fan out to N backends in ~10-12 lines per destination. §4.3 builds on this — "wraps OTel ergonomically" is something a docs page already delivers, so it does not by itself justify a JS package.

### 1.14 Cross-reference to the spike's pain log

The issues above are each tracked in the spike's [`pain-log.md`](../ts-sdk-tracing/pain-log.md) under per-framework codes. For anyone going back to the raw spike notes, the mapping is:

| Issue name used in this doc | Pain-log code |
|---|---|
| Batch processor stream drop | P-NODE-02 + P-APP-VERCEL-01 (same mechanism, two contexts) |
| Resource attributes silently dropped | P-NODE-01 |
| Trace metadata stays on the parent span | P-NODE-03 |
| Edge runtime drops all spans | P-APP-RAW-01 (App Router + Pages Router both hit it) |
| Edge traces arrive 10-15 seconds late | P-APP-VERCEL-02 |
| Pages Router edge build rejects raw OTel (resolved on Next.js 16) | P-PAGES-RAW-01 |
| Pages Router + `@vercel/otel` drops all token attributes | P-PAGES-VERCEL-01 |
| HTTP wrapper masquerades as the trace root | P-COMMON-01 |
| Turbopack requires explicit `@opentelemetry/sdk-trace-base` dep | P-COMMON-02 |
| TanStack instrumentation depends on import order | P-TANSTACK-01 |
| TanStack runtime is global, not per-route | P-TANSTACK-02 |
| TanStack `createStartHandler()` shape mismatch | P-TANSTACK-03 |
| Nuxt client abort doesn't reach `streamText` | P-NUXT-01 |
| Mastra's default tracer is a no-op | P-MASTRA-01 |
| Installing `@mastra/observability` doesn't help | P-MASTRA-02 |
| Mastra metadata uses a different API | P-MASTRA-03 |
| Braintrust drops spans on data-plane mismatch | P-BRAINTRUST-01 |
| Langfuse's trace-list filter is JS-SDK-only | P-LANGFUSE-01 |

The rest of this document uses the descriptive names only.

---

## 2. The problems we are solving

The §1 spike experiments distilled into six concrete things that break for TypeScript developers sending AI traces to Agenta today.

### 2.1 Streamed AI calls silently lose traces

A developer calls `streamText()` from Vercel AI SDK, the stream completes, no trace shows up in Agenta. No error. The default OpenTelemetry batched exporter (which Vercel's recommended `@vercel/otel` package picks automatically) flushes on a 5-second timer, but `streamText`'s root span ends asynchronously *after* the stream completes — often after the flush window has closed and after the response has been returned to the user.

**Who hits this:** anyone following Vercel AI SDK's or `@vercel/otel`'s own setup docs without also finding Agenta's recommendation to use the synchronous "Simple" exporter instead.

**Severity:** silent. Tests on `generateText` (synchronous) pass; production `streamText` calls disappear.

**Where this was observed:** §1.3 Phase 1 (Node baseline) and §1.5 Phase 2b (Next.js App Router with `@vercel/otel`).

### 2.2 Edge runtime traces never arrive — or arrive 10+ seconds late

Vercel Edge / Cloudflare Workers freeze the JavaScript isolate the moment `Response` is returned. The OpenTelemetry HTTP exporter's `fetch()` is killed mid-flight unless its eventual flush promise is registered into the runtime's "keep running until this settles" tracker (`waitUntil` on Vercel). Raw OpenTelemetry doesn't register. `@vercel/otel` does, but its default batched exporter still delays flush several seconds.

Three concrete failure modes:

1. App Router edge + raw OpenTelemetry → zero traces ever
2. Pages Router edge + raw OpenTelemetry → hard build failure (the exporter contains code patterns Pages-edge rejects)
3. Either router + `@vercel/otel` → traces arrive 10-15 seconds after the request returned (useless for debugging)

**Where this was observed:** §1.4 (App Router raw OTel, zero spans), §1.5 (App Router + `@vercel/otel`, 10-15s delay), §1.6 (Pages Router raw OTel, zero spans).

### 2.3 Token usage drops on Pages Router + `pipeUIMessageStreamToResponse`

A specific four-way combination — Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` + `streamText` — produces traces with empty token-usage fields. The mechanism is a race: `@vercel/otel`'s composite span processor force-ends the streaming span when the response returns, before Vercel AI SDK has finished writing the token attributes.

This bug fires regardless of which OpenTelemetry processor you use. The fix for problem 2.1 (switch to Simple) does not help here.

**Severity:** silent. Trace appears in Agenta UI; the cost/usage metadata is just incomplete.

**Where this was observed:** §1.7 Phase 3b (Pages Router with `@vercel/otel`).

### 2.4 The trace UI — and online evaluations, annotations, invocations — all pick the wrong "root span"

Next.js's built-in OpenTelemetry auto-instrumentation emits HTTP and handler wrapper spans for every API request. Agenta's backend has a shared helper `extract_root_span()` in [`api/oss/src/core/tracing/utils/traces.py`](../../../api/oss/src/core/tracing/utils/traces.py) that just picks `spans[0]` — the first span in the trace — and treats it as canonical. For Next.js-routed AI calls, that first span is the empty `POST /api/chat/route` HTTP wrapper, not the `ai.streamText` LLM call (which is buried two levels deeper).

The impact is broader than the UI. A grep across the backend finds the same naive "first span" pattern in five places, feeding four different consumers:

| Consumer | What breaks |
|---|---|
| **Trace-list UI** | Row labeled "POST /api/chat/route" with empty inputs/outputs |
| **Online evaluations** ([`live.py:515`](../../../api/oss/src/core/evaluations/tasks/live.py:515)) | Evaluator workflow receives `span_id` pointing at the wrapper. Fetches empty `ag.data.inputs` / `ag.data.outputs`. **Silently scores garbage or errors with "no inputs to evaluate".** |
| **Annotations** ([`annotations/service.py`](../../../api/oss/src/core/annotations/service.py)) | New annotations attach to the wrapper span instead of the LLM call |
| **Invocations** ([`invocations/service.py`](../../../api/oss/src/core/invocations/service.py)) | Workflow invocation summary shows wrapper span data |
| **Legacy evaluations** ([`legacy.py`](../../../api/oss/src/core/evaluations/tasks/legacy.py)) | Same as live evals, in the legacy code path |

**Where this was observed:** every Next.js-based spike app (§1.4 through §1.7) shows this in the trace-list UI. §1.9 Phase 5 (Nuxt) is the negative control — Nitro doesn't emit the HTTP wrapper, so Nuxt traces have `ai.streamText` as the root.

### 2.5 No first-class user / session tracking

Vercel AI SDK accepts arbitrary metadata via `experimental_telemetry.metadata.userId`. The metadata reaches Agenta — but only on the parent `ai.streamText` span, not on its child spans. A query like "show me all spans for user X" misses every tool call and sub-step.

**Where this was observed:** §1.3 Phase 1 (Node baseline + tool-call demo).

### 2.6 Setup itself is 100+ lines of OpenTelemetry boilerplate

The current canonical setup — copy-pasted from Agenta's own published example — is generic OpenTelemetry wiring: provider + exporter + processor + resource + headers + force-flush hook. The Agenta-specific portion is a handful of lines (OTLP URL, `ApiKey` header, `project_id`); the rest is OTel scaffolding that every JavaScript user has to write to talk to any OTLP backend. Bugs in any of those lines cause silent failures (problems 2.1, 2.2, and 2.3 all start here).

Measured against the spike apps in `web/examples/` (single-backend Agenta wiring, ignoring optional Braintrust/Langfuse tri-export blocks added during Phase 7/8):

| Spike app | Lines in instrumentation file(s) |
|---|---|
| Node + Vercel AI SDK v6 | 141 |
| Next.js App Router (raw OTel) | 123 + 24 router shim |
| Next.js App Router (`@vercel/otel`) | 110 |
| Next.js Pages Router (raw OTel) | 108 + 19 router shim |
| Next.js Pages Router (`@vercel/otel`) | 99 |
| React TanStack Start | 116 |
| Nuxt 4 (Nitro plugin) | 115 |
| Mastra (Node) | 70 (plus a 190-line `AgentaMastraExporter`) |

Stripping the tri-export wiring and sentinels added for spike-specific assertions, a minimal setup is closer to 50-70 lines per app — still substantially more than `ag.init()`. Of those 50-70 lines, ~5 are Agenta-specific (URL, auth, project ID); the rest is the same OTel boilerplate users would write to send traces anywhere.

The Python `agenta` SDK reduces all of this to one line: `ag.init()`. There is no equivalent for JavaScript today.

**Severity:** friction. Users pick Langfuse or Braintrust over Agenta because their setup is one or two lines, even when those competitors have worse trace correctness for the same wire data.

**Where this was observed:** every spike app in §1 — all 8 server-side apps need 70-141 lines of setup.

---

Beyond these six, **Mastra agents** need their own integration entirely. Mastra doesn't emit OpenTelemetry; it emits to its own internal event bus. A JavaScript adapter has to subscribe to that bus and translate events into OpenTelemetry before they can reach Agenta. This is structurally different from the Vercel AI SDK story and is handled in its own package. The mechanism and the working adapter implementation are documented in §1.10 (Phase 6) and §1.11 (the broken-baseline companion).

---

## 3. Goals

What we want to be true after v1 ships.

**For developers building production AI features in TypeScript:**

1. **One-line setup.** Replace ~80 lines of OpenTelemetry boilerplate with `init({host, apiKey, projectId})`. Defaults handle processor choice and URL formatting so users don't have to.

2. **No silent failures.** Streamed calls, edge runtime calls, abort-mid-stream calls, and tool-use traces all arrive in Agenta. Failures surface as errors, not missing spans.

3. **Standards-based wire, no proprietary lock-in.** Traces go over OTLP/HTTP using the same `gen_ai.*` / `ai.*` semantic conventions every other observability vendor accepts. Users can point existing instrumentation at Agenta — or later, somewhere else — without rewriting code.

4. **The "root" of a trace points at the LLM call, everywhere it's consumed.** Multiple Agenta surfaces — the trace-list UI, online evaluations, annotations, invocations — each pick the framework HTTP wrapper as the trace root because they share a naive `spans[0]` selector. Users see empty payload columns in the UI, online evaluators score garbage, annotations attach to the wrapper, invocation summaries show wrapper data. Fixing the shared selector once corrects all four. Token counts and costs roll up to the trace level so dashboards return usable numbers.

5. **User / session queries work across the entire trace.** Tagging a call with `userId: "u1"` makes every span queryable by user, not just the root.

**For Mastra users:** the same Agenta backend ingests Mastra traces via a separate published adapter package.

**For us as maintainers:** the JavaScript package surface is small enough to ship and maintain without tracking every Vercel AI SDK type change across v6 → v7 → v8. We don't take on AI SDK as a wrapped dependency.

v1 scope does not include feature parity with the Python `agenta` SDK (decorators, `propagateAttributes`, secrets/vault/config managers). Those are v2 trajectory.

---

## 4. How the competition stacks up

Two competitors ship TypeScript SDKs covering the same surface: **Langfuse** and **Braintrust**. The comparison below comes from running the same `streamText` call against all three backends in parallel (the §1.12 + §1.13 spike work) and comparing the results.

### 4.1 Capability matrix

| Capability | Agenta today (no SDK) | Langfuse JS | Braintrust JS | Agenta proposed |
|---|---|---|---|---|
| One-line setup | ❌ 80 lines | ✅ 1 line | ✅ 2 lines | ✅ 1 line |
| Streamed call correctness (abort, batch processor) | ❌ silent failures | ❌ same bug, GH issue open | ❌ no abort handling | ⚠️ via docs (Simple) + backend rollup |
| Edge runtime support | ❌ broken | ❌ Node ≥ 20 only | ✅ per-runtime bundles | ✅ eval-free + waitUntil-enrolled |
| Token / cost auto-computed at ingest | ❌ no | ✅ yes (~700-model registry) | ⚠️ only with wrapper SDK | ✅ planned (backend) |
| First-class `userId` / `sessionId` | ❌ no | ✅ typed, propagates | ❌ untyped metadata only | ✅ via backend cascade |
| Trace URL helper | ❌ hand-roll | ✅ `trace.getTraceUrl()` | ✅ `currentSpan().link()` | ✅ `getTraceUrl()` |
| Multi-backend fan-out | ✅ raw OTel | ⚠️ separate processor | ⚠️ OTel passthrough | ✅ raw OTel |
| Decorator / functional wrapper for custom spans | ❌ no | ✅ `observe()` | ✅ `traced()` | ❌ v2 |
| Mastra integration | ❌ silent zero traces | ❌ no | ⚠️ via OpenAI wrapper layer only | ✅ separate package |
| Wire format | OpenTelemetry | OpenTelemetry-compatible + own batch protocol | Proprietary REST (`logs3`) | OpenTelemetry |
| Locks users in | ❌ no | ⚠️ partial | ✅ yes | ❌ no |

### 4.2 Where each one wins and fails

**Langfuse** ships the most polished SDK: typed user/session API, server-side cost computation, model alias resolution, trace URL helpers, ~700-model pricing registry. The trade-offs: no edge runtime support (Node ≥ 20 only; they recommend against `@vercel/otel`), and the streamed-call abort bug is open and acknowledged. Their trace-list polish runs inside their JS SDK, not server-side — users on raw OpenTelemetry get none of it.

**Braintrust** ships the most developer tooling: three init modes, per-runtime bundles (`node`/`edge-light`/`workerd`/`browser`), 13 provider wrappers, CLI with push/pull/dev-server, server-side function execution. The trade-offs: proprietary wire format, no first-class user/session, no abort handling, and it silently swallows spans when the user's organization is on a different data plane than the SDK's default. Switching backends means rewriting instrumentation.

**Agenta today** emits pure OpenTelemetry and fans out to N additional backends in ~10 lines per destination. Setup is 80 lines, there are no helpers, and the silent failures in §2 reproduce out of the box. The published example works; every developer rebuilds the same boilerplate.

### 4.3 Where we want to win

The empirical observation behind this proposal: **all three backends accept raw OpenTelemetry**. The "vendor SDK" feature comparison is mostly about ergonomic surface; the wire is the same. The tri-export work in §1.13 demonstrates a docs page can deliver the "wraps OpenTelemetry ergonomically" capability — it does not by itself justify a published package.

**Two things require a package — everything else is docs or backend work:**

1. **Edge runtime correctness.** Edge bundling rules and `waitUntil` enrollment are hard to get right from a recipe and break across runtime versions. Braintrust ships per-runtime bundles for exactly this reason; Langfuse punts entirely. This is where a JS-side package is required.

2. **Safe-defaults `init()` that hides config gotchas.** The matrix of host-vs-host-plus-`/api`, `project_id` query parameter, processor choice, and OTLP endpoint URL is easy to misconfigure. One `init()` call with correct defaults eliminates four common failure modes.

**Everything else** — token usage rollup, trace root selection, user/session cascade, cost computation — is **backend work** that benefits every Agenta user (Python, raw OTel, AI SDK, Mastra) regardless of which SDK they install. Those ship as the parallel backend track.

---

## 5. Proposed solution

Two parallel tracks. They are independent — either can ship first.

### 5.1 Backend track

Five improvements to Agenta's trace ingest pipeline. None require any JavaScript SDK code.

| Improvement | Solves |
|---|---|
| Preserve OpenTelemetry `Resource` attributes (e.g. `service.name`) under a documented path | Today silently dropped |
| Cascade `userId` / `sessionId` from root span to all child spans during ingest. **Write-if-absent semantics** (don't clobber per-tool metadata). Note: this changes "filter spans by user.id" from "root only" to "all spans in matching traces" — evals are unaffected (they filter by `trace_id`), but dashboards counting spans-per-user will report higher numbers post-cascade. Flag in release notes. | Problem 2.5 |
| Upgrade the shared `extract_root_span` helper to prefer LLM-relevant spans (any with `ai.*`, `gen_ai.*`, `ag.data.inputs/outputs` attributes, or trusted LLM scopes). Eliminate the 4 inline duplicates of the naive `spans[0]` pattern. Fixes trace-list UI, **online evaluations, annotations, and invocations** in one PR. | Problem 2.4 |
| Populate `ag.metrics.costs.incremental.*` per LLM-relevant span from `gen_ai.usage.*` × a model pricing table. The existing tree-walk in [`api/oss/src/core/tracing/utils/trees.py:280-315`](../../../api/oss/src/core/tracing/utils/trees.py:280) already rolls `incremental` → `cumulative`; metrics endpoint and evals already query `ag.metrics.costs.cumulative.total`. Schema path exists; just needs leaf values populated. | Cost was never computed |
| Roll children's token counts up to the parent at trace-read time. Today the ingest tree-walker ([`trees.py:28-89`](../../../api/oss/src/core/tracing/utils/trees.py:28)) only runs once per OTLP request ([`service.py:146`](../../../api/oss/src/core/tracing/service.py:146)). With `SimpleSpanProcessor` (the processor Agenta recommends, because the alternative loses streaming spans on mid-stream abort), each span ships in its own OTLP request — so the walker never sees a parent and its children together at ingest, and parent `tokens.cumulative.*` is never written. The fix: after fetching a trace for a consumer (UI, evaluations, annotations, invocations, metrics), re-run the same walker over the assembled span tree. Same code path as the user/session cascade row above. | Token rollups missing on multi-batch traces |

All five benefit Python SDK users, raw OpenTelemetry users, Vercel AI SDK users, and Mastra users equally. They are additive (no breaking changes to existing trace queries).

**Why this is a post-query computation, not an ingest-time fix.** The existing OTLP ingest already runs a per-framework adapter (e.g. [`vercelai_adapter.py`](../../../api/oss/src/apis/fastapi/otlp/extractors/adapters/vercelai_adapter.py)) and a per-batch tree-walker. The adapter is the right place for per-span normalization (`ai.usage.*` → `ag.metrics.tokens.incremental.*`); it can't do parent rollups because, when `SimpleSpanProcessor` is in use, the parent and its children arrive in separate OTLP requests and the adapter never sees them in the same call. Buffering at the server until "a trace looks complete" would reintroduce the export latency Agenta deliberately avoids by recommending `SimpleSpanProcessor`. Re-running the walker at trace-read time is idempotent (re-rolling spans that already have `cumulative.*` set just writes the same values) and works regardless of which processor or framework emitted the trace.

**Note on problem 2.3 (Pages Router token drop) specifically.** Read-time rollup does not by itself fix this case. Direct trace queries against the affected 4-way combination (Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` + `streamText`) show every span — parent, `.doStream` child, `fetch` grandchild — with empty token attributes. There is nothing to roll up FROM. That fix lives in the JavaScript track at the emit side; see §5.2's `agentaPipeUIMessageStreamToResponse`. The read-time rollup still ships, because it fixes the broader class of multi-batch traces where children DO carry tokens. §7.1 has the full code trace.

### 5.2 JavaScript track — `@agenta/sdk-tracing`

The smallest published package that delivers what backend + docs cannot.

**Ships in v1:**

- **`init({host, apiKey, projectId})`** — one call. Configures the OpenTelemetry pipeline with safe defaults (synchronous "Simple" exporter, correct OTLP endpoint with `?project_id=` propagation, host normalization so users can pass `https://cloud.agenta.ai` or `https://cloud.agenta.ai/api` interchangeably). State stored on a global symbol so monorepo and dev-mode duplicate-package loads don't break tracing.

- **Edge runtime bundle** — auto-selected via the package's conditional `exports` based on the runtime. Eval-free OpenTelemetry HTTP exporter that passes Vercel Edge / Cloudflare Workers / Pages-Router-edge build checks. Enrolls its flush promise into the runtime's `waitUntil` tracker so traces leave the process before the isolate freezes. Fixes all three failure modes in problem 2.2.

- **`getTraceUrl()`** — returns a clickable Agenta trace URL for the current span. ~10 lines; meaningfully reduces debug round-trips. Both Langfuse and Braintrust ship this; nobody implements it from raw OpenTelemetry.

- **`setAgentaTracerProvider(provider)`** — escape hatch for users on `@vercel/otel`'s isolated tracer provider.

- **`getAgentaTracer()`** — escape hatch returning the underlying OpenTelemetry `Tracer` for users writing custom spans.

- **`agentaPipeUIMessageStreamToResponse(result, res, opts)`** — Pages Router helper that wraps `pipeUIMessageStreamToResponse` and writes `gen_ai.usage.*` / `ag.metrics.tokens.*` onto the active `ai.streamText` span before `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends it. Drop-in: users replace `result.pipeUIMessageStreamToResponse(res)` with `agentaPipeUIMessageStreamToResponse(result, res)`. Fixes problem 2.3 directly — the only viable fix, because the affected combination drops token attributes on every span (parent, `.doStream`, `fetch` grandchild), so backend-side rollup has nothing to recover.

**Does not ship in v1:**

- Wrapping `streamText` / `generateText`. Users keep `import { streamText } from "ai"` unchanged. Our `init()` configures the pipeline; we don't touch the call site.
- Framework adapter packages (`/next`, `/tanstack`, `/nuxt`).
- `propagateAttributes` HOF, decorator-style instrumentation, mask function.
- TypeScript managers for prompts, datasets, evals, scoring, annotations.
- CLI tooling.
- Browser tracing.

All deferrals catalogued in §6.4 with explicit trigger conditions.

### 5.3 JavaScript track — `@agenta/sdk-mastra`

A separate package, shipped independently of `@agenta/sdk-tracing`. Mastra's observability stack is not OpenTelemetry — it emits `TracingEvent` payloads to its own `ObservabilityBus`. The adapter extends Mastra's `BaseExporter`, subscribes to the bus, translates each event into Agenta's attribute shape, and re-emits as OTel spans through the globally-registered tracer — so traces land alongside Vercel AI SDK traces in the same Agenta project via the standard OTLP wire.

The working implementation exists from the spike at `web/examples/mastra-node/src/agenta-exporter.ts` — 190 lines (≈120 lines of executable code, the rest is a doc block explaining the architecture). All four canonical spike assertions pass against it. v1 publishes it as `@agenta/sdk-mastra` with `@mastra/core` and `@mastra/observability` as peer dependencies.

**One implementation note grounded from the source:** the exporter assigns OTel-generated trace and span IDs (Mastra's IDs don't propagate, because the OTel SDK doesn't expose a "use these specific IDs" hook). It maintains a Mastra-id → OTel-span map so child spans can find their parent's OTel context. The trace tree shape is preserved; only the identifiers differ.

**Why separate package, not subpath:** different dependency footprint (Mastra peers shouldn't be forced on AI-SDK-only users), different integration shape (`BaseExporter` subclass vs OpenTelemetry `SpanProcessor`), and independent versioning lets Mastra's pre-1.0 churn happen without breaking the AI SDK package.

---

## 6. What v1 looks like in practice

### 6.1 Node + Vercel AI SDK

```ts
import { init } from "@agenta/sdk-tracing"
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"

init({
  host: process.env.AGENTA_HOST!,
  apiKey: process.env.AGENTA_API_KEY!,
  projectId: process.env.AGENTA_PROJECT_ID,
})

const result = streamText({
  model: openai("gpt-4o-mini"),
  prompt: "Reply with: ok.",
  experimental_telemetry: {
    isEnabled: true,
    metadata: { userId: "u1", sessionId: "s1" },
  },
})

for await (const chunk of result.textStream) { /* ... */ }
```

Three lines of `@agenta/sdk-tracing` involvement: one import, one call, one config object. AI SDK imports unchanged. Compare to today's 60-80 lines of OpenTelemetry boilerplate.

### 6.2 Next.js (App Router or Pages Router, Node or Edge runtime)

```ts
// instrumentation.ts (Next.js auto-discovers and registers this)
export async function register() {
  if (process.env.NEXT_RUNTIME) {
    const { init } = await import("@agenta/sdk-tracing")
    init({
      host: process.env.AGENTA_HOST!,
      apiKey: process.env.AGENTA_API_KEY!,
      projectId: process.env.AGENTA_PROJECT_ID,
    })
  }
}
```

```ts
// app/api/chat/route.ts (App Router) or pages/api/chat.ts (Pages Router)
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"

export async function POST(req: Request) {
  const result = streamText({
    model: openai("gpt-4o-mini"),
    messages: [/* ... */],
    abortSignal: req.signal,
    experimental_telemetry: { isEnabled: true },
  })
  return result.toUIMessageStreamResponse()
}
```

Edge runtime is the same code with `export const runtime = "edge"`. The conditional `exports` field auto-selects the edge bundle.

**Pages Router users on `@vercel/otel`** replace `pipeUIMessageStreamToResponse` with `agentaPipeUIMessageStreamToResponse` to preserve token attributes (problem 2.3 fix):

```ts
// pages/api/chat.ts — Pages Router + @vercel/otel
import { agentaPipeUIMessageStreamToResponse } from "@agenta/sdk-tracing"
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import type { NextApiRequest, NextApiResponse } from "next"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const result = streamText({
    model: openai("gpt-4o-mini"),
    messages: req.body.messages,
    experimental_telemetry: { isEnabled: true },
  })
  await agentaPipeUIMessageStreamToResponse(result, res)
  // ↑ drop-in: same shape as result.pipeUIMessageStreamToResponse(res),
  //   plus token-attribute writes before @vercel/otel's force-end fires.
}
```

App Router users do not need this — `toUIMessageStreamResponse` doesn't trigger the same force-end interaction.

### 6.3 Mastra

```ts
import { Mastra } from "@mastra/core"
import { AgentaMastraExporter } from "@agenta/sdk-mastra"

const mastra = new Mastra({
  agents: { /* ... */ },
  observability: {
    default: { enabled: false },
    configs: {
      agenta: {
        exporters: [
          new AgentaMastraExporter({
            host: process.env.AGENTA_HOST!,
            apiKey: process.env.AGENTA_API_KEY!,
            projectId: process.env.AGENTA_PROJECT_ID,
          }),
        ],
      },
    },
  },
})
```

### 6.4 v2+ roadmap

Every deferred capability has an explicit trigger condition. The default is **don't ship until evidence justifies it.**

| Capability | Trigger to revisit |
|---|---|
| Wrapping `streamText` for footgun reduction | ≥3 unique support requests in v1's first quarter tied to users hitting problem 2.1 because they followed Vercel/Mastra docs without finding Agenta's note |
| Framework adapter packages (`/next`, `/tanstack`, `/nuxt`) | ≥3 unique users file an issue on a framework's documented footgun, OR the framework reaches >5% of `@agenta/sdk-tracing` downloads |
| Per-provider proxy wrappers (Braintrust-style 13 wrappers) | Concrete user request for "I call provider X directly without Vercel AI SDK and want Agenta traces" |
| `propagateAttributes` HOF + functional decorator | Top reported friction in v1's first quarter |
| Mask function for PII / secret scrubbing | Concrete user request with a specific use case |
| Python-SDK parity: prompts, datasets, evals, scoring, annotations TypeScript managers | Separate RFC per surface |
| CLI tooling | Explicit user demand signal |
| Multi-backend health surfacing (`init({destinations: [...]})`) | v1 ships with one destination; revisit when multi-destination demand emerges |
| Browser tracing | Concrete user request (likely never — AI calls happen server-side) |

---

## 7. Open questions

Three items still in scope for review. Everything else is implementation detail.

### 7.1 Why the Pages Router token drop needs a JS-side helper, not a backend rollup

Direct Agenta-side queries against the trace emitted by the affected 4-way combination (Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` + `streamText`):

- `ai.streamText` parent: `ag.metrics.tokens.*` missing.
- `ai.streamText.doStream` child: `ag.metrics.tokens.*` missing.
- `fetch POST https://api.openai.com/v1/responses` grandchild: `ag.metrics.tokens.*` missing.

No span carries token data. A walker running at read time would visit every span, find nothing to propagate, and exit. There is nothing to roll up FROM. The spike test [`web/examples/nextjs-pages-router-vercel/test/test-assertion-1.ts`](../../../web/examples/nextjs-pages-router-vercel/test/test-assertion-1.ts) queries `ag.metrics.tokens.cumulative.prompt` — the path Agenta's metrics endpoint and online evaluations read ([`evaluations/service.py:137`](../../../api/oss/src/core/evaluations/service.py:137), [`tracing/service.py:94`](../../../api/oss/src/core/tracing/service.py:94)) — and consequently fails.

**Most plausible mechanism.** `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-end fires not only on the parent (closing it before the synchronous return of `pipeUIMessageStreamToResponse`) but also on `.doStream` while the OpenAI Responses API stream is still draining. The usage write that AI SDK tries to do on `.doStream` (when the OpenAI call completes) lands on an already-ended span and is dropped per OTel spec. The empirical evidence is sufficient to choose the fix without a deeper source trace; the mechanism can be confirmed at implementation time.

**Why the other streamText spike apps still populate `incremental.prompt`.** App Router, Pages Router raw, TanStack, Nuxt — no `@vercel/otel`, no force-end. AI SDK's `setAttributes({ai.usage.*})` lands on the parent (or `.doStream`) directly. The adapter writes `incremental` on the affected span. The 4-way combination is the only one where force-end clobbers tokens on every relevant span.

**Why the fix is JS-side.** Backend rollup can only redistribute data that already arrived. The wire-level emit is missing those attributes. The only place to fix it is before the writes get dropped — i.e. before `@vercel/otel`'s force-end fires. `agentaPipeUIMessageStreamToResponse` (§5.2) owns those writes itself onto an Agenta-controlled span and ends that span explicitly. ~30 lines, single-file, drop-in replacement at one call site.

The §5.1 read-time rollup still ships — just not as the fix for this specific case. It fixes the broader class of traces where children DO carry `incremental.*` but the batch-scoped ingest walker never sees them with their parent in the same OTLP request. That happens any time `SimpleSpanProcessor` is in use (one span per request by design), which is every Agenta-recommended setup.

**Alternatives considered and rejected:**

- **Trace-finalization pass at ingest** (background job triggered when "trace is complete"). Doesn't help when no span has the token data to begin with.
- **Server-side batching before walker** (buffer spans for N ms). Same problem; reintroduces latency.
- **Swap `SimpleSpanProcessor` for `BatchSpanProcessor` in `@vercel/otel`.** Different processor, same force-end mechanism on `.doStream`. Also widens Agenta's setup-docs surface (today we recommend `SimpleSpanProcessor` for everything).
- **Patch `@vercel/otel`'s force-end.** Outside our control; upstream PR is high-risk and slow.
- **Wrap `streamText` in `@agenta/sdk-tracing`.** Larger surface, ties the package to AI SDK's evolving type signature across majors. The narrow `pipeUIMessageStreamToResponse` helper has a stable shape across AI SDK v3-v6 and a clean deprecation path if upstream patches the force-end.

### 7.2 OpenTelemetry endpoint path override for self-hosted Agenta

Cloud Agenta uses `/api/otlp/v1/traces`. Self-hosted deployments may route differently. Recommend `init({otlpPath: "..."})` override with the cloud default. Decision at implementation.

### 7.3 SDK self-telemetry

`@agenta/sdk-tracing` could send anonymized usage metrics (SDK version, runtime, framework detection) back to Agenta. Standard for vendor SDKs, controversial for some users. Recommend default off, opt-in via env var.

---

## 8. Risks

1. **`agentaPipeUIMessageStreamToResponse` adds a Pages-Router-shaped surface to `@agenta/sdk-tracing` we'd prefer not to maintain.** It's the only place the Pages Router token drop can be fixed — backend rollup has no token data to recover — but it's still a surface to keep working across AI SDK majors. Mitigation: ~30 lines, drop-in at a single call site, only Pages Router users need it, and if `@vercel/otel` patches its force-end or AI SDK exposes a pre-force-end signal we deprecate the helper cleanly.

2. **Mastra peer dependency churn.** `@mastra/core` is pre-1.0. Breaking changes between minor versions are common. Mitigation: pin to a tested range, release patches aligned with Mastra majors.

3. **Edge runtime fragmentation.** Vercel Edge is the primary user base. Cloudflare Workers and Deno Deploy each have their own `waitUntil`-equivalent quirks. v1 supports Vercel cleanly and falls back gracefully on others; deep Cloudflare support is v2+ if demand justifies.

4. **Footgun-reduction loss for users who skip Agenta docs.** Without wrapping `streamText`, users who follow Vercel's or Mastra's setup docs in isolation will still hit problem 2.1. Mitigation: a new `@vercel/otel`-specific section in Agenta's Vercel-AI-SDK integration docs explaining the processor override. Tracked as a v2 trigger.

5. **Backend track delays the user-visible UI fix (problem 2.4).** If backend doesn't land before the JavaScript package ships, users see correctly-emitted spans but the trace-list still shows the wrong row. Document the known gap in v0.1.0 release notes with the backend ETA.

6. **Spike app dogfooding.** The eight existing spike apps in `web/examples/` should be refactored to consume `@agenta/sdk-tracing` v0.1.0 before external release. Failing to do this means the SDK ships without a single non-test user.

---

## 9. What lands when

Backend track and JavaScript track are independent — either can ship first.

| Track | Deliverable |
|---|---|
| Backend | Resource attribute preservation, user/session cascade, LLM-scope trace-list row, cost computation |
| Backend | Read-time token rollup (re-runs `calculate_and_propagate_metrics` over the assembled trace at query time). Additive, no breaking changes. |
| JavaScript | `@agenta/sdk-tracing` v0.1.0 — `init()` + Node bundle + edge bundle + `getTraceUrl()` + `agentaPipeUIMessageStreamToResponse` (Pages Router helper, fixes the token-drop case in problem 2.3) |
| JavaScript | `@agenta/sdk-mastra` v0.1.0 — `AgentaMastraExporter` |
| Docs | `@vercel/otel`-specific section in Vercel-AI-SDK integration docs |
| Docs | Migration guide from current ~80-line OpenTelemetry setup |
| Docs | Per-framework warnings (TanStack import-order, Nuxt H3 abort signal) |
| Examples | Refactor spike apps to consume v0.1.0 (dogfooding) |

---

## 10. Approval

Three reviewers, one question each:

- **Backend lead** — the backend track is non-trivial. Concretely: how many engineer-weeks, when does it slot, who owns the verification probe?
- **Strategic** — the JavaScript scope cut is narrower than competing SDKs. Is "we ship less, we ship pure OpenTelemetry, we cost less to migrate off" a story we want to tell publicly?
- **Frontend platform** — the two new packages live in `web/packages/agenta-sdk-tracing` and `web/packages/agenta-sdk-mastra` (currently empty placeholders). Confirm ownership and CI integration.

Approval gates the start of v1 implementation. Backend track may begin independently.
