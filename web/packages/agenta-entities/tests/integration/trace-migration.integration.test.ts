/**
 * Integration tests for the AGE-3788 tracing migration — the two risks that
 * CANNOT be covered by unit tests (they assert real backend behaviour):
 *
 *   RISK 1 — /traces/query trace_id filter format.
 *     The coalescer (traceBatchFetcher), prefetch, and ETL all pass UNDASHED
 *     trace_ids in `filtering` (matching the legacy /tracing/spans/query) and
 *     read the result back as `data.traces[traceIdNoDashes]`. If /traces/query
 *     expects DASHED ids, the filter silently matches nothing → empty trace
 *     drawer / empty scenario hydration. This test proves which id format the
 *     new endpoint accepts.
 *
 *   RISK 2 — X-RateLimit-* headers survive Fern transport.
 *     The bulk-trace export paces itself off `X-RateLimit-Remaining/Limit`
 *     read from the response headers. The migration reads them via Fern's
 *     `.withRawResponse()`. This test proves the headers reach the FE through
 *     Fern (and, on EE, carry numeric throttle state).
 *
 * Gating:
 *   - `hasBackend`            — apiKey + projectId provisioned by global setup.
 *   - AGENTA_TEST_TRACE_ID    — a real trace_id that exists in the test project
 *                               (RISK 1 needs a known trace to look up). Supply
 *                               it once tracing data exists in the test backend;
 *                               the backend team can provision it like
 *                               AGENTA_TEST_TRACE_SPAN_ID.
 *   - AGENTA_TEST_EXPECT_RATELIMIT — set on EE deployments where the throttle
 *                               middleware emits numeric X-RateLimit-* headers.
 *
 * Run: pnpm run test:integration  (vitest.integration.config.ts)
 */
import {getAgentaSdkClient} from "@agenta/sdk"
import {beforeAll, describe, expect, it} from "vitest"

import {
    fetchAllPreviewTraces,
    fetchAllPreviewTracesWithMeta,
    fetchSpansAnalytics,
    isTracesResponse,
} from "../../src/trace"
import type {AnalyticsResponse, TracesResponse} from "../../src/trace/core"

import {TEST_CONFIG, hasBackend} from "./helpers/env"

// Optional live-data override: point the analytics test at an EXISTING project
// that already has traces (the ephemeral account from global setup is empty, so
// it can only assert response shape, not real aggregates). Credentials come from
// env — never hardcode them. Run with:
//   AGENTA_API_URL=... AGENTA_LIVE_PROJECT_ID=... AGENTA_LIVE_API_KEY=... \
//     pnpm run test:integration
const LIVE_PROJECT_ID = process.env.AGENTA_LIVE_PROJECT_ID || ""
const LIVE_API_KEY = process.env.AGENTA_LIVE_API_KEY || ""
const LIVE_API_URL = process.env.AGENTA_API_URL || ""
const hasLiveAnalytics = Boolean(LIVE_PROJECT_ID && LIVE_API_KEY && LIVE_API_URL)

const TEST_TRACE_ID = process.env.AGENTA_TEST_TRACE_ID || ""
// Explicit truthy parse: a bare Boolean(...) treats "false"/"0" as true, which
// would wrongly enable the EE-only rate-limit assertion path.
const EXPECT_RATELIMIT = /^(1|true|yes)$/i.test(process.env.AGENTA_TEST_EXPECT_RATELIMIT ?? "")

// Seed the lazy Fern SDK singleton with the test backend + key BEFORE any api
// function runs. getTracesClient() calls getAgentaSdkClient() argless, so the
// first (seeding) call here fixes the host/auth for the whole worker. Also set
// the env vars so any argless init elsewhere resolves to the same backend.
beforeAll(() => {
    if (!hasBackend) return
    process.env.AGENTA_HOST = TEST_CONFIG.apiUrl
    process.env.AGENTA_API_KEY = TEST_CONFIG.apiKey
    getAgentaSdkClient({host: TEST_CONFIG.apiUrl, apiKey: TEST_CONFIG.apiKey})
})

const traceIdFilter = (value: string) =>
    JSON.stringify({conditions: [{field: "trace_id", operator: "in", value: [value]}]})

// --- RISK 1: /traces/query trace_id filter format ----------------------------

