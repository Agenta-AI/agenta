import {describe, expect, it} from "vitest"

import {computePagerState, pageDelta, CARD_GAP, CARD_WIDTH, PAGE_SIZE} from "./pagerMath"

const PER = CARD_WIDTH + CARD_GAP

// A 6-card row in a viewport that shows ~3 cards.
const SCROLL_WIDTH = 6 * PER
const CLIENT_WIDTH = 3 * PER
const MAX = SCROLL_WIDTH - CLIENT_WIDTH

describe("computePagerState", () => {
    it("is atStart within the 4px tolerance", () => {
        expect(computePagerState(0, SCROLL_WIDTH, CLIENT_WIDTH, 6).atStart).toBe(true)
        expect(computePagerState(4, SCROLL_WIDTH, CLIENT_WIDTH, 6).atStart).toBe(true)
        expect(computePagerState(5, SCROLL_WIDTH, CLIENT_WIDTH, 6).atStart).toBe(false)
    })

    it("is atEnd within the 4px tolerance of max scroll", () => {
        expect(computePagerState(MAX, SCROLL_WIDTH, CLIENT_WIDTH, 6).atEnd).toBe(true)
        expect(computePagerState(MAX - 4, SCROLL_WIDTH, CLIENT_WIDTH, 6).atEnd).toBe(true)
        expect(computePagerState(MAX - 5, SCROLL_WIDTH, CLIENT_WIDTH, 6).atEnd).toBe(false)
    })

    it("treats a non-scrollable row as both atStart and atEnd", () => {
        const state = computePagerState(0, CLIENT_WIDTH, CLIENT_WIDTH, 3)
        expect(state.atStart).toBe(true)
        expect(state.atEnd).toBe(true)
    })

    it("labels the counter at start, middle, and end", () => {
        expect(computePagerState(0, SCROLL_WIDTH, CLIENT_WIDTH, 6).counterLabel).toBe("1-3 of 6")
        expect(computePagerState(PER, SCROLL_WIDTH, CLIENT_WIDTH, 6).counterLabel).toBe("2-4 of 6")
        expect(computePagerState(MAX, SCROLL_WIDTH, CLIENT_WIDTH, 6).counterLabel).toBe("4-6 of 6")
    })

    it("clamps first so the window never runs past the last card", () => {
        // Scrolled absurdly far: first clamps to cardCount - 2.
        expect(computePagerState(50 * PER, SCROLL_WIDTH, CLIENT_WIDTH, 6).counterLabel).toBe(
            "4-6 of 6",
        )
        // Tiny sets clamp to 1.
        expect(computePagerState(0, CLIENT_WIDTH, CLIENT_WIDTH, 2).counterLabel).toBe("1-2 of 2")
    })

    it("shows the pager only above three cards", () => {
        expect(computePagerState(0, SCROLL_WIDTH, CLIENT_WIDTH, 3).showPager).toBe(false)
        expect(computePagerState(0, SCROLL_WIDTH, CLIENT_WIDTH, 4).showPager).toBe(true)
    })
})

describe("pageDelta", () => {
    it("pages by three cards in either direction", () => {
        expect(pageDelta(1)).toBe(PER * PAGE_SIZE)
        expect(pageDelta(-1)).toBe(-PER * PAGE_SIZE)
    })
})
