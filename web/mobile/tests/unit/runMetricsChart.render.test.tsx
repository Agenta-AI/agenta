// @vitest-environment jsdom
import {act, createElement} from "react"

import type {EvaluatorRow, EvaluatorRowMetric, MetricStats} from "@agenta/entities/evaluationRun"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {MetricsChart} from "@/features/evaluation-run/overview/MetricsChart"

// The radar is tested in @agenta/ui. Here, record the axes the card hands it.
const charts = vi.hoisted(() => ({
    radar: [] as {axes: {name: string; values: Record<string, unknown>}[]}[],
}))
vi.mock("@agenta/ui/components/presentational/charts", async (original) => ({
    ...(await original<typeof import("@agenta/ui/components/presentational/charts")>()),
    RadarChart: (props: {
        title: string
        axes: {name: string; values: Record<string, unknown>}[]
    }) => {
        charts.radar.push(props)
        return createElement("svg", {"aria-label": props.title})
    },
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const binary = (passed: number, failed: number): MetricStats => ({
    type: "binary",
    count: passed + failed,
    frequency: [
        {value: true, count: passed},
        {value: false, count: failed},
    ],
})

const numeric = (mean: number, min = 0, max = 1): MetricStats => ({
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
    metricKey: label,
    label,
    kind,
    stats,
})

const row = (name: string, metrics: EvaluatorRowMetric[]): EvaluatorRow => ({
    stepKey: `${name}-step`,
    evaluatorId: `${name}-id`,
    name,
    metrics,
})

/** 27 evaluators with a pass rate and a score each: 54 metrics, like the dev copy run. */
const benchRows = Array.from({length: 27}, (_, index) =>
    row(`Check ${String(index).padStart(2, "0")}`, [
        metric("Passed", "binary", binary(index + 1, 27 - index)),
        metric("Score", "numeric", numeric((index + 0.5) / 28)),
    ]),
)

let host: HTMLDivElement
let root: Root

const renderChart = (rows: EvaluatorRow[]) =>
    act(() =>
        root.render(createElement(MetricsChart, {runs: [{key: "run-1", name: "Run 1", rows}]})),
    )

const barCount = () => host.querySelectorAll("path[data-series]").length
const barNames = () =>
    Array.from(host.querySelectorAll("text[transform^='rotate(-90']")).map((t) => t.textContent)
const radio = (name: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("[role=radio]")).find(
        (button) => button.textContent === name,
    )!
const trigger = () =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Metrics:"))!
const pickerItems = () => Array.from(document.querySelectorAll<HTMLElement>("[cmdk-item]"))

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    charts.radar.length = 0
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    class FixedWidthObserver {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
            this.callback(
                [{target, contentRect: {width: 960} as DOMRectReadOnly} as ResizeObserverEntry],
                this as unknown as ResizeObserver,
            )
        }
        unobserve() {}
        disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FixedWidthObserver)
    Element.prototype.scrollIntoView = () => undefined
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
})