describe.skipIf(!hasBackend || !TEST_TRACE_ID)(
    "AGE-3788 RISK 1 — /traces/query accepts UNDASHED trace_ids in filtering",
    () => {
        it("returns the trace when filtered by an UNDASHED trace_id", async () => {
            const undashed = TEST_TRACE_ID.replace(/-/g, "")
            const res = await fetchAllPreviewTraces(
                {focus: "trace", filter: traceIdFilter(undashed)},
                "",
                TEST_CONFIG.projectId,
            )

            expect(res).not.toBeNull()
            expect(isTracesResponse(res)).toBe(true)
            // The coalescer + ETL look up data.traces[undashed]. If this key is
            // absent, the undashed filter did NOT match — the coalescer would
            // silently return empty and the trace drawer/hydration would break.
            expect((res as TracesResponse).traces[undashed]).toBeDefined()
        })

        // Diagnostic: surfaces which id format the backend honours. If the dashed
        // form matches but the undashed form does not, the FE coalescer's
        // canonicalIds (undashed) must switch to dashed before P5 ships.
        it("[diagnostic] reports dashed vs undashed filter match", async () => {
            const undashed = TEST_TRACE_ID.replace(/-/g, "")
            const [dashedRes, undashedRes] = await Promise.all([
                fetchAllPreviewTraces(
                    {focus: "trace", filter: traceIdFilter(TEST_TRACE_ID)},
                    "",
                    TEST_CONFIG.projectId,
                ),
                fetchAllPreviewTraces(
                    {focus: "trace", filter: traceIdFilter(undashed)},
                    "",
                    TEST_CONFIG.projectId,
                ),
            ])
            const keys = (r: unknown) =>
                isTracesResponse(r) ? Object.keys((r as TracesResponse).traces) : []

            console.info("[AGE-3788 trace-id-format]", {
                dashedMatched: keys(dashedRes),
                undashedMatched: keys(undashedRes),
            })
            // At least one format must match a known trace, else the migration
            // can't fetch trace trees at all.
            expect(keys(dashedRes).length + keys(undashedRes).length).toBeGreaterThan(0)
        })
    },
)

// --- RISK 2: X-RateLimit-* headers through Fern -------------------------------

describe.skipIf(!hasBackend)(
    "AGE-3788 RISK 2 — bulk-export rate-limit headers via Fern .withRawResponse()",
    () => {
        it("returns the {data, rateLimit} shape without throwing", async () => {
            const res = await fetchAllPreviewTracesWithMeta(
                {focus: "span", size: 1},
                "",
                TEST_CONFIG.projectId,
            )
            expect(res).toHaveProperty("data")
            // remaining/limit are number-or-null: EE emits X-RateLimit-Remaining
            // on every 200 (proving the header survives Fern transport);
            // X-RateLimit-Limit is only set on 429 so it is null here; OSS
            // without throttling returns null for both.
            const isNumOrNull = (v: unknown) => v === null || typeof v === "number"
            expect(isNumOrNull(res.rateLimit.remaining)).toBe(true)
            expect(isNumOrNull(res.rateLimit.limit)).toBe(true)

            console.info("[AGE-3788 rate-limit]", res.rateLimit)
        })

        it.skipIf(!EXPECT_RATELIMIT)(
            "exposes a numeric X-RateLimit-Remaining on a throttled (EE) backend",
            async () => {
                const res = await fetchAllPreviewTracesWithMeta(
                    {focus: "span", size: 1},
                    "",
                    TEST_CONFIG.projectId,
                )
                expect(typeof res.rateLimit.remaining).toBe("number")
            },
        )
    },
)

// --- Smoke: Fern transport + auth reach the backend at all -------------------

describe.skipIf(!hasBackend)("AGE-3788 smoke — Fern client reaches the backend", () => {
    it("querySpans (flat) settles without throwing and returns the spans shape", async () => {
        const res = await fetchAllPreviewTraces({focus: "span", size: 1}, "", TEST_CONFIG.projectId)
        // Either a valid SpansResponse or null (validation miss) — never a throw.
        expect(res === null || "spans" in res).toBe(true)
    })
})

