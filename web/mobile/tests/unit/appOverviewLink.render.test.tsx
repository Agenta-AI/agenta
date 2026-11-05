// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AppOverviewLink} from "@/features/app-overview/AppOverviewLink"

const env = vi.hoisted(() => ({enabled: true as boolean | null}))

vi.mock("next/link", () => ({
    default: ({
        children,
        href,
        prefetch,
    }: {
        children?: ReactNode
        href: string
        prefetch?: boolean
    }) => createElement("a", {href, "data-prefetch": String(prefetch)}, children),
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (id: string) => (id === "app-overview" ? env.enabled : false),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

const mount = (appId: string | null) =>
    act(() => root.render(createElement(AppOverviewLink, {base: "/w/ws/p/pr", appId})))

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    env.enabled = true
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("app overview link", () => {
    it("The overview link shows only for a picked app with the view enabled", () => {
        mount("app-1")
        expect(host.querySelector("a")?.textContent).toBe("Overview")
        expect(host.querySelector("a")?.getAttribute("href")).toBe("/w/ws/p/pr/apps/app-1/overview")
        mount(null)
        expect(host.querySelector("a")).toBeNull()
        env.enabled = false
        mount("app-1")
        expect(host.querySelector("a")).toBeNull()
        env.enabled = null
        mount("app-1")
        expect(host.querySelector("a")).toBeNull()
    })

    it("The overview link does not prefetch", () => {
        mount("app-1")
        expect(host.querySelector("a")?.getAttribute("data-prefetch")).toBe("false")
    })
})
