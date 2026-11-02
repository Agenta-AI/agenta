import {describe, expect, it} from "vitest"

import {clippedEdges, scrollEdgeMask} from "../../../src/assets/conversationLayout"

describe("clippedEdges", () => {
    it("reports nothing while the whole thing fits", () => {
        expect(clippedEdges({scrollTop: 0, scrollHeight: 400, clientHeight: 400})).toEqual({
            top: false,
            bottom: false,
        })
    })

    it("reports only the bottom at the top of an overflowing scroller", () => {
        expect(clippedEdges({scrollTop: 0, scrollHeight: 900, clientHeight: 400})).toEqual({
            top: false,
            bottom: true,
        })
    })

    it("reports only the top once scrolled to the end", () => {
        expect(clippedEdges({scrollTop: 500, scrollHeight: 900, clientHeight: 400})).toEqual({
            top: true,
            bottom: false,
        })
    })

    // A sub-pixel offset must not flicker a fade in.
    it("ignores offsets inside the threshold", () => {
        expect(clippedEdges({scrollTop: 3, scrollHeight: 900, clientHeight: 400}).top).toBe(false)
        expect(clippedEdges({scrollTop: 497, scrollHeight: 900, clientHeight: 400}).bottom).toBe(
            false,
        )
    })
})

describe("scrollEdgeMask", () => {
    it("is no mask at all when nothing is clipped", () => {
        expect(scrollEdgeMask(false, false)).toBe("none")
    })

    it("fades only the clipped edge", () => {
        expect(scrollEdgeMask(true, false)).toBe(
            "linear-gradient(to bottom, transparent 0, #000 26px, #000 100%)",
        )
        expect(scrollEdgeMask(false, true)).toBe(
            "linear-gradient(to bottom, #000 0, #000 calc(100% - 34px), transparent 100%)",
        )
    })
})
