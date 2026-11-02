// @vitest-environment jsdom
/**
 * `/m` rewrites a legacy workspace segment to the organization id once, reading the projects
 * query the screen already runs: no request of its own, no loop.
 */
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {replace, router, fetchProjects} = vi.hoisted(() => {
    const router = {isReady: true, asPath: "/w/W/p/P/apps", query: {}, replace: vi.fn()}
    return {replace: router.replace, router, fetchProjects: vi.fn()}
})
vi.mock("next/router", () => ({useRouter: () => router}))
vi.mock("@/lib/context", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/context")>()),
    fetchProjects,
}))

import {useCanonicalProjectRoute} from "@/features/context/useCanonicalProjectRoute"
import {useCurrentProject} from "@/features/context/useCurrentProject"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const answer = {
    kind: "ok",
    projects: [
        {
            project_id: "P",
            project_name: "P",
            workspace_id: "W",
            workspace_name: "W",
            organization_id: "O",
            organization_name: "Org",
        },
    ],
}

let root: Root | null = null
let client: QueryClient

// The screen's own read of the projects (as every project screen makes) plus the hook.
const Screen = () => {
    useCurrentProject("W", "P")
    useCanonicalProjectRoute()
    return null
}

const render = () =>
    act(async () => {
        root?.render(createElement(QueryClientProvider, {client}, createElement(Screen)))
    })

beforeEach(() => {
    replace.mockReset().mockImplementation(async (url: string) => {
        router.asPath = url
        return true
    })
    fetchProjects.mockReset().mockResolvedValue(answer)
    router.asPath = "/w/W/p/P/apps"
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    root = createRoot(document.createElement("div"))
})

afterEach(() => {
    act(() => root?.unmount())
    root = null
})

describe("useCanonicalProjectRoute", () => {
    it("cold cache: one projects fetch, as before the hook, and one replace", async () => {
        await render()
        await render()
        expect(fetchProjects).toHaveBeenCalledTimes(1)
        expect(replace).toHaveBeenCalledTimes(1)
        expect(replace.mock.calls[0][0]).toBe("/w/O/p/P/apps")
    })

    it("warm cache: no fetch and one replace", async () => {
        client.setQueryData(["mobile", "projects"], answer)
        await render()
        expect(fetchProjects).not.toHaveBeenCalled()
        expect(replace).toHaveBeenCalledTimes(1)
    })

    it("after the replace the new route reads the cache: no refetch inside staleTime", async () => {
        await render()
        await render() // the route now names the organization
        await render()
        expect(fetchProjects).toHaveBeenCalledTimes(1)
        expect(replace).toHaveBeenCalledTimes(1)
    })

    it("a correct segment: no replace and no fetch beyond the screen's own", async () => {
        router.asPath = "/w/O/p/P/apps"
        await render()
        await render()
        expect(replace).not.toHaveBeenCalled()
        expect(fetchProjects).toHaveBeenCalledTimes(1)
    })
})
