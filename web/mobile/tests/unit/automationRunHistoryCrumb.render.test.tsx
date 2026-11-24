// @vitest-environment jsdom
/** The run history page crumb: "Automations › <name> › Run history". */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AutomationRunHistoryCrumb} from "@/features/automations/AutomationRunHistoryCrumb"

vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("next/link", () => ({
    default: ({href, children, ...rest}: {href: string; children: unknown}) =>
        createElement("a", {href, ...rest}, children as never),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe("run history page crumb", () => {
    it("names the list, the automation and the page, and goes back to each", () => {
        const onAutomation = vi.fn()
        act(() =>
            root.render(
                createElement(AutomationRunHistoryCrumb, {
                    listHref: "/base/automations",
                    name: "Daily summary",
                    onAutomation,
                }),
            ),
        )
        const crumb = container.querySelector("nav") as HTMLElement
        expect(crumb.textContent).toContain("Automations")
        expect(crumb.textContent).toContain("Daily summary")
        expect(crumb.textContent).toContain("Run history")
        expect(crumb.querySelector("a")?.getAttribute("href")).toBe("/base/automations")
        const name = [...crumb.querySelectorAll("button")].find(
            (button) => button.textContent === "Daily summary",
        ) as HTMLButtonElement
        act(() => name.click())
        expect(onAutomation).toHaveBeenCalledTimes(1)
    })
})
