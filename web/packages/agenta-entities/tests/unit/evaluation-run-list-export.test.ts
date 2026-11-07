/**
 * The runs list export and the column menu against real runs captured from a test stack: two auto
 * runs with three evaluators and a live run. Expected lines are what the old list exports.
 */
import {describe, expect, it} from "vitest"

import {
    buildCsv,
    runListExportHeaders,
    runListExportRow,
    type RunListExportNames,
} from "../../src/evaluationRun/core/runExport"
import {runListColumns, visibleRunListColumns} from "../../src/evaluationRun/core/runListColumns"
import {buildRunStatsMap} from "../../src/evaluationRun/core/runStatsMap"
import autoDefault from "../fixtures/evaluationRun/auto-default-v3.json"
import autoVerbose from "../fixtures/evaluationRun/auto-verbose-v2.json"
import live from "../fixtures/evaluationRun/live.json"

const NAMES: Record<string, string> = {
    "answer-correctness": "Answer correctness",
    "exact-match": "Exact match",
    "starts-uppercase": "Starts uppercase",
}

const names: RunListExportNames = {
    testset: "Capitals",
    application: "Capital finder",
    query: null,
    createdBy: "Alex",
}

describe("runs list export", () => {
    const plan = runListColumns([autoDefault.run, autoVerbose.run], "auto")

    it("writes one header per column on screen, metrics under their evaluator", () => {
        expect(runListExportHeaders(plan, NAMES)).toEqual([
            "Status",
            "Name",
            "Test set",
            "Application",
            "Answer correctness • Score",
            "Exact match • Success",
            "Starts uppercase • Success",
            "Invocation • Cost",
            "Invocation • Duration",
            "Invocation • Tokens",
            "Invocation • Errors",
            "Created on",
            "Created by",
        ])
    })

    it("names an evaluator by its id while its name has not loaded", () => {
        expect(runListExportHeaders(plan, {})[4]).toBe("answer-correctness • Score")
    })

    it("writes a run's line with the same metric text the list cell prints", () => {
        const stats = buildRunStatsMap(autoDefault.run, autoDefault.metrics)
        expect(runListExportRow(autoDefault.run, plan, {names, stats})).toEqual([
            "success",
            "Capitals: default v3",
            "Capitals",
            "Capital finder",
            "true",
            "true",
            "true",
            "$0.000005",
            "522ms",
            "40",
            "—",
            "2026-11-05T18:33:17.447Z",
            "Alex",
        ])
    })

    it("writes a dash for an evaluator the run did not use, and dashes while metrics are missing", () => {
        const onlyDefault = runListColumns([autoDefault.run, live.run], "all")
        const row = runListExportRow(live.run, onlyDefault, {
            names: {...names, testset: null, application: null, query: "Trace Type is invocation"},
            stats: null,
        })
        const headers = runListExportHeaders(onlyDefault, NAMES)
        const cell = (header: string) => row[headers.indexOf(header)]
        expect(cell("Kind")).toBe("Live")
        expect(cell("Test set")).toBe("")
        expect(cell("Query")).toBe("Trace Type is invocation")
        expect(cell("Exact match • Success")).toBe("—")
        expect(cell("Invocation • Cost")).toBe("—")
        expect(row).toHaveLength(headers.length)
    })

    it("leaves out the columns the reader hid", () => {
        const visible = visibleRunListColumns(
            plan,
            new Set(["application", "exact-match:attributes.ag.data.outputs.success", "tokens"]),
        )
        expect(runListExportHeaders(visible, NAMES)).toEqual([
            "Status",
            "Name",
            "Test set",
            "Answer correctness • Score",
            "Starts uppercase • Success",
            "Invocation • Cost",
            "Invocation • Duration",
            "Invocation • Errors",
            "Created on",
            "Created by",
        ])
        const stats = buildRunStatsMap(autoDefault.run, autoDefault.metrics)
        expect(runListExportRow(autoDefault.run, visible, {names, stats})).toHaveLength(10)
    })

    it("guards a run name that starts like a formula", () => {
        const run = {...autoDefault.run, name: "=HYPERLINK(1)"}
        const line = runListExportRow(run, plan, {names, stats: null})
        expect(buildCsv(["Name"], [[line[1]]])).toBe("Name\n'=HYPERLINK(1)")
    })
})

describe("column visibility", () => {
    const plan = runListColumns([autoDefault.run, autoVerbose.run], "auto")

    it("returns the same plan when nothing is hidden", () => {
        expect(visibleRunListColumns(plan, new Set())).toBe(plan)
    })

    it("drops an evaluator whose metrics are all hidden", () => {
        const visible = visibleRunListColumns(
            plan,
            new Set(["answer-correctness:attributes.ag.data.outputs.score"]),
        )
        expect(visible.evaluators.map((group) => group.id)).toEqual([
            "exact-match",
            "starts-uppercase",
        ])
    })
})
