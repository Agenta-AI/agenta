// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    BOOLEAN,
    CATEGORICAL,
    evaluatorMetric,
    invocationMetric,
    NUMERIC,
    RUN_ID,
} from "./runOverviewFixtures"

import {MetricCard} from "@/features/evaluation-run/overview/MetricCard"
import {MetricCardsSection} from "@/features/evaluation-run/overview/MetricCardsSection"
import {RunRadarCard} from "@/features/evaluation-run/overview/RunRadarCard"

// The charts are tested in @agenta/ui. Here, record what each card hands them.
const charts = vi.hoisted(() => ({bar: [] as unknown[], line: [] as unknown[]}))
vi.mock("@agenta/ui/components/presentational/charts", () => ({
    BarChart: (props: unknown) => {
        charts.bar.push(props)
        return null
    },
    LineChart: (props: unknown) => {
        charts.line.push(props)
        return null
    },
    RadarChart: ({title}: {title: string}) => createElement("svg", {"aria-label": title}),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

interface BarProps {
    data: {category: string; values: Record<string, number>}[]
    series: {name: string}[]
    yMax?: number
    formatValue: (value: number) => string
}

let host: HTMLDivElement
let root: Root
const render = (node: ReactNode) => act(() => root.render(node))
const lastBar = () => charts.bar.at(-1) as BarProps

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    charts.bar.length = 0
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

const card = (metric: ReturnType<typeof evaluatorMetric>) =>
    createElement(MetricCard, {metric, runId: RUN_ID, runName: "Capitals check"})

describe("overview charts", () => {
    it("A boolean metric shows the true percent and a True and False chart", () => {
        render(card(evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN)))
        expect(host.textContent).toContain("75.00%")
        const bar = lastBar()
        expect(bar.data).toEqual([
            {category: "True", values: {[RUN_ID]: 75}},
            {category: "False", values: {[RUN_ID]: 25}},
        ])
        expect(bar.yMax).toBe(100)
        expect(bar.series[0].name).toBe("Percentage")
        expect(bar.formatValue(75)).toBe("75%")
    })

    it("A categorical metric charts counts by label", () => {
        render(card(evaluatorMetric("attributes.ag.data.outputs.tone", CATEGORICAL)))
        const bar = lastBar()
        expect(bar.data.map((datum) => [datum.category, datum.values[RUN_ID]])).toEqual([
            ["friendly", 3],
            ["neutral", 2],
            ["curt", 1],
        ])
        expect(bar.series[0].name).toBe("Count")
        expect(bar.formatValue(2.6)).toBe("3")
    })

    it("A numeric metric charts the histogram with the metric as tooltip label", () => {
        render(card(evaluatorMetric("attributes.ag.data.outputs.score", NUMERIC)))
        expect(host.textContent).toContain("0.75")
        const bar = lastBar()
        expect(bar.data.map((datum) => datum.category)).toEqual(["0.5–0.75", "0.75–1"])
        expect(bar.series[0].name).toBe("score")
    })

    it("Fewer than three radar axes shows the insufficient metrics empty state, not a loader", () => {
        render(
            createElement(RunRadarCard, {
                runId: RUN_ID,
                runName: "Capitals check",
                metrics: [invocationMetric("duration", {mean: 1, max: 2})],
                pending: false,
            }),
        )
        expect(host.textContent).toContain("Insufficient metrics for spider chart")
        expect(host.querySelector('[role="status"]')).toBeNull()

        render(
            createElement(RunRadarCard, {
                runId: RUN_ID,
                runName: "Capitals check",
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.score", NUMERIC),
                    invocationMetric("duration", {mean: 1, max: 2}),
                    invocationMetric("cost", {mean: 0.001, max: 0.002}),
                ],
                pending: false,
            }),
        )
        expect(host.querySelector("svg")?.getAttribute("aria-label")).toContain("Capitals check")
    })

    it("A metrics load error shows the alert without the raw error text", () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
        render(
            createElement(MetricCardsSection, {
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

    it("An online run shows one time chart per metric", () => {
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
            createElement(MetricCardsSection, {
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
        expect(charts.line).toHaveLength(1)
        expect(charts.bar).toHaveLength(0)
        const line = charts.line[0] as {points: unknown[]; yDomain?: number[]}
        expect(line.points).toEqual([
            {x: Date.UTC(2026, 9, 30, 9, 0), values: {[RUN_ID]: 0.25}},
            {x: Date.UTC(2026, 9, 30, 9, 10), values: {[RUN_ID]: 0.75}},
        ])
        expect(line.yDomain).toEqual([0, 1])
        // The score metric has no points yet.
        expect(host.textContent).toContain("Exact match metrics are on the way")
    })

    it("No evaluator metrics shows No evaluator metrics available", () => {
        render(
            createElement(MetricCardsSection, {
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
        expect(charts.bar).toHaveLength(0)
    })
})
