import type {AnalyticsResponse} from "@agenta/entities/trace"
import {describe, expect, it} from "vitest"

import {analyticsToAgentWindow, analyticsToBreakdowns, hasCoverage} from "./agentAnalytics"

const TRACE = "attributes.ag.type.trace"
const DURATION = "attributes.ag.metrics.duration.cumulative"
const COST = "attributes.gen_ai.usage.cost"
const TOK_TOTAL = "attributes.ag.metrics.tokens.cumulative.total"
const TOK_PROMPT = "attributes.ag.metrics.tokens.cumulative.prompt"
const TOK_COMPLETION = "attributes.ag.metrics.tokens.cumulative.completion"
const HARNESS = "attributes.ag.data.parameters.agent.harness.kind"
const MODEL = "attributes.ag.data.parameters.agent.llm.model"

const bucket = (timestamp: string, metrics: Record<string, Record<string, unknown>>) => ({
    timestamp,
    metrics,
})

describe("analyticsToAgentWindow", () => {
    it("splits success/failed, reads single-total cost and tokens, and the nested p95", () => {
        const unfiltered: AnalyticsResponse = {
            buckets: [
                bucket("2026-08-01T00:00:00", {
                    [TRACE]: {count: 10},
                    [DURATION]: {count: 10, sum: 2000, min: 50, max: 800, pcts: {p95: 600}},
                    [COST]: {sum: 1.0, count: 10},
                    [TOK_TOTAL]: {sum: 250, count: 10},
                    [TOK_PROMPT]: {sum: 100, count: 10},
                    [TOK_COMPLETION]: {sum: 150, count: 10},
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
        expect(b.tokensPrompt).toBe(100)
        expect(b.tokensCompletion).toBe(150)

        expect(totals.totalRuns).toBe(10)
        expect(totals.totalCost).toBeCloseTo(1.0)
        expect(totals.totalTokens).toBe(250)
        expect(totals.costCount).toBe(10)
        expect(totals.tokenSplitCount).toBe(10)
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
        const {buckets} = analyticsToAgentWindow(unfiltered, {buckets: []}, "24_hours")
        expect(buckets[0].failed).toBe(0)
        expect(buckets[0].success).toBe(4)
    })

    it("zero-fills a continuous x-axis so sparse buckets keep their real position", () => {
        // Two non-empty 12h buckets a day apart, inside a 2-day window.
        const unfiltered: AnalyticsResponse = {
            buckets: [
                bucket("2026-07-28T00:00:00.000Z", {[TRACE]: {count: 5}}),
                bucket("2026-07-29T00:00:00.000Z", {[TRACE]: {count: 3}}),
            ],
        }
        const {buckets} = analyticsToAgentWindow(unfiltered, {buckets: []}, "30_days", {
            oldest: "2026-07-28T00:00:00.000Z",
            newest: "2026-07-29T12:00:00.000Z",
            intervalMinutes: 720, // 12h
        })

        // 4 slots at 12h across a 36h window; the two empty slots are zero-filled.
        expect(buckets).toHaveLength(4)
        expect(buckets.map((b) => b.runs)).toEqual([5, 0, 3, 0])
    })

    it("returns zeroed totals for an empty response", () => {
        const {buckets, totals} = analyticsToAgentWindow({buckets: []}, {buckets: []}, "7_days")
        expect(buckets).toHaveLength(0)
        expect(totals.totalRuns).toBe(0)
        expect(totals.totalCost).toBe(0)
        expect(totals.costCount).toBe(0)
    })
})

describe("hasCoverage", () => {
    it("passes at or above the threshold, fails below it, and fails with no runs", () => {
        expect(hasCoverage(6, 10, 0.5)).toBe(true)
        expect(hasCoverage(5, 10, 0.5)).toBe(true)
        expect(hasCoverage(4, 10, 0.5)).toBe(false)
        expect(hasCoverage(5, 0, 0.5)).toBe(false)
    })
})

describe("analyticsToBreakdowns", () => {
    it("sums freq counts per category and sorts descending", () => {
        const response: AnalyticsResponse = {
            buckets: [
                bucket("t1", {
                    [HARNESS]: {
                        freq: [
                            {value: "claude", count: 3},
                            {value: "pi", count: 1},
                        ],
                    },
                    [MODEL]: {freq: [{value: "gpt-4o", count: 4}]},
                }),
                bucket("t2", {
                    [HARNESS]: {freq: [{value: "pi", count: 5}]},
                }),
            ],
        }

        const {harness, model} = analyticsToBreakdowns(response)

        expect(harness).toEqual([
            {key: "pi", label: "pi", count: 6},
            {key: "claude", label: "claude", count: 3},
        ])
        expect(model).toEqual([{key: "gpt-4o", label: "gpt-4o", count: 4}])
    })

    it("skips empty/nullish category values and tolerates a null response", () => {
        const response: AnalyticsResponse = {
            buckets: [bucket("t", {[HARNESS]: {freq: [{value: "", count: 2}, {count: 3}]}})],
        }
        expect(analyticsToBreakdowns(response).harness).toEqual([])
        expect(analyticsToBreakdowns(null)).toEqual({harness: [], model: []})
    })
})
