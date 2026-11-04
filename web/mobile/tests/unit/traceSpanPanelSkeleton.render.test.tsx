// @vitest-environment jsdom
// The drill-in panel loads on the first open span. If its chunk fails, the panel says so and
// offers a retry instead of a skeleton that never ends.
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, expect, it, vi} from "vitest"

import {TraceSpanPanelSkeleton} from "@/features/observability/states/TraceSpanPanelSkeleton"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
})

const render = (props: Parameters<typeof TraceSpanPanelSkeleton>[0]) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(<TraceSpanPanelSkeleton {...props} />))
    return host
}

it("holds the panel's place while it loads", () => {
    const shown = render({isLoading: true, error: null})
    expect(shown.querySelector('[role="alert"]')).toBeNull()
    expect(shown.firstElementChild).not.toBeNull()
})

it("offers a retry when the panel failed to load", () => {
    const retry = vi.fn()
    const shown = render({isLoading: false, error: new Error("ChunkLoadError"), retry})
    expect(shown.querySelector('[role="alert"]')).not.toBeNull()
    expect(shown.textContent).not.toContain("ChunkLoadError")
    const button = [...shown.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Try again"),
    )
    act(() => button!.click())
    expect(retry).toHaveBeenCalledTimes(1)
})
