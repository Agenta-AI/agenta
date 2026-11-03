import {describe, expect, it} from "vitest"

import {
    bandLayout,
    finiteOrNull,
    fitRadarLabels,
    barPath,
    formatChartValue,
    lineSegments,
    linearScale,
    nearestIndex,
    nearestRadarAxis,
    niceDomain,
    niceMax,
    radarLabelAlign,
    radarPoint,
    radarRadius,
    tickIndexes,
    ticks,
    truncate,
    wrapLabel,
    xLabelEvery,
} from "../../src/components/presentational/charts/scale"

describe("chart scale math", () => {
    it("Nice max rounds the largest value up to a readable tick", () => {
        expect(niceMax(37)).toBe(40)
        expect(niceMax(100)).toBe(100)
        expect(niceMax(0.73)).toBe(0.8)
        expect(niceMax(1234)).toBe(1500)
        expect(niceMax(0)).toBe(1)
        expect(niceMax(-5)).toBe(1)
    })

    it("ticks are readable steps without float noise", () => {
        expect(ticks(0, 100)).toEqual([0, 25, 50, 75, 100])
        expect(ticks(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3])
        expect(ticks(-20, 40, 3)).toEqual([-20, 0, 20, 40])
        expect(ticks(5, 5)).toEqual([5])
    })

    it("ticks stop at values beyond float precision instead of looping", () => {
        expect(ticks(1e16, 1e16 + 2)).toEqual([1e16, 1e16 + 2])
        expect(ticks(0, Infinity)).toEqual([0])
    })

    it("NaN and infinite values count as missing", () => {
        expect(finiteOrNull(3)).toBe(3)
        expect(finiteOrNull(Number.NaN)).toBeNull()
        expect(finiteOrNull(Infinity)).toBeNull()
        expect(finiteOrNull(null)).toBeNull()
        expect(finiteOrNull(undefined)).toBeNull()
    })

    it("nice domain holds negative values and never collapses to one value", () => {
        expect(niceDomain(-13, 42)).toEqual([-20, 60])
        expect(niceDomain(0, 0)).toEqual([0, 1])
        expect(niceDomain(7, 7)).toEqual([0, 8])
        expect(niceDomain(-3, -3)).toEqual([-3, 0])
    })

    it("linear scale maps the domain onto the range, and a flat domain onto the middle", () => {
        const y = linearScale([0, 100], [200, 0])
        expect(y(0)).toBe(200)
        expect(y(25)).toBe(150)
        expect(linearScale([5, 5], [0, 100])(5)).toBe(50)
    })

    it("default value format keeps three significant digits", () => {
        expect(formatChartValue(0.123456)).toBe("0.123")
        expect(formatChartValue(12)).toBe("12")
        expect(formatChartValue(-4567)).toBe("-4570")
    })

    it("band layout leaves a 20% group gap and a 10% bar gap", () => {
        const one = bandLayout(100, 2, 1)
        expect(one.groupWidth).toBe(50)
        expect(one.bandWidth).toBe(40)
        expect(one.bandStart(1)).toBe(55)
        expect(one.barWidth).toBe(40)
        const two = bandLayout(100, 1, 2)
        expect(two.barWidth).toBeCloseTo(36)
        expect(two.barStart(0, 1)).toBeCloseTo(10 + 40 + 2)
    })

    it("x labels thin out when the groups are too narrow for them", () => {
        expect(xLabelEvery(80, 4)).toEqual({every: 1, maxChars: 11})
        expect(xLabelEvery(30, 9).every).toBe(2)
    })

    it("bar path rounds the value end up or down", () => {
        expect(barPath(0, 10, 20, 100)).toBe("M0,100 V24 Q0,20 4,20 H6 Q10,20 10,24 V100 Z")
        expect(barPath(0, 10, 120, 100)).toBe("M0,100 V116 Q0,120 4,120 H6 Q10,120 10,116 V100 Z")
        // A 2px stub has 2px corners, not 4px ones.
        expect(barPath(0, 10, 98, 100)).toBe("M0,100 V100 Q0,98 2,98 H8 Q10,98 10,100 V100 Z")
    })

    it("truncates and wraps labels with an ellipsis", () => {
        expect(truncate("short", 20)).toBe("short")
        expect(truncate("a very long series name here", 20)).toBe("a very long series…")
        expect(wrapLabel("Answer relevance")).toEqual(["Answer relevance"])
        expect(wrapLabel("Context recall over retrieved passages")).toEqual([
            "Context recall",
            "over retrieved pa…",
        ])
        expect(wrapLabel("Supercalifragilisticexpialidocious")).toEqual(["Supercalifragilis…"])
        expect(wrapLabel("Groundedness score", 10)).toEqual(["Groundedn…", "score"])
    })

    it("radar axis 0 points up and axes go clockwise", () => {
        const [x0, y0] = radarPoint(50, 50, 10, 0, 4, 1)
        expect(x0).toBeCloseTo(50)
        expect(y0).toBeCloseTo(40)
        const [x1, y1] = radarPoint(50, 50, 10, 1, 4, 0.5)
        expect(x1).toBeCloseTo(55)
        expect(y1).toBeCloseTo(50)
        expect(nearestRadarAxis(0, -10, 4)).toBe(0)
        expect(nearestRadarAxis(10, 1, 4)).toBe(1)
        expect(nearestRadarAxis(-10, -1, 4)).toBe(3)
    })

    it("radar labels sit beside side axes and above or below vertical ones", () => {
        expect(radarLabelAlign(0, 4)).toEqual({anchor: "middle", vertical: "above"})
        expect(radarLabelAlign(1, 4)).toEqual({anchor: "start", vertical: "center"})
        expect(radarLabelAlign(2, 4)).toEqual({anchor: "middle", vertical: "below"})
        expect(radarLabelAlign(3, 4)).toEqual({anchor: "end", vertical: "center"})
    })

    it("radar radius leaves room for the widest side label and the tallest top label", () => {
        const label = {width: 60, height: 20}
        // Four axes in a 300 x 200 box with a 10 px gap: the side labels need 60 px each,
        // so 150 - 60 - 10 = 80; the top and bottom labels need 20 px, so 100 - 20 - 10 = 70.
        expect(radarRadius(300, 200, [label, label, label, label], 10)).toBeCloseTo(70)
        expect(radarRadius(300, 400, [label, label, label, label], 10)).toBeCloseTo(80)
        // A side label wider than half the box leaves no room.
        expect(radarRadius(100, 400, [label, {width: 90, height: 20}, label], 10)).toBeLessThan(0)
    })

    it("radar labels wrap shorter when 18 characters leave too little room", () => {
        // Axis 1 points right, so its label needs its full width beside the chart.
        const names = ["Latency", "Context recall over retrieved passages", "Cost", "Fluency"]
        const options = {gap: 10, lineHeight: 13, targetRadius: 60}
        const wide = fitRadarLabels(600, 300, names, options)
        expect(wide.labels[1]).toEqual(["Context recall", "over retrieved pa…"])
        const narrow = fitRadarLabels(320, 300, names, options)
        expect(narrow.radius).toBeGreaterThanOrEqual(60)
        expect(Math.max(...narrow.labels.flat().map((line) => line.length))).toBeLessThan(18)
        // Too small for the target with any length: the largest radius wins, never below 0.
        const tiny = fitRadarLabels(60, 60, names, options)
        expect(tiny.radius).toBeGreaterThanOrEqual(0)
        expect(tiny.radius).toBeLessThan(60)
    })

    it("line segments break at null values", () => {
        expect(
            lineSegments([
                [0, 1],
                [1, null],
                [2, 3],
                [3, 4],
            ]),
        ).toEqual([
            [[0, 1]],
            [
                [2, 3],
                [3, 4],
            ],
        ])
    })

    it("finds the nearest x and spaces tick indexes evenly", () => {
        expect(nearestIndex([0, 10, 20], 14)).toBe(1)
        expect(nearestIndex([0, 10, 20], 16)).toBe(2)
        expect(nearestIndex([], 3)).toBe(-1)
        expect(tickIndexes(24, 4)).toEqual([0, 8, 16])
        expect(tickIndexes(12, 10)).toEqual([0, 2, 4, 6, 8, 10])
        expect(tickIndexes(3, 10)).toEqual([0, 1, 2])
        expect(tickIndexes(1, 4)).toEqual([0])
    })
})
