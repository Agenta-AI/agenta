/**
 * The inline / pinned decision for the New session (+) must read ONE geometry.
 *
 * #6742: resizing the config pane crashed `/m` with "Maximum update depth exceeded". The chips
 * are motion layout items, and mid-animation they sit on a translate that `scrollWidth` counts
 * as overflow while offsets do not. Overflow was read off `scrollWidth` (→ pin) and the un-pin
 * slack off offsets (→ un-pin), so the (+) flapped between the two homes inside one synchronous
 * effect chain until React threw. These pin the strip to layout offsets for both decisions.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {SessionTabStrip} from "../../src/SessionTabStrip"

/** Per-element geometry jsdom does not compute: widths from `data-w`, the scroller's own box from
 * the test, and `scrollWidth` deliberately INFLATED past the content, as an in-flight translate
 * makes it. `offsetLeft` is the running sum of the earlier siblings' widths, so `chipsWidth` reads
 * what a real flex row would give. */
const geometry = {scroller: 500, scrollWidth: 800}
const widthOf = (el: HTMLElement) => Number(el.dataset.w ?? 32)
const descriptors: Record<string, PropertyDescriptor | undefined> = {}
const define = (name: string, get: (this: HTMLElement) => number) => {
    descriptors[name] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
    Object.defineProperty(HTMLElement.prototype, name, {configurable: true, get})
}
const isScroller = (el: Element) => el.classList.contains("overflow-x-auto")

/** jsdom has no ResizeObserver. The stub keeps the callbacks so a test can deliver a "resize"
 * the way the browser does — after a stable mount, from outside React's commit. */
const resizeCallbacks: ResizeObserverCallback[] = []
class ResizeObserverStub {
    constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
}
const fireResize = () => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
}

let root: Root
let host: HTMLDivElement
let errors: string[]

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    define("clientWidth", function () {
        return isScroller(this) ? geometry.scroller : widthOf(this)
    })
    define("scrollWidth", function () {
        return isScroller(this) ? geometry.scrollWidth : widthOf(this)
    })
    define("offsetWidth", function () {
        return widthOf(this)
    })
    define("offsetLeft", function () {
        let left = 0
        for (let prev = this.previousElementSibling; prev; prev = prev.previousElementSibling) {
            left += widthOf(prev as HTMLElement)
        }
        return left
    })
    resizeCallbacks.length = 0
    errors = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "))
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    for (const [name, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
    }
})

const chip = (w: number) => createElement("div", {"data-w": w, role: "tab"})

/** Renders, then lets the effect chain and the observers settle: the flap under test ran in the
 * measurement callbacks React flushes after the commit, so asserting straight after `render`
 * looked at a strip that had not looped YET. Counts the (+)'s moves while waiting — a single
 * settle is at most one pin, never a back-and-forth. */
const render = (chips: number[]) => {
    act(() => {
        root.render(
            createElement(
                SessionTabStrip,
                {onAdd: () => undefined, remeasureKey: chips.length},
                ...chips.map(chip),
            ),
        )
    })
}

/** Lets the effect chain and the observers settle — OUTSIDE `act`, which holds every update until
 * its scope exits. Counts the (+)'s moves meanwhile: one settle is at most one pin, never a
 * back-and-forth. */
const settle = async () => {
    let moves = 0
    const observer = new MutationObserver((records) => {
        for (const record of records) moves += record.addedNodes.length + record.removedNodes.length
    })
    observer.observe(host, {childList: true, subtree: true})
    await new Promise((resolve) => setTimeout(resolve, 100))
    observer.disconnect()
    return moves
}

const addButton = () => host.querySelector('button[aria-label="New session"]')
const scroller = () => host.querySelector(".overflow-x-auto")

describe("SessionTabStrip (+) placement", () => {
    it("keeps the (+) inline when the chips fit, however far a translate inflates scrollWidth", async () => {
        // A strip that fits, settled inline.
        geometry.scroller = 500
        geometry.scrollWidth = 500
        render([100, 100])
        await settle()
        expect(scroller()?.contains(addButton())).toBe(true)

        // The pane drag: the strip resizes while the chips' layout animation holds them on a
        // translate, so `scrollWidth` runs far past the content that still fits.
        geometry.scrollWidth = 800
        act(() => fireResize())
        const moves = await settle()

        expect(errors.filter((e) => /Maximum update depth/.test(e))).toEqual([])
        expect(moves).toBe(0)
        expect(scroller()?.contains(addButton())).toBe(true)
    })

    it("pins the (+) outside the scroller once the chips themselves overflow", async () => {
        geometry.scroller = 500
        geometry.scrollWidth = 500
        render([300, 300])
        await settle()

        expect(errors.filter((e) => /Maximum update depth/.test(e))).toEqual([])
        expect(addButton()).not.toBeNull()
        expect(scroller()?.contains(addButton())).toBe(false)
    })
})
