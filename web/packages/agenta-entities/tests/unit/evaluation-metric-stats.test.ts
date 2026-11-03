import {describe, expect, it} from "vitest"

import {
    formatCost,
    formatDuration,
    formatTokens,
    frequencyBars,
    histogramBars,
    metricSummary,
    normalizeMetricStats,
    radarAxes,
    type RadarMetricInput,
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

const evaluator = (id: string, raw: Record<string, unknown>): RadarMetricInput => ({
    id,
    kind: "evaluator",
    name: id,
    stats: stats(raw),
})

const invocation = (id: string, mean: number, max: number): RadarMetricInput => ({
    id,
    kind: "invocation",
    name: id === "cost" ? "Cost" : "Duration",
    stats: stats({type: "numeric/continuous", mean, max}),
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

    it("Histogram labels come from each bin interval even when a bin is missing", () => {
        const bars = histogramBars(
            stats({
                type: "numeric/continuous",
                min: 0,
                max: 3,
                hist: [
                    {bin: 1, count: 4, interval: [0, 1]},
                    // The API left out the empty bin [1, 2].
                    {bin: 3, count: 2, interval: [2, 3]},
                ],
            }),
        )
        expect(bars).toEqual([
            {category: "0–1", value: 4},
            {category: "2–3", value: 2},
        ])
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

    it("Radar axes add duration and cost when there are fewer than three evaluator metrics", () => {
        const axes = radarAxes(
            {
                r1: [
                    evaluator("score", {type: "numeric/continuous", mean: 0.5, max: 1}),
                    invocation("cost", 0.002, 0.004),
                    invocation("duration", 1.5, 3),
                ],
            },
            ["r1"],
        )
        expect(axes.map((axis) => axis.name)).toEqual(["score", "Duration", "Cost"])
        expect(axes[0]).toEqual({
            name: "score",
            max: 1,
            values: {r1: {raw: 0.5, normalized: 0.5}},
        })

        const three = radarAxes(
            {
                r1: [
                    evaluator("a", {type: "binary", freq: [{value: true, count: 1}]}),
                    evaluator("b", {mean: 2, max: 4}),
                    evaluator("c", {mean: 1}),
                    invocation("duration", 1, 2),
                ],
            },
            ["r1"],
        )
        expect(three.map((axis) => [axis.name, axis.max])).toEqual([
            ["a", 100],
            ["b", 4],
            ["c", 1],
        ])
    })

    it("A run without a value on an axis gets null, not zero", () => {
        const axes = radarAxes(
            {
                base: [evaluator("score", {mean: 3, max: 5})],
                other: [],
            },
            ["base", "other"],
        )
        expect(axes[0].values).toEqual({base: {raw: 3, normalized: 0.6}, other: null})
    })

    it("Cost, duration and token formats match the overview table", () => {
        expect(formatCost(12.5)).toBe("$12.50")
        expect(formatCost(0.000123456)).toBe("$0.000123")
        expect(formatDuration(0.4567)).toBe("457 ms")
        expect(formatDuration(8.48)).toBe("8.48 s")
        expect(formatTokens(950)).toBe("950")
        expect(formatTokens(12_340)).toBe("12.3K")
        expect(formatTokens(4_500_000)).toBe("4.5M")
    })
})
