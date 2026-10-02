// @vitest-environment jsdom
/**
 * A website template link that went through sign-up: AuthGate remembered the key, and the `/m`
 * root forwards to that template's create step. The root can resolve more than once while it
 * settles (a remembered project first, then the fetched tree; React's development double run).
 * Each run must forward to the template, or the last navigation to land decides and the person
 * ends on the project home without their template.
 */
import {StrictMode, act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {replace, queryState} = vi.hoisted(() => ({
    replace: vi.fn(),
    queryState: {data: undefined as unknown},
}))
vi.mock("next/router", () => ({
    useRouter: () => ({isReady: true, query: {}, asPath: "/", replace}),
}))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQuery: () => ({data: queryState.data, refetch: vi.fn()}),
}))
vi.mock("@/features/home/states/HomePageSkeleton", () => ({HomePageSkeleton: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({ScreenScaffold: () => null}))

import {ContextResolver} from "@/features/context/ContextResolver"
import {LAST_CONTEXT_KEY, peekTemplateKey, rememberTemplateKey} from "@/lib/context"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | null = null

const render = () =>
    act(async () => {
        root?.render(createElement(StrictMode, null, createElement(ContextResolver)))
    })

beforeEach(() => {
    replace.mockReset().mockResolvedValue(true)
    queryState.data = undefined
    localStorage.clear()
    root = createRoot(document.createElement("div"))
})

afterEach(() => {
    act(() => root?.unmount())
    root = null
})

describe("the /m root after a sign-up that carried a template", () => {
    it("forwards every resolution to the template, never to the project home", async () => {
        // A project remembered from an earlier visit that the fetched tree no longer holds: the
        // root forwards on the remembered pair, then again once the tree names the real one.
        localStorage.setItem(
            LAST_CONTEXT_KEY,
            JSON.stringify({workspaceId: "ws-old", projectId: "p-old"}),
        )
        rememberTemplateKey("pr-reviewer")

        await render()
        queryState.data = {
            kind: "ok",
            projects: [{project_id: "p1", project_name: "Default", workspace_id: "ws1"}],
        }
        await render()

        const targets = replace.mock.calls.map(([url]) => url as string)
        expect(targets.length).toBeGreaterThanOrEqual(2)
        expect(targets.every((url) => url.includes("/agents/new?template=pr-reviewer"))).toBe(true)
        expect(targets.at(-1)).toBe("/w/ws1/p/p1/agents/new?template=pr-reviewer")
    })

    it("keeps the key for the template screen to forget", async () => {
        rememberTemplateKey("pr-reviewer")
        queryState.data = {
            kind: "ok",
            projects: [{project_id: "p1", project_name: "Default", workspace_id: "ws1"}],
        }

        await render()

        expect(replace).toHaveBeenLastCalledWith("/w/ws1/p/p1/agents/new?template=pr-reviewer")
        expect(peekTemplateKey()).toBe("pr-reviewer")
    })

    it("forwards to the project home when no template was carried", async () => {
        queryState.data = {
            kind: "ok",
            projects: [{project_id: "p1", project_name: "Default", workspace_id: "ws1"}],
        }

        await render()

        expect(replace).toHaveBeenLastCalledWith("/w/ws1/p/p1/apps")
    })
})
