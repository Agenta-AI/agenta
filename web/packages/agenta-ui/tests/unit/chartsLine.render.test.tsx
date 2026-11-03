// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {LineChart} from "../../src/components/presentational/charts"

import {numbersOf, stubChartWidth} from "./chartsTestUtils"

beforeEach(() => stubChartWidth(480))
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

const oneSeries = [{key: "score", name: "Score"}]
const formatX = (x: number) => `t${x}`

/** The stroked line paths of a series (the area paths have no stroke). */
const linesOf = (container: HTMLElement, series: string) =>
    Array.from(container.querySelectorAll(`g[data-series="${series}"] path[stroke]`))

describe("LineChart", () => {
    it("Line chart sorts points by time before drawing", () => {
        render(
            <LineChart
                title="Score over time"
                height={200}
                series={oneSeries}
                formatX={formatX}
                points={[
                    {x: 3, values: {score: 3}},
                    {x: 1, values: {score: 1}},
                    {x: 2, values: {score: 2}},
                ]}
            />,
        )
        const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1)
        expect(rows.map((row) => row.textContent)).toEqual(["t11", "t22", "t33"])
        const {container} = render(
            <LineChart
                title="Sorted"
                height={200}
                series={oneSeries}
                points={[
                    {x: 3, values: {score: 3}},
                    {x: 1, values: {score: 1}},
                ]}
            />,
        )
        const [x0, , x1] = numbersOf(linesOf(container, "score")[0].getAttribute("d"))
        expect(x0).toBeLessThan(x1)
    })

    it("A null value breaks the line instead of dropping to zero", () => {
        const {container} = render(
            <LineChart
                title="Score over time"
                height={200}
                series={oneSeries}
                points={[
                    {x: 1, values: {score: 5}},
                    {x: 2, values: {score: 6}},
                    {x: 3, values: {score: null}},
                    {x: 4, values: {score: 7}},
                    {x: 5, values: {score: 8}},
                ]}
            />,
        )
        expect(linesOf(container, "score")).toHaveLength(2)
    })

    it("A single point draws a dot", () => {
        const {container} = render(
            <LineChart
                title="Score over time"
                height={200}
                series={oneSeries}
                points={[{x: 1, values: {score: 5}}]}
            />,
        )
        expect(linesOf(container, "score")).toHaveLength(0)
        expect(container.querySelectorAll('g[data-series="score"] circle')).toHaveLength(1)
    })

    it("Negative values get a domain below zero", () => {
        render(
            <LineChart
                title="Delta"
                height={200}
                series={oneSeries}
                points={[
                    {x: 1, values: {score: -13}},
                    {x: 2, values: {score: 42}},
                ]}
            />,
        )
        // Y tick labels; the hidden table lists data values only.
        expect(screen.getByText("-20").tagName).toBe("text")
        expect(screen.getByText("60").tagName).toBe("text")
    })

    it("The tooltip shows the nearest point for every series", () => {
        render(
            <LineChart
                title="Score over time"
                height={200}
                formatX={formatX}
                series={[
                    {key: "a", name: "Run A"},
                    {key: "b", name: "Run B"},
                ]}
                points={[
                    {x: 0, values: {a: 1, b: 2}},
                    {x: 100, values: {a: 3, b: 4}},
                ]}
            />,
        )
        const svg = screen.getByRole("img", {name: "Score over time"})
        fireEvent.mouseMove(svg, {clientX: 400, clientY: 60})
        const tooltip = screen.getByRole("tooltip")
        expect(tooltip.textContent).toContain("t100")
        expect(tooltip.textContent).toContain("Run A: 3")
        expect(tooltip.textContent).toContain("Run B: 4")
        fireEvent.mouseMove(svg, {clientX: 30, clientY: 60})
        expect(screen.getByRole("tooltip").textContent).toContain("Run A: 1")
    })

    it("Line and grid colors come from theme tokens", () => {
        const {container} = render(
            <LineChart
                title="Score over time"
                height={200}
                series={oneSeries}
                points={[
                    {x: 1, values: {score: 1}},
                    {x: 2, values: {score: 2}},
                ]}
            />,
        )
        expect(linesOf(container, "score")[0].getAttribute("stroke")).toBe(
            "var(--ag-chart-series-0)",
        )
        const grid = container.querySelector("line[stroke-dasharray]")
        expect(grid?.getAttribute("stroke")).toBe("var(--ag-chart-grid)")
        const colors = Array.from(container.querySelectorAll("[stroke], [fill]")).flatMap((el) =>
            [el.getAttribute("stroke"), el.getAttribute("fill")].filter(
                (c): c is string => !!c && c !== "none",
            ),
        )
        expect(colors.every((c) => c.startsWith("var(--ag-"))).toBe(true)
    })

    it("A fixed y domain sets the axis, and a NaN value only breaks its own line", () => {
        const {container} = render(
            <LineChart
                title="Pass rate"
                height={200}
                series={oneSeries}
                yDomain={[0, 1]}
                points={[
                    {x: 1, values: {score: 0.5}},
                    {x: 2, values: {score: Number.NaN}},
                    {x: 3, values: {score: 0.75}},
                    {x: 4, values: {score: 1}},
                ]}
            />,
        )
        // Tick labels are svg text; the hidden table holds the data values.
        const tickLabels = Array.from(container.querySelectorAll("text")).map((t) => t.textContent)
        expect(tickLabels).toEqual(expect.arrayContaining(["0", "0.25", "0.5", "0.75", "1"]))
        // The NaN point leaves a dot before it and a line after it.
        expect(container.querySelectorAll('g[data-series="score"] circle')).toHaveLength(1)
        expect(linesOf(container, "score")).toHaveLength(1)
        expect(container.innerHTML).not.toContain("NaN")
    })

    it("Empty points render nothing", () => {
        const {container} = render(
            <LineChart title="Score over time" height={200} series={oneSeries} points={[]} />,
        )
        expect(container.innerHTML).toBe("")
    })
})
