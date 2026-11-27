// @vitest-environment jsdom
import {act, createElement} from "react"

import type {EvaluatorRow, EvaluatorRowMetric, MetricStats} from "@agenta/entities/evaluationRun"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EvaluatorResultsSection} from "@/features/evaluation-run/overview/EvaluatorResultsSection"

import {BOOLEAN, evaluatorMetric, RUN_ID} from "./runOverviewFixtures"
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

const numeric = (mean: number): MetricStats => ({
    type: "numeric/continuous",
    count: 4,
    mean,
    min: 0,
    max: 1,
})

const metric = (
    label: string,
    kind: EvaluatorRowMetric["kind"],
    stats: MetricStats,
): EvaluatorRowMetric => ({id: label, stepKey: "step", metricKey: label, label, kind, stats})

const row = (stepKey: string, name: string, metrics: EvaluatorRowMetric[]): EvaluatorRow => ({
    stepKey,
    evaluatorId: `id-${stepKey}`,
    name,
    metrics,
})

const ROWS = [
    row("tone", "Tone judge", [metric("Tone", "numeric", numeric(0.8))]),
    row("exact", "Exact match", [metric("success", "binary", binary(1, 3))]),
    row("format", "Answer format", [metric("valid", "binary", binary(1, 1))]),
]

let host: HTMLDivElement
let root: Root

const render = () =>
    act(() =>
        root.render(
            createElement(EvaluatorResultsSection, {
                runId: RUN_ID,
                runName: "Capitals check",
                online: false,
                rows: ROWS,
                metrics: [evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN)],
                hasEvaluators: true,
                pending: false,
                error: null,
            }),
        ),
    )

const rowNames = () =>
    Array.from(host.querySelectorAll("[data-testid^='evaluator-']")).map(
        (node) => node.querySelector("[role=cell] span")?.textContent,
    )
const barCount = () => host.querySelectorAll("path[data-series]").length
const button = (text: string) =>
    Array.from(document.querySelectorAll<HTMLElement>("button, [role=menuitemradio]")).find(
        (node) => node.textContent?.trim() === text,
    )!

const typeSearch = (value: string) => {
    const input = host.querySelector<HTMLInputElement>(
        "input[aria-label='Search evaluators and metrics']",
    )!
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
            input,
            value,
        )
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
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
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.releasePointerCapture = () => undefined
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
})

describe("evaluator toolbar", () => {
    it("shows search, filter, group and sort, and orders rows lowest first", () => {
        render()
        expect(
            host.querySelector("input[aria-label='Search evaluators and metrics']"),
        ).not.toBeNull()
        expect(button("Filter")).toBeDefined()
        expect(button("Group: evaluator")).toBeDefined()
        expect(button("Sort: lowest first")).toBeDefined()
        expect(rowNames()).toEqual(["Exact match", "Answer format", "Tone judge"])
    })

    it("search by a metric label narrows the rows and not the chart", () => {
        render()
        const bars = barCount()
        expect(bars).toBe(3)
        typeSearch("tone")
        expect(rowNames()).toEqual(["Tone judge"])
        expect(barCount()).toBe(bars)
        typeSearch("VALID")
        expect(rowNames()).toEqual(["Answer format"])
    })

    it("shows the no-match text when nothing matches", () => {
        render()
        typeSearch("nothing like this")
        expect(rowNames()).toEqual([])
        expect(host.textContent).toContain("No evaluators match this search.")
    })

    it("the filter hides the rows it clears", () => {
        render()
        act(() => button("Filter").click())
        act(() => button("EvaluatorAll evaluators").click())
        const option = Array.from(document.querySelectorAll<HTMLElement>("[role=option]")).find(
            (node) => node.textContent?.includes("Exact match"),
        )!
        act(() => option.click())
        expect(rowNames()).toEqual(["Answer format", "Tone judge"])
        expect(barCount()).toBe(3)
    })

    it("Sort: name orders the rows by evaluator name", () => {
        render()
        const trigger = button("Sort: lowest first")
        act(() => {
            trigger.dispatchEvent(
                new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
            )
        })
        act(() => button("Name").click())
        expect(button("Sort: name")).toBeDefined()
        expect(rowNames()).toEqual(["Answer format", "Exact match", "Tone judge"])
    })
})
