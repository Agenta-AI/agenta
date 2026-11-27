// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {
    buildCompareEvaluatorRows,
    buildCompareSummaryRows,
    buildEvaluatorRows,
    runTiles,
} from "@agenta/entities/evaluationRun"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {evaluatorMetric, invocationMetric} from "./runOverviewFixtures"

import {CompareEvaluatorTable} from "@/features/evaluation-run/compare/overview/CompareEvaluatorTable"
import {
    CompareSummaryTable,
    type CompareColumn,
} from "@/features/evaluation-run/compare/overview/CompareSummaryTable"
import type {OverviewMetric} from "@/features/evaluation-run/overview/useRunOverview"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
const render = (node: ReactNode) => act(() => root.render(node))

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const COLUMNS: CompareColumn[] = [
    {runId: "older", slot: 0, name: "Capitals: v1", role: "before"},
    {runId: "newer", slot: 1, name: "Capitals: v2", role: "newest"},
]
const ROLES = {newest: 1, before: 0}

const binary = (passed: number, failed: number) => ({
    type: "binary",
    count: passed + failed,
    freq: [
        {value: true, count: passed},
        {value: false, count: failed},
    ],
})
const score = (mean: number) => ({type: "numeric/continuous", count: 4, mean, min: 0, max: 1})

const rowsOf = (metrics: OverviewMetric[]) =>
    buildEvaluatorRows([{stepKey: "ev-step", evaluatorId: "ev-1", name: "Exact match"}], metrics)

const lineTexts = (metricKey: string) =>
    [
        ...host.querySelectorAll(
            `[data-testid="metric-ev-step:${metricKey}"] [data-testid^="line-"]`,
        ),
    ].map((line) => line.textContent)
const badgeOf = (metricKey: string) =>
    host.querySelector<HTMLElement>(
        `[data-testid="metric-ev-step:${metricKey}"] [data-testid="compare-change"]`,
    )

describe("compare evaluator rows", () => {
    it("A binary and a score metric show one line per run and the change of the newest run as a badge", () => {
        const rows = buildCompareEvaluatorRows(
            [
                rowsOf([
                    evaluatorMetric("success", binary(3, 1)),
                    evaluatorMetric("score", score(0.83)),
                ]),
                rowsOf([
                    evaluatorMetric("success", binary(4, 0)),
                    evaluatorMetric("score", score(0.75)),
                ]),
            ],
            ROLES,
        )
        render(createElement(CompareEvaluatorTable, {rows, columns: COLUMNS}))

        expect(host.textContent).toContain("Metrics, one line per evaluation")
        expect(lineTexts("success")).toEqual(["Capitals: v175% 3 of 4", "Capitals: v2100% 4 of 4"])
        expect(badgeOf("success")?.textContent).toBe("+25 points")
        expect(badgeOf("success")?.className).toContain("text-success")

        expect(lineTexts("score")).toEqual(["Capitals: v10.83 mean", "Capitals: v20.75 mean"])
        expect(badgeOf("score")?.textContent).toBe("−0.08")
        expect(badgeOf("score")?.className).toContain("text-destructive")

        // Each line's bar is in its run's color.
        const bars = [
            ...host.querySelectorAll<HTMLElement>(
                '[data-testid="metric-ev-step:success"] [data-segment]',
            ),
        ]
        expect(bars.map((bar) => bar.getAttribute("data-segment"))).toEqual(["older", "newer"])
    })

    it("A run without the metric shows a dash, and a categorical metric has no badge", () => {
        const tone = {
            type: "categorical/single",
            count: 3,
            freq: [
                {value: "formal", count: 2},
                {value: "casual", count: 1},
            ],
        }
        const rows = buildCompareEvaluatorRows(
            [
                rowsOf([evaluatorMetric("success", binary(1, 1))]),
                rowsOf([evaluatorMetric("success", binary(1, 1)), evaluatorMetric("tone", tone)]),
            ],
            ROLES,
        )
        render(createElement(CompareEvaluatorTable, {rows, columns: COLUMNS}))

        expect(badgeOf("success")?.textContent).toBe("no change")
        expect(lineTexts("tone")).toEqual(["Capitals: v1—", "Capitals: v2formal 67%"])
        expect(badgeOf("tone")).toBeNull()
    })
})

describe("compare summary table", () => {
    const tilesOf = (cost: number) =>
        runTiles({
            status: "success",
            online: false,
            invocation: [
                invocationMetric("cost", {type: "numeric/continuous", count: 9, mean: cost}),
            ],
            binaryStats: [],
            passed: {status: "unavailable"},
            metricsPending: false,
        })

    it("Has no Passed row without a binary metric, and shows the change as plain text with the note", () => {
        render(
            createElement(CompareSummaryTable, {
                columns: COLUMNS,
                rows: buildCompareSummaryRows([tilesOf(0.004), tilesOf(0.006)], ROLES),
            }),
        )
        expect(host.querySelector('[data-testid="compare-summary-passed"]')).toBeNull()
        const header = [...host.querySelectorAll("thead th")].map((th) => th.textContent)
        expect(header).toEqual(["Summary", "Capitals: v1before", "Capitals: v2newest", "Change"])
        const cost = host.querySelector('[data-testid="compare-summary-cost"]')
        expect(cost?.querySelector("th")?.textContent).toBe("Cost per test case")
        const change = cost?.querySelector<HTMLElement>('[data-testid="compare-change"]')
        expect(change?.textContent).toBe("+$0.002")
        expect(change?.className).toContain("text-muted-foreground")
        expect(host.textContent).toContain(
            "The change column compares the newest evaluation with the one before it.",
        )
    })
})
