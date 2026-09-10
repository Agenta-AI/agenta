import {describe, expect, it} from "vitest"

import {
    autoscrollSpeed,
    insertionIndex,
    insertionOffset,
    reorderedIds,
    type DragSlot,
} from "../../src/reorder/geometry"

/** Three 28px rows, the rail's own height, in scroller-content coordinates. */
const slots: DragSlot[] = [
    {id: "a", top: 0, mid: 14, bottom: 28},
    {id: "b", top: 28, mid: 42, bottom: 56},
    {id: "c", top: 56, mid: 70, bottom: 84},
]

describe("insertionIndex", () => {
    it("counts the rows the pointer has passed the middle of", () => {
        expect(insertionIndex(slots, 0)).toBe(0)
        expect(insertionIndex(slots, 13)).toBe(0)
        expect(insertionIndex(slots, 15)).toBe(1)
        expect(insertionIndex(slots, 43)).toBe(2)
        expect(insertionIndex(slots, 999)).toBe(3)
    })

    it("has no gap to offer an empty zone", () => {
        expect(insertionIndex([], 40)).toBe(0)
    })
})

describe("insertionOffset", () => {
    it("draws above the first row, then below each row it follows", () => {
        expect(insertionOffset(slots, 0)).toBe(0)
        expect(insertionOffset(slots, 1)).toBe(28)
        expect(insertionOffset(slots, 3)).toBe(84)
    })

    it("clamps past the end rather than reading off the array", () => {
        expect(insertionOffset(slots, 9)).toBe(84)
    })
})

describe("reorderedIds", () => {
    it("moves a row down into the gap the pointer marks", () => {
        // The dragged row still occupies a slot, so a later gap counts one too many.
        expect(reorderedIds(["a", "b", "c"], 0, 2)).toEqual(["b", "a", "c"])
        expect(reorderedIds(["a", "b", "c"], 0, 3)).toEqual(["b", "c", "a"])
    })

    it("moves a row up into the gap the pointer marks", () => {
        expect(reorderedIds(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
        expect(reorderedIds(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"])
    })

    it("is a no-op when the row lands where it started", () => {
        expect(reorderedIds(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"])
        expect(reorderedIds(["a", "b", "c"], 1, 2)).toEqual(["a", "b", "c"])
    })
})

describe("autoscrollSpeed", () => {
    it("is still in the middle of the scroller", () => {
        expect(autoscrollSpeed(300, 100, 500)).toBe(0)
    })

    it("scrolls up near the top edge and down near the bottom", () => {
        expect(autoscrollSpeed(110, 100, 500)).toBeLessThan(0)
        expect(autoscrollSpeed(495, 100, 500)).toBeGreaterThan(0)
    })

    it("ramps with depth into the band and caps out", () => {
        const shallow = autoscrollSpeed(140, 100, 500)
        const deep = autoscrollSpeed(105, 100, 500)
        expect(Math.abs(deep)).toBeGreaterThan(Math.abs(shallow))
        expect(Math.abs(autoscrollSpeed(0, 100, 500))).toBeLessThanOrEqual(14)
    })
})
