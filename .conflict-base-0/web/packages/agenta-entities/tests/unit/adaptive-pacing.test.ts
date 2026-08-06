/**
 * Unit tests for the adaptive page-fetch delay used by the bulk-trace export.
 *
 * Pure function — covers the bucket-fill ramp from "full" (floor delay) to
 * "empty" (sustained refill rate). The same logic runs across every EE plan
 * tier because the input is the live `X-RateLimit-*` reading, not the plan.
 */

import {describe, expect, it} from "vitest"

import {
    ADAPTIVE_CEILING_DELAY_MS,
    ADAPTIVE_FLOOR_DELAY_MS,
    ADAPTIVE_RAMP_START_FILL,
    computeAdaptivePageDelayMs,
} from "../../src/trace/etl"

describe("computeAdaptivePageDelayMs", () => {
    it("returns the floor delay when the bucket is full", () => {
        expect(computeAdaptivePageDelayMs({remaining: 120, limit: 120})).toBe(
            ADAPTIVE_FLOOR_DELAY_MS,
        )
    })

    it("returns the floor delay when fill is above the ramp threshold", () => {
        // EE Free plan has TRACING_SLOW capacity = 120. With 100 remaining
        // (fill ≈ 0.83) we're still in burst-OK territory.
        expect(computeAdaptivePageDelayMs({remaining: 100, limit: 120})).toBe(
            ADAPTIVE_FLOOR_DELAY_MS,
        )
    })

    it("returns the floor delay when fill equals the ramp threshold", () => {
        expect(
            computeAdaptivePageDelayMs({
                remaining: Math.round(120 * ADAPTIVE_RAMP_START_FILL),
                limit: 120,
            }),
        ).toBe(ADAPTIVE_FLOOR_DELAY_MS)
    })

    it("ramps the delay up as the bucket drains below the threshold", () => {
        const halfDrained = computeAdaptivePageDelayMs({
            remaining: Math.round(120 * (ADAPTIVE_RAMP_START_FILL / 2)),
            limit: 120,
        })
        // Halfway down the ramp — delay should sit roughly in the middle of
        // the floor → ceiling range.
        const midpoint = (ADAPTIVE_FLOOR_DELAY_MS + ADAPTIVE_CEILING_DELAY_MS) / 2
        expect(halfDrained).toBeGreaterThan(ADAPTIVE_FLOOR_DELAY_MS)
        expect(halfDrained).toBeLessThan(ADAPTIVE_CEILING_DELAY_MS)
        expect(Math.abs(halfDrained - midpoint)).toBeLessThan(50)
    })

    it("returns the ceiling delay when the bucket is empty", () => {
        expect(computeAdaptivePageDelayMs({remaining: 0, limit: 120})).toBe(
            ADAPTIVE_CEILING_DELAY_MS,
        )
    })

    it("returns the ceiling delay when remaining is negative (clock skew)", () => {
        expect(computeAdaptivePageDelayMs({remaining: -1, limit: 120})).toBe(
            ADAPTIVE_CEILING_DELAY_MS,
        )
    })

    it("returns the floor delay when headers are unavailable", () => {
        // OSS deployments without EE throttling, or the first call before
        // any header has been seen.
        expect(computeAdaptivePageDelayMs({remaining: null, limit: null})).toBe(
            ADAPTIVE_FLOOR_DELAY_MS,
        )
    })

    it("returns the floor delay when limit is 0 (avoid divide-by-zero)", () => {
        expect(computeAdaptivePageDelayMs({remaining: 0, limit: 0})).toBe(ADAPTIVE_FLOOR_DELAY_MS)
    })

    it("returns the floor delay when only `remaining` is reported", () => {
        expect(computeAdaptivePageDelayMs({remaining: 50, limit: null})).toBe(
            ADAPTIVE_FLOOR_DELAY_MS,
        )
    })

    it("monotonically increases as remaining tokens drop", () => {
        // The ramp must never reverse — a draining bucket only slows down,
        // never speeds up. Cross-tier check using EE Business capacity.
        const limit = 1800
        const samples = [limit, 1500, 1000, 900, 500, 200, 100, 0].map((remaining) =>
            computeAdaptivePageDelayMs({remaining, limit}),
        )
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
        }
        expect(samples[0]).toBe(ADAPTIVE_FLOOR_DELAY_MS)
        expect(samples[samples.length - 1]).toBe(ADAPTIVE_CEILING_DELAY_MS)
    })

    it("produces the same delay shape across tiers at equal fill ratios", () => {
        // EE Free has capacity 120, Business has 1800. At the same fill
        // ratio, the delay should be identical — the algorithm is
        // bucket-aware, not tier-aware.
        const free = computeAdaptivePageDelayMs({remaining: 30, limit: 120}) // fill 0.25
        const business = computeAdaptivePageDelayMs({remaining: 450, limit: 1800}) // fill 0.25
        expect(free).toBe(business)
    })
})
