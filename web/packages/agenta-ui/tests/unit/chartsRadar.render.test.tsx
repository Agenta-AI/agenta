// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {RadarChart, type RadarAxis} from "../../src/components/presentational/charts"

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

const axis = (name: string, max: number, a: number | null, b: number | null): RadarAxis => ({
    name,
    max,
    values: {
        a: a === null ? null : {normalized: a / max, raw: a},
        b: b === null ? null : {normalized: b / max, raw: b},
    },
})

const axes = [axis("Accuracy", 1, 0.8, 0.6), axis("Latency", 2, 1, 2), axis("Cost", 4, 2, 1)]

const polygonOf = (container: HTMLElement, series: string) =>
    container.querySelector(`g[data-series="${series}"] polygon`)

describe("RadarChart", () => {
    it("Radar chart with fewer than three axes renders nothing", () => {
        const {container} = render(
            <RadarChart title="Metrics" height={300} series={twoRuns} axes={axes.slice(0, 2)} />,
        )
        expect(container.innerHTML).toBe("")
    })

    it("Each series draws one polygon through its normalized values", () => {
        const {container} = render(
            <RadarChart title="Metrics" height={300} series={twoRuns} axes={axes} />,
        )
        const points = numbersOf(polygonOf(container, "a")?.getAttribute("points") ?? null)
        expect(points).toHaveLength(6)
        // Axis 0 points straight up from the center (240, 150): x stays on the center line.
        expect(points[0]).toBeCloseTo(240)
        expect(points[1]).toBeLessThan(150)
        expect(polygonOf(container, "a")?.getAttribute("stroke")).toBe("var(--ag-chart-series-0)")
        expect(polygonOf(container, "b")?.getAttribute("stroke")).toBe("var(--ag-chart-series-1)")
    })

    it("A value of zero sits on the center and a full value on the outer ring", () => {
        const {container} = render(
            <RadarChart
                title="Metrics"
                height={300}
                series={[{key: "a", name: "Run A"}]}
                axes={[axis("One", 1, 0, null), axis("Two", 1, 1, null), axis("Three", 1, 1, null)]}
            />,
        )
        const [x0, y0] = numbersOf(polygonOf(container, "a")?.getAttribute("points") ?? null)
        expect(x0).toBeCloseTo(240)
        expect(y0).toBeCloseTo(150)
    })

    it("Axis labels wrap to two lines of eighteen characters", () => {
        const {container} = render(
            <RadarChart
                title="Metrics"
                height={300}
                series={twoRuns}
                axes={[
                    axis("Context recall over retrieved passages", 1, 0.5, 0.5),
                    ...axes.slice(1),
                ]}
            />,
        )
        const label = Array.from(container.querySelectorAll("text")).find((text) =>
            text.textContent?.startsWith("Context"),
        )
        const lines = Array.from(label?.querySelectorAll("tspan") ?? []).map((t) => t.textContent)
        expect(lines).toEqual(["Context recall", "over retrieved pa…"])
    })

    it("The axis tooltip shows raw over max for every series", () => {
        render(
            <RadarChart
                title="Metrics"
                height={300}
                series={twoRuns}
                axes={axes}
                formatAxisValue={(raw, current) =>
                    current.name === "Cost" ? `$${raw.toFixed(2)}` : String(raw)
                }
            />,
        )
        const svg = screen.getByRole("img", {name: "Metrics"})
        // Straight down from the center is between axis 1 (right-down) and axis 2 (left-down);
        // to the lower left is axis 2, "Cost".
        fireEvent.mouseMove(svg, {clientX: 140, clientY: 220})
        const tooltip = screen.getByRole("tooltip")
        expect(tooltip.textContent).toContain("Cost")
        expect(tooltip.textContent).toContain("Run A: $2.00 / $4.00")
        expect(tooltip.textContent).toContain("Run B: $1.00 / $4.00")
    })

    it("A narrow chart without width draws nothing and does not fail", () => {
        stubChartWidth(0)
        render(<RadarChart title="Metrics" height={300} series={twoRuns} axes={axes} />)
        expect(screen.queryByRole("img")).toBeNull()
    })

    it("A missing series value is left out, not drawn as zero", () => {
        const {container} = render(
            <RadarChart
                title="Metrics"
                height={300}
                series={twoRuns}
                axes={[...axes, axis("Fluency", 1, 0.9, null)]}
            />,
        )
        expect(numbersOf(polygonOf(container, "a")?.getAttribute("points") ?? null)).toHaveLength(8)
        // Run B misses "Fluency": three vertices, none of them at the center.
        const b = numbersOf(polygonOf(container, "b")?.getAttribute("points") ?? null)
        expect(b).toHaveLength(6)
        for (let i = 0; i < b.length; i += 2) {
            expect(Math.hypot(b[i] - 240, b[i + 1] - 150)).toBeGreaterThan(1)
        }
        fireEvent.focus(screen.getByRole("img"))
        fireEvent.keyDown(screen.getByRole("img"), {key: "End"})
        expect(screen.getByRole("tooltip").textContent).not.toContain("Run B")
    })
})
