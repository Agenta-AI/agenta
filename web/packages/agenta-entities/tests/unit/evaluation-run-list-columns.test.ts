/**
 * The runs list columns against real runs captured from a test stack: two auto runs with three
 * evaluators and a live run with two. Expected columns are the ones the old app's list shows.
 */
import {describe, expect, it} from "vitest"

import {flattenQueryConditions} from "../../src/evaluationRun/core/liveQuery"
import {
    humanizeMetricPath,
    isTextOutputMetric,
    runListColumns,
    runMetricCellView,
} from "../../src/evaluationRun/core/runListColumns"
import {buildRunStatsMap, runLevelMetricRow} from "../../src/evaluationRun/core/runStatsMap"
import autoDefault from "../fixtures/evaluationRun/auto-default-v3.json"
import autoVerbose from "../fixtures/evaluationRun/auto-verbose-v2.json"
import live from "../fixtures/evaluationRun/live.json"

const SUCCESS = "attributes.ag.data.outputs.success"

describe("runs list columns", () => {
    it("shows the test set and app on the auto tab, with one column per evaluator metric", () => {
        const columns = runListColumns([autoDefault.run, autoVerbose.run], "auto")
        expect(columns.showKind).toBe(false)
        expect(columns.references).toEqual(["testset", "application"])
        expect(
            columns.evaluators.map((group) => [group.id, group.columns.map((c) => c.label)]),
        ).toEqual([
            ["answer-correctness", ["Score"]],
            ["exact-match", ["Success"]],
            ["starts-uppercase", ["Success"]],
        ])
        expect(columns.invocation.map((column) => column.label)).toEqual([
            "Cost",
            "Duration",
            "Tokens",
            "Errors",
        ])
    })

    it("keeps each run's step for a metric column both runs share", () => {
        const columns = runListColumns([autoDefault.run, autoVerbose.run], "auto")
        const exactMatch = columns.evaluators.find((group) => group.id === "exact-match")
        expect(exactMatch?.columns[0].metricKey).toBe(SUCCESS)
        expect(exactMatch?.columns[0].stepKeysByRunId).toEqual({
            [autoDefault.run.id]: "evaluator-exact-match",
            [autoVerbose.run.id]: "evaluator-exact-match",
        })
    })

    it("shows the query and the live evaluators on the live tab", () => {
        const columns = runListColumns([live.run], "online")
        expect(columns.references).toEqual(["query"])
        expect(columns.evaluators.map((group) => group.id)).toEqual([
            "answer-correctness",
            "starts-uppercase",
        ])
    })

    it("adds the Kind column and every reference the runs use on the All tab", () => {
        const columns = runListColumns([autoDefault.run, live.run], "all")
        expect(columns.showKind).toBe(true)
        expect(columns.references).toEqual(["testset", "query", "application"])
    })

    it("falls back to the tab's columns when there are no runs", () => {
        expect(runListColumns([], "online").references).toEqual(["query"])
        expect(runListColumns([], "human").references).toEqual(["testset", "application"])
        expect(runListColumns([], "all").evaluators).toEqual([])
    })

    it("humanizes metric paths like the old app", () => {
        expect(humanizeMetricPath("attributes.ag.data.outputs.score")).toBe("Score")
        expect(humanizeMetricPath("outputs.is_valid")).toBe("Output Is Valid")
        expect(humanizeMetricPath("attributes.ag.data.outputs.json_id")).toBe("JSON ID")
    })
})

describe("text output metrics", () => {
    const schema = {
        properties: {
            comment: {type: "string"},
            score: {type: "number"},
            approved: {type: "boolean"},
        },
    }

    it("hides a metric the evaluator types as a string, as the old list does", () => {
        expect(isTextOutputMetric(schema, "attributes.ag.data.outputs.comment")).toBe(true)
        expect(isTextOutputMetric(schema, "attributes.ag.data.outputs.score")).toBe(false)
        expect(isTextOutputMetric(schema, "attributes.ag.data.outputs.approved")).toBe(false)
    })

    it("keeps a metric when the schema is missing or does not name it", () => {
        expect(isTextOutputMetric(null, "attributes.ag.data.outputs.comment")).toBe(false)
        expect(isTextOutputMetric(schema, "attributes.ag.data.outputs.other")).toBe(false)
    })

    it("keeps each evaluator's revision for the schema lookup", () => {
        const columns = runListColumns([autoDefault.run], "auto")
        expect(columns.evaluators.every((group) => Boolean(group.evaluatorRevisionId))).toBe(true)
    })
})

describe("metric cell view", () => {
    const map = buildRunStatsMap(autoDefault.run, autoDefault.metrics)

    it("draws a boolean evaluator metric as a bar", () => {
        const view = runMetricCellView("evaluator", map[`evaluator-exact-match.${SUCCESS}`], "true")
        expect(view.kind).toBe("bar")
    })

    it("prints the most frequent value with its count when there are more than two", () => {
        const view = runMetricCellView(
            "evaluator",
            {
                frequency: [
                    {value: "b", count: 2},
                    {value: "a", count: 5},
                    {value: "c", count: 1},
                ],
            },
            "a",
        )
        expect(view).toEqual({kind: "categories", text: "a (5)"})
    })

    it("prints numbers and invocation metrics as text", () => {
        expect(runMetricCellView("evaluator", {mean: 0.5}, "0.5")).toEqual({
            kind: "text",
            text: "0.5",
        })
        expect(runMetricCellView("invocation", {frequency: [{value: 1, count: 1}]}, "1")).toEqual({
            kind: "text",
            text: "1",
        })
    })
})

describe("latest run-level row", () => {
    it("reads a live run's newest window for the list and the static row for the summary", () => {
        const latest = runLevelMetricRow(live.metrics, "latest")
        const newest = [...live.metrics]
            .filter((metric) => metric.timestamp)
            .sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? ""))[0]
        expect(latest?.timestamp).toBe(newest.timestamp)
        expect(runLevelMetricRow(live.metrics)?.timestamp ?? null).toBeNull()
    })

    it("falls back to the static row when no row has a time", () => {
        const row = runLevelMetricRow(autoDefault.metrics, "latest")
        expect(row).toBe(runLevelMetricRow(autoDefault.metrics))
    })
})

describe("stored query conditions", () => {
    it("flattens nested groups and reads an empty operator as is", () => {
        expect(
            flattenQueryConditions({
                operator: "and",
                conditions: [
                    {field: "trace_type", operator: "is", value: "invocation"},
                    {
                        operator: "or",
                        conditions: [{field: "references", operator: "", value: [{id: "x"}]}],
                    },
                    {operator: "is", value: "skipped"},
                ],
            }),
        ).toEqual([
            {field: "trace_type", key: undefined, operator: "is", value: "invocation"},
            {field: "references", key: undefined, operator: "is", value: [{id: "x"}]},
        ])
        expect(flattenQueryConditions(null)).toEqual([])
    })
})
