// The annotation helpers live in @agenta/annotation. They run from the mobile suite.

import {getHumanMetrics, formatHumanMetricLabel} from "@agenta/annotation"
import {
    formatQueueReviewed,
    queueKindLabel,
    queueStatusLabel,
    queueStatusTone,
    scenarioStatusLabel,
    scenarioStatusTone,
    truncateScenarioId,
} from "@agenta/annotation"
import {
    categorizeScenarioEntries,
    categorizeTestcaseFields,
    formatScenarioValue,
} from "@agenta/annotation"
import {describe, expect, it} from "vitest"

describe("annotation helpers", () => {
    it("Queue status labels match the old list", () => {
        const statuses = [
            "pending",
            "queued",
            "running",
            "success",
            "failure",
            "errors",
            "cancelled",
        ]
        expect(statuses.map(queueStatusLabel)).toEqual([
            "Pending",
            "Queued",
            "Running",
            "Completed",
            "Failed",
            "Errors",
            "Cancelled",
        ])
        expect(statuses.map(queueStatusTone)).toEqual([
            "default",
            "processing",
            "processing",
            "success",
            "error",
            "error",
            "warning",
        ])
        expect(queueStatusLabel(null)).toBe("Pending")
        expect(queueStatusLabel("PAUSED")).toBe("Paused")
        expect(queueKindLabel("testcases")).toBe("Test cases")
        expect(queueKindLabel("other")).toBe("")
    })

    it("A failed scenario reads Failed, not Pending", () => {
        expect(scenarioStatusLabel("failure")).toBe("Failed")
        expect(scenarioStatusLabel("errors")).toBe("Errors")
        expect(scenarioStatusLabel("cancelled")).toBe("Cancelled")
        expect(scenarioStatusLabel("success")).toBe("Success")
        expect(scenarioStatusTone("failure")).toBe("error")
        expect(scenarioStatusTone("success")).toBe("success")
    })

    it("Reviewed reads No items for an empty queue and X out of Y otherwise", () => {
        expect(formatQueueReviewed({completed: 0, total: 0})).toBe("No items")
        expect(formatQueueReviewed({completed: 3, total: 8})).toBe("3 out of 8")
        expect(formatQueueReviewed(null)).toBe("")
    })

    it("Long scenario ids are cut to five characters on each side", () => {
        expect(truncateScenarioId("0123456789abcdef")).toBe("01234...bcdef")
        expect(truncateScenarioId("0123456789abcd")).toBe("0123456789abcd")
    })

    it("Human metrics list name and type from the first schema that has outputs", () => {
        const metrics = getHumanMetrics({
            data: {
                schemas: {outputs: {properties: {}}},
                service: {
                    format: {
                        properties: {
                            outputs: {
                                properties: {
                                    score: {type: "number"},
                                    tags: {type: "array", items: {type: "string"}},
                                    label: {enum: ["a", "b"]},
                                },
                            },
                        },
                    },
                },
                configuration: {outputs: {properties: {ignored: {type: "string"}}}},
            },
        })
        expect(metrics).toEqual([
            {name: "score", type: "number"},
            {name: "tags", type: "array<string>"},
            {name: "label", type: "enum"},
        ])
        expect(formatHumanMetricLabel(metrics[0])).toBe("score: number")
        expect(getHumanMetrics({data: null})).toEqual([])
    })

    it("Test case fields split into inputs, outputs and expected outputs", () => {
        expect(
            categorizeTestcaseFields({
                question: "q",
                output: "o",
                expected_output: "e",
                testcase_dedup_id: "x",
            }),
        ).toEqual({
            inputs: [["question", "q"]],
            outputs: [["output", "o"]],
            expectedOutputs: [["expected_output", "e"]],
        })
    })

    it("A scenario record splits into sections and drops internal keys", () => {
        const result = categorizeScenarioEntries({
            id: "1",
            trace_id: "t",
            question: "q",
            status: "success",
            meta: {answer: "a", response: "r", golden: "g", span_id: "s"},
            tags: {trace_id: "t", topic: "x"},
        })
        expect(result.inputs).toEqual([
            ["question", "q"],
            ["answer", "a"],
        ])
        expect(result.outputs).toEqual([["response", "r"]])
        expect(result.expectedOutputs).toEqual([["golden", "g"]])
        expect(result.metaEntries).toEqual([["status", "success"]])
        expect(result.tags).toEqual({topic: "x"})
        expect(formatScenarioValue(null)).toBe("—")
        expect(formatScenarioValue({a: 1})).toBe('{\n  "a": 1\n}')
    })
})
