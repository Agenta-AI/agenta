import type {AnalyticsResponse} from "@agenta/entities/trace"
import {describe, expect, it} from "vitest"

import {analyticsToAgentWindow, computeHealth, HEALTH_RUN_FLOOR} from "./agentAnalytics"

const TRACE = "attributes.ag.type.trace"
const DURATION = "attributes.ag.metrics.duration.cumulative"
const COST_PROMPT = "attributes.ag.metrics.costs.cumulative.prompt"
const COST_COMPLETION = "attributes.ag.metrics.costs.cumulative.completion"
const TOK_PROMPT = "attributes.ag.metrics.tokens.cumulative.prompt"
const TOK_COMPLETION = "attributes.ag.metrics.tokens.cumulative.completion"

const bucket = (timestamp: string, metrics: Record<string, Record<string, unknown>>) => ({
    timestamp,
    metrics,
})

describe("analyticsToAgentWindow", () => {
    it("splits success/failed, cost, tokens, and reads the nested p95", () => {
        const unfiltered: AnalyticsResponse = {
            buckets: [
                bucket("2026-08-01T00:00:00", {
                    [TRACE]: {count: 10},
                    [DURATION]: {count: 10, sum: 2000, min: 50, max: 800, pcts: {p95: 600}},
                    [COST_PROMPT]: {sum: 0.4},
                    [COST_COMPLETION]: {sum: 0.6},
                    [TOK_PROMPT]: {sum: 100},
                    [TOK_COMPLETION]: {sum: 150},
                }),
            ],
        }
        const failed: AnalyticsResponse = {
            buckets: [bucket("2026-08-01T00:00:00", {[TRACE]: {count: 2}})],
        }

        const {buckets, totals} = analyticsToAgentWindow(unfiltered, failed, "24_hours")
        const b = buckets[0]

        expect(b.runs).toBe(10)
        expect(b.failed).toBe(2)
        expect(b.success).toBe(8)
        expect(b.latencyAvg).toBe(200) // 2000 / 10
        expect(b.latencyMin).toBe(50)
        expect(b.latencyMax).toBe(800)
        expect(b.latencyP95).toBe(600) // nested pcts.p95
        expect(b.cost).toBeCloseTo(1.0)
        expect(b.tokens).toBe(250)

        expect(totals.totalRuns).toBe(10)
        expect(totals.failedRuns).toBe(2)
        expect(totals.successRuns).toBe(8)
        expect(totals.successRate).toBeCloseTo(0.8)
        expect(totals.avgLatency).toBe(200)
        expect(totals.totalCost).toBeCloseTo(1.0)
        expect(totals.totalTokens).toBe(250)
    })

    it("clamps a failed count that exceeds the unfiltered total", () => {
        const unfiltered: AnalyticsResponse = {
            buckets: [bucket("t", {[TRACE]: {count: 3}})],
        }
        const failed: AnalyticsResponse = {
            buckets: [bucket("t", {[TRACE]: {count: 5}})],
        }
        const {buckets} = analyticsToAgentWindow(unfiltered, failed, "24_hours")
        expect(buckets[0].failed).toBe(3)
        expect(buckets[0].success).toBe(0)
    })

    it("treats a missing failed bucket as zero failures", () => {
        const unfiltered: AnalyticsResponse = {
            buckets: [bucket("t", {[TRACE]: {count: 4}})],
        }
        const {buckets, totals} = analyticsToAgentWindow(unfiltered, {buckets: []}, "24_hours")
        expect(buckets[0].failed).toBe(0)
        expect(totals.successRate).toBe(1)
    })

    it("returns zeroed totals for an empty response", () => {
        const {buckets, totals} = analyticsToAgentWindow({buckets: []}, {buckets: []}, "7_days")
        expect(buckets).toHaveLength(0)
        expect(totals.totalRuns).toBe(0)
        expect(totals.successRate).toBe(0)
        expect(totals.avgLatency).toBe(0)
    })
})

describe("computeHealth", () => {
    const totals = (totalRuns: number, successRate: number) => ({
        totalRuns,
        successRuns: Math.round(totalRuns * successRate),
        failedRuns: totalRuns - Math.round(totalRuns * successRate),
        successRate,
        avgLatency: 0,
        totalCost: 0,
        totalTokens: 0,
    })

    it("bands Healthy at 85 and above", () => {
        const h = computeHealth(totals(100, 0.9))
        expect(h.score).toBe(90)
        expect(h.band).toBe("healthy")
        expect(h.hasEnoughRuns).toBe(true)
    })

    it("bands Watch from 65 to 84", () => {
        expect(computeHealth(totals(100, 0.7)).band).toBe("watch")
        expect(computeHealth(totals(100, 0.84)).band).toBe("watch")
    })

    it("bands At risk below 65", () => {
        expect(computeHealth(totals(100, 0.5)).band).toBe("at-risk")
    })

    it("shows the neutral state below the run floor", () => {
        const h = computeHealth(totals(HEALTH_RUN_FLOOR - 1, 0))
        expect(h.band).toBe("insufficient")
        expect(h.hasEnoughRuns).toBe(false)
    })

    it("boundary: exactly 85 is Healthy, exactly 65 is Watch", () => {
        expect(computeHealth(totals(100, 0.85)).band).toBe("healthy")
        expect(computeHealth(totals(100, 0.65)).band).toBe("watch")
    })
})
