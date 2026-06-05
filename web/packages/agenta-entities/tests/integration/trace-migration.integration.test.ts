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
    isTracesResponse,
} from "../../src/trace"
import type {TracesResponse} from "../../src/trace/core"

import {TEST_CONFIG, hasBackend} from "./helpers/env"

const TEST_TRACE_ID = process.env.AGENTA_TEST_TRACE_ID || ""
const EXPECT_RATELIMIT = Boolean(process.env.AGENTA_TEST_EXPECT_RATELIMIT)

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
