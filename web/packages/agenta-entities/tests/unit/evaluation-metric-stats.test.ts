import {describe, expect, it} from "vitest"

import {
    formatCost,
    formatDuration,
    formatTokens,
    frequencyBars,
    metricSummary,
    normalizeMetricStats,
} from "../../src/evaluationRun"

const stats = (raw: Record<string, unknown>) => normalizeMetricStats(raw)

const binary = (trueCount: number, falseCount: number) =>
    stats({
        type: "binary",
        freq: [
            {value: true, count: trueCount},
            {value: false, count: falseCount},
        ],
    })

describe("metric stats", () => {
    it("Boolean stats summarize as the percent of true with two decimals", () => {
        expect(metricSummary(binary(2, 1))).toEqual({
            value: (2 / 3) * 100,
            formatted: "66.67%",
            kind: "boolean",
            label: "true",
        })
    })

    it("Numeric stats summarize as the mean, else the median, else the max", () => {
        expect(metricSummary(stats({type: "numeric/continuous", mean: 0.123456, max: 9}))).toEqual({
            value: 0.123456,
            formatted: "0.123",
            kind: "numeric",
            label: "mean",
        })
        expect(metricSummary(stats({median: 1234.5, max: 9}))?.formatted).toBe("1230")
        expect(metricSummary(stats({median: 1234.5, max: 9}))?.label).toBe("median")
        expect(metricSummary(stats({max: 7}))?.label).toBe("max")
        expect(metricSummary(stats({type: "numeric/continuous"}))).toBeNull()
    })

    it("Frequency bars sort by count, then true before false", () => {
        expect(
            frequencyBars(
                stats({
                    freq: [
                        {value: false, count: 3},
                        {value: "maybe", count: 1},
                        {value: true, count: 3},
                    ],
                }),
            ),
        ).toEqual([
            {category: "true", value: 3},
            {category: "false", value: 3},
            {category: "maybe", value: 1},
        ])
        expect(
            frequencyBars(
                stats({
                    freq: [
                        {value: "b", count: 2},
                        {value: "a", count: 2},
                        {value: "c", count: 5},
                    ],
                }),
                2,
            ),
        ).toEqual([
            {category: "c", value: 5},
            {category: "a", value: 2},
        ])
    })

    it("Cost, duration and token formats match the overview table", () => {
        expect(formatCost(12.5)).toBe("$12.50")
        expect(formatCost(0.000123456)).toBe("$0.000123")
        // Milliseconds, the unit of `attributes.ag.metrics.duration.cumulative`.
        expect(formatDuration(456.7)).toBe("457 ms")
        expect(formatDuration(8_480)).toBe("8.48 s")
        expect(formatTokens(950)).toBe("950")
        expect(formatTokens(12_340)).toBe("12.3K")
        expect(formatTokens(4_500_000)).toBe("4.5M")
    })
})
