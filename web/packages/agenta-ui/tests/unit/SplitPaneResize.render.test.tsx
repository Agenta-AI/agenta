// @vitest-environment jsdom
import {act, cleanup, fireEvent, render} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {SplitPane} from "../../src/components/ui/split-pane"

let width = 1200
let notifyResize: () => void

beforeEach(() => {
    width = 1200
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
        () => ({width, left: 0, right: width}) as DOMRect,
    )
    vi.stubGlobal(
        "ResizeObserver",
        class {
            constructor(callback: () => void) {
                notifyResize = callback
            }
            observe() {}
            disconnect() {}
        },
    )
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

const resize = (nextWidth: number) => {
    width = nextWidth
    act(() => notifyResize())
}

const props = {
    paneSize: 620,
    paneMin: 320,
    paneMax: 1000,
    fillMin: 360,
    pane: <div>Files</div>,
    fill: <button>Close files</button>,
}

const paneWidth = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-slot="split-pane-pane"]')!.style.flexBasis

const separator = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[role="separator"]')!

describe("SplitPane container resizing", () => {
    it.each(["start", "end"] as const)(
        "bounds the %s pane after shrinking and restores its preferred width after expanding",
        (paneSide) => {
            const onResize = vi.fn()
            const onResizeEnd = vi.fn()
            const {container} = render(
                <SplitPane {...props} paneSide={paneSide} onResize={onResize} onResizeEnd={onResizeEnd} />,
            )
            expect(paneWidth(container)).toBe("620px")
            resize(800)
            expect(paneWidth(container)).toBe("440px")
            expect(separator(container).getAttribute("aria-valuenow")).toBe("440")
            resize(1200)
            expect(paneWidth(container)).toBe("620px")
            expect(onResize).not.toHaveBeenCalled()
            expect(onResizeEnd).not.toHaveBeenCalled()
        },
    )

    it("lets the pane go below its minimum when the container cannot fit both minimums", () => {
        const {container} = render(<SplitPane {...props} paneSide="end" />)
        resize(500)
        expect(paneWidth(container)).toBe("140px")
        expect(separator(container).getAttribute("aria-valuemin")).toBe("140")
        expect(separator(container).getAttribute("aria-valuemax")).toBe("140")
        resize(300)
        expect(paneWidth(container)).toBe("0px")
        resize(0)
        expect(paneWidth(container)).toBe("0px")
        resize(1200)
        expect(paneWidth(container)).toBe("620px")
    })

    it("keeps a collapsed pane at zero after container changes", () => {
        const {container} = render(<SplitPane {...props} paneSide="end" paneSize={0} />)
        resize(800)
        expect(paneWidth(container)).toBe("0px")
        resize(1200)
        expect(paneWidth(container)).toBe("0px")
    })

    it("does not constrain a growing single-pane phone layout", () => {
        const {container} = render(
            <SplitPane {...props} paneSide="end" paneGrow fillClassName="hidden" />,
        )
        resize(400)
        expect(paneWidth(container)).toBe("620px")
    })

    it("starts keyboard resizing from the displayed width, not the stored width", () => {
        const onResize = vi.fn()
        const onResizeEnd = vi.fn()
        const {container} = render(
            <SplitPane {...props} paneSide="end" onResize={onResize} onResizeEnd={onResizeEnd} />,
        )
        resize(800)
        fireEvent.keyDown(separator(container), {key: "ArrowRight"})
        expect(onResize).toHaveBeenCalledWith(424, 800)
        expect(onResizeEnd).toHaveBeenCalledWith(424, 800)
    })

    it("keeps slide content at the bounded width", () => {
        const {container, rerender} = render(<SplitPane {...props} paneSide="end" />)
        resize(800)
        rerender(<SplitPane {...props} paneSide="end" paneSize={0} animate />)
        const content = container.querySelector<HTMLElement>('[data-slot="split-pane-pane-content"]')!
        expect(paneWidth(container)).toBe("0px")
        expect(content.style.width).toBe("440px")
    })
})
