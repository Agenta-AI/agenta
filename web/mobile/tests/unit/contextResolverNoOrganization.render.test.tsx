// @vitest-environment jsdom
/**
 * A person who signed up without an invitation on an instance at its organization limit has
 * no organization. The root shows why, and lets them check again or sign out to another account.
 */
import {act, createElement, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {logout, queryState} = vi.hoisted(() => ({
    logout: vi.fn(),
    queryState: {data: undefined as unknown, hasOrganization: undefined as boolean | undefined},
}))
vi.mock("next/router", () => ({
    useRouter: () => ({isReady: true, query: {}, asPath: "/", replace: vi.fn()}),
}))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQuery: ({queryKey}: {queryKey: string[]}) =>
        queryKey[1] === "hasOrganization"
            ? {data: queryState.hasOrganization, isError: false, refetch: vi.fn()}
            : {data: queryState.data, refetch: vi.fn()},
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
    it("explains the invitation and offers Check again and Sign out", async () => {
        queryState.data = {kind: "ok", projects: []}
        queryState.hasOrganization = false

        await act(async () => root.render(createElement(ContextResolver)))

        expect(container.textContent).toContain("You are not in an organization yet")
        expect(container.textContent).toContain(
            "This instance has one organization. Ask its admin to invite you.",
        )
        expect(button("Check again")).toBeDefined()
        act(() => button("Sign out")?.click())
        expect(logout).toHaveBeenCalledOnce()
    })

    it("tells a member of an organization with no project that there is none", async () => {
        queryState.data = {kind: "ok", projects: []}
        queryState.hasOrganization = true

        await act(async () => root.render(createElement(ContextResolver)))

        expect(container.textContent).toContain("No projects found.")
        expect(container.textContent).not.toContain("You are not in an organization yet")
        expect(button("Retry")).toBeDefined()
        expect(button("Sign out")).toBeDefined()
    })

    it("waits for the organization read before it chooses a screen", async () => {
        queryState.data = {kind: "ok", projects: []}
        queryState.hasOrganization = undefined

        await act(async () => root.render(createElement(ContextResolver)))

        expect(container.textContent).toBe("")
    })
})
