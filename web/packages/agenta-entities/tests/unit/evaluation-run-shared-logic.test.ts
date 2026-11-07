/**
 * The shared evaluation logic against real API responses, captured from a test stack: two finished
 * auto runs on the same test set and evaluators, and a live run (its static row and four
 * timestamped rows). Expected texts are what the old app prints for the same responses.
 */
import {describe, expect, it} from "vitest"

import {formatMetricNumber, formatMetricValue} from "../../src/evaluationRun/core/metricFormat"
import {booleanTruePercent} from "../../src/evaluationRun/core/metricStats"
import {
    compareBlockReason,
    compareCandidates,
    compareParamValue,
    MAX_COMPARISON_RUNS,
    parseCompareParam,
    runComparisonStructure,
    toggleCompareRun,
} from "../../src/evaluationRun/core/runCompare"
import {
    buildCsv,
    csvCell,
    metricExportHeader,
    runExportCreatedAt,
    runExportFilename,
    runExportKind,
} from "../../src/evaluationRun/core/runExport"
import {
    buildRunReferencePayload,
    buildRunsQueryBody,
    countRunListFilters,
    runListTabFlags,
} from "../../src/evaluationRun/core/runFilters"
import {
    buildRunStatsMap,
    invocationMetricValues,
    mergeMetricStats,
    runLevelMetricRow,
    selectRunMetricStats,
} from "../../src/evaluationRun/core/runStatsMap"
import autoDefault from "../fixtures/evaluationRun/auto-default-v3.json"
import autoVerbose from "../fixtures/evaluationRun/auto-verbose-v2.json"
import live from "../fixtures/evaluationRun/live.json"

const DURATION = "attributes.ag.metrics.duration.cumulative"
const COST = "attributes.ag.metrics.costs.cumulative.total"
const TOKENS = "attributes.ag.metrics.tokens.cumulative.total"
const ERRORS = "attributes.ag.metrics.errors.cumulative"
const APP_STEP = "application-step"
const STARTS_UPPERCASE_STEP = "evaluator-starts-uppercase"
const SUCCESS = "attributes.ag.data.outputs.success"

describe("run-level metric aggregation", () => {
    const map = buildRunStatsMap(autoDefault.run, autoDefault.metrics)

    it("takes the invocation metrics from the app step only", () => {
        const duration = selectRunMetricStats(map, {metricKey: DURATION})
        expect(duration?.mean).toBeCloseTo(522.3472, 4)
        expect(duration?.count).toBe(10)
        expect(formatMetricValue(DURATION, duration)).toBe(
            formatMetricValue(DURATION, {mean: 522.3472}),
        )
        expect(invocationMetricValues(selectRunMetricStats(map, {metricKey: TOKENS}))).toEqual({
            mean: 40.2,
            total: 402,
        })
    })

    it("shows why the old app printed 261 ms: it averaged one evaluator step into the app's duration", () => {
        const app = selectRunMetricStats(map, {metricKey: DURATION, stepKey: APP_STEP})
        const evaluator = selectRunMetricStats(map, {
            metricKey: DURATION,
            stepKey: STARTS_UPPERCASE_STEP,
        })
        expect(app && evaluator).toBeTruthy()
        // The old flatten set the app's stats, then merged the next step in: (5223.472 + 2.091) / 20.
        const oldAppValue = mergeMetricStats(app ?? undefined, evaluator ?? {})
        expect(oldAppValue.mean).toBeCloseTo(261.278, 3)
        expect(selectRunMetricStats(map, {metricKey: DURATION})?.mean).not.toBeCloseTo(261.278, 0)
    })

    // The old list cells and CSV export print cost with the shared currency formatter ("$0.000005");
    // only the old overview table used its own 2-decimal formatter ("$0.00").
    it("prints the list and export cells as the old app does", () => {
        expect(formatMetricValue(TOKENS, selectRunMetricStats(map, {metricKey: TOKENS}))).toBe("40")
        expect(formatMetricValue(COST, selectRunMetricStats(map, {metricKey: COST}))).toBe(
            "$0.000005",
        )
        expect(formatMetricValue(ERRORS, null)).toBe("—")
    })

    it("keeps each evaluator's metric under its own step", () => {
        const success = selectRunMetricStats(map, {
            metricKey: SUCCESS,
            stepKey: STARTS_UPPERCASE_STEP,
        })
        expect(success?.type).toBe("binary")
        expect(booleanTruePercent(success)).toBe(100)
        expect(formatMetricValue(SUCCESS, success)).toBe("true")
        expect(
            selectRunMetricStats(map, {metricKey: SUCCESS, stepKey: "evaluator-unknown"}),
        ).toBeNull()
    })

    it("merges counts, sums and frequencies", () => {
        const merged = mergeMetricStats(
            {count: 2, sum: 4, min: 1, max: 3, frequency: [{value: true, count: 2}]},
            {
                count: 2,
                mean: 5,
                min: 0,
                max: 9,
                frequency: [
                    {value: true, count: 1},
                    {value: false, count: 1},
                ],
            },
        )
        expect(merged).toMatchObject({count: 4, sum: 14, mean: 3.5, min: 0, max: 9})
        expect(merged.frequency).toEqual([
            {value: true, count: 3},
            {value: false, count: 1},
        ])
    })
})

