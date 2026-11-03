// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {BarChart, ChartLegend} from "../../src/components/presentational/charts"

import {numbersOf, stubChartWidth} from "./chartsTestUtils"

beforeEach(() => stubChartWidth(480))
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

const twoRuns = [
    {key: "a", name: "Run A"},
    {key: "b", name: "Run B"},
]

const data = [
    {category: "Low", values: {a: 4, b: 0}},
    {category: "Mid", values: {a: 10, b: null}},
    {category: "High", values: {a: 6, b: 8}},
]

/** Top and bottom y of a bar path, from its "M x,baseline V ... Q x,top" shape. */
function barExtent(path: Element) {
    const [, baseline, , , top] = numbersOf(path.getAttribute("d"))
    return {baseline, top, height: Math.abs(baseline - top)}
}

const bars = (container: HTMLElement, series: string) =>
    Array.from(container.querySelectorAll(`path[data-series="${series}"]`))

describe("BarChart", () => {
    it("Bar chart draws one bar per series in each category", () => {
        const {container} = render(
            <BarChart
                title="Scores"
                height={200}
                series={twoRuns}
                data={[
                    {category: "x", values: {a: 1, b: 2}},
                    {category: "y", values: {a: 3, b: 4}},
                ]}
            />,
        )
        expect(bars(container, "a")).toHaveLength(2)
        expect(bars(container, "b")).toHaveLength(2)
        expect(bars(container, "a")[0].getAttribute("fill")).toBe("var(--ag-chart-series-0)")
        expect(bars(container, "b")[0].getAttribute("fill")).toBe("var(--ag-chart-series-1)")
    })

    it("A zero value still draws a visible stub", () => {
        const {container} = render(
            <BarChart title="Scores" height={200} series={twoRuns} data={data} />,
        )
        expect(barExtent(bars(container, "b")[0]).height).toBe(2)
    })

    it("A null value draws no bar", () => {
        const {container} = render(
            <BarChart title="Scores" height={200} series={twoRuns} data={data} />,
        )
        // Run B has values for "Low" and "High" only.
        expect(bars(container, "b")).toHaveLength(2)
    })

    it("Bar chart with a fixed max of 100 scales bars as percentages", () => {
        const {container} = render(
            <BarChart
                title="Pass rate"
                height={232}
                series={[{key: "pct", name: "Percentage"}]}
                data={[
                    {category: "True", values: {pct: 50}},
                    {category: "False", values: {pct: 50}},
                ]}
                yMax={100}
            />,
        )
        // Plot is 232 - 8 top - 24 bottom = 200 px high, so 50% is 100 px.
        const [first] = bars(container, "pct")
        expect(barExtent(first).height).toBeCloseTo(100)
        expect(screen.getByText("100")).toBeTruthy()
    })

    it("Negative values draw below the zero line", () => {
        const {container} = render(
            <BarChart
                title="Delta"
                height={200}
                series={[{key: "d", name: "Delta"}]}
                data={[
                    {category: "x", values: {d: 5}},
                    {category: "y", values: {d: -5}},
                ]}
            />,
        )
        const [up, down] = bars(container, "d").map(barExtent)
        expect(up.top).toBeLessThan(up.baseline)
        expect(down.top).toBeGreaterThan(down.baseline)
        expect(up.height).toBeCloseTo(down.height)
    })

    it("A single category with one series draws one bar", () => {
        const {container} = render(
            <BarChart
                title="Count"
                height={200}
                series={[{key: "n", name: "Count"}]}
                data={[{category: "Only", values: {n: 3}}]}
            />,
        )
        expect(bars(container, "n")).toHaveLength(1)
        expect(screen.queryByRole("list")).toBeNull()
    })

    it("Hovering a category shows every series value in the tooltip", () => {
        render(<BarChart title="Scores" height={200} series={twoRuns} data={data} />)
        const svg = screen.getByRole("img", {name: "Scores"})
        // Left margin is "10".length * 6.5 + 10 = 23 px; the plot is 449 px for three groups,
        // so x = 400 is inside the third group ("High").
        fireEvent.mouseMove(svg, {clientX: 400, clientY: 50})
        const tooltip = screen.getByRole("tooltip")
        expect(tooltip.textContent).toContain("High")
        expect(tooltip.textContent).toContain("Run A: 6")
        expect(tooltip.textContent).toContain("Run B: 8")
        fireEvent.mouseLeave(svg)
        expect(screen.queryByRole("tooltip")).toBeNull()
    })

    it("Keyboard focus on a category shows the same tooltip", () => {
        render(<BarChart title="Scores" height={200} series={twoRuns} data={data} />)
        const svg = screen.getByRole("img", {name: "Scores"})
        fireEvent.focus(svg)
        expect(screen.getByRole("tooltip").textContent).toContain("Low")
        fireEvent.keyDown(svg, {key: "ArrowRight"})
        const tooltip = screen.getByRole("tooltip")
        expect(tooltip.textContent).toContain("Mid")
        expect(tooltip.textContent).toContain("Run A: 10")
        // Run B has no value for "Mid", so it has no row.
        expect(tooltip.textContent).not.toContain("Run B")
        expect(svg.getAttribute("aria-describedby")).toBe(tooltip.id)
        fireEvent.keyDown(svg, {key: "Escape"})
        expect(screen.queryByRole("tooltip")).toBeNull()
    })

    it("The svg has the title as its accessible name and a hidden data table", () => {
        render(<BarChart title="Scores" height={200} series={twoRuns} data={data} />)
        expect(screen.getByRole("img", {name: "Scores"})).toBeTruthy()
        const table = screen.getByRole("table", {name: "Scores"})
        expect(table.className).toContain("sr-only")
        const rows = within(table).getAllByRole("row")
        expect(rows.map((row) => row.textContent)).toEqual([
            "Run ARun B",
            "Low40",
            "Mid10",
            "High68",
        ])
    })

    it("Empty data renders nothing", () => {
        const {container} = render(
            <BarChart title="Scores" height={200} series={twoRuns} data={[]} />,
        )
        expect(container.innerHTML).toBe("")
    })

    it("A series color and a value format from the caller are used", () => {
        const {container} = render(
            <BarChart
                title="Pass rate"
                height={200}
                series={[{key: "pct", name: "Percentage", color: "var(--ag-colorSuccess)"}]}
                data={[{category: "True", values: {pct: 40}}]}
                yMax={100}
                formatValue={(value) => `${value}%`}
            />,
        )
        expect(bars(container, "pct")[0].getAttribute("fill")).toBe("var(--ag-colorSuccess)")
        expect(screen.getByText("100%").tagName).toBe("text")
        fireEvent.focus(screen.getByRole("img"))
        expect(screen.getByRole("tooltip").textContent).toContain("Percentage: 40%")
    })

    it("Home and End move the focus to the first and last category", () => {
        render(<BarChart title="Scores" height={200} series={twoRuns} data={data} />)
        const svg = screen.getByRole("img")
        fireEvent.focus(svg)
        fireEvent.keyDown(svg, {key: "End"})
        expect(screen.getByRole("tooltip").textContent).toContain("High")
        fireEvent.keyDown(svg, {key: "Home"})
        expect(screen.getByRole("tooltip").textContent).toContain("Low")
    })

    it("A NaN value draws no bar and leaves the other bars in place", () => {
        const {container} = render(
            <BarChart
                title="Scores"
                height={200}
                series={[{key: "a", name: "Run A"}]}
                data={[
                    {category: "x", values: {a: Number.NaN}},
                    {category: "y", values: {a: 4}},
                ]}
            />,
        )
        const drawn = bars(container, "a")
        expect(drawn).toHaveLength(1)
        expect(drawn[0].getAttribute("d")).not.toContain("NaN")
    })

    it("A chart that first renders without data draws once data arrives", () => {
        const {rerender} = render(
            <BarChart title="Scores" height={200} series={twoRuns} data={[]} />,
        )
        expect(screen.queryByRole("img")).toBeNull()
        rerender(<BarChart title="Scores" height={200} series={twoRuns} data={data} />)
        expect(screen.getByRole("img", {name: "Scores"})).toBeTruthy()
    })

    it("A hidden chart with no width draws no svg and does not fail", () => {
        stubChartWidth(0)
        render(<BarChart title="Scores" height={200} series={twoRuns} data={data} />)
        expect(screen.queryByRole("img")).toBeNull()
    })
})

describe("ChartLegend", () => {
    it("Legend shows only with two or more series and shortens long names", () => {
        const {rerender} = render(<ChartLegend series={[{key: "a", name: "Only"}]} />)
        expect(screen.queryByRole("list")).toBeNull()
        rerender(
            <ChartLegend
                series={[
                    {key: "a", name: "A very long evaluation run name"},
                    {key: "b", name: "Short"},
                ]}
            />,
        )
        const items = within(screen.getByRole("list")).getAllByRole("listitem")
        expect(items.map((item) => item.textContent)).toEqual(["A very long evaluat…", "Short"])
        expect(items[0].getAttribute("title")).toBe("A very long evaluation run name")
    })
})
