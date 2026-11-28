import {describe, expect, it} from "vitest"

import {
    assertionSummary,
    sortEvaluatorResults,
    summarizeEvaluatorResult,
    type EvaluatorResultMetricInput,
    type MetricKind,
} from "../../src/evaluationRun/core"

const metric = (
    name: string,
    value: unknown,
    kind: MetricKind | null,
): EvaluatorResultMetricInput => ({
    name,
    value,
    kind,
})

describe("summarizeEvaluatorResult", () => {
    it("shows up to three short metrics inline, by name, and never fails without a false one", () => {
        const summary = summarizeEvaluatorResult(
            [
                metric("success", true, "binary"),
                metric("score", 0.35, "numeric"),
                metric("label", "partial", "categorical"),
            ],
            "done",
        )
        expect(summary.inline).toEqual({
            kind: "metrics",
            metrics: [
                {name: "success", value: true, kind: "binary"},
                {name: "score", value: 0.35, kind: "numeric"},
                {name: "label", value: "partial", kind: "categorical"},
            ],
        })
        expect(summary.failed).toBe(false)
        expect(summary.binary).toEqual({passed: 1, total: 1})
    })

    it("counts 7 binary metrics with 2 false as 5 of 7 passed with the failed names", () => {
        const values = [true, true, false, true, false, true, true]
        const summary = summarizeEvaluatorResult(
            values.map((value, index) => metric(`check ${index + 1}`, value, "binary")),
            "done",
        )
        expect(summary.inline).toEqual({
            kind: "passed",
            passed: 5,
            total: 7,
            failedNames: ["check 3", "check 5"],
        })
        expect(summary.short).toHaveLength(7)
        expect(summary.failed).toBe(true)
    })

    it("counts only the binary metrics when numbers sit next to them", () => {
        const summary = summarizeEvaluatorResult(
            [
                metric("a", true, "binary"),
                metric("b", false, "binary"),
                metric("c", 0.83, "numeric"),
                metric("d", 1, "numeric"),
            ],
            "done",
        )
        expect(summary.inline).toMatchObject({kind: "passed", passed: 1, total: 2})
    })

    it("shows the first two of 6 numbers and +4 more, never passed, never failed", () => {
        const names = ["Accuracy", "Coverage", "F1", "MRR", "Hits", "Recall"]
        const summary = summarizeEvaluatorResult(
            names.map((name, index) => metric(name, index / 10, "numeric")),
            "done",
        )
        expect(summary.inline).toEqual({
            kind: "first",
            metrics: [
                {name: "Accuracy", value: 0, kind: "numeric"},
                {name: "Coverage", value: 0.1, kind: "numeric"},
            ],
            more: 4,
        })
        expect(summary.failed).toBe(false)
        expect(summary.binary.total).toBe(0)
    })

    it("keeps text metrics, a string and an object, off the row and on expand", () => {
        const summary = summarizeEvaluatorResult(
            [
                metric("success", true, "binary"),
                metric("reason", "The agent checked the order date.", "text"),
                metric("details", {missing: ["price"]}, "text"),
            ],
            "done",
        )
        expect(summary.inline).toEqual({
            kind: "metrics",
            metrics: [{name: "success", value: true, kind: "binary"}],
        })
        expect(summary.text.map((entry) => entry.name)).toEqual(["reason", "details"])
    })

    it("draws the states with no metrics: error fails, pending and not run do not", () => {
        const values = [metric("success", true, "binary")]
        const error = summarizeEvaluatorResult(values, "error")
        expect(error).toMatchObject({state: "error", failed: true, short: [], text: []})
        expect(summarizeEvaluatorResult(values, "pending")).toMatchObject({
            state: "pending",
            failed: false,
            short: [],
        })
        expect(summarizeEvaluatorResult(values, "notRun")).toMatchObject({
            state: "notRun",
            failed: false,
        })
    })

    it("reads the kind from the value when there is no catalog (the trace view)", () => {
        const summary = summarizeEvaluatorResult(
            [
                metric("valid", false, null),
                metric("score", 0.6, null),
                metric("note", "Ask again after the pilot.", null),
            ],
            "done",
        )
        expect(summary.short.map((entry) => entry.kind)).toEqual(["binary", "numeric"])
        expect(summary.text.map((entry) => entry.kind)).toEqual(["text"])
        expect(summary.failed).toBe(true)
    })

    it("keeps a category label short only with the catalog kind", () => {
        const fromCatalog = summarizeEvaluatorResult(
            [metric("tone", "friendly", "categorical")],
            "done",
        )
        expect(fromCatalog.short).toHaveLength(1)
        const fromValue = summarizeEvaluatorResult([metric("tone", "friendly", null)], "done")
        expect(fromValue.text).toHaveLength(1)
    })
})

describe("sortEvaluatorResults", () => {
    it("puts failed and errored first by name, then the rest, then not run", () => {
        const row = (name: string, metrics: EvaluatorResultMetricInput[], state = "done") => ({
            name,
            summary: summarizeEvaluatorResult(metrics, state as "done"),
        })
        const rows = [
            row("D", [], "notRun"),
            row("A", [metric("ok", true, "binary")]),
            row("C", [], "error"),
            row("B", [metric("ok", false, "binary")]),
        ]
        expect(sortEvaluatorResults(rows).map((entry) => entry.name)).toEqual(["B", "C", "A", "D"])
    })
})

describe("assertionSummary", () => {
    it("counts true binary metrics over all binary metrics of the test case", () => {
        const summaries = [
            summarizeEvaluatorResult(
                [
                    metric("a", true, "binary"),
                    metric("b", false, "binary"),
                    metric("s", 1, "numeric"),
                ],
                "done",
            ),
            summarizeEvaluatorResult(
                [metric("c", true, "binary"), metric("d", true, "binary")],
                "done",
            ),
        ]
        expect(assertionSummary(summaries)).toEqual({kind: "assertions", passed: 3, total: 4})
    })

    it("gives the first number of up to two evaluators when no metric is binary", () => {
        const summaries = [
            summarizeEvaluatorResult(
                [metric("label", "ok", "categorical"), metric("relevance", 0.8, "numeric")],
                "done",
            ),
            summarizeEvaluatorResult([metric("faithfulness", 0.9, "numeric")], "done"),
            summarizeEvaluatorResult([metric("brevity", 0.4, "numeric")], "done"),
        ]
        expect(assertionSummary(summaries)).toEqual({
            kind: "mainNumbers",
            items: [
                {name: "relevance", value: 0.8},
                {name: "faithfulness", value: 0.9},
            ],
        })
    })
})
