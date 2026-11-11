// @vitest-environment jsdom
// The transcript window beside the real auto-scroll hook, on a scroller with faked geometry.
import {act, useMemo} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useTranscriptAutoScroll} from "@/features/chat/useTranscriptAutoScroll"
import {useTranscriptWindow} from "@/features/chat/useTranscriptWindow"

const ROW_PX = 100
const VIEWPORT_PX = 700

const Transcript = ({count}: {count: number}) => {
    const turns = useMemo(() => Array.from({length: count}, (_, i) => i), [count])
    const autoScroll = useTranscriptAutoScroll(turns)
    const start = useTranscriptWindow(turns.length, autoScroll.ref)
    return (
        <div ref={autoScroll.ref} onScroll={autoScroll.onScroll} data-testid="scroller">
            <div>
                {turns.slice(start).map((turn) => (
                    <div key={turn} data-row={turn} />
                ))}
            </div>
        </div>
    )
}

describe("transcript window with auto-scroll", () => {
    let host: HTMLDivElement
    let root: Root

    const scroller = () => host.querySelector<HTMLDivElement>("[data-testid=scroller]")!
    const rows = () =>
        Array.from(host.querySelectorAll("[data-row]"), (row) => row.getAttribute("data-row"))
    const render = (count: number) => act(() => root.render(<Transcript count={count} />))
    const scrollTo = (top: number) =>
        act(() => {
            scroller().dispatchEvent(new Event("wheel"))
            scroller().scrollTop = top
            scroller().dispatchEvent(new Event("scroll"))
        })

    beforeEach(() => {
        ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe = vi.fn()
                disconnect = vi.fn()
            },
        )
        vi.stubGlobal("matchMedia", () => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }))
        vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
            this: HTMLElement,
        ) {
            return this.querySelectorAll("[data-row]").length * ROW_PX
        })
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(VIEWPORT_PX)
        HTMLElement.prototype.scrollTo = function (this: HTMLElement, options) {
            this.scrollTop = (options as ScrollToOptions).top ?? 0
        } as typeof HTMLElement.prototype.scrollTo
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it("opens on the last 12 turns, pinned to the latest", () => {
        render(40)
        expect(rows()).toHaveLength(12)
        expect(rows()[0]).toBe("28")
        expect(scroller().scrollTop).toBe(500)
    })

    it("renders a short session whole", () => {
        render(12)
        expect(rows()).toHaveLength(12)
        expect(rows()[0]).toBe("0")
    })

    it("does not add turns inside the follow band", () => {
        render(40)
        scrollTo(450)
        expect(rows()).toHaveLength(12)
    })

    it("adds 12 older turns on scroll-up and keeps the distance from the bottom", () => {
        render(40)
        scrollTo(300)
        expect(rows()).toHaveLength(24)
        expect(rows()[0]).toBe("16")
        // 24 rows are 2400px; 200px from the bottom before, 200px after.
        expect(scroller().scrollTop).toBe(1500)
    })

    it("holds the first turn and the parked reader while new turns arrive", () => {
        render(40)
        scrollTo(300)
        render(41)
        render(42)
        expect(rows()[0]).toBe("16")
        expect(rows().at(-1)).toBe("41")
        expect(scroller().scrollTop).toBe(1500)
    })

    it("still follows the bottom after growth once the reader jumps back", () => {
        render(40)
        scrollTo(300)
        scrollTo(1700)
        render(41)
        expect(scroller().scrollTop).toBe(1800)
    })
})
