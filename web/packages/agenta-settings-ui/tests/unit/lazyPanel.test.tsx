// @vitest-environment jsdom
import React, {act, Suspense} from "react"

import {createRoot} from "react-dom/client"
import {expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => ({
    Button: ({children, onClick}: React.ComponentProps<"button">) => (
        <button onClick={onClick}>{children}</button>
    ),
}))

import {lazyPanel} from "../../src/channels/lazyPanel"
import {PanelLoadBoundary} from "../../src/channels/PanelLoadBoundary"

it("loads the panel again after a failed load when Try again is clicked", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const Panel = () => <p>panel loaded</p>
    const load = vi
        .fn<() => Promise<typeof Panel>>()
        .mockRejectedValueOnce(new Error("chunk failed"))
        .mockResolvedValue(Panel)
    const getPanel = lazyPanel(load)
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    const container = document.createElement("div")
    const root = createRoot(container)
    await act(async () =>
        root.render(
            <PanelLoadBoundary>
                {() => {
                    const LazyPanel = getPanel()
                    return (
                        <Suspense fallback={<span>loading</span>}>
                            <LazyPanel />
                        </Suspense>
                    )
                }}
            </PanelLoadBoundary>,
        ),
    )
    await vi.waitFor(() => expect(container.textContent).toContain("Try again"))

    await act(async () => container.querySelector("button")!.click())
    await vi.waitFor(() => expect(container.textContent).toContain("panel loaded"))
    expect(load).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
})
