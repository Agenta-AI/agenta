import {describe, expect, it} from "vitest"

import {
    distributeColumnWidths,
    type DistributableColumn,
} from "../../src/InfiniteVirtualTable/distributeColumnWidths"

const col = (key: string, width: number, extra: Partial<DistributableColumn> = {}) => ({
    key,
    width,
    minWidth: 40,
    ...extra,
})

const sum = (sizing: Record<string, number>) => Object.values(sizing).reduce((a, b) => a + b, 0)

describe("distributeColumnWidths", () => {
    describe("all flexible", () => {
        it("shares surplus space in proportion to declared widths", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100), col("b", 200), col("c", 300)],
                containerWidth: 1200,
            })
            // weights 100:200:300 of 1200 → 200 : 400 : 600
            expect(sizing).toEqual({a: 200, b: 400, c: 600})
        })

        it("fills the container exactly, with the last column absorbing rounding", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100), col("b", 100), col("c", 100)],
                containerWidth: 1000,
            })
            expect(sum(sizing)).toBe(1000)
        })

        it("returns integers so the header and body dividers cannot drift", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100), col("b", 100), col("c", 100)],
                containerWidth: 1000,
            })
            for (const width of Object.values(sizing)) expect(Number.isInteger(width)).toBe(true)
        })

        it("never shrinks a column below its declared width, overflowing instead", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 300), col("b", 300), col("c", 300)],
                containerWidth: 400,
            })
            expect(sizing).toEqual({a: 300, b: 300, c: 300})
            expect(sum(sizing)).toBeGreaterThan(400)
        })
    })

    describe("capped and pinned columns", () => {
        it("holds a capped column at its cap and shares the rest", () => {
            const sizing = distributeColumnWidths({
                columns: [col("capped", 100, {maxWidth: 150}), col("flex", 200)],
                containerWidth: 1000,
            })
            expect(sizing.capped).toBe(150)
            expect(sizing.flex).toBe(850)
        })

        it("reserves pinned columns at their declared width before sharing", () => {
            const sizing = distributeColumnWidths({
                columns: [col("pinned", 120, {isFixed: true}), col("flex", 200)],
                containerWidth: 1000,
            })
            expect(sizing.pinned).toBe(120)
            expect(sizing.flex).toBe(880)
        })

        it("reserves the selection column before sharing", () => {
            const sizing = distributeColumnWidths({
                columns: [col("flex", 200)],
                containerWidth: 1000,
                leadingColumnWidth: 48,
            })
            expect(sizing.flex).toBe(952)
        })

        it("returns only reserved widths when nothing can flex", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100, {isFixed: true}), col("b", 100, {maxWidth: 150})],
                containerWidth: 1000,
            })
            expect(sizing).toEqual({a: 100, b: 150})
        })
    })

    describe("user drags win over the auto-layout", () => {
        it("keeps a dragged width and shares what is left", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100), col("b", 100)],
                containerWidth: 1000,
                userWidths: {a: 400},
            })
            expect(sizing.a).toBe(400)
            expect(sizing.b).toBe(600)
        })

        it("lets a drag override a cap, since the user opted out of it", () => {
            const sizing = distributeColumnWidths({
                columns: [col("capped", 100, {maxWidth: 150}), col("flex", 200)],
                containerWidth: 1000,
                userWidths: {capped: 500},
            })
            expect(sizing.capped).toBe(500)
            expect(sizing.flex).toBe(500)
        })

        it("clamps a drag to minWidth", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100, {minWidth: 80}), col("b", 100)],
                containerWidth: 1000,
                userWidths: {a: 10},
            })
            expect(sizing.a).toBe(80)
        })

        it("stretches the last dragged column to close a gap when every column was dragged", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100), col("b", 100)],
                containerWidth: 1000,
                userWidths: {a: 200, b: 300},
            })
            expect(sizing.a).toBe(200)
            expect(sizing.b).toBe(800)
            expect(sum(sizing)).toBe(1000)
        })

        it("gives untouched columns their declared width when drags consumed the space", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100), col("b", 150)],
                containerWidth: 500,
                userWidths: {a: 480},
            })
            expect(sizing.a).toBe(480)
            expect(sizing.b).toBe(150)
        })
    })

    describe("edges", () => {
        it("handles no columns", () => {
            expect(distributeColumnWidths({columns: [], containerWidth: 1000})).toEqual({})
        })

        it("handles a container of zero without producing negatives", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100), col("b", 100)],
                containerWidth: 0,
            })
            for (const width of Object.values(sizing)) expect(width).toBeGreaterThan(0)
        })

        it("does not shrink when the leading column alone exceeds the container", () => {
            const sizing = distributeColumnWidths({
                columns: [col("a", 100)],
                containerWidth: 40,
                leadingColumnWidth: 48,
            })
            expect(sizing.a).toBe(100)
        })
    })
})