describe("live run summary", () => {
    it("reads the static row, not the newest minute", () => {
        const row = runLevelMetricRow(live.metrics)
        expect(row?.timestamp ?? null).toBeNull()
        const map = buildRunStatsMap(live.run, live.metrics)
        const score = selectRunMetricStats(map, {
            metricKey: "attributes.ag.data.outputs.score",
            stepKey: "evaluator-answer-correctness",
        })
        expect(booleanTruePercent(score)).toBeCloseTo((108 / 112) * 100, 6)
    })

    it("takes a live run's invocation metrics from its first evaluator step", () => {
        const map = buildRunStatsMap(live.run, live.metrics)
        const duration = selectRunMetricStats(map, {metricKey: DURATION})
        const first = Object.keys(live.metrics.find((m) => !m.timestamp)?.data ?? {}).find(
            (step) => map[`${step}.${DURATION}`],
        )
        expect(duration).toEqual(map[`${first}.${DURATION}`])
    })
})

describe("metric numbers", () => {
    it("keeps the zeros of whole numbers and drops trailing decimal zeros", () => {
        expect(formatMetricNumber(100)).toBe("100")
        expect(formatMetricNumber(120)).toBe("120")
        expect(formatMetricNumber(1000)).toBe("1000")
        expect(formatMetricNumber(1.5)).toBe("1.5")
        expect(formatMetricNumber(0)).toBe("0")
        expect(formatMetricNumber(0.012345)).toBe("0.0123")
        expect(formatMetricValue("score", {mean: 100})).toBe("100")
    })
})

