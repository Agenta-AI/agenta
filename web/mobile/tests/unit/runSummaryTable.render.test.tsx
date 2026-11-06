// @vitest-environment jsdom
import {act, createElement} from "react"

import type {RunReferences} from "@agenta/entities/evaluationRun"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {
    buildRunSummaryRows,
    type RunSummaryInput,
} from "@/features/evaluation-run/overview/runSummaryRows"
import {RunSummaryTable} from "@/features/evaluation-run/overview/RunSummaryTable"

import {
    BOOLEAN,
    CATEGORICAL,
    evaluatorMetric,
    header,
    invocationMetric,
    NUMERIC,
} from "./runOverviewFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const references = (patch: Partial<RunReferences> = {}): RunReferences => ({
    applicationId: "app-1",
    variantId: "var-1",
    revisionId: "rev-1",
    revisionVersion: 3,
    testsets: [{testsetId: "ts-1", revisionId: "tsr-1", version: 3}],
    evaluators: [],
    queryIds: [],
    ...patch,
})

const input = (patch: Partial<RunSummaryInput> = {}): RunSummaryInput => ({
    header: header(),
    references: references(),
    metrics: [],
    metricsPending: false,
    names: {testsets: ["Capitals"], application: "Geography bot", variant: "default"},
    ...patch,
})

let host: HTMLDivElement
let root: Root

const render = (value: RunSummaryInput) =>
    act(() => root.render(createElement(RunSummaryTable, {rows: buildRunSummaryRows(value)})))

const rowKeys = () =>
    [...host.querySelectorAll("[data-testid^='summary-']")].map((row) =>
        row.getAttribute("data-testid")?.replace("summary-", ""),
    )
const rowText = (key: string) =>
    host.querySelector(`[data-testid="summary-${key}"] dd`)?.textContent ?? null
const labelText = (key: string) =>
    host.querySelector(`[data-testid="summary-${key}"] dt`)?.textContent ?? null

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("run summary table", () => {
    it("Summary rows follow the /w order and hide Test set when no run has one", () => {
        render(input())
        expect(rowKeys()).toEqual([
            "testset",
            "evaluation",
            "status",
            "created",
            "updated",
            "application",
            "variant",
            "cost",
            "duration",
            "tokens",
            "errors",
        ])
        expect(rowText("testset")).toBe("Capitalsv3")
        expect(rowText("application")).toBe("Geography bot")
        expect(rowText("variant")).toBe("defaultv3")

        render(input({references: references({testsets: [], applicationId: null})}))
        expect(rowKeys()).not.toContain("testset")
        expect(rowKeys()).not.toContain("application")
        expect(rowKeys()).not.toContain("variant")
    })

    it("Filters and queries row appears only for query runs", () => {
        render(input({references: references({queryIds: ["q-1"]})}))
        expect(rowKeys().slice(2, 4)).toEqual(["status", "queries"])
        expect(labelText("queries")).toBe("Filters / Queries")
    })

    it("Invocation rows show the average cost, duration and tokens", () => {
        render(
            input({
                metrics: [
                    invocationMetric("cost", {count: 4, sum: 0.002}),
                    // The duration metric is in milliseconds, as on the trace.
                    invocationMetric("duration", {count: 4, mean: 779.06}),
                    invocationMetric("tokens", {count: 4, mean: 12_340}),
                    invocationMetric("errors", null),
                ],
            }),
        )
        expect(labelText("cost")).toBe("Cost (Avg)")
        expect(rowText("cost")).toBe("$0.0005")
        expect(rowText("duration")).toBe("779 ms")
        expect(rowText("tokens")).toBe("12.3K")
        expect(rowText("errors")).toBe("—")

        render(input({metricsPending: true}))
        expect(rowText("cost")).toBe("…")
    })

    it("Errors row shows the total error count", () => {
        render(input({metrics: [invocationMetric("errors", {count: 6, mean: 0.5})]}))
        expect(rowText("errors")).toBe("3")
        render(input({metrics: [invocationMetric("errors", {count: 6, sum: 2, mean: 0.33})]}))
        expect(rowText("errors")).toBe("2")
    })

    it("Evaluator rows sort by evaluator and metric and mark means", () => {
        render(
            input({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN, {
                        evaluatorName: "Similarity",
                    }),
                    evaluatorMetric("attributes.ag.data.outputs.tone", CATEGORICAL),
                    evaluatorMetric("attributes.ag.data.outputs.score", NUMERIC),
                ],
            }),
        )
        const evaluatorKeys = rowKeys().filter((key) => key?.startsWith("ev-step:"))
        expect(evaluatorKeys).toEqual([
            "ev-step:attributes.ag.data.outputs.score",
            "ev-step:attributes.ag.data.outputs.tone",
            "ev-step:attributes.ag.data.outputs.success",
        ])
        expect(labelText("ev-step:attributes.ag.data.outputs.score")).toBe(
            "Exact matchScore (mean)",
        )
        expect(rowText("ev-step:attributes.ag.data.outputs.score")).toBe("0.75")
        expect(rowText("ev-step:attributes.ag.data.outputs.success")).toBe("75.00%")
        expect(rowText("ev-step:attributes.ag.data.outputs.tone")).toBe(
            "friendly (3)neutral (2)curt (1)",
        )
    })

    it("Status shows a dot of the matching tone and a humanized label", () => {
        const dot = () => host.querySelector('[data-testid="summary-status"] dd span[aria-hidden]')
        render(input({header: header({status: "evaluation_failed"})}))
        expect(rowText("status")).toBe("Evaluation Failed")
        expect(dot()?.className).toContain("bg-destructive")

        render(input({header: header({status: "success"})}))
        expect(rowText("status")).toBe("Success")
        expect(dot()?.className).toContain("bg-success")
    })

    it("Metric names are in title case, as in /w", () => {
        render(
            input({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN, {
                        evaluatorName: "Exact Match",
                    }),
                ],
            }),
        )
        expect(labelText("ev-step:attributes.ag.data.outputs.success")).toBe("Exact MatchSuccess")
    })

    it("Test set and variant chips link to their pages; without links they are plain", () => {
        const links = {
            testset: (revisionId: string) => `/w/ws/p/pr/testsets/${revisionId}`,
            variant: (appId: string, revisionId: string) =>
                `/w/ws/p/pr/variants?app=${appId}&revisionId=${revisionId}`,
        }
        render(input({links}))
        const href = (key: string) =>
            host.querySelector(`[data-testid="summary-${key}"] dd a`)?.getAttribute("href")
        // The test set page takes the revision id, not the test set id.
        expect(href("testset")).toBe("/w/ws/p/pr/testsets/tsr-1")
        expect(href("variant")).toBe("/w/ws/p/pr/variants?app=app-1&revisionId=rev-1")
        expect(href("application")).toBeUndefined()

        render(input({links: {testset: () => null, variant: () => null}}))
        expect(host.querySelector('[data-testid="summary-testset"] dd a')).toBeNull()
        expect(rowText("testset")).toBe("Capitalsv3")
    })
})
