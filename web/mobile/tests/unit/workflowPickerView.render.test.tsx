// @vitest-environment jsdom
import {act} from "react"

import {WorkflowPickerView} from "@agenta/navigation-ui"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("the app switcher menu", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const renderOpen = (onSelect: (key: string) => void, onOpenChange = vi.fn()) =>
        act(() =>
            root.render(
                <WorkflowPickerView
                    collapsed={false}
                    open
                    onOpenChange={onOpenChange}
                    triggerContent="Capital finder"
                    onSelect={onSelect}
                    entries={[
                        {key: "a1", href: "/apps/a1/overview", content: "Capital finder"},
                        {key: "a2", href: "/apps/a2/overview", content: "Support bot"},
                    ]}
                />,
            ),
        )

    const item = (name: string) =>
        Array.from(document.querySelectorAll("a")).find((a) => a.textContent === name)!

    it("a plain click picks the app and closes the menu", () => {
        const onSelect = vi.fn()
        const onOpenChange = vi.fn()
        renderOpen(onSelect, onOpenChange)
        act(() => item("Support bot").click())
        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect).toHaveBeenCalledWith("a2")
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("a ctrl or cmd click leaves the pick to the new tab", () => {
        const onSelect = vi.fn()
        renderOpen(onSelect)
        act(() => {
            item("Support bot").dispatchEvent(
                new MouseEvent("click", {bubbles: true, cancelable: true, ctrlKey: true}),
            )
        })
        expect(onSelect).not.toHaveBeenCalled()
    })
})
