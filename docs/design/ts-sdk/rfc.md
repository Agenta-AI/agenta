# RFC: Agenta TypeScript SDK v1

**Status:** Draft (supersedes Notion `ts-sdk-sprint-plan-v2`)
**Author:** Arda Erzin
**Branch:** `ts-sdk-chore/rfc`
**Date:** 2026-05-17
**Reviewers:** Mahmoud, JP, frontend platform
**Decision deadline:** before v1 implementation kickoff
**Source-grounded:** specific claims about spike app behavior, file sizes, and existing test coverage verified against `web/examples/` source on 2026-05-17. The four Next.js spike apps (Phases 2a, 2b, 3a, 3b) were re-run on Next.js 16.2.6 on 2026-05-18 — the empirical re-verification flipped a key recommendation: `agentaPipeUIMessageStreamToResponse` is now a v1 deliverable (formerly contingency), and §4.4 is reframed as a general multi-batch rollup fix that does NOT subsume P-PAGES-VERCEL-01. See [§11.4](#114-backend-rollup--code-trace-and-empirical-verification) for the full story. See [companion proposal.md](proposal.md) for the readable short-form version.

---

## 0. Summary

Agenta ships a TypeScript SDK in two parts:

- **`@agenta/sdk`** — the existing REST client (Fern-generated `@agentaai/api-client` + thin convenience wrapper). Already on `main`. Unchanged in scope.
- **`@agenta/sdk-tracing` (new, v1, narrowest defensible cut)** — ships two narrow mechanisms: an **edge runtime helper** for Vercel Edge / Cloudflare Workers / Workerd, and **`agentaPipeUIMessageStreamToResponse`** for Pages Router users on `@vercel/otel` (fixes P-PAGES-VERCEL-01 — promoted from contingency to v1 based on Next.js 16 empirical re-verification, see [§11.4](#114-backend-rollup--code-trace-and-empirical-verification)). Plus `init()` that configures safe OTel defaults (Simple processor, host normalization, `project_id` propagation) and a `getTraceUrl()` helper. **No `streamText` / `generateText` wrapper.** Nothing else in v1. The full AI SDK lifecycle wrapper considered in earlier drafts was rejected after honest audit — see [§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected). The Pages Router helper is narrow enough (one stable response function) that it does not slip into the lifecycle-wrapper failure mode.
- **`@agenta/sdk-mastra` (new, v1, independent)** — the spike's `AgentaMastraExporter` (190 lines including its doc block, ~120 lines of executable code, 4/4 spike assertions passing) published as its own package. Mastra's `ObservabilityBus` is not OTel — it needs a `BaseExporter` subclass, not an `OTel SpanProcessor`. The two packages do not overlap.

**Parallel backend track.** The RFC commits to a backend-side workstream that solves four pain entries on Agenta's adapter alone, with no JS SDK involvement: preserve OTel `Resource` attributes (P-NODE-01), trace-level metadata cascade (P-NODE-03), **shared `extract_root_span` helper upgrade — fixes trace-list UI AND online evaluations AND annotations AND invocations in one PR** (P-COMMON-01, scope corrected after backend code read), and cost computation from `gen_ai.usage.*` (D80 in [competitive-analysis.md](competitive-analysis.md)). Plus a **§4.4 extension** that re-runs the existing tree-walker at trace-read time (or via equivalent post-query enricher) so children's `incremental.*` token data rolls up to parents' `cumulative.*` fields in the general multi-batch SimpleSpanProcessor case. Code-trace verified necessary — the ingest-time walker is batch-scoped and SimpleSpanProcessor exports each span in its own batch, so siblings never meet at ingest. **Earlier drafts claimed this subsumed P-PAGES-VERCEL-01; Next.js 16 empirical re-verification on 2026-05-18 disproved that** (no span has tokens to roll up FROM in the affected combination). P-PAGES-VERCEL-01 specifically moves to the JS-side helper described above. These backend improvements benefit ALL Agenta users — Python SDK, raw OTel, AI SDK, Mastra — and are decoupled from any JS package shipping.

**v1 deliberately does not include:** AI SDK v6 `streamText` / `generateText` lifecycle wrapper, framework adapter packages (`/next`, `/tanstack`, `/nuxt`), `propagateAttributes` HOF, decorator-style instrumentation, mask function, prompt cache, datasets/evals/scoring/annotations TS managers, CLI, secrets/config manager port from Python SDK. All of these are catalogued in [§9 v2+ roadmap](#9-v2-roadmap) with the trigger conditions for each.

**Strategic posture toward Mahmoud's "backend > JS" pushback.** Accepted in full for the lifecycle cluster — 2 of 3 entries are docs-fixable, the 3rd folds into backend rollup. The JS-side wedge for `@agenta/sdk-tracing` reduces to **edge runtime exclusively** — the one place where docs cannot guarantee correctness across runtime + bundler + Next-version permutations. See [§2.2](#22-the-313-split-mahmouds-pushback-addressed).

**Why this is the right size.** Approach B+ is the smallest cut that still ships a JS package, justified specifically by edge runtime mechanism bugs (P-APP-RAW-01, P-PAGES-RAW-01, P-APP-VERCEL-02). Approach C (with a thicker `streamText` wrapper) was considered and rejected after the honest audit — see [§12.2](#122-approach-b--adopted-v1-ships-edge-helper-only-no-lifecycle-wrapper). Approach A's full surface is the v2 trajectory.

---

## 1. Context

### 1.1 What this RFC supersedes

This RFC supersedes the Notion document `ts-sdk-sprint-plan-v2` (`https://www.notion.so/agentaai/ts-sdk-sprint-plan-v2-351dcb35ffd980349e50cc9d258f829a`). That plan was written before the spike landed empirical evidence. Two of its premises did not survive the spike:

- It treated "wraps OTel ergonomically" as sufficient differentiation. The tri-export work (Phase 7 Braintrust + Phase 8 Langfuse, [`sdk-comparison.md`](../ts-sdk-tracing/sdk-comparison.md)) shows raw OTLP fan-out to N backends costs ~10-12 LoC per backend. "Wraps OTel" is not enough to justify a published package.
- It scoped the SDK to feature parity with the Python `agenta` SDK as a v1 gate. That was rejected by Mahmoud + JP in review (cited in memory `project_ts_sdk_sprint_plan_rework.md`). v1 ships the narrow wedge; v2 chases parity.

Two further changes happened after that Notion doc was last touched:

- **Fern adoption landed** as [PR #4239](https://github.com/Agenta-AI/agenta/pull/4239) and the Fern-generated client + thin `@agenta/sdk` wrapper merged in [PR #4259](https://github.com/Agenta-AI/agenta/pull/4259). The Notion plan's "defer Fern" decision is moot — Fern is the wire.
- **The spike completed all 8 framework phases + Phase 7/8 tri-export** with 16 pain entries, 13 specific to AI SDK, 3 specific to Mastra (cross-counted), and 2 specific to third-party backend behavior (P-BRAINTRUST-01, P-LANGFUSE-01). The pain log is the empirical evidence base for every JS-side design decision in this RFC.

### 1.2 Locked decisions inherited from prior work

These are not revisited here. Anyone wanting to challenge them is referred to the prior artifacts.

| Decision | Source | Status |
|---|---|---|
| OTLP/HTTP wire for tracing | D1 in [`competitive-analysis.md` §21](competitive-analysis.md#21-rfc-decisions-for-agenta) | Locked |
| `ag.*` attribute taxonomy | Backend adapter + Python SDK convention | Locked |
| REST for non-tracing surfaces (scores, prompts, datasets, evals) | D1 in [`competitive-analysis.md` §21](competitive-analysis.md#21-rfc-decisions-for-agenta) | Locked |
| SDK-REQ-01: ship a built `dist/` from day one | [`status.md` § SDK Requirements](../ts-sdk-tracing/status.md#sdk-req-01-ship-a-built-dist-from-day-one) | Already applied to `@agenta/sdk` |
| SDK-REQ-02: `host` parameter accepts origin-only strings; SDK appends `/api` | [`status.md`](../ts-sdk-tracing/status.md#sdk-req-02-host-parameter-accepts-origin-only-strings-sdk-adds-api-itself) | Locked — must apply to tracing package too |
| SDK-REQ-03: `init({projectId})` propagates `?project_id=<uuid>` to every request including OTLP ingest URL | [`status.md`](../ts-sdk-tracing/status.md#sdk-req-03-initprojectid-propagates-project_id-to-every-request) | Locked — applies to OTLP exporter URL too |
| Two-package split: tracing + client | This RFC + Notion v2 | Locked — confirmed by Approach B+ |
| AI SDK v6 `streamText` lifecycle wrapper | [§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected) + [§12.2](#122-approach-b--adopted-v1-ships-edge-helper-only-no-lifecycle-wrapper) | **Rejected from v1** for the full `streamText` wrap. A narrow `pipeUIMessageStreamToResponse`-only Pages Router helper (`agentaPipeUIMessageStreamToResponse`) DOES ship in v1 — promoted from contingency after Next.js 16 empirical re-verification ([§11.4](#114-backend-rollup--code-trace-and-empirical-verification)) showed the backend §4.4 read-time enricher cannot recover tokens for P-PAGES-VERCEL-01 alone. |

### 1.3 What "tracing" means in this RFC

Throughout: **"tracing"** refers exclusively to the OTLP path — span emission, processor, exporter, and the framework-specific glue around them. Scores, prompts, datasets, evals, annotations are **not** tracing in this RFC. They live in `@agenta/sdk` (REST). This separation matches the Langfuse 5-package split ([`competitive-analysis.md` §1](competitive-analysis.md#1-package-layout--install-surface)) and is explicit because the Notion v2 doc occasionally blurred the two.

### 1.4 Critical reading framing

Most of the "features" in [`competitive-analysis.md`](competitive-analysis.md) §§3-13 run **inside vendor SDKs** (Langfuse's `LangfuseSpanProcessor`, Braintrust's `wrapAISDK`). The spike apps emit **raw OTLP**, the same wire Agenta will produce and receive. The authoritative reference for what hits the wire is [`docs/design/ts-sdk-tracing/sdk-comparison.md`](../ts-sdk-tracing/sdk-comparison.md). When evaluating any claimed differentiator below, the test is: does it fire on raw OTLP, or only inside the vendor SDK?

---

## 2. Strategic posture

### 2.1 The wedge is no longer "wraps OTel"

Mahmoud's "fewer moving parts" pushback puts the burden of proof on us: **why publish a JS package at all?** The RFC has to clear that bar before proposing anything.

The Phase 7 + Phase 8 tri-export work answers the easy half empirically. The spike wired the same 8 apps to send identical spans to three observability platforms in parallel — Agenta, Braintrust, Langfuse — using one `NodeTracerProvider`, three `SimpleSpanProcessor` instances, and ~10-12 lines of additional configuration per destination. No vendor SDK involved. A user with a docs page and 30 minutes can do this themselves.

What that proves: **OTel fan-out is a docs-tier capability, not a package-tier one.** "Wraps OTel ergonomically" is no longer enough to justify a published package, because a recipe matches it. The bar `@agenta/sdk-tracing` has to clear is **doing something a docs recipe + raw OTLP cannot.**

Two things meet that bar, both confirmed empirically:

1. **Hide silent-failure config gotchas.** P-BRAINTRUST-01 (data-plane mismatch silently swallows spans for hours), `SimpleSpanProcessor` success ≠ delivery, host-vs-host-plus-api confusion (SDK-REQ-02), `project_id` query-param requirement (SDK-REQ-03). Users cannot debug these without reading source. The package's `init()` codifies the safe defaults so users get them without reading carefully.
2. **Solve what raw OTLP physically cannot — edge runtime.** P-APP-RAW-01 (zero spans on App Router edge despite documented setup), P-PAGES-RAW-01 (hard BUILD failure on Pages Router edge), P-APP-VERCEL-02 (10-15 second delay on `@vercel/otel`-edge default). All three are mechanism bugs that fire below the recipe layer — the user follows the docs and still loses spans, or sees them arrive 15 seconds after the request returned. Unfixable from documentation without asking users to copy ~30 lines of eval-free exporter + `waitUntil` enrollment into every edge route, every time, and keep it correct across runtime / bundler / Next-version permutations.

These two are the entire wedge for `@agenta/sdk-tracing` v1.

**Audit note (changed from earlier drafts).** Earlier drafts listed the AI SDK v6 `streamText` lifecycle bug as a third wedge item. Honest audit ([§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected)) showed 2 of its 3 entries are docs-fixable (Agenta's own vercel-ai-sdk docs already prescribe `SimpleSpanProcessor`). The 3rd (P-PAGES-VERCEL-01) was initially folded into backend rollup ([§4.4](#44-cost-computation-from-gen_aiusage-d80--read-time-token-rollup-general-multi-batch-gap--does-not-subsume-p-pages-vercel-01)); the Next.js 16 re-verification on 2026-05-18 ([§11.4](#114-backend-rollup--code-trace-and-empirical-verification)) flipped that — P-PAGES-VERCEL-01 now ships in v1 as the narrow `agentaPipeUIMessageStreamToResponse` helper ([§11.5](#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01)). The full `streamText` lifecycle wrapper stays rejected from v1.

### 2.2 The 3/13 split (Mahmoud's pushback, addressed)

Mahmoud's framing — "fewer moving parts, prefer backend" — is correct for a subset of the spike's pain entries and incorrect for the rest. The split is empirical, not argumentative. See [`summary.md` § Backend-fixable subset](../ts-sdk-tracing/summary.md#backend-fixable-subset-ai-sdk) for the full table; the reproducible mechanism for each "no" verdict is "the JS process loses the span before it ever reaches the network."

**Backend wins (4 entries — committed in this RFC, [§4](#4-backend-track-no-js-package-required)):**

| Entry | What's broken | Backend fix |
|---|---|---|
| P-NODE-01 | OTel `Resource` attrs (incl. `service.name`) silently dropped | Preserve under `ag.resource.*` at OTLP adapter |
| P-NODE-03 | `metadata.userId` only on parent span, not children (`ai.toolCall`) | Trace-level enricher cascades root `ag.user.id` / `ag.session.id` to children |
| P-COMMON-01 | Next.js HTTP auto-instrumentation buries `ai.streamText` not just in the UI trace-list but in **every consumer that calls `extract_root_span` or duplicates its `spans[0]` pattern** — online evals, annotations, invocations (see [§4.3](#43-shared-extract_root_span-helper-upgrade--eliminate-inline-duplicates-p-common-01-scope-corrected)) | Upgrade the shared helper to prefer LLM-relevant spans; eliminate 4 inline duplicates; all 4 consumers fixed in one PR |
| Cost (D80) | `ag.metrics.costs = {}` while Langfuse computes `totalCost` from same wire | Model pricing table + trace-level rollup from `gen_ai.usage.*` |

These ship as backend work and benefit Python SDK + raw OTel + AI SDK + Mastra users equally. They are decoupled from any JS package decision.

**JS-side wedge (10 entries):**

| Cluster | Entries | Why backend cannot fix |
|---|---|---|
| streamText lifecycle | P-NODE-02, P-APP-VERCEL-01 (docs), P-PAGES-VERCEL-01 (backend read-time rollup §4.4 — real work, code-trace verified) | All three entries are handled outside the JS package. P-NODE-02 / P-APP-VERCEL-01: Agenta's vercel-ai-sdk docs already prescribe `SimpleSpanProcessor`; a new `@vercel/otel`-specific cross-reference closes the remaining gap for users following Vercel/Mastra docs in isolation. P-PAGES-VERCEL-01: backend post-query enricher re-runs the existing tree-walker on the full assembled trace at read time (the ingest-time walker is batch-scoped; SimpleSpanProcessor exports child and parent separately, so they never meet at ingest). See [§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected) for the honest split. |
| Edge runtime | P-APP-RAW-01, P-APP-VERCEL-02, P-PAGES-RAW-01 | Vercel edge isolate freezes before OTLP `fetch` resolves unless enrolled into `globalThis[Symbol.for("@vercel/request-context")].get().waitUntil(...)`; raw OTel doesn't enroll. Pages-edge static analysis rejects raw OTel exporter at BUILD time. |
| Framework wiring | P-TANSTACK-01, P-TANSTACK-03, P-NUXT-01 | Instrumentation never registers (unenforced import order); abort signal undefined at runtime in H3 v2 RC. Spans never start. |
| Mastra | P-MASTRA-01, P-MASTRA-02, P-MASTRA-03 | Mastra returns `noopTracer` for its vendored AI SDK; emits to its own `ObservabilityBus`, not OTel. No spans ever reach the OTLP pipeline. |

v1 of `@agenta/sdk-tracing` covers the edge cluster exclusively. **The lifecycle cluster moves out of the JS package entirely** — 2 entries to docs (Agenta's existing vercel-ai-sdk docs prescribe `SimpleSpanProcessor`; new `@vercel/otel` cross-reference closes the gap for users following Vercel/Mastra docs in isolation), 1 entry to backend read-time enricher (P-PAGES-VERCEL-01 via §4.4 — re-runs the existing tree-walker on the assembled trace at read time; code-trace verified necessary because the ingest-time walker is batch-scoped). Framework wiring stays as documented patterns with explicit warnings; the SDK does not ship `/next`, `/tanstack`, `/nuxt` adapters in v1. Mastra is owned by the separate `@agenta/sdk-mastra` package and gets all 3 of its entries.

**Combined v1 surface:**

| Track | Coverage | Entries |
|---|---|---|
| Backend (§4) | 4 fixes | P-NODE-01, P-NODE-03, P-COMMON-01, cost computation |
| Backend (§4.4 read-time enricher — code-trace verified) | 1 fix | P-PAGES-VERCEL-01 |
| `@agenta/sdk-tracing` v1 (edge helper + init defaults) | 3 fixes | P-APP-RAW-01, P-PAGES-RAW-01, P-APP-VERCEL-02 |
| `@agenta/sdk-mastra` v1 | 3 fixes | P-MASTRA-01, P-MASTRA-02, P-MASTRA-03 |
| Docs improvements | 4 fixes | P-NODE-02, P-APP-VERCEL-01, P-TANSTACK-01/03, P-NUXT-01 |
| Architectural constraint (unaddressable) | 1 gap | P-TANSTACK-02 (no per-route edge runtime opt-in — TanStack framework decision) |
| **Total** | **15 of 16 + 1 contingent on verification + 1 framework constraint** | |

The line between "package fixes" and "docs fix" is sharper than the earlier draft of this RFC implied. The decision to drop the lifecycle wrapper from v1 is finalized in [§12.2](#122-approach-b--adopted-v1-ships-edge-helper-only-no-lifecycle-wrapper).

### 2.3 Why not full Python-SDK parity in v1

The Python SDK ships `ag.init()`, `@ag.instrument()`, `ag.tracing.store_internals/store_refs`, `litellm.callbacks` integration, and a high-level decorator surface. Porting all of it is a multi-quarter effort and was rejected as a v1 gate. The Python ergonomics matter and are catalogued in [`sdk-comparison.md` § Ergonomic-by-ergonomic, six implementations side-by-side](../ts-sdk-tracing/sdk-comparison.md#ergonomic-by-ergonomic-six-implementations-side-by-side) — they go in v2's roadmap ([§9](#9-v2-roadmap)). The v1 cut intentionally chooses correctness over ergonomics: silent failures first, ergonomic ceiling later, on top of a v1 that already correctness-guarantees the call.

---

## 3. The empirical wedge — what the SDK actually does

**v1 of `@agenta/sdk-tracing` ships one mechanism: an edge runtime helper ([§3.2](#32-edge-runtime-helper))**, plus `init()` that configures safe OTel defaults and a `getTraceUrl()` helper. The lifecycle wrapper considered in earlier drafts was rejected after honest audit ([§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected)). Full pain-entry evidence in [`pain-log.md`](../ts-sdk-tracing/pain-log.md).

### 3.1 AI SDK v6 lifecycle wrapper (considered and rejected)

**Status: full `streamText` wrap rejected for v1; a narrow `pipeUIMessageStreamToResponse`-only helper DOES ship.** Earlier drafts proposed an AI SDK v6 `streamText` lifecycle wrapper as the primary v1 mechanism. Honest audit showed 2 of 3 lifecycle pain entries are docs-fixable; the 3rd (P-PAGES-VERCEL-01) was assumed backend-fixable until the Next.js 16 re-verification (2026-05-18) showed otherwise. Updated table:

| Entry | Processor-dependent? | Coverage in v1 |
|---|---|---|
| P-NODE-02 (Batch + streamText loses spans) | Yes (Batch only) | **Docs.** Agenta's [`vercel-ai-sdk/observability.mdx`](../../docs/docs/integrations/frameworks/vercel-ai-sdk/observability.mdx) prescribes `SimpleSpanProcessor` which avoids the bug. New `@vercel/otel`-specific cross-reference covers users following Vercel/Mastra docs in isolation. |
| P-APP-VERCEL-01 (`@vercel/otel` Batch default + streamText) | Yes (Batch only) | **Docs.** Same mechanism, same cross-reference. |
| P-PAGES-VERCEL-01 (force-end race on Pages Router + `pipeUIMessageStreamToResponse`) | **No** (both Batch and Simple) | **`agentaPipeUIMessageStreamToResponse` JS-side helper, ships in v1** ([§5.4](#54-edge-runtime-helper--surface) and [§11.5](#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01)). Promoted from contingency to v1 deliverable after the Next.js 16 empirical re-verification: direct Agenta-side trace queries showed BOTH parent AND child have empty token attributes, so the backend rollup approach has nothing to roll up FROM. See [§11.4](#114-backend-rollup--code-trace-and-empirical-verification). |

Source: [`summary.md` Phase 7 methodology correction](../ts-sdk-tracing/summary.md), verified empirically across all 8 spike apps; Next.js 16.2.6 re-verification on 2026-05-18 surfaced the parent-AND-child-empty finding that flipped the P-PAGES-VERCEL-01 fix recommendation.

**P-PAGES-VERCEL-01 mechanism (revised).** `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends every still-open span when the Next.js root SERVER span ends. AI SDK v6 `streamText` writes `ai.usage.*` attrs inside `flush()` immediately before `rootSpan.end()`. On Pages Router, `pipeUIMessageStreamToResponse` returns synchronously while the stream is still draining → SERVER span ends FIRST → force-end kills the parent `ai.streamText` → AI SDK's subsequent `setAttributes({ai.usage.*})` no-ops on the ended span (OTel spec). The parent's tokens are dropped. **The original hypothesis was that the child `ai.streamText.doStream` span retained `ai.usage.*` because it fires earlier from the underlying provider call. Empirically (Next 16, 2026-05-18) the child is ALSO empty** — the force-end plausibly fires on it too. Same for the `fetch POST openai.com` grandchild. No span in the trace has tokens to roll up, so the JS-side helper (which owns the writes onto an Agenta-controlled span before any force-end can reach it) is the only viable fix.

**Why the narrow helper is OK to ship and the full wrapper is not.**

1. **AI SDK churn cost.** Wrapping `streamText` ties the package to AI SDK's evolving type signature across v6 → v7 → v8. The Pages Router helper wraps a single response function (`pipeUIMessageStreamToResponse`) whose shape has been stable across AI SDK v3, v4, v5, v6. Different blast radius.
2. **The safe-defaults case is delivered by `init()` alone.** `init()` configures `SimpleSpanProcessor` automatically and handles SDK-REQ-02/03 — see [§5.2](#52-init-semantics). Users get the right defaults on the OTel pipeline they emit into, without needing the wrapper to intercept their `streamText` calls. The full-wrapper's residual wins (single-import ergonomic, abort hardening on partial-stream paths) are catalogued in [§9.3](#93-propagateattributes-decorator-surface-and-the-ai-sdk-lifecycle-wrapper-revisited) as candidate v2 work, gated on demand signal.
3. **Mahmoud's "fewer moving parts" framing still holds for the call-site surface.** 2 of 3 entries are docs-fixable; the 3rd needed exactly one narrow helper at exactly one call site. The package stays at "what only a package can deliver" — edge correctness, plus this one Pages Router file.

**Long-term deprecation path for the helper.** If a future AI SDK release exposes a pre-force-end stream-complete signal, or `@vercel/otel` patches its `CompositeSpanProcessor.onEnd` semantics, the helper becomes unnecessary and we deprecate it cleanly. Until then, it ships.

### 3.2 Edge runtime helper

**Pain entries collapsed into one mechanism:** P-APP-RAW-01, P-PAGES-RAW-01, P-APP-VERCEL-02.

**The common root cause.** Edge runtimes freeze the isolate the moment `Response` returns. The OTLP `fetch` is killed mid-flight unless its promise is enrolled into the runtime's lifetime tracker via `globalThis[Symbol.for("@vercel/request-context")].get().waitUntil(...)`. Raw OTel does not enroll. `@vercel/otel` does, but defaults to `BatchSpanProcessor` with a ~5s scheduled delay — so spans arrive 10-15 seconds after the user's request returns (P-APP-VERCEL-02). Pages Router additionally applies a stricter static dynamic-code-eval analysis that rejects `@opentelemetry/exporter-trace-otlp-http` at `next build` time (P-PAGES-RAW-01) — users on Pages Router edge cannot ship raw OTel at all.

**What the helper does.**

1. Ships an eval-free OTLP exporter bundle that passes both App Router and Pages Router static-dynamic-code-eval checks. (Effectively: re-bundle our exporter through esbuild with `platform: "browser"`, no `eval`, no `Function()`, mirroring Braintrust's per-runtime build pattern — [`competitive-analysis.md` §5](competitive-analysis.md#5-export-model--edge-runtime).)
2. Enrolls the OTLP `fetch` promise into the request-context tracker on root-span open. Same mechanism `@vercel/otel` uses; we apply it on top of `SimpleSpanProcessor` so flush is sub-second instead of 10-15 seconds.
3. Auto-selects the right bundle via conditional `exports` in `package.json` (`edge-light`, `workerd`, `node`, `browser`).
4. Falls back cleanly to the Node bundle on non-Vercel deployments; the request-context enrollment is a no-op when the symbol is absent.

**Out of scope for v1:** TanStack Start edge runtime (P-TANSTACK-02) and Nuxt edge runtime — both require a Nitro preset swap, not a per-route flag. Documented as known gap. v2 ships preset-aware adapters.

### 3.3 What v1 deliberately does NOT include

| Pain entry / capability | Why excluded from v1 | Where it goes |
|---|---|---|
| AI SDK v6 `streamText` / `generateText` full lifecycle wrapper | Considered and rejected — see [§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected). 2 of 3 lifecycle entries are docs-fixable; the 3rd (P-PAGES-VERCEL-01) is fixed by the narrow `agentaPipeUIMessageStreamToResponse` helper in v1 (see [§11.5](#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01); promoted from contingency after Next.js 16 empirical re-verification in [§11.4](#114-backend-rollup--code-trace-and-empirical-verification)). | v2 if footgun-reduction signal or v2 ergonomic surface (`propagateAttributes`, decorator) demands a full-wrapper foothold |
| P-TANSTACK-01 (unenforced `src/server.ts` import order) | Framework adapter — see [§9.1](#91-framework-adapters) | v2.x `@agenta/sdk-tracing/tanstack` |
| P-TANSTACK-03 (`createStartHandler` return shape) | Framework adapter | v2.x `@agenta/sdk-tracing/tanstack` |
| P-NUXT-01 (H3 v2 RC abort signal undefined) | Framework adapter — needs Nuxt-version-aware fallback | v2.x `@agenta/sdk-tracing/nuxt` |
| `propagateAttributes`, decorator helpers, mask function | Python-SDK-parity ergonomics | v2 |
| Prompt cache, datasets, evals, scoring, annotations TS managers | REST-side surface | Separate roadmap; not blocking tracing v1 |
| CLI (`agenta eval`, `agenta push`, `agenta pull`) | Multi-quarter scope; competing-feature analysis only | v2+, behind explicit user demand signal |
| Secrets / Vault / Config manager port from Python SDK | Per user direction in this RFC's brief | v2, separate RFC |
| Browser tracing | Out of scope — no browser entries in the spike's pain log | v3 or never |

The deliberate-exclusion list matters as much as the inclusion list. Anyone shipping work outside it during v1 is scope-creeping the cut.

---

## 4. Backend track — no JS package required

These ship as backend work in parallel with `@agenta/sdk-tracing` v1. They are not blocking and not blocked by the JS work. They benefit Python SDK + raw OTel + AI SDK + Mastra users equally.

### 4.1 Preserve `Resource` attributes (P-NODE-01)

**Today:** OTel `Resource` attributes including `service.name`, `service.version`, `deployment.environment` are dropped by Agenta's OTLP adapter pipeline. There is no documented `ag.*` path they land on.

**Fix:** preserve under `ag.resource.*` namespace at the adapter. Document the path so SDK users (Python and TS) can rely on it for filtering / grouping by service. ~1-2 days of backend work. Same fix benefits every existing customer using OTel `Resource`.

### 4.2 Trace-level metadata cascade (P-NODE-03)

**Today:** AI SDK only attaches `metadata.userId` / `metadata.sessionId` to the parent `ai.streamText` span. Child spans like `ai.toolCall` have no `ag.user.id` — users querying "all spans for user X" miss the tool calls.

**Fix:** at trace ingest completion (or via a periodic enricher), cascade root span's `ag.user.id` and `ag.session.id` to all spans in the same trace. The backend has all spans in the same trace; this is a one-pass enricher, not a JS-side propagation problem.

**Two specs the cascade implementation must nail (added 2026-05-17 after backend consumer audit):**

1. **Write-if-absent semantics.** Cascade must NOT overwrite a child span's `ag.user.id` / `ag.session.id` if already set. Users who manually attach per-tool-call metadata (e.g., different userId per sub-step in an agent workflow) would otherwise have their metadata clobbered. Spec: `if span.ag.user.id is None: write; else: skip`.
2. **Query-semantics change requires release-notes flag.** Today `filter where attributes.ag.user.id = X` returns root spans only. Post-cascade, the same filter returns all spans in matching traces. Impact assessment:
   - **Online evaluations** ([`live.py:472`](../../../api/oss/src/core/evaluations/tasks/live.py:472)): filter by `trace_id`, not `user.id`. Unaffected.
   - **Annotations** ([`annotations/service.py`](../../../api/oss/src/core/annotations/service.py)): store annotator's Agenta-account user_id, not trace metadata. Unaffected.
   - **Trace-list UI**: shows traces (one row per trace). Unaffected by per-span filter behavior.
   - **Metrics endpoint** ([`tracing/service.py:84-94`](../../../api/oss/src/core/tracing/service.py:84)) and any user-built saved query that counts/sums spans by `ag.user.id`: **counts grow post-cascade** because child spans now also match. The new numbers are more accurate (full token/cost attribution per user), but existing dashboards may report different absolute values. Flag in v1 release notes.

**Same pattern handles trace-level cost rollup** (§4.4 below).

### 4.3 Shared `extract_root_span` helper upgrade + eliminate inline duplicates (P-COMMON-01, scope corrected)

**Scope correction (2026-05-17, after backend code read).** Earlier drafts of this section described P-COMMON-01 as a "trace-list UI / render-side promotion" fix. That framing was incomplete. Reading the actual backend code (specifically [`api/oss/src/core/tracing/utils/traces.py`](../../../api/oss/src/core/tracing/utils/traces.py), [`api/oss/src/core/evaluations/tasks/live.py`](../../../api/oss/src/core/evaluations/tasks/live.py), [`api/oss/src/core/annotations/service.py`](../../../api/oss/src/core/annotations/service.py), and [`api/oss/src/core/invocations/service.py`](../../../api/oss/src/core/invocations/service.py)) confirmed the same naive "pick `spans[0]`" pattern is duplicated in 5 places and feeds 4 different consumers — not just the UI.

**Today:** every Next.js spike app shows `POST /api/chat/route` as the trace root in Agenta's UI with empty Inputs/Outputs columns, because Next.js 15's built-in OTel auto-instrumentation buries `ai.streamText` two levels deep under HTTP wrapper spans where the LLM payload actually lives. The shared helper [`extract_root_span`](../../../api/oss/src/core/tracing/utils/traces.py) just returns `spans[0]` — for Next.js-routed traces, that's the wrapper. And at least four other places duplicate the same pattern inline.

**Call sites of the naive "first span" pattern (5 distinct):**

| Location | What it picks | What it feeds |
|---|---|---|
| [`core/tracing/utils/traces.py:97`](../../../api/oss/src/core/tracing/utils/traces.py:97) `extract_root_span` | `spans[0]` | Shared helper — used by `parse_simple_trace` |
| [`core/tracing/utils/traces.py:135`](../../../api/oss/src/core/tracing/utils/traces.py:135) `parse_simple_trace` | Via helper above | Tracing API, annotations, invocations (3 services consume this) |
| [`core/tracing/service.py:677`](../../../api/oss/src/core/tracing/service.py:677) | `return spans[0] if spans else None` | Tracing service internal |
| [`core/evaluations/tasks/live.py:515`](../../../api/oss/src/core/evaluations/tasks/live.py:515) | `list(trace.spans.values())[0]` inline | **Online evaluations — `span_id` passed to evaluator as the input link** |
| [`core/evaluations/tasks/legacy.py:71, 99, 131, 1872`](../../../api/oss/src/core/evaluations/tasks/legacy.py:71) `_extract_root_span` + inline duplicates | `spans[0]` | Legacy evaluation paths |

**Why online evaluations are silently broken today:** [`live.py:515-553`](../../../api/oss/src/core/evaluations/tasks/live.py:515) picks `spans[0]`, captures its `span_id`, and passes it as a link to the evaluator workflow as the input span. For Next.js-routed AI calls, the evaluator receives a `(trace_id, span_id)` pointing at the empty HTTP wrapper. It fetches `ag.data.inputs` / `ag.data.outputs` — both empty, because the LLM payload is on `ai.streamText` two levels deeper. The evaluator either errors with "no inputs to evaluate" or silently scores garbage.

Same shape for annotations: a user attaches an annotation to "a trace" → the system attaches it to `spans[0]` = the wrapper span → the annotation points at an empty span.

**Fix — two parts in one backend PR:**

1. **Upgrade the shared helper.** Rename `extract_root_span` to `extract_primary_span` (or `extract_display_span`) and add LLM-preference logic:

   ```python
   def extract_primary_span(trace: Optional[Trace]) -> Optional[OTelFlatSpan]:
       if not trace or not trace.spans:
           return None
       spans = list(trace.spans.values())
       if not spans:
           return None
       # Prefer LLM-relevant spans when present.
       llm_spans = [s for s in spans if is_llm_relevant(s)]
       if llm_spans:
           return choose_highest_or_earliest(llm_spans)
       # Fall back to current behavior for non-LLM traces.
       return spans[0]
   ```

   `is_llm_relevant(span)` matches on: `instrumentation_scope.name` in `{"ai", "openinference", "litellm", "langsmith", "mastra", "gen_ai.*"}`, OR span name starts with `ai.` or `gen_ai.`, OR span has any attribute under `ai.*` / `gen_ai.*` / `ag.data.inputs` / `ag.data.outputs`.

2. **Eliminate the inline duplicates.** Replace `live.py:515`, `legacy.py:71/99/131/1872`, and any other inline `spans[0]` pattern with calls to the shared helper. The private `_extract_root_span` in `legacy.py` gets deleted. Keep `extract_root_span` as a deprecated alias delegating to `extract_primary_span` to avoid breaking external callers.

**Tree rendering note:** Framework wrapper spans (`POST /api/chat/route`, `BaseServer.handleRequest`, `AppRouteRouteHandlers.runHandler`) still exist in the trace-detail tree view. They render as **collapsed-by-default / muted** so the LLM hierarchy reads cleanly. Clicking expands them for anyone who wants HTTP timing.

**Why this shape:**

- One implementation, all consumers benefit. Online evals, annotations, invocations, trace-list UI — all stop picking the wrapper span on the same day.
- Cleaner than Langfuse's approach. Langfuse's `isDefaultExportSpan` filter ([`packages/otel/src/span-filter.ts:35-39`](https://github.com/langfuse/langfuse-js/blob/main/packages/otel/src/span-filter.ts)) runs only inside `@langfuse/otel` (their JS SDK). P-LANGFUSE-01 confirmed empirically that Langfuse's server (raw OTLP) does NOT filter — same wrapper-span clutter. Doing it backend-side in Agenta means the filter lives in one place and applies to every wire format (Python SDK, raw OTel, AI SDK, Mastra).
- No data loss. Wrapper spans stay queryable. Pure read-side logic, no schema change, no migration, no reindex.

**Open questions a backend PR has to nail (not blockers, implementation review):**

1. **Multi-LLM-span traces.** Agent loops with sibling `ai.streamText` calls — pick the first by start time, or the one with the most descendants? v1 likely picks first-by-time; v2 may show "N LLM calls" as a meta-row.
2. **Annotation persistence.** Annotations created before the fix attach to old `spans[0]`. After the fix, the trace's primary span is different. Old annotations still point at their original span_id (not broken), but the UI may need to show "annotations on non-primary spans" somewhere reasonable.
3. **Manual override attribute.** Should users mark a specific span as the primary via `ag.display.primary = true`? Useful for custom agent frameworks the trusted-scope list doesn't recognize.
4. **Trusted-scope list maintenance.** Where lives the list (config, env, hardcoded)? How does it get updated when a new framework ships?

### 4.4 Cost computation from `gen_ai.usage.*` (D80) + read-time token rollup (general multi-batch gap) — does NOT subsume P-PAGES-VERCEL-01

**Heads up — substantive revision.** Earlier drafts of this section claimed the read-time rollup "subsumes P-PAGES-VERCEL-01." The Next.js 16 re-verification on 2026-05-18 disproved that. The rollup stays in scope as a general-purpose ingest fix, but P-PAGES-VERCEL-01 specifically moves to the JavaScript track. See [§11.4](#114-backend-rollup--code-trace-and-empirical-verification) for the full empirical analysis and [§5.4 / §11.5](#54-edge-runtime-helper--surface) for the JS-side helper that now ships in v1.

**Today:** `ag.metrics.costs = {}` on every span; Agenta has no model-pricing table. Langfuse computes `totalCost = 3.6e-06` at ingest for the exact same `gen_ai.usage.*` payload. Customers building cost dashboards on Agenta have to pull tokens and look up pricing themselves. Separately, P-PAGES-VERCEL-01 lands `ai.streamText` PARENT spans with empty `ag.metrics.tokens` because `@vercel/otel`'s force-end kills the write before AI SDK's `setAttributes({ai.usage.*})` lands.

**Existing infrastructure (verified by reading backend code 2026-05-17 / 2026-05-18).** The backend already has:

- An `incremental → cumulative` tree-walker at [`trees.py:237-437`](../../../api/oss/src/core/tracing/utils/trees.py:237) for both costs (lines 237-315) and tokens (lines 359-437)
- Schema paths `ag.metrics.costs.cumulative.total` and `ag.metrics.tokens.cumulative.total` already read by [`evaluations/service.py:133-137`](../../../api/oss/src/core/evaluations/service.py:133) and the metrics endpoint at [`tracing/service.py:93-94`](../../../api/oss/src/core/tracing/service.py:93)
- An OTLP adapter at [`vercelai_adapter.py:67-75`](../../../api/oss/src/apis/fastapi/otlp/extractors/adapters/vercelai_adapter.py:67) that normalizes `ai.usage.*` → `ag.metrics.unit.tokens.*` per span
- A renamer at [`span_data_builders.py:177`](../../../api/oss/src/apis/fastapi/otlp/extractors/span_data_builders.py:177) that takes `unit.tokens.*` → `tokens.incremental.*`

**The architectural gap (verified by code trace 2026-05-18).** The walker is called from exactly one place: [`service.py:146`](../../../api/oss/src/core/tracing/service.py:146), the ingest pipeline. Grep confirms no read-path invocation. The walker is therefore **batch-scoped at ingest time**. With `SimpleSpanProcessor` (Agenta's recommended export mode), each span ends and exports as its own OTLP request — sibling spans never arrive together. The walker sees one span per batch, can't sum across them, and [`_set_cumulative`'s `tokens != 0` guard](../../../api/oss/src/core/tracing/utils/trees.py:402) skips parents that don't have their own `incremental`. Net result: parents never get `cumulative` populated when their children's tokens live in a separate OTLP batch. **This is a real, generic backend issue that affects more than just P-PAGES-VERCEL-01.**

**What the read-time enricher does (and does not) fix.**

**Does fix:** the general multi-batch case where the trace's spans DO carry `incremental` tokens on at least one descendant, but the walker never saw them together at ingest. Re-running the walker on the assembled trace at read time rolls them up.

**Does NOT fix:** P-PAGES-VERCEL-01 specifically. The Next.js 16 re-verification (2026-05-18, direct Agenta-side queries) showed BOTH parent AND child (`ai.streamText`, `.doStream`, and the underlying `fetch POST openai.com` span) have empty `ag.metrics.tokens.*`. There is no surviving token data anywhere in the trace to roll up FROM. Most plausible mechanism: `@vercel/otel`'s force-end fires on `.doStream` too (which is still open when `pipeUIMessageStreamToResponse` returns synchronously while the OpenAI Responses API stream is still draining), so AI SDK's `setAttributes({ai.usage.*})` lands on an already-ended span and is dropped. See [§11.4](#114-backend-rollup--code-trace-and-empirical-verification) for the full analysis. The fix for that case is the JS-side helper in [§5.4](#54-edge-runtime-helper--surface) (promoted from contingency to v1 deliverable).

**Fix — two parts, both real work:**

1. **Cost computation.** Add a model pricing table keyed by `ai.model.id` (Vercel AI SDK) and `gen_ai.system` + `gen_ai.request.model` (OTel-standard). At ingest, compute `ag.metrics.costs.incremental.{input, output, total}` per LLM-relevant span by multiplying its tokens by the pricing entry. The walker's existing cost rollup pipeline takes it from there. Same per-batch limitation as tokens applies, but cost is computed FROM tokens — so as long as the read-time enricher (part 2) re-runs metrics computation including cost, this is consistent. **Net work: pricing table + per-span `incremental` writer + invocation from the read-time enricher.**

2. **Read-time post-query enricher.** When assembling a trace to return to a consumer (UI, evaluations, annotations, invocations, metrics endpoint), re-run `calculate_and_propagate_metrics` on the full assembled span set:

   ```python
   # tracing/service.py — example shape for the query path
   spans = await self.tracing_dao.fetch_trace(trace_id=trace_id, ...)
   spans = cascade_metadata(spans)                  # §4.2 cascade
   spans = calculate_and_propagate_metrics(spans)   # NEW: re-run walker at read time
   return spans
   ```

   The walker is already idempotent: re-running it on a trace whose spans already have `cumulative` set just re-writes the same values. For traces where parents are missing `cumulative` because the per-batch ingest race split spans across separate OTLP requests, the read-time walker now sees the assembled tree and rolls up correctly. Generic multi-batch fix; benefits any future framework or streaming pattern that causes batch splits.

**Cost: per-query DFS over the trace's spans.** Typically cheap (small traces). For very large agent traces, opt-in via a query flag (e.g. `?include_rollup=false`) if it ever becomes a hotspot.

**Alternatives considered:**

- **Trace-finalization pass at ingest** (async background job when "trace is complete"). Needs a heuristic for completeness + async infrastructure. Defer to v2 if read-time DFS becomes expensive.
- **Server-side batching before walker** (buffer N ms server-side). Reintroduces latency, defeats SimpleSpanProcessor's "ship immediately" advantage. Not recommended.

**Verification status:** the multi-batch failure is confirmed by reading code. The spike test [`nextjs-pages-router-vercel/test/test-assertion-1.ts`](../../../web/examples/nextjs-pages-router-vercel/test/test-assertion-1.ts) queries `cumulative.prompt` on the parent and is currently FAILING on Next.js 16. With the read-time enricher in place, multi-batch failures of this shape will pass; **P-PAGES-VERCEL-01 specifically will continue to fail until §5.4's JS-side helper ships** (because the empirical evidence shows no descendant has tokens to roll up either). The two fixes are complementary, not alternatives.

**Empirical baseline:** [`sdk-comparison.md` § Tokens and cost: three backends, three different transformations](../ts-sdk-tracing/sdk-comparison.md#tokens-and-cost-three-backends-three-different-transformations). Verified per-span output for the same wire data on all three backends. Langfuse goes further with model-alias resolution (`gpt-4o-mini` → `gpt-4o-mini-2024-07-18` for historical accuracy) — fold that in if low cost.

### 4.5 Sequencing

These four are independent and can land in parallel. Recommended order (smallest blast radius first): P-NODE-01 (additive — new namespace, no existing field changes) → cost computation (additive — new fields, no breaking changes) → P-COMMON-01 shared-helper upgrade (touches more files than the others — shared helper plus 4 inline-duplicate call sites — but each call-site change is mechanical; no API breakage) → P-NODE-03 enricher (new attribute writes on existing spans — backward-compatible).

None of these blocks `@agenta/sdk-tracing` v1. The JS package ships against current backend behavior; backend improvements add value over time.

---

## 5. `@agenta/sdk-tracing` v1 — surface design

Approach B+, the narrowest defensible cut. Ships **two** narrow mechanisms: an edge runtime helper ([§3.2](#32-edge-runtime-helper)) and `agentaPipeUIMessageStreamToResponse` for Pages Router ([§11.5](#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01)). The full lifecycle wrapper was considered and rejected — see [§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected) and [§12.2](#122-approach-b--adopted-v1-ships-edge-helper-only-no-lifecycle-wrapper). The helper is narrow enough (one Pages-Router-only response function with stable shape across AI SDK v3-v6) that it does not slip into the lifecycle-wrapper failure mode.

### 5.1 Surface

```ts
// Single import path covers v1 surface.
import {
  init,                            // configure host/apiKey/projectId (SDK-REQ-01/02/03); picks Simple, auto-registers edge bundle on edge runtimes
  getAgentaTracer,                 // returns the OTel Tracer the SDK uses (escape hatch)
  setAgentaTracerProvider,         // for users on @vercel/otel with isolated TracerProvider
  getTraceUrl,                     // returns https://<host>/observability/traces/<traceId> for the active span
  agentaPipeUIMessageStreamToResponse, // Pages Router helper; fixes P-PAGES-VERCEL-01 (§11.5)
} from "@agenta/sdk-tracing"
```

**That is the entire v1 export sheet.** No `streamText` wrapper. No `generateText` wrapper. No `withAgentaLifecycle`. No `propagateAttributes`. No `instrument` decorator. No `startSpan` / `startActiveSpan` re-exports (users can import those from `@opentelemetry/api` directly if they need imperative spans). No `Span` wrapper class. No mask function. No media extraction.

Users keep their existing AI SDK imports unchanged: `import { streamText } from "ai"`. Our `init()` configures the OTel pipeline they emit into. Users get safe defaults (Simple processor, edge bundle auto-selected via conditional exports, correct OTLP URL, `?project_id=` propagation, `host` normalization) without any per-call import change. Pages Router users on `@vercel/otel` swap one response call (`result.pipeUIMessageStreamToResponse(res)` → `agentaPipeUIMessageStreamToResponse(result, res)`) to fix P-PAGES-VERCEL-01.

### 5.2 `init()` semantics

```ts
init({
  host: string,                    // SDK-REQ-02: origin only; SDK appends /api itself
  apiKey: string,
  projectId?: string,              // SDK-REQ-03: propagated to OTLP URL as ?project_id=<uuid>
  debug?: boolean,                 // gated debug logger; default false
  spanProcessor?: SpanProcessor,   // escape hatch — pass your own (e.g. BatchSpanProcessor)
  exporter?: SpanExporter,         // escape hatch — pass your own
})
```

**Defaults:**

- `SimpleSpanProcessor` wrapping our OTLP HTTP exporter pointed at `${host}/api/otlp/v1/traces?project_id=${projectId}` with `Authorization: ApiKey ${apiKey}`. SimpleSpanProcessor avoids P-NODE-02 / P-APP-VERCEL-01 by construction. Users who explicitly want batched export pass `spanProcessor: new BatchSpanProcessor(...)` — they own that decision and are warned in docs ([`vercel-ai-sdk/observability.mdx`](../../docs/docs/integrations/frameworks/vercel-ai-sdk/observability.mdx)) that streamText spans can be lost on mid-stream abort with Batch.
- `Resource` attributes initialized from env-prefix scan (`OTEL_RESOURCE_ATTRIBUTES`) + an `agenta.sdk.{name, version}` pair we always set.

**State storage:** `globalThis[Symbol.for("agenta-tracing-state")]` (Braintrust pattern, [D3 in competitive-analysis](competitive-analysis.md#21-rfc-decisions-for-agenta)). Survives monorepo dev-mode duplicate-package loads and Next.js dev rebuilds. Trivial cost; eliminates an entire category of "tracing stopped working when I added a workspace" bugs.

### 5.3 `getTraceUrl()`

One of the highest-leverage UX wins documented in [`sdk-comparison.md` § Trace URL surfacing to the client](../ts-sdk-tracing/sdk-comparison.md#ergonomic-by-ergonomic-six-implementations-side-by-side) — both Langfuse and Braintrust have it; AI SDK + raw OTel users hand-roll it (none of the 8 spike apps does).

```ts
import { getTraceUrl } from "@agenta/sdk-tracing"

// inside a route handler / streaming response
const url = getTraceUrl() // → https://cloud.agenta.ai/observability/traces/<traceId>
// emit as SSE data-trace event, log it, attach to error, etc.
```

Reads the active OTel span's trace ID, builds the URL from the init'd host. One helper, ~10 lines, dramatically improves debug UX. The Python `examples/python/RAG_QA_chatbot/` pattern in production today demonstrates the user-facing impact.

### 5.4 Edge runtime helper — surface

This is the centerpiece of v1. See [§3.2](#32-edge-runtime-helper) for the mechanism rationale.

```ts
// app/api/edge-chat/route.ts (App Router edge)
export const runtime = "edge"

import { init } from "@agenta/sdk-tracing"
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"

init({ host, apiKey, projectId }) // detects edge runtime via conditional exports; uses eval-free bundle + waitUntil enrollment

export async function POST(req: Request) {
  const result = streamText({ model: openai("gpt-4o-mini"), messages: [...], abortSignal: req.signal, experimental_telemetry: { isEnabled: true } })
  return result.toUIMessageStreamResponse()
}
```

One `init()` call. Users keep AI SDK imports unchanged. Package's conditional `exports` ([§7.2](#72-conditional-exports)) auto-selects the edge bundle. Edge bundle internally registers an `OTLPTraceExporter`-equivalent that:

1. Uses `fetch` directly (no XMLHttpRequest, no `eval`, no `Function()` — passes Pages Router edge build).
2. On root-span open, enrolls its eventual flush promise into `globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil?.(...)` if the symbol is present (Vercel edge). No-op fallback for non-Vercel edge (Cloudflare Workers, Deno Deploy via Vercel-runtime-shim if present, otherwise direct flush).
3. Uses `SimpleSpanProcessor` so flush is sub-second (not 10-15 seconds like `@vercel/otel`'s Batch default — P-APP-VERCEL-02).

### 5.5 Conformance to inherited SDK requirements

| Requirement | Implementation |
|---|---|
| SDK-REQ-01 (built `dist/` from day one) | `package.json` `main`/`module`/`types` point at `dist/`; `prepare` script runs `tsc -p tsconfig.json`. Mirrors `@agenta/sdk` pattern. |
| SDK-REQ-02 (`host` accepts origin only) | `init({host})` normalizes via a tiny helper: if host doesn't end in `/api`, append `/api` for REST paths; OTLP URL is `${normalizedHost}/otlp/v1/traces`. Accept both `https://cloud.agenta.ai` and `https://cloud.agenta.ai/api`. |
| SDK-REQ-03 (`projectId` propagates) | OTLP exporter URL constructed as `${host}/api/otlp/v1/traces?project_id=${projectId}` at init time. Future trace metadata API also threads `?project_id=` on every request. |

### 5.6 Conformance to backend track

The JS SDK does not need to know about backend track work to ship. Backend-side fixes ([§4](#4-backend-track-no-js-package-required)) improve the UX for both `@agenta/sdk-tracing` users and raw-OTel users transparently. No JS-side flag, no version gate.

### 5.7 Bundle target & dependencies

**Peer dependencies** (user must install separately):

- `@opentelemetry/api` — peer.
- `@opentelemetry/sdk-trace-node` — peer (Node-runtime users only; auto-picked by conditional exports).

**No peer dependency on `ai`.** Because v1 does not wrap `streamText` / `generateText`, the package is AI-SDK-agnostic. Users on AI SDK v6, v7, or any future major version interact with the package only via `init()` and `getTraceUrl()` — neither of which touches AI SDK types. This is one of the primary advantages of the B+ cut over a wrapper-based approach.

**Direct dependencies:**

- `@opentelemetry/sdk-trace-base` (for `SimpleSpanProcessor` re-export).
- `@opentelemetry/exporter-trace-otlp-http` (for Node; edge bundle ships its own minimal fetch-based exporter inline).
- `@agentaai/api-client` (workspace) — for the trace URL helper to read project metadata if we end up needing it. Open: may not be strictly needed in v1; revisit at implementation. If not needed, drop and use plain `fetch`.

**Bundle size target:** Node ESM bundle ≤ 50 KB minified (excluding peers). Edge bundle ≤ 20 KB. These are budgets, not commitments; revisit after first ship.

### 5.8 Telemetry / debug logging

Silent by default. `init({debug: true})` or env `AGENTA_DEBUG=1` enables a namespaced debug logger that surfaces:

- OTLP export failures (P-BRAINTRUST-01 lesson: do not let exporter HTTP errors disappear into stderr).
- Edge runtime detection result (which conditional `exports` bundle was selected).
- The fact that init was called, with normalized `host` / `projectId`.

Debug output goes to `stderr` via `console.warn`; no `pino` / `winston` / etc. dependency added.

---

## 6. `@agenta/sdk-mastra` v1 — separate package

Mastra is not OTel. Its `ObservabilityBus` emits `AGENT_RUN` / `MODEL_GENERATION` / `MODEL_STEP` / `MODEL_CHUNK` events to a Mastra-specific event bus, not to OTel ([P-MASTRA-02](../ts-sdk-tracing/pain-log.md)). Its vendored AI SDK v1 returns `noopTracer` by default and the user-facing `agent.generate()` / `agent.stream()` API does not expose `experimental_telemetry.isEnabled` to flip it ([P-MASTRA-01](../ts-sdk-tracing/pain-log.md)). The two integration points — OTel-based and Mastra-bus-based — do not overlap.

**Therefore:** `@agenta/sdk-mastra` is a separate package shipping the spike's `AgentaMastraExporter` (live at [`web/examples/mastra-node/src/agenta-exporter.ts`](../../../web/examples/mastra-node/src/agenta-exporter.ts), 190 lines / ≈120 executable + doc block, 4/4 spike assertions passing). It is structurally a Mastra `BaseExporter` subclass, not an OTel `SpanProcessor`. Implementation note grounded from the source: the exporter assigns OTel-generated trace and span IDs (Mastra's IDs don't propagate, because the OTel SDK doesn't expose a "use these specific IDs" hook). It maintains a Mastra-id → OTel-span map so child spans can find their parent's OTel context. The trace tree shape is preserved; only the identifiers differ.

### 6.1 Surface

```ts
import { Mastra } from "@mastra/core"
import { AgentaMastraExporter } from "@agenta/sdk-mastra"

const mastra = new Mastra({
  agents: { ... },
  observability: {
    default: { enabled: false }, // avoid Mastra's bus-internal stack
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

The exporter subscribes to Mastra's `TracingEvent` bus, translates each event into the `ag.*` attribute shape, and ships via the same OTLP wire as `@agenta/sdk-tracing` — landing alongside any AI SDK traces from non-Mastra code paths in the same Agenta project. Mastra's per-call metadata path is `tracingOptions.metadata` (P-MASTRA-03) — the exporter normalizes this so users get `ag.user.id` / `ag.session.id` consistent with the AI SDK path.

### 6.2 Why separate package (not subpath of `@agenta/sdk-tracing`)

- Different dependency footprint. `@agenta/sdk-mastra` peer-depends on `@mastra/core` and `@mastra/observability`. Bundling those into `@agenta/sdk-tracing` would force users who don't use Mastra to pay the install cost.
- Different integration shape (`BaseExporter` subclass vs OTel SpanProcessor). Independent versioning lets Mastra's SDK churn at its own cadence without breaking `@agenta/sdk-tracing` consumers.
- The two packages CAN coexist in one app. Users running Mastra agents + direct AI SDK calls install both; spans from both paths land in the same Agenta project.

### 6.3 Migration path to backend-led ingest (non-breaking)

[`summary.md` § Strategic alternative: backend-led integration](../ts-sdk-tracing/summary.md#strategic-alternative-backend-led-integration) describes a future where Agenta's backend ingests Mastra-shaped payloads at a dedicated endpoint (`/api/mastra/v1/spans` or similar) and the JS-side exporter slims to a thin POST-the-raw-events shape. **That is a non-breaking migration** — same JS install, swap one import path, backend semantic-mapping moves server-side. The v1 JS-side exporter validates that Mastra users will accept an Agenta integration before we commit backend work to the alternative shape.

### 6.4 What v1 does NOT include for Mastra

- `@agenta/sdk-mastra/observability` middleware-level integration with Mastra's workflow primitives — v2.
- LangChain TS adapter (different ecosystem; separate `@agenta/sdk-langchain` if/when demand exists).
- Genkit adapter — same.

---

## 7. Package shape & dependencies

### 7.1 Package map

| Package | Status | Workspace path | Public API |
|---|---|---|---|
| `@agentaai/api-client` | Existing (on `main`) | `web/packages/agenta-api-client/` | Fern-generated REST client |
| `@agenta/sdk` | Existing (on `main`) | `web/packages/agenta-sdk/` | Thin convenience wrapper over Fern client (`init`, `traces.querySpans`, etc.) |
| `@agenta/sdk-tracing` | **New, v1, this RFC** | `web/packages/agenta-sdk-tracing/` (currently empty) | [§5](#5-agentasdk-tracing-v1--surface-design) |
| `@agenta/sdk-mastra` | **New, v1, this RFC** | `web/packages/agenta-sdk-mastra/` (currently empty) | [§6](#6-agentasdk-mastra-v1--separate-package) |
| `@agenta/sdk-ai` | **NOT shipped in v1** — directory exists empty | `web/packages/agenta-sdk-ai/` | Deleted or marked reserved. v2+ may revisit if a higher-level "AI" surface emerges above lifecycle wrapper. |

The empty `agenta-sdk-ai`, `agenta-sdk-tracing`, `agenta-sdk-mastra` directories in this worktree are placeholder scaffolding from prior exploration and have nothing committed. v1 implementation populates `agenta-sdk-tracing` and `agenta-sdk-mastra`. `agenta-sdk-ai` is deleted unless someone has an explicit v1 use for it (none in this RFC).

### 7.2 Conditional exports

Both new packages declare conditional exports for runtime targeting (Braintrust pattern, [`competitive-analysis.md` §1](competitive-analysis.md#1-package-layout--install-surface)):

```jsonc
// @agenta/sdk-tracing/package.json
{
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "exports": {
    ".": {
      "edge-light": "./dist/edge-light.mjs",
      "workerd":    "./dist/workerd.mjs",
      "node":       { "import": "./dist/index.mjs", "require": "./dist/index.cjs" },
      "browser":    "./dist/browser.mjs",
      "types":      "./dist/index.d.ts"
    }
  }
}
```

- `engines: node >= 20` matches Langfuse's tracing/otel packages — Node 18 EOL'd, AI SDK v6 already requires modern Node.
- `sideEffects: false` declared for tree-shaking. Verified by audit before each release that no module-top-level mutations leak.
- Four runtime bundles: `node`, `edge-light` (Vercel Edge Functions), `workerd` (Cloudflare Workers), `browser` (fallback — no tracing implementation in v1; tree-shakes to near-zero). Browser bundle exists only so bundlers don't error on `import "@agenta/sdk-tracing"` from client code; runtime behavior is no-op.

### 7.3 Dependency rules

- Tracing package depends on `@opentelemetry/*` peers + `@agentaai/api-client` (TBD, see [§5.9](#59-bundle-target--dependencies)).
- Mastra package depends on `@mastra/core` + `@mastra/observability` peers. Does NOT depend on `@agenta/sdk-tracing`; both packages share the OTLP wire format but not code.
- Neither package depends on `@agenta/sdk` directly. The convenience client is for REST-side users; tracing users may or may not need it. If they want to query spans they've emitted (e.g., for assertion-style verification, the way `@agenta/spike-verify` does), they install both — they're orthogonal.

### 7.4 Build & release

- `tsup` (or `tsc + esbuild`) — TBD at implementation; both work. Match the rest of `web/packages/*`.
- Independent semver per package. `@agenta/sdk-tracing` and `@agenta/sdk-mastra` start at `0.1.0`. They are not tied to `@agentaai/api-client` (`0.99.x`) or `@agenta/sdk` (`0.0.0-dev` until first release) versioning.
- Release cadence: aligned with backend Agenta releases for v1 (so SDK doesn't ship features the backend doesn't yet receive). v2 may decouple.

---

## 8. Integration points — what the v1 user wires

### 8.1 Node + AI SDK v6 (Phase 1 spike app shape)

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
    metadata: { userId: "u1", sessionId: "s1" }, // backend §4.3 cascade promotes these to ag.user.id / ag.session.id on every span in the trace
  },
})
for await (const chunk of result.textStream) { /* ... */ }
```

That's it. No `NodeTracerProvider`, no `OTLPTraceExporter`, no `SimpleSpanProcessor`, no `Resource` boilerplate. Compare to the Phase 1 spike app's [`instrumentation.ts`](../../../web/examples/node-vercel-ai-v6/src/instrumentation.ts) which is **141 lines** including optional Braintrust/Langfuse tri-export wiring and per-app sentinels (≈50-70 lines for a minimal Agenta-only equivalent). AI SDK imports are unchanged — only the OTel pipeline setup is owned by `init()`. Spike-app line counts across the full matrix: 99-141 lines (Node, Next.js, TanStack, Nuxt), with the Mastra app at 70 lines because it imports the 190-line `AgentaMastraExporter` separately.

### 8.2 Next.js App Router (Phase 2 spike app shape)

Two files needed:

```ts
// instrumentation.ts (Next.js auto-registers this)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { init } = await import("@agenta/sdk-tracing")
    init({
      host: process.env.AGENTA_HOST!,
      apiKey: process.env.AGENTA_API_KEY!,
      projectId: process.env.AGENTA_PROJECT_ID,
    })
  }
}

// app/api/chat/route.ts
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"

export async function POST(req: Request) {
  const result = streamText({
    model: openai("gpt-4o-mini"),
    messages: [...],
    abortSignal: req.signal,
    experimental_telemetry: { isEnabled: true },
  })
  return result.toUIMessageStreamResponse()
}
```

Edge route works the same way; the conditional export auto-picks the edge bundle. AI SDK imports unchanged.

**Known v1 gap (documented):** P-COMMON-01 — until the backend track ([§4.3](#43-shared-extract_root_span-helper-upgrade--eliminate-inline-duplicates-p-common-01-scope-corrected)) ships, the Next.js HTTP wrapper-span shows as the trace-list row in Agenta's UI, AND online evaluations / annotations / invocations all attach to it instead of the LLM call. The data is present and queryable in raw form; what's broken is which span the system picks as "root". SDK users see all four fixes transparently once backend lands.

### 8.3 Next.js Pages Router (Phase 3 spike app shape)

Identical to App Router for the instrumentation.ts setup. Edge route now BUILDS (where raw OTel failed P-PAGES-RAW-01) because our edge bundle is eval-free. As of Next.js 16 + Turbopack, P-PAGES-RAW-01 is additionally fixed at the framework level — Turbopack's static analysis no longer rejects raw OTel imports — but the runtime tracing problem (edge isolate freezes before flush) persists; our edge bundle still solves it.

**Pages Router + `@vercel/otel` users**: swap one call to fix P-PAGES-VERCEL-01:

```ts
// pages/api/chat.ts
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
}
```

Drop-in replacement for `result.pipeUIMessageStreamToResponse(res)`. Owns the `gen_ai.usage.*` / `ag.metrics.tokens.*` writes onto an Agenta-controlled span before `@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-end fires. See [§11.5](#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01) for design rationale and [§11.4](#114-backend-rollup--code-trace-and-empirical-verification) for the Next.js 16 empirical re-verification that promoted this from contingency to v1.

### 8.4 TanStack Start (Phase 4 spike app shape) — v1 has a known footgun

In v1, TanStack Start users wire `@agenta/sdk-tracing` the manual way:

```ts
// src/server.ts — instrumentation MUST be first import
import "@agenta/sdk-tracing/register"  // <-- side-effect init; reads env

// ...rest of TanStack server setup
```

This still has P-TANSTACK-01 (auto-formatter reorders the import → tracing silently disabled). **v1 ships docs with the warning** and a code-comment template; v2 ships `@agenta/sdk-tracing/tanstack` which wraps `createStartHandler` invariant-by-construction. The Mahmoud-style alternative — "document it" — works for now because TanStack is small framework share; the wedge isn't worth a v1 package on its own.

### 8.5 Nuxt 4 (Phase 5 spike app shape) — v1 has a known footgun

Users wire a Nitro plugin:

```ts
// server/plugins/agenta.ts
import { init } from "@agenta/sdk-tracing"

export default defineNitroPlugin(() => {
  init({
    host: process.env.AGENTA_HOST!,
    apiKey: process.env.AGENTA_API_KEY!,
    projectId: process.env.AGENTA_PROJECT_ID,
  })
})
```

P-NUXT-01 (mid-stream abort doesn't propagate due to H3 v2 RC's undefined `event.req.signal`) is **not solved in v1** — and the B+ cut means there is no JS-side wrapper that could intercept it from our side regardless. v1 docs flag this as known and recommend pinning H3 to a version where `event.node.req` close events fire reliably, or accepting the cost of late-arriving spans on abort. v2 ships `@agenta/sdk-tracing/nuxt` with version-aware abort-signal fabrication.

### 8.6 Mastra (Phase 6 spike app shape) — `@agenta/sdk-mastra`

Covered in [§6.1](#61-surface). One exporter registration in the Mastra config; everything else flows through Mastra's `tracingOptions.metadata` API ([P-MASTRA-03](../ts-sdk-tracing/pain-log.md)) which the exporter translates to `ag.user.id` / `ag.session.id`.

### 8.7 Multi-backend fan-out (Phase 7/8 spike app shape)

Out of scope for v1. The tri-export pattern documented in [`sdk-comparison.md`](../ts-sdk-tracing/sdk-comparison.md) works today with raw OTel — users who want fan-out add their own additional `SpanProcessor`s alongside our default. The SDK doesn't have to mediate this. v2 may add an opinionated `init({destinations: [...]})` API if user demand emerges; not before.

---

## 9. v2+ roadmap

The narrow v1 is sized to the smallest defensible cut. Approach A's full surface is the v2+ trajectory. This section catalogues every deferred item with its trigger condition — "what evidence justifies promotion from v2-roadmap to v2-committed."

### 9.1 Framework adapters

**v2.x ships:** `@agenta/sdk-tracing/next`, `@agenta/sdk-tracing/tanstack`, `@agenta/sdk-tracing/nuxt`.

**What each does:**

- `/next` — registers via `instrumentation.ts` with no manual `register()` boilerplate. Mostly cosmetic; the dominant `instrumentation.ts` shape is already minimal. Adds value if we ship `setAgentaTracerProvider(provider)` for users on `@vercel/otel`'s isolated `TracerProvider` (Langfuse pattern, [`competitive-analysis.md` §2](competitive-analysis.md#2-initialization--state-model)).
- `/tanstack` — wraps `createStartHandler` so instrumentation is invariant-by-construction (fixes P-TANSTACK-01 and P-TANSTACK-03 by wrapping both seams). High impact; small package.
- `/nuxt` — Nitro plugin + version-aware abort-signal fabrication (fixes P-NUXT-01).

**Trigger condition:** any one of: (a) ≥3 unique users file an issue tied to the documented footgun for a given framework, (b) framework reaches >5% of `@agenta/sdk-tracing` downloads, (c) we want to publish that framework as a supported integration in marketing.

### 9.2 Per-provider wrappers

**v2+ may ship:** `@agenta/sdk-tracing/openai`, `/anthropic`, `/google-genai`, etc. — Braintrust's pattern of 13 explicit provider proxies.

**Default position is no.** AI SDK v6 already emits OTel via `experimental_telemetry: {isEnabled: true}`. Per-provider wrappers add value only if a specific provider routes around AI SDK (e.g., users calling OpenAI SDK directly bypass `streamText`).

**Trigger condition:** measured DX gap — concrete user requests for "I'm calling X provider's SDK directly without AI SDK and want Agenta traces." Until then, AI SDK is the choke point; we wrap that.

### 9.3 `propagateAttributes`, decorator surface, AND the AI SDK lifecycle wrapper revisited

**v2 ships (subject to trigger conditions):**

- **Langfuse-style `propagateAttributes(callback)` HOF** that sets attributes on the current active span AND OTel context so future child spans inherit.
- **Functional decorator** (`instrument("name", asyncFn)`) that auto-captures inputs/outputs to `ag.data.*` (mirroring Python SDK's `@ag.instrument()` ergonomic).
- **AI SDK v6 lifecycle wrapper** (revisited from [§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected) v1 rejection) — if post-v1 usage shows the docs-fixable lifecycle entries remain a real source of support tickets (users following Vercel/Mastra docs in isolation, not finding Agenta's `SimpleSpanProcessor` note), the wrapper returns as a footgun-reduction vehicle. The decorator + `propagateAttributes` surface also benefits from a wrapper foothold for ergonomic consistency.

**Why deferred (all three):** v1 users can use `@opentelemetry/api` directly for custom spans, and Agenta's docs prescribe the safe processor — they're not blocked. The ergonomic gap is real (catalogued in [`sdk-comparison.md` § Ergonomic-by-ergonomic](../ts-sdk-tracing/sdk-comparison.md#ergonomic-by-ergonomic-six-implementations-side-by-side)) but not silent-failure shaped. The lifecycle wrapper's residual value (footgun reduction + abort hardening on partial-stream paths) is real but soft.

**Trigger conditions:**

- `propagateAttributes` / decorator: v1 ships, gathers feedback for one quarter, and these surface as top reported friction.
- Lifecycle wrapper (full `streamText` / `generateText` wrap): post-v1 ≥3 unique support requests in the first quarter for users hitting P-NODE-02 / P-APP-VERCEL-01 because they followed Vercel/Mastra docs without finding Agenta's processor note. (Note: the narrow `agentaPipeUIMessageStreamToResponse` Pages Router helper already ships in v1 — see [§5.4](#54-edge-runtime-helper--surface) and [§11.5](#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01). The trigger above is for the broader `streamText` wrapper that was rejected from v1.)

### 9.4 Mask function

**v2 ships:** async-aware mask function with six attribute slots (input/output/metadata × trace/observation), sentinel on throw, applied before media extraction. Langfuse pattern, [`competitive-analysis.md` §5](competitive-analysis.md#5-export-model--edge-runtime).

**Why deferred:** PII / secret masking is high-stakes — needs careful API design (sync vs async, error handling, audit logging when masking fires) and a real use case driving it. Hand-rolling a `SpanProcessor` filter on top of v1 is viable for users who need it sooner.

### 9.5 Python-SDK parity surface

**v2+ ships (separate RFCs per surface):**

- Prompts (`@agenta/sdk-prompts` or `@agenta/sdk` subpath) — SWR cache, plugin templating, build() returning LLM request shape ([`competitive-analysis.md` §6](competitive-analysis.md#6-prompts)).
- Datasets — `AsyncIterable` + cursor + `link()` for trace stitching ([`competitive-analysis.md` §7](competitive-analysis.md#7-datasets--testsets)).
- Evals — `Eval(name, opts)` with rolling concurrency + content-addressed item IDs ([`competitive-analysis.md` §8](competitive-analysis.md#8-evals--experiments)).
- Scoring — 5 data types + fire-and-forget queue with overflow hook ([`competitive-analysis.md` §9](competitive-analysis.md#9-scoring--feedback)).
- Annotations — high-level manager wrapping raw API ([`competitive-analysis.md` §11](competitive-analysis.md#11-annotations--queues)).
- Sessions / users / propagation — first-class API (D45-D50, [`competitive-analysis.md` §21](competitive-analysis.md#21-rfc-decisions-for-agenta)).
- CLI — `eval` / `push` / `pull` ([`competitive-analysis.md` §14](competitive-analysis.md#14-cli--developer-workflow)) — explicitly behind demand signal; not assumed.

**Why deferred (all of these):** they are the Python SDK's surface area. Per the user direction in the brief, the v1 cut is "surface design, package shape, integration points, v1 cut" with secrets/config manager port explicitly deferred. The full Python-SDK parity exercise is a separate planning effort that the RFC explicitly does NOT commit to as a v1 gate. Each gets its own RFC when prioritized.

### 9.6 Multi-backend delivery health surfacing

**v2 may ship:** explicit per-destination health-ping + warning log on first delivery failure + opt-in metrics callback. Direct response to P-BRAINTRUST-01 ([`competitive-analysis.md` §22](competitive-analysis.md#22-differentiation-opportunities-ranked-by-leverage) #3).

**Why deferred:** v1 SDK targets one destination (Agenta). Multi-backend fan-out is the user's existing OTel SpanProcessor setup, not something we mediate yet. Surfaces only when v2 grows `init({destinations: [...]})`.

### 9.7 Browser tracing

**Probably never.** No browser entries in the spike's pain log; the user-facing AI calls happen on server-side handlers. Browser-side tracing would need fundamentally different design (no async-local-storage, different export path, CORS). Reopens only on explicit customer demand.

---

## 10. Migration story

### 10.1 From current state (raw OTel + `@agenta/sdk`)

Users currently wiring tracing follow the v4 published example [`examples/node/observability-vercel-ai/`](../../../examples/node/observability-vercel-ai/) — roughly 50-70 lines of raw OTel boilerplate in `instrumentation.ts` for a minimal Agenta-only setup, or 99-141 lines if they're following the spike apps' richer pattern (which adds optional tri-export to Braintrust/Langfuse + per-app sentinels). Migration to `@agenta/sdk-tracing` v1:

1. `npm install @agenta/sdk-tracing` (or `pnpm add`).
2. Replace the entire OTel block in `instrumentation.ts` with a single `init({host, apiKey, projectId})` call.
3. **AI SDK imports stay unchanged.** Users keep `import { streamText } from "ai"` and `experimental_telemetry: {isEnabled: true, metadata: {...}}`. No call-site rewrites.
4. Per-call `experimental_telemetry.metadata.{userId, sessionId}` continues to work; the backend §4.3 cascade enricher promotes these to `ag.user.id` / `ag.session.id` on every span in the trace.

**Net diff:** about -60 lines in `instrumentation.ts`, +1 import + +1 `init()` call. **Zero per-call changes.** No backend changes required for v1. Old apps continue to work unchanged (raw OTel + OTLP path is unaffected).

### 10.2 From the v4 Python `agenta` SDK (out of scope)

JS users coming from the Python SDK get a familiar `init()` in v1 (no decorator, no `propagateAttributes`, no `store_internals`). Full Python-SDK ergonomic parity is v2 ([§9.3](#93-propagateattributes-decorator-surface-and-the-ai-sdk-lifecycle-wrapper-revisited)). Documented as known gap.

### 10.3 Backward compatibility commitments

- v1 → v2 migration MUST be additive: no breaking removals from the v1 surface within the v2 series. v1.x = stable.
- v1 surface marked `@stable` in JSDoc. v2-only surface marked `@experimental` until at least one minor release stabilizes it.
- Migration notes live in `MIGRATION.md` alongside `CHANGELOG.md` (D75, [`competitive-analysis.md` §21](competitive-analysis.md#21-rfc-decisions-for-agenta)).

---

## 11. Open questions

These are deferred to implementation review or follow-up RFCs. None block v1 kickoff. The §4.4 backend read-time enricher is real work but additive (no breaking changes); §11.5 is no longer a contingency — empirical re-verification on Next.js 16 (2026-05-18) promoted `agentaPipeUIMessageStreamToResponse` to a v1 deliverable as the only viable fix for P-PAGES-VERCEL-01.

### 11.1 `@agenta/sdk` and `@agenta/sdk-tracing` interaction

Should `@agenta/sdk-tracing`'s `init()` also configure `@agenta/sdk`'s `init()` if both are installed? Convenience vs hidden coupling. Today they're independent (each takes its own `host` / `apiKey`). Keep independent in v1; revisit if user surveys show this is a friction point.

### 11.2 OTLP endpoint path

Currently: `/api/otlp/v1/traces?project_id=<uuid>`. Spike apps confirm this works. Open: should v1 SDK accept an `otlpPath` override for users on self-hosted Agenta with non-default routing? Recommend yes; default to `/api/otlp/v1/traces` for cloud.

### 11.3 Telemetry of the SDK itself

`@agenta/sdk-tracing` could send anonymized usage metrics (SDK version, runtime, frameworks detected) back to Agenta for product analytics. Standard for vendor SDKs; controversial for some users. Recommend default off, env opt-in (`AGENTA_TELEMETRY=1`).

### 11.4 Backend rollup — code trace and empirical verification

**Position has shifted.** Earlier drafts said "the read-time enricher subsumes P-PAGES-VERCEL-01." The Next.js 16 re-verification on 2026-05-18 disproved that. This section now documents both the original hypothesis (kept for audit trail) and the empirical finding that flipped the recommendation.

**Original hypothesis (Next 15.5.15 spike, verified by code trace 2026-05-17):**

1. **AI SDK emits `.doStream` child first** (ends when the OpenAI/Anthropic call completes, carrying `ai.usage.*`). Then tries to write `ai.usage.*` to the `ai.streamText` parent. **`@vercel/otel`'s `CompositeSpanProcessor.onEnd` force-ends the parent before that write lands.**

2. **`SimpleSpanProcessor` (Agenta-recommended) exports each ended span as its own OTLP request.** So `.doStream` arrives at Agenta in one HTTP request, `ai.streamText` parent in another. They never travel together.

3. **OTLP ingest normalizes the child correctly.** [`vercelai_adapter.py:67-75`](../../../api/oss/src/apis/fastapi/otlp/extractors/adapters/vercelai_adapter.py:67) maps `ai.usage.*` → `ag.metrics.unit.tokens.*` on `.doStream`. [`span_data_builders.py:177`](../../../api/oss/src/apis/fastapi/otlp/extractors/span_data_builders.py:177) renames to `ag.metrics.tokens.incremental.*`. The parent has no `ai.usage.*` so no `incremental` lands on it.

4. **The walker is batch-scoped at ingest time only.** [`service.py:146`](../../../api/oss/src/core/tracing/service.py:146) calls [`calculate_and_propagate_metrics_by_trace`](../../../api/oss/src/core/tracing/utils/trees.py:66) per OTLP request. With SimpleSpanProcessor that's one span per call:
   - `.doStream` batch: walker sees one span → sets `cumulative = own incremental` on `.doStream` itself. ✓
   - `ai.streamText` batch: walker sees one span → it has no `incremental` → [`_set_cumulative`](../../../api/oss/src/core/tracing/utils/trees.py:402) guard `tokens != 0` fails → **no `cumulative` written on the parent.** ✗

5. **No read-time re-rollup exists.** Grep confirms the walker is only called from `service.py:146`, the ingest path. Reading a trace doesn't re-run it.

Implied fix at the time: read-time enricher to roll `.doStream`'s `incremental.*` up to the parent.

**Empirical re-verification (Next.js 16.2.6, 2026-05-18) — the hypothesis was wrong.**

Direct Agenta-side queries against the trace emitted by the spike against Next 16.2.6 (Turbopack default builder) show:

- `ai.streamText` parent: `ag.metrics.tokens.*` missing — expected.
- `ai.streamText.doStream` child: `ag.metrics.tokens.*` ALSO missing — **NOT expected.** This is the finding that breaks the rollup hypothesis.
- `fetch POST https://api.openai.com/v1/responses` grandchild: `ag.metrics.tokens.*` ALSO missing.

There is no surviving token data anywhere in the trace to roll up FROM. A read-time walker would visit every span, find no `incremental.*` to propagate, and exit without writing anything to the parent.

**Most plausible mechanism (not yet source-traced through `@vercel/otel`).** The force-end fires not only on the parent but also on `.doStream`. Sequence:

1. User calls `pipeUIMessageStreamToResponse(res)`, which returns synchronously.
2. `@vercel/otel`'s `CompositeSpanProcessor.onEnd` interprets the return as "stream done," force-ends both `ai.streamText` AND its still-open `.doStream` child.
3. Meanwhile the OpenAI Responses API stream is still draining server-side. When the stream finally completes, AI SDK calls `setAttributes({ai.usage.*})` on `.doStream`. The span is already ended; the call is a no-op.

A source-level trace through `@vercel/otel`'s `CompositeSpanProcessor` to confirm this can happen at implementation time. The fix recommendation does not depend on it: the empirical evidence (three spans, all empty) is sufficient to flip the recommendation.

**Why the OTHER streamText spike tests still pass on `incremental.prompt`:** App Router, Pages Router raw, TanStack, Nuxt — no `@vercel/otel`, no force-end. AI SDK's `setAttributes({ai.usage.*})` lands on the parent (or `.doStream`) directly. Adapter writes `incremental` on the affected span. The four-way combination (Pages Router + `@vercel/otel` + `pipeUIMessageStreamToResponse` + `streamText`) is the only one where the force-end clobbers token attributes on every relevant span.

**Revised fix recommendation.**

- **The §4.4 read-time enricher stays in scope** as the general fix for the multi-batch SimpleSpanProcessor gap. It does NOT fix P-PAGES-VERCEL-01 specifically — that requires source-of-truth token writes that survive the force-end, which can only happen on the JS side.
- **The §5.4 `agentaPipeUIMessageStreamToResponse` helper** is promoted from contingency to v1 deliverable. It owns the token-attribute writes onto an Agenta-controlled span before `@vercel/otel`'s force-end can interfere. Single-file ~30-line addition. Drop-in replacement for `result.pipeUIMessageStreamToResponse(res)`. See [§11.5](#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01) for the implementation shape.

**Earlier audit context (verified by reading test files on 2026-05-17):**

- The spike empirically reproduces parent-span `incremental` emptiness under **both** Batch and Simple span processors. Stale comment that was in `test-assertion-1.ts`: *"P-PAGES-VERCEL-01 still reproduces under SimpleSpanProcessor. The bug is in @vercel/otel's `CompositeSpanProcessor.onEnd` force-end logic — independent of whether the wrapped processor is Batch or Simple."*
- The workaround in assertion-1 was to **drop the token check entirely** — a testing-implementation bug fixed on 2026-05-18 to query the consumer-facing `cumulative` path. The fixed test will pass once §5.4's helper ships (NOT when §4.4's read-time enricher ships alone, as earlier drafts claimed).
- A `grep -rln 'doStream'` across all 37 test files in the spike suite returns **zero matches**. No test queries the child span directly. With the §5.4 helper in place, the parent's `cumulative.prompt` will be populated and the test passes.

### 11.5 JS-side helper `agentaPipeUIMessageStreamToResponse` — fixes P-PAGES-VERCEL-01

**Status: promoted from contingency to v1 deliverable** based on the §11.4 empirical re-verification. Earlier drafts framed this as a "contingency that triggers only if backend rollup verification fails." The verification has run; the rollup approach cannot recover tokens for this case; the helper ships in v1.

**Shape:**

```ts
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
}
```

**How it differs from `result.pipeUIMessageStreamToResponse(res)`.**

The helper opens an Agenta-controlled span around the pipe call, intercepts the stream completion event (which carries `usage` in AI SDK v6), writes `gen_ai.usage.*` AND `ag.metrics.tokens.*` onto its span, then ends its span explicitly. The Agenta-controlled span is never force-ended by `@vercel/otel` because Agenta's pipeline doesn't wrap it. After the helper returns, the Agenta span has the token attributes set, the read path returns them, online evaluations and metrics work.

**Affected scope.** Pages Router users on `@vercel/otel` who call `pipeUIMessageStreamToResponse`. App Router, raw OTel, `toUIMessageStreamResponse`, server actions, and edge routes are unaffected and use the default surface.

**Why this stays JS-side, not backend.** The backend has no token data to recover — the force-end clobbers it at emit time on every relevant span. The fix must own the write itself, before the force-end fires. That's a JS-side concern by definition. (Source-tracing or patching `@vercel/otel`'s `CompositeSpanProcessor.onEnd` upstream is the long-term right fix; the helper is the right v1 bridge.)

**Why this is not a full `streamText` wrapper.** The lifecycle wrapper considered and rejected in §3.1 wraps `streamText` itself, which couples our package to every AI SDK release and grows with provider churn. `agentaPipeUIMessageStreamToResponse` wraps a single Pages-Router-only response helper that has a stable shape (it has not changed across AI SDK v3-v6). No call to `streamText` is wrapped; users keep `import { streamText } from "ai"` unchanged.

**Deprecation path.** If a future AI SDK release exposes a `streamCompleteSignal` or similar hook that fires before `@vercel/otel`'s force-end (or if `@vercel/otel` patches its force-end), the helper becomes unnecessary and we deprecate it cleanly. Until then, it ships.

### 11.6 Mastra v1: lifecycle wrapper for Mastra-vendored AI SDK

Mastra vendors its own AI SDK v1 internally. The spike's `AgentaMastraExporter` subscribes to Mastra's bus, which means we get *Mastra-shaped* spans, not AI-SDK-shaped spans. Users who do `mastra.getAgent("x").generate(...)` get a 4-level Mastra tree; users who do raw AI SDK get the AI SDK shape. **Open: do we cross-translate?** Probably no for v1 — Mastra users will look at Mastra-shaped traces and that's fine. Revisit if cross-comparison becomes a friction point.

### 11.7 When does `@agenta/sdk-ai` exist (if ever)?

The empty `agenta-sdk-ai` directory in this worktree implies a planned higher-level "AI" package. v1 has no use for it — the lifecycle wrapper is deferred to v2 and lives in `@agenta/sdk-tracing` when revisited. Delete the directory unless someone proposes a v2 use. Document the deletion in the implementation PR.

---

## 12. Rejected alternatives

Each rejected approach gets a short rationale so future readers don't relitigate.

### 12.1 Approach A — Full SDK v1 (lifecycle + edge + framework adapters + propagateAttributes + decorator)

**Why rejected for v1:** largest new surface area to maintain. Framework adapters compound versioning churn (4 packages, each needing to track its framework's API). The full ergonomic surface is the right v2 trajectory, not the right v1 bet — the v1 wedge (edge runtime) is the only thing docs physically cannot deliver well, so v1 ships that and nothing more. Approach A piles on framework adapters and ergonomic surface whose value depends on adoption signals we do not have yet.

**When to revisit:** v2 cycle. Specific triggers in [§9.1](#91-framework-adapters), [§9.3](#93-propagateattributes-decorator-surface-and-the-ai-sdk-lifecycle-wrapper-revisited).

### 12.2 Approach B+ — adopted (v1 ships edge helper + narrow Pages Router helper; no full lifecycle wrapper)

**Status: ADOPTED as v1.** Earlier drafts of this RFC rejected Approach B with the rationale "docs cannot prevent the 3 streamText silent failures." That rejection was overstated. Honest audit (see [§3.1](#31-ai-sdk-v6-lifecycle-wrapper-considered-and-rejected)) showed:

- **2 of 3 lifecycle entries are docs-fixable.** Agenta's vercel-ai-sdk integration docs already prescribe `SimpleSpanProcessor` which avoids P-NODE-02 and P-APP-VERCEL-01. A new `@vercel/otel`-specific cross-reference covers users following Vercel/Mastra docs in isolation.
- **P-PAGES-VERCEL-01 was originally folded into backend read-time enricher [§4.4](#44-cost-computation-from-gen_aiusage-d80--read-time-token-rollup-general-multi-batch-gap--does-not-subsume-p-pages-vercel-01)** — code-trace verified necessary in earlier drafts. The Next.js 16 empirical re-verification on 2026-05-18 ([§11.4](#114-backend-rollup--code-trace-and-empirical-verification)) showed the rollup approach cannot recover tokens for this case (parent AND child both empty). P-PAGES-VERCEL-01 now ships in v1 as the narrow `agentaPipeUIMessageStreamToResponse` helper ([§11.5](#115-jsside-helper-pipeuimessagestreamtoresponse-fixes-p-pages-vercel-01)) — a single Pages-Router-only response-function wrapper with stable shape across AI SDK v3-v6. The §4.4 read-time enricher stays in scope as the general multi-batch rollup fix.
- **All 3 edge runtime entries (P-APP-RAW-01, P-PAGES-RAW-01, P-APP-VERCEL-02) survive as the genuine "docs cannot prevent" wedge.** Mechanism-bug shaped, unfixable from docs without asking users to copy ~30 lines of eval-free exporter + `waitUntil` enrollment into every edge route.

**Therefore v1 ships:**

1. Backend track ([§4](#4-backend-track-no-js-package-required)) — 4 fixes that benefit Python + raw OTel + AI SDK + Mastra users equally, plus the §4.4 general multi-batch rollup enricher.
2. `@agenta/sdk-tracing` v1 — `init()` + edge helper + `getTraceUrl()` + `setAgentaTracerProvider()` + `getAgentaTracer()` + `agentaPipeUIMessageStreamToResponse` (Pages Router helper). No full `streamText` wrapper. No `withAgentaLifecycle`. See [§5](#5-agentasdk-tracing-v1--surface-design).
3. `@agenta/sdk-mastra` v1 — unchanged, ships the spike's `AgentaMastraExporter` ([§6](#6-agentasdk-mastra-v1--separate-package)).
4. Docs improvements — `@vercel/otel`-specific section in vercel-ai-sdk integration docs explaining the processor override, plus a `pipeUIMessageStreamToResponse` warning, plus per-framework warnings for TanStack import-order and Nuxt H3 abort-signal.

**Coverage math:** 4 backend fixes + 3 JS-side edge entries + 3 Mastra entries + 4 docs entries (P-NODE-02, P-APP-VERCEL-01, P-TANSTACK-01/03, P-NUXT-01) + 1 contingent (P-PAGES-VERCEL-01 via backend rollup) = **15 of 16 spike entries addressed**, with 1 contingent on backend verification. P-TANSTACK-02 (no per-route edge runtime opt-in) is a TanStack architectural constraint not addressable from any layer.

**Honest framing to Mahmoud's pushback:** accepted in full for the lifecycle cluster. The wedge for shipping `@agenta/sdk-tracing` at all is now exclusively edge runtime — where docs can describe the eval-free + `waitUntil` recipe but cannot guarantee it stays correct across runtime + bundler + Next-version permutations. That's what the package delivers. Nothing more.

**What's deferred to v2 (and the trigger to revisit):** the lifecycle wrapper survives in [§9.3](#93-propagateattributes-decorator-surface-and-the-ai-sdk-lifecycle-wrapper-revisited) as candidate v2 work. Trigger: post-v1 usage shows footgun-reduction on the docs-fixable lifecycle entries is a meaningful pain point in practice (e.g., ≥3 unique support requests in the first quarter of v1 release), OR v2's `propagateAttributes` / decorator surface needs a wrapper foothold.

### 12.3 Approach D (implied) — wait for backend to fix everything

**Why rejected:** the 10 non-backend-fixable entries are not "things backend hasn't gotten to yet" — they're "things backend physically cannot see because the span never arrives." Waiting longer doesn't change the mechanism. The streamText lifecycle bug existed in the spike's first run and exists in every framework combination tested.

### 12.4 Per-provider wrappers as v1 (Braintrust's 13 wrappers shape)

**Why rejected:** AI SDK v6 already emits OTel via `experimental_telemetry`. Per-provider wrappers add value only when a specific provider routes around AI SDK. The user base for `@agenta/sdk-tracing` v1 is AI SDK users; we wrap the choke point, not 13 providers. v2 if measured DX gap demands ([§9.2](#92-per-provider-wrappers)).

### 12.5 Bundle Mastra into `@agenta/sdk-tracing`

**Why rejected:** Mastra's `BaseExporter` and OTel's `SpanProcessor` are structurally different. Bundling forces every `@agenta/sdk-tracing` user to install `@mastra/core` + `@mastra/observability` peers they don't use. Two packages, independent versioning, no overlap. Same wire format means they coexist seamlessly in one app.

### 12.6 Backend-led Mastra ingest in v1 (defer JS-side exporter)

**Why rejected:** backend semantic-mapping for Mastra is real work (new ingest endpoint, Mastra-shape parsing, adapter to `ag.*`) that takes Agenta-backend team cycles. The spike's PoC exporter exists today, passes 4/4 assertions, and ships against the current backend with zero backend changes. Ship JS-side first, validate Mastra adoption, then migrate semantic mapping backend-side later as a non-breaking change ([§6.3](#63-migration-path-to-backend-led-ingest-non-breaking)). Same overall trajectory; better sequencing.

### 12.7 Feature parity with the Python `agenta` SDK as a v1 gate

**Why rejected:** explicitly rejected by Mahmoud + JP in prior review (memory `project_ts_sdk_sprint_plan_rework.md`). The Python SDK is rich; full parity is a multi-quarter effort. v1 ships the correctness wedge; v2+ chases parity per [§9.5](#95-python-sdk-parity-surface).

### 12.8 `diagnostics_channel.tracingChannel` for instrumentation (Braintrust's approach)

**Why rejected for v1:** non-trivial design surface, not standard, not portable to edge runtimes without `dc-browser`-style polyfill (which Braintrust ships precisely because it doesn't run on edge natively). OTel + `experimental_telemetry` is the standard path AI SDK users already opt into. `diagnostics_channel` is in scope for v2 if AI SDK adds new emission paths we can't intercept via OTel.

---

## 13. What lands when

| Track | Item | Owner (TBD at kickoff) | Blocker for shipping |
|---|---|---|---|
| Backend | P-NODE-01 Resource attrs preserve | Backend | None — additive |
| Backend | Cost computation rollup | Backend | None — additive |
| Backend | P-COMMON-01 shared `extract_root_span` helper upgrade + eliminate 4 inline duplicates (fixes trace-list UI, online evals, annotations, invocations) | Backend | None — read-side logic, no schema change |
| Backend | P-NODE-03 metadata cascade enricher | Backend | None — additive |
| Backend | §4.4 read-time enricher — re-run `calculate_and_propagate_metrics` on assembled trace at query time (general multi-batch rollup fix; does NOT subsume P-PAGES-VERCEL-01 — see [§11.4](#114-backend-rollup--code-trace-and-empirical-verification)) | Backend | None — additive, code-trace verified necessary |
| JS | `@agenta/sdk-tracing` v0.1.0 — `init()` + Node bundle + safe defaults | Frontend platform | None |
| JS | `@agenta/sdk-tracing` v0.1.0 — edge bundle (eval-free, `waitUntil`-enrolled) | Frontend platform | None |
| JS | `@agenta/sdk-tracing` v0.1.0 — `getTraceUrl()` helper | Frontend platform | None |
| JS | `@agenta/sdk-tracing` v0.1.0 — `agentaPipeUIMessageStreamToResponse` Pages Router helper (fixes P-PAGES-VERCEL-01; promoted from contingency based on [§11.4](#114-backend-rollup--code-trace-and-empirical-verification) empirical re-verification) | Frontend platform | None |
| JS | `@agenta/sdk-mastra` v0.1.0 — `AgentaMastraExporter` | Frontend platform | Mastra peer dep stability |
| Docs | `@vercel/otel`-specific section in vercel-ai-sdk integration docs (processor override + `agentaPipeUIMessageStreamToResponse` usage for Pages Router + Next.js 16 `@opentelemetry/sdk-trace-base` explicit-dep callout per [P-COMMON-02](../ts-sdk-tracing/pain-log.md#p-common-02-nextjs-16--turbopack-stricter-module-resolution-exposes-missing-transitive-opentelemetrysdk-trace-base-declarations-on-vercelotel-apps)) | Docs / Frontend | Concurrent with v0.1.0 |
| Docs | Migration guide (raw OTel → SDK) | Docs / Frontend | After v0.1.0 ships |
| Docs | Per-framework warnings doc (TanStack import order, Nuxt H3 abort) | Docs | Concurrent with v0.1.0 |
| Examples | Refactor spike apps to consume v0.1.0 | Frontend | After v0.1.0 ships; replaces in-tree `instrumentation.ts` boilerplate |

Backend track and JS track are independent. Either can ship first. The Next.js 16 re-verification on 2026-05-18 resolved the §4.4 / §11.5 dependency — the read-time enricher and the JS-side helper are now both v1 deliverables addressing complementary problems (general multi-batch rollup gap vs. P-PAGES-VERCEL-01 specifically), not alternatives.

---

## 14. Risks

1. **Mastra peer dep churn.** `@mastra/core` is pre-1.0 — breaking changes between minor versions are common. Mitigation: pin peer dep to a tested range; release patch versions of `@agenta/sdk-mastra` aligned with Mastra majors.
2. **The `agentaPipeUIMessageStreamToResponse` helper adds a Pages-Router-shaped surface to `@agenta/sdk-tracing` that we'd prefer to avoid.** Promoted from contingency to v1 deliverable after the Next.js 16 empirical re-verification ([§11.4](#114-backend-rollup--code-trace-and-empirical-verification)) showed the backend read-time enricher cannot recover tokens for P-PAGES-VERCEL-01 (no surviving token data anywhere in the trace). Mitigation: helper is narrow (~30 lines), single call-site swap, Pages Router only. Affected scope is one specific 4-way combination, not all AI SDK users. Long-term: if `@vercel/otel` patches its `CompositeSpanProcessor.onEnd` force-end semantics or AI SDK exposes a pre-force-end signal, we deprecate the helper cleanly.
3. **AI SDK churn affects edge users indirectly.** v1 has no `ai` peer dep and does not wrap `streamText`, so AI SDK v6 → v7 → v8 evolution does not directly break the package. But edge users following docs that recommend AI SDK + our edge helper may need updated docs as AI SDK changes its own surface. Mitigation: docs maintenance pass per AI SDK major.
4. **Edge runtime fragmentation.** Vercel edge / Cloudflare Workers / Deno Deploy each have their own quirks. v1 ships Vercel-edge support (the primary user base) and a no-op fallback for others. Cloudflare-specific `waitUntil` semantics differ; flag in docs.
5. **Backend track delays the P-COMMON-01 fix across four surfaces.** If backend doesn't land before v0.1.0 ships, users will see the SDK correctly emit spans, then hit four downstream consequences: trace-list UI shows the wrapper row, online evaluations score garbage or error silently, annotations attach to the wrapper span, invocations summaries show wrapper data. Document this in v0.1.0 release notes with the backend ETA so users on Next.js know to defer online-eval setup until the backend ships.
6. **Spike app cleanup.** The 8 spike apps in `web/examples/` should be refactored to consume `@agenta/sdk-tracing` v0.1.0 as a dogfooding pass before the package ships externally. Failing to do this means the SDK ships without a single non-test user.
7. **Footgun-reduction loss for users following Vercel/Mastra docs in isolation.** Dropping the lifecycle wrapper means users who follow Vercel's docs (which default to `BatchSpanProcessor`) without also reading Agenta's `SimpleSpanProcessor` note will hit P-NODE-02 / P-APP-VERCEL-01 silent failures. Mitigation: new `@vercel/otel`-specific docs section ([§13](#13-what-lands-when) docs track). Tracked: if this generates ≥3 unique support requests in v1's first quarter, v2's [§9.3](#93-propagateattributes-decorator-surface-and-the-ai-sdk-lifecycle-wrapper-revisited) wrapper is triggered.

---

## 15. References

### 15.1 Spike artifacts (this branch)

- [`docs/design/ts-sdk-tracing/summary.md`](../ts-sdk-tracing/summary.md) — 8 framework phases + Phase 7/8 tri-export results, full pain table, backend-fixable subset analysis, implementation order recommendation
- [`docs/design/ts-sdk-tracing/pain-log.md`](../ts-sdk-tracing/pain-log.md) — 16 structured pain entries with root-cause and ideal-API sketches
- [`docs/design/ts-sdk-tracing/sdk-comparison.md`](../ts-sdk-tracing/sdk-comparison.md) — empirical cross-backend comparison; tokens/cost transformation per backend; six-implementation ergonomic side-by-side
- [`docs/design/ts-sdk-tracing/status.md`](../ts-sdk-tracing/status.md) — phase tracker + SDK-REQ-01/02/03 + locked decisions
- [`docs/design/ts-sdk/competitive-analysis.md`](competitive-analysis.md) — Braintrust + Langfuse TS SDK audits, RFC decision rollup (D1-D80), differentiation ranking

### 15.2 Existing code referenced

- [`web/packages/agenta-sdk/`](../../../web/packages/agenta-sdk/) — current convenience wrapper (`@agenta/sdk`)
- [`web/packages/agenta-api-client/`](../../../web/packages/agenta-api-client/) — Fern-generated REST client (`@agentaai/api-client`)
- [`web/examples/node-vercel-ai-v6/`](../../../web/examples/node-vercel-ai-v6/) — Phase 1 spike app
- [`web/examples/nextjs-app-router-raw/`](../../../web/examples/nextjs-app-router-raw/) — Phase 2a spike app
- [`web/examples/nextjs-app-router-vercel/`](../../../web/examples/nextjs-app-router-vercel/) — Phase 2b spike app
- [`web/examples/nextjs-pages-router-raw/`](../../../web/examples/nextjs-pages-router-raw/) — Phase 3a spike app
- [`web/examples/nextjs-pages-router-vercel/`](../../../web/examples/nextjs-pages-router-vercel/) — Phase 3b spike app
- [`web/examples/react-tanstack-start/`](../../../web/examples/react-tanstack-start/) — Phase 4 spike app
- [`web/examples/nuxt-raw/`](../../../web/examples/nuxt-raw/) — Phase 5 spike app
- [`web/examples/mastra-node/`](../../../web/examples/mastra-node/) — Phase 6 spike app + working `AgentaMastraExporter` PoC
- [`examples/node/observability-vercel-ai/`](../../../examples/node/observability-vercel-ai/) — published v4 quickstart (still works)
- [`examples/node/observability-mastra/`](../../../examples/node/observability-mastra/) — companion broken-baseline that reproduces P-MASTRA-01/02
- [`examples/python/RAG_QA_chatbot/`](../../../examples/python/RAG_QA_chatbot/) — Python SDK split-stack reference

### 15.3 External

- Vercel AI SDK v6 GA — [github.com/vercel/ai](https://github.com/vercel/ai)
- Langfuse JS SDK v5 — [github.com/langfuse/langfuse-js](https://github.com/langfuse/langfuse-js)
- Braintrust JS SDK v3 — [github.com/braintrustdata/braintrust-sdk-javascript](https://github.com/braintrustdata/braintrust-sdk-javascript)
- Langfuse AI SDK v6 abort issue — [github.com/langfuse/langfuse/issues/12643](https://github.com/langfuse/langfuse/issues/12643) (still OPEN at time of writing)
- Mastra `@mastra/core` — [github.com/mastra-ai/mastra](https://github.com/mastra-ai/mastra)

---

## 16. Approval

| Reviewer | Role | Status |
|---|---|---|
| Mahmoud | Backend / strategic | Requested — [§2.2 3/13 split](#22-the-313-split-mahmouds-pushback-addressed) addresses the "backend > JS" framing directly |
| JP | Strategic | Requested |
| Frontend platform | Implementation owner | Requested |

**Approval gates the start of implementation work** in `web/packages/agenta-sdk-tracing/` and `web/packages/agenta-sdk-mastra/`. Backend track ([§4](#4-backend-track-no-js-package-required)) may begin independently if backend team has cycles.
