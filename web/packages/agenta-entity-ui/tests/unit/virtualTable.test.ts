import {describe, expect, it} from "vitest"

/**
 * The windowing and sticky-offset arithmetic behind the antd-free table.
 *
 * Both are pure and both are the parts that break silently: a wrong slice renders blank rows
 * mid-scroll, and a wrong offset overlaps pinned columns. Mirrored here rather than exported
 * from the component so the component stays a single render path.
 */

const sliceFor = (
    scrollTop: number,
    rowHeight: number,
    viewportHeight: number,
    overscan: number,
    total: number,
) => {
    const first = viewportHeight ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0
    const count = viewportHeight ? Math.ceil(viewportHeight / rowHeight) + overscan * 2 : total
    return {first, last: Math.min(total, first + count)}
}

describe("row windowing", () => {
    it("mounts only the visible slice plus overscan", () => {
        // 1000 rows at 48px in a 480px viewport: 10 visible, 6 overscan each side.
        expect(sliceFor(0, 48, 480, 6, 1000)).toEqual({first: 0, last: 22})
    })

    it("moves the window as the scroller advances", () => {
        expect(sliceFor(4800, 48, 480, 6, 1000)).toEqual({first: 94, last: 116})
    })

    it("never starts before the first row", () => {
        expect(sliceFor(48, 48, 480, 6, 1000).first).toBe(0)
    })

    it("clamps the end to the dataset", () => {
        expect(sliceFor(47_760, 48, 480, 6, 1000).last).toBe(1000)
    })

    it("renders everything when no viewport height is known", () => {
        // Height arrives a frame late; rendering nothing until then would flash an empty table.
        expect(sliceFor(0, 48, 0, 6, 30)).toEqual({first: 0, last: 30})
    })
})

interface Col {
    fixed?: "left" | "right" | boolean
    width: number
}

const offsetsFor = (columns: Col[], leading: number) => {
    const left = new Map<number, number>()
    const right = new Map<number, number>()

    let runningLeft = leading
    columns.forEach((column, index) => {
        if (column.fixed === "left" || column.fixed === true) {
            left.set(index, runningLeft)
            runningLeft += column.width
        }
    })

    let runningRight = 0
    for (let index = columns.length - 1; index >= 0; index -= 1) {
        if (columns[index].fixed === "right") {
            right.set(index, runningRight)
            runningRight += columns[index].width
        }
    }

    return {left, right}
}

describe("sticky column offsets", () => {
    it("stacks left-pinned columns after the selection column", () => {
        const {left} = offsetsFor(
            [{fixed: "left", width: 200}, {fixed: "left", width: 120}, {width: 300}],
            48,
        )

        expect(left.get(0)).toBe(48)
        expect(left.get(1)).toBe(248)
        expect(left.has(2)).toBe(false)
    })

    it("stacks right-pinned columns from the right edge inward", () => {
        const {right} = offsetsFor(
            [{width: 300}, {fixed: "right", width: 120}, {fixed: "right", width: 80}],
            0,
        )

        expect(right.get(2)).toBe(0)
        expect(right.get(1)).toBe(80)
    })
})
