# Status: `ts-sdk-tracing` Spike

## Current State

**Branch:** `ts-sdk-chore/example-apps`
**Last Updated:** 2026-05-12 (Phase 8 Langfuse tri-export across 8 apps · 3 spot-checks 12/12 PASS · same single-instrumentation-file pattern as Phase 7, refactored if/else to unified `spanProcessors` array for `@vercel/otel` apps)

---

## Progress Tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Foundation: scaffolding, `@agenta/spike-verify` package (uses `@agenta/sdk`), pnpm-workspace wiring, validation script | ✅ DONE |
| 1a | App 1 (Node + AI SDK v6 + raw OTel) builds: instrumentation + app + 4 assertion scripts | ✅ DONE |
| 1b | LOCK: 4 canonical assertions against live Agenta endpoint | ✅ 4/4 PASS |
| 2a | Next.js App Router — raw OTel | ✅ 4/4 nodejs assertions PASS · edge route P-APP-RAW-01 captured |
| 2b | Next.js App Router — `@vercel/otel` | ✅ 3/4 nodejs assertions PASS · assertion-2 P-APP-VERCEL-01 (Batch+streamText flush) · edge P-APP-VERCEL-02 (delayed but works) |
| 3a | Next.js Pages Router — raw OTel | ✅ 4/4 nodejs assertions PASS · edge route can't BUILD on raw OTel (P-PAGES-RAW-01) |
| 3b | Next.js Pages Router — `@vercel/otel` | ✅ 4/4 nodejs assertions PASS (assertion-1 loosened — P-PAGES-VERCEL-01 empty token metrics) · edge route BUILDS + runs (`@vercel/otel` passes Pages-edge static check) with same ~10-15s delay as App Router edge |
| 4 | React TanStack Start (20h hard cap) | ✅ 4/4 nodejs assertions PASS · 3 TanStack-specific pain entries captured (P-TANSTACK-01/02/03) · edge probe deferred (no per-route opt-in, needs preset swap — P-TANSTACK-02) |
| 5 | Nuxt 4 (Vue + Nitro) — raw OTel | ✅ 4/4 assertions PASS (assertion-2 needs 30s flush window per P-NUXT-01: H3 v2 RC's abort signal is undefined at runtime) · trace hierarchy CLEAN (ai.streamText IS root, P-COMMON-01 does not apply) · edge probe deferred (no per-route opt-in, same as TanStack) |
| 6 | Mastra (Node) — raw OTel + custom Mastra exporter | ✅ 4/4 assertions PASS with AgentaMastraExporter PoC · Path A (bare Mastra) and Path B-cheap (Observability + ConsoleExporter) both emit 0 OTel traces (P-MASTRA-01 + P-MASTRA-02) · Path B-real with custom `BaseExporter` subclass (~150 lines) ships 4-level Mastra tree to Agenta · companion broken-baseline at `examples/node/observability-mastra/` reproduces failure mode |
| 7 | Braintrust dual-export across 8 AI-SDK-direct apps | ✅ 29/32 assertions PASS (a2 P-APP-VERCEL-01 expected FAIL preserved) · single instrumentation-file change adds Braintrust alongside Agenta · accidental finding: `spanProcessors: [SimpleSpanProcessor]` overrides @vercel/otel's default BatchSpanProcessor and sidesteps P-APP-VERCEL-01 (added as interim workaround note to that entry) · Mastra-Braintrust integration deferred (different shape, no key provided) |
| 8 | Langfuse tri-export across the same 8 apps | ✅ Spot-checks 12/12 PASS across the 3 distinct instrumentation shapes — Phase 1 (raw Node OTel SDK, 4/4 PASS) · Phase 2b (`@vercel/otel` unified-array refactor, 4/4 PASS) · Phase 5 (Nitro plugin, 4/4 PASS) · same conditional `SimpleSpanProcessor(OTLPTraceExporter(langfuse))` pattern as Phase 7 · Basic auth via `base64(public:secret)` per Langfuse OTel docs · 8 distinct Langfuse projects (one per app) for clean per-app trace separation in their UI · enables side-by-side comparison: identical OTel input, three platforms displaying it |
| 9 | Pain log de-dup + severity grouping → SDK design phase input | 🔜 PENDING |

---

## Decisions Locked

### Decision 1: AI SDK v6, not v5

**Original plan:** target AI SDK v5 GA.
**Discovered during execution:** Vercel skipped a stable v5 release. v5 only exists as betas (latest `5.1.0-beta.28`). v6 is the current GA stable (latest `6.0.177`, 318 versions shipped).
**Resolution:** new spike apps target AI SDK v6. Existing `examples/node/observability-vercel-ai/` stays at v4 — side-by-side validation now spans 2 major versions, which exposes more pain (better for the spike).

### Decision 2: Vitest for `@agenta/spike-verify`

**Original plan:** "10 unit tests" without specifying a runner.
**Discovered during execution:** the monorepo has no unit test runner — every existing TS package's `test` script is just type-check + lint.
**Resolution:** Vitest as a devDep of `spike-verify` only. Doesn't impose Vitest on other packages but does set a precedent. Mitigation: only use it for spike-verify, remove when the spike retires.

### Decision 3: 6 apps, not 4

**Original plan:** 4 apps (one per framework).
**Discovered during eng review:** `@vercel/otel` is the canonical Next.js OTel wrapper, but the original plan only had it as a "fallback exporter." Most real Next.js users will reach for it first. Measuring only raw-OTel friction would measure the wrong pain.
**Resolution:** Each Next.js spike split into raw + vercel-otel siblings (App 2a/2b, App 3a/3b). Total 6 apps. Effort revised from 1.5-2 weeks → 3-4 weeks.

### Decision 4: Local testing only during the spike

**Original plan:** Open Question 3 committed to Vercel deploys for warm-Lambda RSC test.
**Discovered during eng review:** Vercel project ownership + scoped API keys + per-engineer setup adds significant overhead and security surface.
**Resolution:** Local-only testing during the spike. Cold-start RSC propagation tested via `vercel dev` or `next dev`. Warm-Lambda re-init becomes post-spike follow-up at `ts-sdk-tracing` design kickoff (captured in `TODOS.md`).

### Decision 5: spike-verify uses `@agenta/sdk`, not hand-rolled `fetch`

**Original plan:** spike-verify rolls its own fetch wrapper against `/api/spans/query`.
**Discovered during execution:** [PR #4259](https://github.com/Agenta-AI/agenta/pull/4259) merged a Fern-generated TypeScript API client (`@agenta/api-client`) and a thin convenience wrapper (`@agenta/sdk`) onto `origin/main`. Our branch was 75 commits behind, hence I missed them initially. **Plus** my hand-rolled filter shape used `LogicalOperator: "AND"` (uppercase) where the actual API expects `"and"` (lowercase) — would have failed at LOCK time.
**Resolution:**
  1. Rebased `ts-sdk-chore/example-apps` onto `origin/main` (clean rebase, only conflict on `web/pnpm-lock.yaml`, resolved by regenerating).
  2. spike-verify now depends on `@agenta/sdk` (`workspace:*`).
  3. Production path: `init({host, apiKey}).traces.querySpans({filtering: {...}})`.
  4. Test path unchanged: tests still mock at the `AgentaApiClient` interface (the spike-verify abstraction), not at the SDK layer. Stub-based tests stay fast and deterministic.

**Why this matters for the SDK design:** the spike now measures friction USERS WILL ACTUALLY HIT. The pain log entries from here forward reflect "what does it feel like to wire `@agenta/sdk` + raw OTel + AI SDK v6 together?" — which is the exact question `ts-sdk-tracing` is being designed to answer.

---

## SDK Requirements (locked-in features the SDK must deliver)

These were initially logged as "pain entries" during Phase 1, but on review they're **obvious features `ts-sdk-tracing` itself must ship**. Real users won't hit them because we're building the SDK to handle them. Captured here so they're not lost as requirements.

### SDK-REQ-01: ship a built `dist/` from day one

When attempted to consume `@agenta/sdk` from a Node + tsx context, Node ESM refused to load `main: ./src/index.ts`. Fix already applied to `web/packages/agenta-sdk` during Phase 1: added `prepare`/`build` scripts emitting `dist/index.js` + `dist/index.d.ts`, mirrored from how `@agenta/api-client` ships. **Implication for `ts-sdk-tracing`**: any package consumed by Node-side users (which is the entire AI SDK + raw OTel target audience) MUST ship `dist/` with `type: module`, `main`/`module`/`types` pointing at compiled artifacts.

### SDK-REQ-02: `host` parameter accepts origin-only strings (SDK adds `/api` itself)

Real users typing `AGENTA_HOST=https://cloud.agenta.ai` (matches every `.env.example` everywhere) hit 404s because the Fern client's `AgentaApiEnvironment.Default` is `/api` — when an explicit absolute host replaces it, `/api` is lost. Workaround in spike-verify: `appendApiPrefix()` helper. **Implication**: `init({host})` should normalize the host so users can pass either origin or origin+`/api` transparently. Match the mental model of `OPENAI_API_KEY` (origin only).

### SDK-REQ-03: `init({projectId})` propagates project_id to every request

The SDK's `AgentaInitOptions` already accepts `projectId` but `init()` doesn't pass it through to `AgentaApiClient`. Agenta reads `project_id` from query params (`?project_id=<uuid>`) on every endpoint, including OTLP ingest. Workaround in spike-verify: thread `requestOptions.queryParams.project_id` on each call manually. **Implication**: `init({projectId})` must wire a request middleware (or per-call `requestOptions` injection) that adds `?project_id=<uuid>` to every URL. Same pattern needed for the OTLP exporter URL when the SDK provides exporter configuration helpers.

---

## Open Questions

1. ~~**TanStack Start instrumentation hook** — where does it live? `entry-server.tsx`? Vite plugin? `app.config.ts`? Resolves during Phase 4 discovery.~~ **Resolved:** `src/instrumentation.ts` imported as FIRST line of `src/server.ts`. No framework-level enforcement — captured as P-TANSTACK-01.
2. ~~**Edge runtime exporter that actually flushes** — App 2 builds will discover the working dependency tree. Pain log entry either way (works → "what we used"; doesn't → "what we tried").~~ **Resolved:** raw OTel emits zero spans on edge (P-APP-RAW-01); `@vercel/otel` emits spans with ~10-15s delay (P-APP-VERCEL-02); Pages Router raw OTel can't even BUILD on edge (P-PAGES-RAW-01); `@vercel/otel` works on Pages-edge. SDK has to own the edge bundle.
3. **`@vercel/otel` Server Component context propagation** — does it correctly thread context across Suspense boundaries? Verified via App 2b's Server Action probe.

---

## Known Gaps (deferred, not blockers)

- Warm-Lambda RSC propagation re-test on Vercel deploy (deferred to post-spike, captured in `TODOS.md`).
- CI build for the spike apps (intentionally not in CI; manual smoke check before commit).
- Cloudflare Workers / Deno Deploy / SvelteKit / Hono / Remix (out of spike scope).