describe("Metrics chart", () => {
    it("Shows the 16 lowest of 54 metrics as bars, lowest first, with values above the bars", () => {
        renderChart(benchRows)
        expect(trigger().textContent).toBe("Metrics: 16 of 54")
        expect(host.textContent).toContain(
            "The 16 lowest of 54 metrics. Each value is on one scale from 0 to 1.",
        )
        expect(barCount()).toBe(16)
        expect(barNames().slice(0, 3)).toEqual([
            "Check 00: Score",
            "Check 00: Passed",
            "Check 01: Score",
        ])
        const labels = Array.from(host.querySelectorAll("text[data-value-label]")).map(
            (t) => t.textContent,
        )
        expect(labels.slice(0, 2)).toEqual(["0.02", "4%"])
        expect(host.textContent).toContain("Pass rate of a true or false metric")
        expect(host.textContent).toContain("Mean of a score")
    })

    it("Pass rates and score means have their own bar colors", () => {
        renderChart(benchRows)
        const fills = Array.from(host.querySelectorAll("path[data-series]")).map((p) =>
            p.getAttribute("fill"),
        )
        expect(fills.slice(0, 2)).toEqual(["var(--data-1)", "var(--data-2)"])
    })

    it("Every metric is shown when there are 16 or fewer", () => {
        renderChart(benchRows.slice(0, 4))
        expect(trigger().textContent).toBe("Metrics: 8 of 8")
        expect(host.textContent).toContain("Every metric of this run.")
        expect(barCount()).toBe(8)
    })

    it("The picker changes the bars and keeps the choice", async () => {
        renderChart(benchRows)
        await act(async () => {
            trigger().dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        expect(pickerItems()).toHaveLength(54)
        // Uncheck the lowest metric, check the highest one.
        await act(async () => {
            pickerItems()[0].click()
        })
        await act(async () => {
            pickerItems()[53].click()
        })
        expect(trigger().textContent).toBe("Metrics: 16 of 54")
        expect(barNames()).not.toContain("Check 00: Score")
        expect(barNames().at(-1)).toBe("Check 26: Passed")
        // A choice of the user is not "the 16 lowest" any more.
        expect(host.textContent).not.toContain("The 16 lowest of 54 metrics.")
        // A new poll keeps the choice.
        renderChart([...benchRows])
        expect(barNames()).not.toContain("Check 00: Score")
    })

    it("The radar shows the selected metrics", async () => {
        renderChart(benchRows.slice(0, 2))
        await act(async () => radio("Radar").click())
        expect(
            host.querySelector("svg[aria-label='Radar chart of the selected metrics']"),
        ).not.toBeNull()
        const axes = charts.radar.at(-1)?.axes ?? []
        expect(axes).toHaveLength(4)
        // Lowest first; each axis holds the run's value on 0 to 1.
        expect(axes[0]).toEqual({
            name: "Check 00: Score",
            max: 1,
            values: {"run-1": {normalized: 0.5 / 28, raw: 0.5 / 28}},
        })
    })

    it("The radar is disabled with fewer than 3 metrics", () => {
        renderChart([
            row("Solo", [metric("ok", "binary", binary(1, 1))]),
            row("Duo", [metric("ok", "binary", binary(2, 0))]),
        ])
        expect(radio("Radar").disabled).toBe(true)
        expect(radio("Bars").getAttribute("aria-checked")).toBe("true")
        expect(host.textContent).toContain("A radar chart needs at least 3 metrics.")
        expect(barNames()).toEqual(["Solo", "Duo"])
    })

    it("Scores off the 0 to 1 scale are left out with one line that counts them", () => {
        renderChart([
            row("Judge", [
                metric("ok", "binary", binary(1, 1)),
                metric("stars", "numeric", numeric(3.5, 1, 5)),
            ]),
            row("Latency", [metric("ms", "numeric", numeric(120, 80, 300))]),
        ])
        expect(barNames()).toEqual(["Judge: ok"])
        expect(host.textContent).toContain(
            "2 metrics are not on a 0 to 1 scale and are not in the chart.",
        )
    })

    it("One score off the scale reads in the singular", () => {
        renderChart([
            row("Judge", [
                metric("ok", "binary", binary(1, 1)),
                metric("stars", "numeric", numeric(3.5, 1, 5)),
            ]),
        ])
        expect(host.textContent).toContain(
            "1 metric is not on a 0 to 1 scale and is not in the chart.",
        )
    })

    it("A run with only scores off the scale keeps the card with the line that counts them", () => {
        renderChart([row("Rating", [metric("stars", "numeric", numeric(3.5, 1, 5))])])
        expect(host.querySelector("section")).not.toBeNull()
        expect(barCount()).toBe(0)
        expect(trigger()).toBeUndefined()
        expect(host.textContent).toBe(
            "Metrics1 metric is not on a 0 to 1 scale and is not in the chart.",
        )
    })

    it("Categorical and text metrics are left out, and a run with no chartable metric has no card", () => {
        renderChart([
            row("Tone", [
                metric("tone", "categorical", {
                    type: "categorical/single",
                    count: 2,
                    frequency: [{value: "calm", count: 2}],
                }),
            ]),
        ])
        expect(host.querySelector("section")).toBeNull()
    })
})
