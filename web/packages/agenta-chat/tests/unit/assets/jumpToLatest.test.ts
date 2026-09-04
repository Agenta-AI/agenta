/**
 * @vitest-environment jsdom
 *
 * The jump-to-latest rule. This exists because the three transcript engines each carried their own
 * number (24px, Virtuoso's ~4px default, 80px), so "scrolled up a little" meant something different
 * on every surface. The two regressions worth pinning: the pill must not fire on a nudge, and a
 * reserved transcript must be measured by its last turn's box, not by the scroll gap — the reserve
 * is up to a full viewport of empty space and would otherwise read as "miles from the bottom".
 */
import {describe, expect, it} from "vitest"

import {
    JUMP_REVEAL_MIN_PX,
    distanceBelowNewest,
    jumpGateOpen,
    jumpRevealDistance,
    shouldRevealJump,
} from "../../../src/assets/jumpToLatest"

/** A scroller whose geometry we control outright — jsdom lays nothing out. */
const scroller = ({
    clientHeight,
    scrollHeight = clientHeight,
    scrollTop = 0,
    lastTurnBottom,
}: {
    clientHeight: number
    scrollHeight?: number
    scrollTop?: number
    /** Viewport-relative bottom of the last turn's content; omit for a transcript with no rows. */
    lastTurnBottom?: number
}): HTMLElement => {
    const el = document.createElement("div")
    Object.defineProperty(el, "clientHeight", {value: clientHeight})
    Object.defineProperty(el, "scrollHeight", {value: scrollHeight})
    el.scrollTop = scrollTop
    el.getBoundingClientRect = () => ({bottom: clientHeight, top: 0}) as DOMRect
    if (lastTurnBottom !== undefined) {
        const row = document.createElement("div")
        row.dataset.mid = "m1"
        const content = document.createElement("p")
        content.getBoundingClientRect = () => ({bottom: lastTurnBottom, top: 0}) as DOMRect
        row.appendChild(content)
        el.appendChild(row)
    }
    return el
}

describe("jumpRevealDistance", () => {
    it("is half a viewport once that clears the floor", () => {
        expect(jumpRevealDistance(1000)).toBe(500)
    })

    it("holds at the floor on a short or embedded panel", () => {
        // Without the floor a 300px panel would reveal at 150px — back to firing on a nudge.
        expect(jumpRevealDistance(300)).toBe(JUMP_REVEAL_MIN_PX)
    })
})

describe("distanceBelowNewest", () => {
    it("measures the last turn's box, ignoring the reserve below it", () => {
        // Desktop: the active turn reserves a viewport, so the scroll gap says 900px while the
        // last message is sitting 40px under the fold.
        const el = scroller({
            clientHeight: 800,
            scrollHeight: 1700,
            scrollTop: 0,
            lastTurnBottom: 840,
        })
        expect(distanceBelowNewest(el)).toBe(40)
    })

    it("falls back to the scroll gap where there are no rows to measure", () => {
        // /m has no `data-mid` and no reserve, so its gap is already the right number.
        const el = scroller({clientHeight: 600, scrollHeight: 2000, scrollTop: 900})
        expect(distanceBelowNewest(el)).toBe(500)
    })
})

describe("windowed transcripts", () => {
    it("falls back to the scroll gap when the newest turn is not rendered", () => {
        // Virtuoso scrolled far up on a settled thread: rows exist, but the last RENDERED one is
        // not the newest. Measuring it would report ~0 and hide the pill exactly when it is needed.
        const el = scroller({
            clientHeight: 800,
            scrollHeight: 9000,
            scrollTop: 200,
            lastTurnBottom: 810,
        })
        expect(distanceBelowNewest(el, "m-newest")).toBe(8000)
        expect(shouldRevealJump(el, "m-newest")).toBe(true)
    })

    it("still measures the box when the last rendered row IS the newest", () => {
        const el = scroller({
            clientHeight: 800,
            scrollHeight: 1700,
            scrollTop: 0,
            lastTurnBottom: 840,
        })
        expect(distanceBelowNewest(el, "m1")).toBe(40)
        expect(shouldRevealJump(el, "m1")).toBe(false)
    })
})

describe("shouldRevealJump", () => {
    it("stays hidden for a nudge", () => {
        // The old desktop rule fired here (>24px past the edge). It must not now.
        const el = scroller({clientHeight: 800, lastTurnBottom: 860})
        expect(shouldRevealJump(el)).toBe(false)
    })

    it("appears once the reader is half a viewport up", () => {
        const el = scroller({clientHeight: 800, lastTurnBottom: 1300})
        expect(shouldRevealJump(el)).toBe(true)
    })

    it("uses the floor, not half the viewport, on a short panel", () => {
        const short = {clientHeight: 300}
        expect(shouldRevealJump(scroller({...short, lastTurnBottom: 460}))).toBe(false)
        expect(shouldRevealJump(scroller({...short, lastTurnBottom: 560}))).toBe(true)
    })
})

describe("jumpGateOpen", () => {
    const none = {approvals: 0, elicitationOpen: false, connectionOpen: false}

    it("is closed with nothing docked", () => {
        expect(jumpGateOpen(none)).toBe(false)
    })

    it("opens for each blocking gate", () => {
        expect(jumpGateOpen({...none, approvals: 1})).toBe(true)
        expect(jumpGateOpen({...none, elicitationOpen: true})).toBe(true)
        expect(jumpGateOpen({...none, connectionOpen: true})).toBe(true)
    })
})
