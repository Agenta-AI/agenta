// @vitest-environment jsdom
//
// The session bar's files toggle never moves; its FILL is the state. This pins the glyph: the
// right strip is painted while the pane is open and absent while it is closed, so a reviewer can
// tell the two apart from the icon alone.
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it} from "vitest"

import {FilesPaneIcon} from "@/features/chat/FilesPaneIcon"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
})

const render = (open: boolean) => {
    const host = document.createElement("div")
    root = createRoot(host)
    act(() => root!.render(<FilesPaneIcon open={open} />))
    return host
}

describe("FilesPaneIcon", () => {
    it("fills the right strip while the pane is open", () => {
        const host = render(true)
        const filled = host.querySelectorAll('rect[fill="currentColor"]')
        expect(filled).toHaveLength(1)
        expect(filled[0]?.getAttribute("x")).toBe("15")
    })

    it("stays an outline while the pane is closed", () => {
        const host = render(false)
        expect(host.querySelectorAll('rect[fill="currentColor"]')).toHaveLength(0)
        expect(host.querySelectorAll("rect")).toHaveLength(1)
    })
})
