/** @vitest-environment jsdom */
// The drawer body loads on the first open. If its chunk fails to load, the skeleton must not
// spin forever: it says so and offers a retry.
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, expect, it, vi} from "vitest"

import TraceDrawerContentSkeleton from "../../src/traceDrawer/TraceDrawerContentSkeleton"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
})

const render = (props: Parameters<typeof TraceDrawerContentSkeleton>[0]) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(<TraceDrawerContentSkeleton {...props} />))
    return host
}

it("shows the loading state while the body loads", () => {
    const shown = render({isLoading: true, error: null})
    expect(shown.querySelector('[aria-label="Loading trace"]')).not.toBeNull()
    expect(shown.querySelector('[role="alert"]')).toBeNull()
})

it("offers a retry when the body failed to load", () => {
    const retry = vi.fn()
    const shown = render({isLoading: false, error: new Error("ChunkLoadError"), retry})
    expect(shown.querySelector('[aria-label="Loading trace"]')).toBeNull()
    expect(shown.textContent).toContain("Couldn't load the trace")
    expect(shown.textContent).not.toContain("ChunkLoadError")
    const button = [...shown.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Try again"),
    )
    act(() => button!.click())
    expect(retry).toHaveBeenCalledTimes(1)
})
