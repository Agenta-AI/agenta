// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {buildEvaluatorRows} from "@agenta/entities/evaluationRun"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EvaluatorResultsSection} from "@/features/evaluation-run/overview/EvaluatorResultsSection"
import type {OverviewMetric} from "@/features/evaluation-run/overview/useRunOverview"

import {
    BOOLEAN,
    CATEGORICAL,
    evaluatorMetric,
    invocationMetric,
    NUMERIC,
    RUN_ID,
} from "./runOverviewFixtures"

// The line and radar charts are tested in @agenta/ui. Here, record what the cards hand them.
const charts = vi.hoisted(() => ({line: [] as unknown[]}))
vi.mock("@agenta/ui/components/presentational/charts", async (original) => ({
    ...(await original<typeof import("@agenta/ui/components/presentational/charts")>()),
    LineChart: (props: unknown) => {
        charts.line.push(props)
        return null
    },
    RadarChart: ({title}: {title: string}) => createElement("svg", {"aria-label": title}),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
const render = (node: ReactNode) => act(() => root.render(node))

/** The results section with the rows the view builds from the same metrics. */
const section = (props: {
    runId: string
    runName: string
    online: boolean
    human?: boolean
    metrics: OverviewMetric[]
    hasEvaluators: boolean
    pending: boolean
    error: Error | null
    onRetry?: () => void
}) =>
    createElement(EvaluatorResultsSection, {
        ...props,
        rows: buildEvaluatorRows(
            [{stepKey: "ev-step", evaluatorId: "ev-1", name: "Exact match"}],
            props.metrics,
            {runWideOnly: props.online},
        ),
    })

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    charts.line.length = 0
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("overview states and charts over time", () => {
    it("A metrics load error shows the alert without the raw error text", () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: false,
                metrics: [],
                hasEvaluators: true,
                pending: false,
                error: new Error("Request failed with status code 500"),
            }),
        )
        expect(host.textContent).toBe("Unable to load evaluator metrics")
        expect(log).toHaveBeenCalled()
        log.mockRestore()
    })

    it("A first metrics load error offers a retry", () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        const retry = vi.fn()
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: false,
                metrics: [],
                hasEvaluators: true,
                pending: false,
                error: new Error("Request failed with status code 500"),
                onRetry: retry,
            }),
        )
        expect(host.textContent).toContain("Unable to load evaluator metrics")
        const button = Array.from(host.querySelectorAll("button")).find(
            (node) => node.textContent === "Try again",
        )
        act(() => button?.click())
        expect(retry).toHaveBeenCalledTimes(1)
    })

    it("A failed refresh keeps the table, warns, and offers a retry", () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        const retry = vi.fn()
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: false,
                metrics: [evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN)],
                hasEvaluators: true,
                pending: false,
                error: new Error("Request failed with status code 500"),
                onRetry: retry,
            }),
        )
        expect(host.textContent).toContain("Unable to refresh evaluator metrics")
        expect(host.textContent).not.toContain("500")
        expect(host.querySelector('[data-testid="evaluator-ev-step"]')).not.toBeNull()
        const button = Array.from(host.querySelectorAll("button")).find(
            (node) => node.textContent === "Try again",
        )
        act(() => button?.click())
        expect(retry).toHaveBeenCalledTimes(1)
    })

    it("A categorical value missing from the latest point keeps its line", () => {
        const point = (minute: number, frequency: {value: string; count: number}[]) => ({
            timestamp: Date.UTC(2026, 9, 30, 9, minute),
            stats: {type: "categorical/single", frequency},
        })
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: true,
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.tone", CATEGORICAL, {
                        temporal: [
                            point(0, [
                                {value: "friendly", count: 1},
                                {value: "curt", count: 2},
                            ]),
                            point(10, [{value: "friendly", count: 4}]),
                        ],
                    }),
                ],
                hasEvaluators: true,
                pending: false,
                error: null,
            }),
        )
        const line = charts.line.at(-1) as {series: {key: string}[]; points: {values: unknown}[]}
        expect(line.series.map((series) => series.key)).toEqual(["friendly", "curt"])
        expect(line.points.map((point) => point.values)).toEqual([
            {friendly: 1, curt: 2},
            {friendly: 4, curt: 0},
        ])
    })

    it("An online run shows the table, then one time chart per metric under Over time", () => {
        const point = (minute: number, trueCount: number) => ({
            timestamp: Date.UTC(2026, 9, 30, 9, minute),
            stats: {
                type: "binary",
                frequency: [
                    {value: true, count: trueCount},
                    {value: false, count: 4 - trueCount},
                ],
            },
        })
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: true,
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN, {
                        temporal: [point(0, 1), point(10, 3)],
                    }),
                    evaluatorMetric("attributes.ag.data.outputs.score", NUMERIC),
                    invocationMetric("duration", {mean: 1}),
                ],
                hasEvaluators: true,
                pending: false,
                error: null,
            }),
        )
        expect(host.querySelector("h2")?.textContent).toBe("Over time")
        expect(host.querySelector('[data-testid="evaluator-ev-step"]')).not.toBeNull()
        expect(charts.line).toHaveLength(1)
        const line = charts.line[0] as {points: unknown[]; yDomain?: number[]}
        expect(line.points).toEqual([
            {x: Date.UTC(2026, 9, 30, 9, 0), values: {[RUN_ID]: 0.25}},
            {x: Date.UTC(2026, 9, 30, 9, 10), values: {[RUN_ID]: 0.75}},
        ])
        expect(line.yDomain).toEqual([0, 1])
        // The score metric has no points yet.
        expect(host.textContent).toContain("Exact match metrics are on the way")
    })

    it("An online run's card shows the whole run's value, not the newest minute", () => {
        const point = (minute: number, trueCount: number, count: number) => ({
            timestamp: Date.UTC(2026, 9, 30, 9, minute),
            stats: {
                type: "binary",
                frequency: [
                    {value: true, count: trueCount},
                    {value: false, count: count - trueCount},
                ],
            },
        })
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: true,
                metrics: [
                    evaluatorMetric(
                        "attributes.ag.data.outputs.score",
                        {
                            type: "binary",
                            count: 88,
                            frequency: [
                                {value: true, count: 84},
                                {value: false, count: 4},
                            ],
                        },
                        {temporal: [point(0, 30, 30), point(10, 0, 2)]},
                    ),
                ],
                hasEvaluators: true,
                pending: false,
                error: null,
            }),
        )
        expect(host.textContent).toContain("Capitals check: 95.45%")
        expect(host.textContent).not.toContain("0.00%")
    })

    it("An online run with no run-wide value shows no value, not the newest minute", () => {
        const latest = {
            type: "binary",
            frequency: [
                {value: true, count: 0},
                {value: false, count: 2},
            ],
        }
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: true,
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.score", latest, {
                        statsAreRunWide: false,
                        temporal: [{timestamp: Date.UTC(2026, 9, 30, 9, 0), stats: latest}],
                    }),
                ],
                hasEvaluators: true,
                pending: false,
                error: null,
            }),
        )
        expect(charts.line).toHaveLength(1)
        expect(host.textContent).not.toContain("Capitals check:")
        expect(host.textContent).not.toContain("0.00%")
    })

    it("An online categorical metric draws one line per value", () => {
        const point = (minute: number, friendly: number, curt: number) => ({
            timestamp: Date.UTC(2026, 9, 30, 9, minute),
            stats: {
                type: "categorical/single",
                frequency: [
                    {value: "friendly", count: friendly},
                    {value: "curt", count: curt},
                ],
            },
        })
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: true,
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.tone", CATEGORICAL, {
                        temporal: [point(0, 1, 2), point(10, 4, 1)],
                    }),
                ],
                hasEvaluators: true,
                pending: false,
                error: null,
            }),
        )
        const line = charts.line[0] as {series: {key: string}[]; points: unknown[]}
        expect(line.series.map((series) => series.key)).toEqual(["friendly", "curt"])
        expect(line.points).toEqual([
            {x: Date.UTC(2026, 9, 30, 9, 0), values: {friendly: 1, curt: 2}},
            {x: Date.UTC(2026, 9, 30, 9, 10), values: {friendly: 4, curt: 1}},
        ])
        expect(host.textContent).toContain("Exact match")
    })

    it("No evaluator metrics shows No evaluator metrics available", () => {
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: false,
                metrics: [invocationMetric("duration", {mean: 1})],
                hasEvaluators: false,
                pending: false,
                error: null,
            }),
        )
        expect(host.textContent).toContain("No evaluator metrics available")
    })

    it("While metrics load, the table skeleton stands in for the rows", () => {
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: false,
                metrics: [],
                hasEvaluators: true,
                pending: true,
                error: null,
            }),
        )
        expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
            "Preparing evaluator metrics",
        )
    })

    it("A human run with evaluators and no annotations asks for annotations", () => {
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: false,
                human: true,
                metrics: [],
                hasEvaluators: true,
                pending: false,
                error: null,
            }),
        )
        expect(host.textContent).toContain("Annotate the scenarios of this run")
    })

    it("No radar card, no summary list and no metric cards on a finished run", () => {
        render(
            section({
                runId: RUN_ID,
                runName: "Capitals check",
                online: false,
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN),
                    evaluatorMetric("attributes.ag.data.outputs.tone", CATEGORICAL),
                    evaluatorMetric("attributes.ag.data.outputs.score", NUMERIC),
                ],
                hasEvaluators: true,
                pending: false,
                error: null,
            }),
        )
        expect(host.querySelector("svg")).toBeNull()
        expect(host.textContent).not.toContain("Run summary")
        expect(host.textContent).not.toContain("Over time")
        expect(charts.line).toHaveLength(0)
    })
})
