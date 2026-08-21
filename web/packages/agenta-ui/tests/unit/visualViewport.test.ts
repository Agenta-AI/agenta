/**
 * Unit tests for the two pure rules behind `useVisualViewportHeight`.
 *
 * The load-bearing case is the desktop one: with no keyboard the layout viewport and the visual
 * viewport are the same height, the override must be `null`, and the page keeps its `100dvh`
 * height. A rule that returned a pixel height there would pin every desktop page to a measured
 * value and break on every window resize the hook does not observe.
 */
import {describe, expect, it} from "vitest"

import {
    KEYBOARD_INSET_MIN_PX,
    keyboardInset,
    viewportHeightOverride,
    type VisualViewportSample,
} from "../../src/hooks/useVisualViewport"

/** A 844pt iPhone viewport, the numbers iOS reports with no keyboard. */
const sample = (over: Partial<VisualViewportSample> = {}): VisualViewportSample => ({
    innerHeight: 844,
    height: 844,
    offsetTop: 0,
    scale: 1,
    ...over,
})

describe("keyboardInset", () => {
    it("is zero when the visual viewport fills the layout viewport", () => {
        expect(keyboardInset(sample())).toBe(0)
    })

    it("measures the covered strip when a keyboard is open", () => {
        expect(keyboardInset(sample({height: 508}))).toBe(336)
    })

    it("counts the pushed-down offset as covered too", () => {
        // Safari scrolls the visual viewport down to reveal the focused field: the strip the user
        // cannot see is the keyboard PLUS whatever scrolled off the top.
        expect(keyboardInset(sample({height: 508, offsetTop: 40}))).toBe(296)
    })

    it("reports nothing while the user pinch-zooms", () => {
        // Zoom shrinks the visual viewport the same way a keyboard does. Resizing the page here
        // would fight the gesture.
        expect(keyboardInset(sample({height: 400, scale: 2}))).toBe(0)
    })

    it("never returns a negative inset", () => {
        expect(keyboardInset(sample({height: 900}))).toBe(0)
    })
})

describe("viewportHeightOverride", () => {
    it("returns null with no keyboard, so the page keeps 100dvh", () => {
        expect(viewportHeightOverride(sample())).toBeNull()
    })

    it("returns null for browser chrome smaller than the keyboard threshold", () => {
        const chromeOnly = sample({height: 844 - (KEYBOARD_INSET_MIN_PX - 1)})
        expect(viewportHeightOverride(chromeOnly)).toBeNull()
    })

    it("returns the visible height once the keyboard is open", () => {
        expect(viewportHeightOverride(sample({height: 508}))).toBe("508px")
    })

    it("adds the offset so the page bottom lands on the visible bottom", () => {
        expect(viewportHeightOverride(sample({height: 508, offsetTop: 40}))).toBe("548px")
    })

    it("rounds to whole pixels", () => {
        expect(viewportHeightOverride(sample({height: 507.5}))).toBe("508px")
    })

    it("stays out of the way while the user pinch-zooms", () => {
        expect(viewportHeightOverride(sample({height: 300, scale: 2}))).toBeNull()
    })
})
