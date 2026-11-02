// @vitest-environment jsdom
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {apps} = vi.hoisted(() => ({
    apps: {
        current: {data: [] as Record<string, unknown>[], isPending: false, isError: false},
    },
}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        appWorkflowsListQueryStateAtom: mockAtom(() => apps.current),
    }
})

import {ObservabilityAppFilter} from "@/features/observability/ObservabilityAppFilter"

const APPS = [
    {id: "app-1", name: "Support agent", slug: "support"},
    {id: "app-2", name: "", slug: "summarizer"},
]

describe("ObservabilityAppFilter", () => {
    let root: Root
    let host: HTMLDivElement

    const mount = (value: string | null, onChange = vi.fn()) => {
        act(() =>
            root.render(
                <Provider store={createStore()}>
                    <ObservabilityAppFilter value={value} onChange={onChange} />
                </Provider>,
            ),
        )
        return onChange
    }
    const trigger = () => host.querySelector<HTMLButtonElement>("button[role='combobox']")

    beforeEach(() => {
        // Radix Select measures and scrolls on open; jsdom has neither.
        Element.prototype.scrollIntoView = vi.fn()
        Element.prototype.hasPointerCapture = vi.fn(() => false)
        Element.prototype.releasePointerCapture = vi.fn()
        apps.current = {data: APPS, isPending: false, isError: false}
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("The picker lists All apps then every app by name", () => {
        mount(null)
        expect(trigger()?.textContent).toContain("All apps")

        act(() => {
            trigger()?.focus()
            trigger()?.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
            )
        })

        const options = [...document.querySelectorAll("[role='option']")].map((node) =>
            node.textContent?.trim(),
        )
        expect(options).toEqual(["All apps", "Support agent", "summarizer"])
    })

    it("An unknown app id shows All apps and calls onChange with null", () => {
        const onChange = mount("deleted-app")

        expect(trigger()?.textContent).toContain("All apps")
        expect(onChange).toHaveBeenCalledWith(null)
    })

    it("A known app id is kept and does not call onChange", () => {
        const onChange = mount("app-1")

        expect(trigger()?.textContent).toContain("Support agent")
        expect(onChange).not.toHaveBeenCalled()
    })

    it("The picker is disabled while apps load", () => {
        apps.current = {data: [], isPending: true, isError: false}
        const onChange = mount("app-1")

        expect(trigger()?.disabled).toBe(true)
        expect(trigger()?.textContent).toContain("All apps")
        // The id stays in the URL while the list loads: it may be a real app.
        expect(onChange).not.toHaveBeenCalled()
    })

    it("The picker is hidden when the apps list fails, and the picked app is cleared", () => {
        apps.current = {data: [], isPending: false, isError: true}
        const onChange = mount("app-1")

        expect(trigger()).toBeNull()
        expect(onChange).toHaveBeenCalledWith(null)
    })
})
