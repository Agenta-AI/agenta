/**
 * GenericDrawer (the /w "Add to testset" drawer, the evaluation focus drawer) draws its own header.
 * The shared SheetHeader puts Close at the right edge; this header had it first, on the left, so
 * two conventions sat side by side. Close is now the header's last control.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest"

import GenericDrawer from "./index"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeAll(() => {
    // antd's Splitter measures its panels.
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver
})

afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    document.body.innerHTML = ""
})

const mount = (onClose: () => void) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(
            <GenericDrawer
                open
                onClose={onClose}
                expandable
                headerExtra={<span>Add to testset</span>}
                mainContent={<p>body</p>}
                closeButtonProps={{"data-tour": "add-to-testset-close"} as never}
            />,
        )
    })
}

describe("GenericDrawer's header", () => {
    it("puts Close last, at the right edge, after the title", () => {
        const onClose = vi.fn()
        mount(onClose)

        const header = document.querySelector('[data-slot="sheet-header"]')!
        const buttons = [...header.querySelectorAll("button")]
        const close = buttons.at(-1)!
        expect(close.getAttribute("aria-label")).toBe("Close")
        expect(close.getAttribute("data-tour")).toBe("add-to-testset-close")
        // The title comes before it in document order.
        const title = [...header.querySelectorAll("span")].find(
            (el) => el.textContent === "Add to testset",
        )!
        expect(title.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

        act(() => close.click())
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})
