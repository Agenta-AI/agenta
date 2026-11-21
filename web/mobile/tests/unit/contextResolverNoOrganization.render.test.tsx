// @vitest-environment jsdom
/**
 * A person who signed up without an invitation on an instance at its organization limit has
 * no organization. The root shows why, and lets them retry or sign out to another account.
 */
import {act, createElement, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {logout, queryState} = vi.hoisted(() => ({
    logout: vi.fn(),
    queryState: {data: undefined as unknown},
}))
vi.mock("next/router", () => ({
    useRouter: () => ({isReady: true, query: {}, asPath: "/", replace: vi.fn()}),
}))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQuery: () => ({data: queryState.data, refetch: vi.fn()}),
}))
vi.mock("@/features/auth/useLogout", () => ({useLogout: () => logout}))
vi.mock("@/features/home/states/HomePageSkeleton", () => ({HomePageSkeleton: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({children}: {children: ReactNode}) => children,
}))

import {ContextResolver} from "@/features/context/ContextResolver"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    logout.mockReset()
    localStorage.clear()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === label,
    )

describe("the /m root for a person with no organization", () => {
    it("explains the invitation and offers Retry and Sign out", async () => {
        queryState.data = {kind: "ok", projects: []}

        await act(async () => root.render(createElement(ContextResolver)))

        expect(container.textContent).toContain(
            "You are not in an organization yet. Ask an organization admin to invite you.",
        )
        expect(button("Retry")).toBeDefined()
        act(() => button("Sign out")?.click())
        expect(logout).toHaveBeenCalledOnce()
    })
})