describe("runs list filters", () => {
    it("sends the old app's flags per tab, leaving out annotation queue runs", () => {
        expect(runListTabFlags("all")).toEqual({has_testcases: false, has_traces: false})
        expect(runListTabFlags("human")).toEqual({
            has_human: true,
            has_testcases: false,
            has_traces: false,
        })
        expect(runListTabFlags("online")).toEqual({is_live: true})
    })

    it("builds reference filters by id or slug", () => {
        expect(
            buildRunReferencePayload({
                evaluator: ["01a1acf9-cddc-7b02-a139-b00d7457b14e", "exact-match"],
                testset: [" "],
                app: ["01a1acfb-6d9d-7802-9546-1cf71729e704"],
                variant: ["v-1"],
            }),
        ).toEqual([
            {evaluator: {id: "01a1acf9-cddc-7b02-a139-b00d7457b14e"}},
            {evaluator: {slug: "exact-match"}},
            {application: {id: "01a1acfb-6d9d-7802-9546-1cf71729e704"}},
            {application_variant: {id: "v-1"}},
        ])
        expect(buildRunReferencePayload({testset: []})).toBeUndefined()
    })

    it("builds the runs query body the old app sends", () => {
        expect(
            buildRunsQueryBody({
                search: "capitals",
                flags: {has_traces: false, has_auto: true, has_testcases: false},
                statuses: ["success", "failure", "success"],
                evaluationKinds: ["Human", "auto"],
                windowing: {limit: 50, order: "descending", oldest: "2026-11-01T00:00:00Z"},
            }),
        ).toEqual({
            run: {
                search: "capitals",
                flags: {has_auto: true, has_testcases: false, has_traces: false},
                statuses: ["failure", "success"],
                evaluation_kinds: ["auto", "human"],
            },
            windowing: {limit: 50, order: "descending", oldest: "2026-11-01T00:00:00Z"},
        })
        expect(buildRunsQueryBody({})).toEqual({})
    })

    it("counts active filters like the filter button", () => {
        expect(countRunListFilters({}, "all")).toBe(0)
        expect(countRunListFilters({}, "auto")).toBe(1)
        expect(
            countRunListFilters(
                {statuses: ["success"], references: {app: ["a", "b"]}, dateRange: {from: "x"}},
                "all",
            ),
        ).toBe(4)
    })
})

describe("CSV export", () => {
    it("escapes cells and joins rows", () => {
        expect(
            buildCsv(
                ["Name", "Score"],
                [
                    ["a, b", 1],
                    ['say "hi"', null],
                ],
            ),
        ).toBe('Name,Score\n"a, b",1\n"say ""hi""",')
        expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)")
        expect(csvCell("+1")).toBe("'+1")
        expect(csvCell("-2, x")).toBe('"\'-2, x"')
        expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)")
        expect(csvCell("\tcmd")).toBe("'\tcmd")
        expect(csvCell(-2)).toBe("-2")
        expect(runExportFilename("preview::01a1/x y")).toBe("evaluation-run-preview-01a1-x-y.csv")
        expect(metricExportHeader("success", "Exact Match")).toBe("Exact Match • success")
    })

    it("writes the run columns of a real run", () => {
        const run = {...autoDefault.run, created_at: "2026-11-05T18:40:00.000000Z"}
        expect(runExportKind(run)).toBe("Auto")
        expect(runExportCreatedAt(run)).toBe("2026-11-05T18:40:00.000Z")
        expect(runExportKind(live.run)).toBe("Live")
    })
})

describe("compare", () => {
    it("reads and writes the compare query value", () => {
        expect(parseCompareParam(["a,b", " c "])).toEqual(["a", "b", "c"])
        expect(parseCompareParam(undefined)).toEqual([])
        expect(compareParamValue([])).toBeNull()
        expect(compareParamValue(["a", "b"])).toBe("a,b")
    })

    it("caps the compared runs", () => {
        let ids: string[] = []
        for (let i = 0; i < MAX_COMPARISON_RUNS + 2; i += 1) ids = toggleCompareRun(ids, `r${i}`)
        expect(ids).toHaveLength(MAX_COMPARISON_RUNS)
        expect(toggleCompareRun(ids, "r0")).not.toContain("r0")
    })

    it("offers the other finished run on the same test set and evaluators", () => {
        const structure = runComparisonStructure(autoDefault.run)
        expect(structure.inputStepCount).toBe(1)
        expect(structure.evaluatorIds).toHaveLength(3)
        expect(compareBlockReason(autoDefault.run)).toBeNull()
        expect(
            compareCandidates(autoDefault.run, [autoDefault.run, autoVerbose.run, live.run]),
        ).toEqual([autoVerbose.run])
    })

    it("blocks a running live run", () => {
        expect(compareBlockReason(live.run)).toBe("pending-status")
        expect(compareBlockReason({...live.run, status: "success"})).toBe("no-testset")
    })
})
