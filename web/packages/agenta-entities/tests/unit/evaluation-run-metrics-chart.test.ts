import {describe, expect, it} from "vitest"

import {
    buildMetricsChart,
    defaultChartSelection,
    type EvaluatorRow,
    type EvaluatorRowMetric,
    type MetricStats,
} from "../../src/evaluationRun"

const binary = (passed: number, failed: number): MetricStats => ({
    type: "binary",
    count: passed + failed,
    frequency: [
        {value: true, count: passed},
        {value: false, count: failed},
    ],
})

const numeric = (mean: number, min: number, max: number): MetricStats => ({
    type: "numeric/continuous",
    count: 4,
    mean,
    min,
    max,
})

const metric = (
    label: string,
    kind: EvaluatorRowMetric["kind"],
    stats: MetricStats | null,
): EvaluatorRowMetric => ({
    id: label,
    stepKey: "step",
    metricKey: `attributes.ag.data.outputs.${label}`,
    label,
    kind,
    stats,
})

const row = (name: string, metrics: EvaluatorRowMetric[]): EvaluatorRow => ({
    stepKey: `${name}-step`,
    evaluatorId: `${name}-id`,
    name,
    metrics,
})

describe("metrics chart values", () => {
    it("A binary metric charts its pass rate and a numeric metric on 0 to 1 its mean", () => {
        const {metrics} = buildMetricsChart([
            {
                key: "run",
                rows: [
                    row("Exact match", [metric("success", "binary", binary(3, 1))]),
                    row("Relevance", [metric("score", "numeric", numeric(0.5, 0, 1))]),
                ],
            },
        ])
        expect(metrics.map((m) => [m.name, m.kind, m.values.run])).toEqual([
            ["Relevance", "numeric", 0.5],
            ["Exact match", "binary", 0.75],
        ])
    })

    it("Metrics are ordered lowest first", () => {
        const {metrics} = buildMetricsChart([
            {
                key: "run",
                rows: [
                    row("A", [metric("x", "binary", binary(9, 1))]),
                    row("B", [metric("x", "binary", binary(1, 9))]),
                    row("C", [metric("x", "numeric", numeric(0.4, 0, 1))]),
                ],
            },
        ])
        expect(metrics.map((m) => m.name)).toEqual(["B", "C", "A"])
    })

    it("The bar name adds the metric label only when the evaluator has several metrics", () => {
        const {metrics} = buildMetricsChart([
            {
                key: "run",
                rows: [
                    row("Judge", [
                        metric("Correct", "binary", binary(1, 1)),
                        metric("Score", "numeric", numeric(0.2, 0, 1)),
                    ]),
                    row("Solo", [metric("Success", "binary", binary(4, 0))]),
                ],
            },
        ])
        expect(metrics.map((m) => m.name)).toEqual(["Judge: Score", "Judge: Correct", "Solo"])
        expect(metrics[0]).toMatchObject({evaluatorName: "Judge", label: "Score"})
    })

    it("Two evaluators with one name get unique bar names", () => {
        const {metrics} = buildMetricsChart([
            {
                key: "run",
                rows: [
                    {...row("Judge", [metric("ok", "binary", binary(1, 3))]), evaluatorId: "a"},
                    {
                        ...row("Judge", [metric("score", "numeric", numeric(0.5, 0, 1))]),
                        evaluatorId: "b",
                    },
                ],
            },
        ])
        expect(metrics.map((m) => [m.name, m.kind])).toEqual([
            ["Judge", "binary"],
            ["Judge (2)", "numeric"],
        ])
    })

    it("A generated name never repeats a real name, and names follow row order, not values", () => {
        const {metrics} = buildMetricsChart([
            {
                key: "run",
                rows: [
                    {
                        ...row("Judge", [metric("a", "numeric", numeric(0.9, 0, 1))]),
                        evaluatorId: "a",
                    },
                    {...row("Judge (2)", [metric("b", "binary", binary(1, 3))]), evaluatorId: "b"},
                    {
                        ...row("Judge", [metric("c", "numeric", numeric(0.1, 0, 1))]),
                        evaluatorId: "c",
                    },
                ],
            },
        ])
        expect(metrics.map((m) => [m.id, m.name])).toEqual([
            ["c:attributes.ag.data.outputs.c", "Judge (3)"],
            ["b:attributes.ag.data.outputs.b", "Judge (2)"],
            ["a:attributes.ag.data.outputs.a", "Judge"],
        ])
    })

    it("Scores off the 0 to 1 scale are counted and left out; categorical metrics are left out", () => {
        const model = buildMetricsChart([
            {
                key: "run",
                rows: [
                    row("Rating", [metric("stars", "numeric", numeric(3.2, 1, 5))]),
                    row("Latency", [metric("ms", "numeric", numeric(120, 80, 300))]),
                    row("Tone", [
                        metric("tone", "categorical", {
                            type: "categorical/single",
                            count: 2,
                            frequency: [{value: "calm", count: 2}],
                        }),
                    ]),
                    row("Pass", [metric("ok", "binary", binary(1, 0))]),
                ],
            },
        ])
        expect(model.metrics.map((m) => m.name)).toEqual(["Pass"])
        expect(model.offScale).toBe(2)
    })

    it("A metric with no results yet is neither charted nor counted as off the scale", () => {
        const model = buildMetricsChart([
            {key: "run", rows: [row("Pending", [metric("score", "numeric", null)])]},
        ])
        expect(model).toEqual({metrics: [], offScale: 0})
    })

    it("Several runs share one entry per metric, with one value per run", () => {
        const rows = (passed: number) => [
            row("Exact", [metric("ok", "binary", binary(passed, 4 - passed))]),
        ]
        const {metrics} = buildMetricsChart([
            {key: "new", rows: rows(1)},
            {key: "old", rows: rows(3)},
        ])
        expect(metrics).toHaveLength(1)
        expect(metrics[0].values).toEqual({new: 0.25, old: 0.75})
    })
})

describe("metric picker default", () => {
    const many = (count: number) =>
        buildMetricsChart([
            {
                key: "run",
                rows: Array.from({length: count}, (_, index) =>
                    row(`E${index}`, [metric("ok", "binary", binary(count - index, index))]),
                ),
            },
        ]).metrics

    it("Every metric is picked when there are 16 or fewer", () => {
        const metrics = many(9)
        expect(defaultChartSelection(metrics)).toHaveLength(9)
    })

    it("With more than 16 metrics the 16 lowest are picked", () => {
        const metrics = many(54)
        const picked = defaultChartSelection(metrics)
        expect(picked).toHaveLength(16)
        expect(picked).toEqual(metrics.slice(0, 16).map((m) => m.id))
        // E53 has the lowest pass rate (1 of 54).
        expect(picked[0]).toBe("E53-id:attributes.ag.data.outputs.ok")
    })
})
