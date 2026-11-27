import {describe, expect, it} from "vitest"

import {
    filterAndSortRows,
    lowestChartValue,
    type EvaluatorRow,
    type EvaluatorRowMetric,
    type EvaluatorRowsView,
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

const row = (stepKey: string, name: string, metrics: EvaluatorRowMetric[]): EvaluatorRow => ({
    stepKey,
    evaluatorId: `id-${stepKey}`,
    name,
    metrics,
})

const ROWS: EvaluatorRow[] = [
    row("tone", "Tone judge", [metric("Tone", "numeric", numeric(0.8, 0, 1))]),
    row("exact", "Exact match", [
        metric("success", "binary", binary(3, 1)),
        metric("score", "numeric", numeric(0.4, 0, 1)),
    ]),
    row("length", "Length", [metric("chars", "numeric", numeric(120, 10, 300))]),
    row("pending", "Awaiting", [metric("Correct", "binary", null)]),
    row("format", "Format", [metric("valid", "binary", binary(1, 1))]),
]

const view = (patch: Partial<EvaluatorRowsView> = {}): EvaluatorRowsView => ({
    search: "",
    hidden: [],
    sort: "lowest",
    ...patch,
})

const keys = (rows: EvaluatorRow[]) => rows.map((r) => r.stepKey)

describe("lowestChartValue", () => {
    it("takes the lowest pass rate or 0 to 1 mean of the row", () => {
        expect(lowestChartValue(ROWS[1])).toBe(0.4)
        expect(lowestChartValue(ROWS[4])).toBe(0.5)
    })

    it("is null for a row with no chartable metric", () => {
        expect(lowestChartValue(ROWS[2])).toBeNull()
        expect(lowestChartValue(ROWS[3])).toBeNull()
        expect(lowestChartValue(row("empty", "Empty", []))).toBeNull()
    })
})

describe("filterAndSortRows", () => {
    it("lowest first by default, rows with no chartable value last by name", () => {
        expect(keys(filterAndSortRows(ROWS, view()))).toEqual([
            "exact",
            "format",
            "tone",
            "pending",
            "length",
        ])
    })

    it("sorts by evaluator name", () => {
        expect(keys(filterAndSortRows(ROWS, view({sort: "name"})))).toEqual([
            "pending",
            "exact",
            "format",
            "length",
            "tone",
        ])
    })

    it("searches the evaluator name, case ignored", () => {
        expect(keys(filterAndSortRows(ROWS, view({search: "  EXACT "})))).toEqual(["exact"])
    })

    it("searches the metric labels and keeps every metric of a matching row", () => {
        const shown = filterAndSortRows(ROWS, view({search: "succ"}))
        expect(keys(shown)).toEqual(["exact"])
        expect(shown[0].metrics.map((m) => m.label)).toEqual(["success", "score"])
        expect(keys(filterAndSortRows(ROWS, view({search: "tone"})))).toEqual(["tone"])
    })

    it("hides the rows the filter clears", () => {
        expect(keys(filterAndSortRows(ROWS, view({hidden: ["exact", "pending"]})))).toEqual([
            "format",
            "tone",
            "length",
        ])
    })

    it("returns no row when nothing matches the search and the filter", () => {
        expect(filterAndSortRows(ROWS, view({search: "nothing"}))).toEqual([])
        expect(filterAndSortRows(ROWS, view({search: "tone", hidden: ["tone"]}))).toEqual([])
    })

    it("does not change the rows it is given", () => {
        const before = keys(ROWS)
        filterAndSortRows(ROWS, view({sort: "name"}))
        expect(keys(ROWS)).toEqual(before)
    })
})
