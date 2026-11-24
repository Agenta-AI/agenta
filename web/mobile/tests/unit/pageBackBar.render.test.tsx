// @vitest-environment jsdom
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PageBackBar} from "@/features/page-layout/PageBackBar"

vi.mock("next/link", () => ({
    default: ({href, children, ...rest}: {href: string; children: unknown}) =>
        createElement("a", {href, ...rest}, children as never),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("PageBackBar", () => {
    it("names the parent and links to it, with no menu", () => {
        act(() =>
            root.render(
                createElement(PageBackBar, {back: {label: "Automations", href: "/p/automations"}}),
            ),
        )
        const link = host.querySelector("a")
        expect(link?.textContent).toBe("Automations")
        expect(link?.getAttribute("href")).toBe("/p/automations")
        expect(host.querySelector('[aria-label="Open the sidebar"]')).toBeNull()
    })

    it("returns in the page when Back is another view of it", () => {
        const onBack = vi.fn()
        act(() => root.render(createElement(PageBackBar, {back: {label: "Daily summary", onBack}})))
        const button = host.querySelector("button") as HTMLButtonElement
        expect(button.textContent).toBe("Daily summary")
        act(() => button.click())
        expect(onBack).toHaveBeenCalledTimes(1)
    })
})
