/**
 * @vitest-environment jsdom
 *
 * Wiring tests for `useVisualViewportHeight` and `dismissSoftKeyboardAfterSend`.
 *
 * The pure rules had unit tests from the start and were never the problem. What shipped broken was
 * everything around them: whether the hook actually writes the variable a frame lands in, whether
 * it CLEARS it when the keyboard goes away, and whether the blur that closes the keyboard survives
 * the editor's own clear. All three are covered here.
 */
import {createElement} from "react"

import {act} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    KEYBOARD_SETTLE_MS,
    VIEWPORT_HEIGHT_VAR,
    dismissSoftKeyboardAfterSend,
    useVisualViewportHeight,
} from "../../src/hooks/useVisualViewport"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/** A stand-in for `window.visualViewport` whose numbers the test drives. */
class FakeViewport extends EventTarget {
    height = 844
    offsetTop = 0
    scale = 1
}

let viewport: FakeViewport
let root: Root | null = null
let container: HTMLDivElement | null = null

const Probe = () => {
    useVisualViewportHeight()
    return null
}

const mount = () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(createElement(Probe)))
}

const readVar = () => document.documentElement.style.getPropertyValue(VIEWPORT_HEIGHT_VAR)

/** Drive one viewport change and let the hook's animation frame run. */
const emit = (event: "resize" | "scroll") => {
    act(() => {
        viewport.dispatchEvent(new Event(event))
        vi.advanceTimersByTime(20)
    })
}

beforeEach(() => {
    vi.useFakeTimers()
    // jsdom has no rAF tied to fake timers; a timeout keeps the coalescing path real.
    vi.stubGlobal(
        "requestAnimationFrame",
        (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number,
    )
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
    viewport = new FakeViewport()
    vi.stubGlobal("visualViewport", viewport)
    Object.defineProperty(window, "innerHeight", {value: 844, configurable: true, writable: true})
})

afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    document.documentElement.style.removeProperty(VIEWPORT_HEIGHT_VAR)
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("useVisualViewportHeight", () => {
    it("sets no variable when no keyboard is open, so the page keeps 100dvh", () => {
        mount()
        expect(readVar()).toBe("")
    })

    it("publishes the visible height while the keyboard is open", () => {
        mount()
        viewport.height = 508
        emit("resize")
        expect(readVar()).toBe("508px")
    })

    it("clears the variable when the keyboard closes", () => {
        mount()
        viewport.height = 508
        emit("resize")
        expect(readVar()).toBe("508px")

        viewport.height = 844
        emit("resize")
        expect(readVar()).toBe("")
    })

    it("clears the variable on blur even when the browser reports no viewport change", () => {
        // The iOS case this exists for: the keyboard closes, the page is left pinned to the short
        // height, and no visual-viewport `resize` ever arrives. Without the focusout fallback the
        // composer would sit above a strip of dead space.
        mount()
        viewport.height = 508
        emit("resize")
        expect(readVar()).toBe("508px")

        viewport.height = 844
        act(() => {
            window.dispatchEvent(new Event("focusout"))
            vi.advanceTimersByTime(KEYBOARD_SETTLE_MS + 50)
        })
        expect(readVar()).toBe("")
    })

    it("removes the variable when it unmounts", () => {
        mount()
        viewport.height = 508
        emit("resize")
        expect(readVar()).toBe("508px")

        act(() => root?.unmount())
        root = null
        expect(readVar()).toBe("")
    })
})

describe("dismissSoftKeyboardAfterSend", () => {
    const setPointer = (coarse: boolean) => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: coarse && query.includes("coarse"),
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        }))
    }

    it("does nothing on a mouse-driven browser, so Enter keeps focus for the next message", () => {
        setPointer(false)
        const blur = vi.fn()
        dismissSoftKeyboardAfterSend(blur)
        vi.advanceTimersByTime(100)
        expect(blur).not.toHaveBeenCalled()
    })

    it("blurs on a touch device, but only after the editor has reconciled", () => {
        setPointer(true)
        const blur = vi.fn()
        dismissSoftKeyboardAfterSend(blur)
        // The load-bearing assertion: NOT synchronous. The caller clears the editor on the next
        // statement, and that clear writes a DOM selection that would re-focus the input and undo
        // an inline blur.
        expect(blur).not.toHaveBeenCalled()

        vi.advanceTimersByTime(100)
        expect(blur).toHaveBeenCalledTimes(1)
    })
})