// --- Phase 6: /spans/analytics/query end-to-end (the generation dashboard) ---
// This is the function the observability dashboard atom chain ultimately calls:
//   useObservabilityDashboard → observabilityDashboardQueryAtom
//     → fetchGenerationsDashboardData → fetchSpansAnalytics (this) → analyticsToGeneration
// Asserting it here proves the migrated Fern wiring + the metric-path contract
// the OSS transform reads (buckets[].metrics keyed by dotted MetricSpec path).

const DURATION_PATH = "attributes.ag.metrics.duration.cumulative"
const COST_PATH = "attributes.ag.metrics.costs.cumulative.total"
const TOKENS_PATH = "attributes.ag.metrics.tokens.cumulative.total"
const ERRORS_PATH = "attributes.ag.metrics.errors.cumulative"
const TRACE_TYPE_PATH = "attributes.ag.type.trace"

type Buckets = NonNullable<AnalyticsResponse["buckets"]>
const sumField = (buckets: Buckets, path: string, field: string): number =>
    buckets.reduce((acc, b) => {
        const v = (
            b.metrics as Record<string, Record<string, unknown> | null> | null | undefined
        )?.[path]?.[field]
        return acc + (typeof v === "number" ? v : 0)
    }, 0)

// Shape-only smoke against whatever project the harness provisioned (empty
// ephemeral project is fine — proves the Fern call + envelope parse work).
describe.skipIf(!hasBackend)("AGE-3788 Phase 6 — querySpansAnalytics shape", () => {
    it("omits specs, returns an AnalyticsResponse with a buckets array (or null)", async () => {
        const oldest = new Date(Date.now() - 24 * 3600 * 1000).toISOString().split(".")[0]
        const res = await fetchSpansAnalytics({
            projectId: TEST_CONFIG.projectId,
            focus: "trace",
            interval: 720,
            oldest,
        })
        // null on a validation miss is tolerated; otherwise buckets must be an array.
        expect(res === null || Array.isArray(res.buckets)).toBe(true)
    })
})

// Real-data assertions against a project that already has traces.
describe.skipIf(!hasLiveAnalytics)(
    "AGE-3788 Phase 6 — querySpansAnalytics against a project with real data",
    () => {
        beforeAll(() => {
            process.env.AGENTA_HOST = LIVE_API_URL
            process.env.AGENTA_API_KEY = LIVE_API_KEY
            getAgentaSdkClient({host: LIVE_API_URL, apiKey: LIVE_API_KEY})
        })

        it("returns default-spec metric buckets keyed by the dotted paths the transform reads", async () => {
            const oldest = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split(".")[0]
            const res = await fetchSpansAnalytics({
                projectId: LIVE_PROJECT_ID,
                focus: "trace",
                interval: 720,
                oldest,
            })

            expect(res).not.toBeNull()
            const buckets = (res?.buckets ?? []) as Buckets
            expect(Array.isArray(buckets)).toBe(true)

            const durationSum = sumField(buckets, DURATION_PATH, "sum")
            const durationCount = sumField(buckets, DURATION_PATH, "count")
            const costSum = sumField(buckets, COST_PATH, "sum")
            const tokensSum = sumField(buckets, TOKENS_PATH, "sum")
            const errorsSum = sumField(buckets, ERRORS_PATH, "sum")
            const traceCount = sumField(buckets, TRACE_TYPE_PATH, "count")

            // The duration metric is the SAME ag.metrics.duration.cumulative the
            // legacy /tracing/spans/analytics summed — this logs its real unit so
            // the dashboard's /1000 normalization can be confirmed against actuals.
            console.info("[AGE-3788 analytics LIVE]", {
                bucketCount: buckets.length,
                durationSum,
                durationCount,
                avgDurationRaw: durationCount ? durationSum / durationCount : 0,
                avgDuration_div1000: durationCount ? durationSum / durationCount / 1000 : 0,
                costSum,
                tokensSum,
                errorsSum,
                traceCount,
                sampleBucketMetricKeys: Object.keys(buckets[0]?.metrics ?? {}),
            })

            // The contract analyticsToGeneration depends on: the default-spec
            // dotted paths are present with numeric aggregates.
            expect(buckets.length).toBeGreaterThan(0)
            expect(traceCount).toBeGreaterThan(0)
            expect(durationCount).toBeGreaterThan(0)
            expect(Number.isFinite(durationSum)).toBe(true)
            expect(Number.isFinite(costSum)).toBe(true)
            expect(Number.isFinite(tokensSum)).toBe(true)
        })
    },
)
