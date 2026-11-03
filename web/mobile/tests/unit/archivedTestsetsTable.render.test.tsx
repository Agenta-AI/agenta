// @vitest-environment jsdom
/**
 * The archived test sets table over the real package code: the real unarchive action, the real
 * revision read and the real query hook. Only the HTTP layer is replaced, so each test checks the
 * request that would reach the server.
 */
import {act, createElement} from "react"

import type {Testset} from "@agenta/entities/testset"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const noop = vi.hoisted(() => () => undefined)
const api = vi.hoisted(() => ({
    http: {post: vi.fn()},
    page: vi.fn(),
    push: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: api.http,
}))
// The list read goes through the generated client; this is its HTTP seam.
vi.mock("@agenta/entities/testset", async (original) => ({
    ...(await original<object>()),
    queryTestsetsPage: (...args: unknown[]) => api.page(...args),
}))
vi.mock("@agenta/entities/shared/user", () => ({
    UserAuthorLabel: ({fallback}: {fallback?: string}) => createElement("span", null, fallback),
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: api.success, error: api.error},
}))
vi.mock("next/router", () => ({useRouter: () => ({push: api.push})}))

import {ArchivedTestsetsTable} from "@/features/testsets/archived/ArchivedTestsetsTable"
import {ArchivedTestsetsEmpty} from "@/features/testsets/archived/states/ArchivedTestsetsEmpty"
import {useArchivedTestsets} from "@/features/testsets/archived/useArchivedTestsets"
import {useRestoreTestset} from "@/features/testsets/archived/useRestoreTestset"
import {useTestsetRowActions} from "@/features/testsets/list/useTestsetRowActions"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "project-1"
const ALPHA = "0b9f6c1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"
const BETA = "1c0a7d2f-2d3e-4f40-9b0c-1d2e3f4a5b6c"
const REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"

const testset = (id: string, name: string) =>
    ({
        id,
        name,
        created_at: "2026-09-01T00:00:00Z",
        deleted_at: "2026-10-01T00:00:00Z",
    }) as Testset

let host: HTMLDivElement
let root: Root
let client: QueryClient
let server: Testset[]

const Probe = ({canRestore = true}: {canRestore?: boolean}) => {
    const archived = useArchivedTestsets({projectId: PROJECT, search: ""})
    const actions = useTestsetRowActions({
        projectId: PROJECT,
        base: "/w/ws/p/pr",
        includeArchived: true,
    })
    return createElement(ArchivedTestsetsTable, {
        rows: archived.testsets,
        projectId: PROJECT,
        isLoading: archived.isPending,
        canRestore,
        isBusy: actions.isBusy,
        onOpen: (row) => void actions.openLatest(row),
        empty: createElement(ArchivedTestsetsEmpty),
    })
}

const flush = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const mount = async (props?: {canRestore?: boolean}) => {
    await act(async () => {
        root.render(createElement(QueryClientProvider, {client}, createElement(Probe, props)))
    })
    await flush()
}

const text = () => host.textContent ?? ""
const kebab = () => document.querySelector<HTMLButtonElement>('[aria-label="Test set actions"]')
const menuItem = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
        item.textContent?.includes(label),
    )

const openKebab = async () => {
    await act(async () => {
        kebab()?.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    server = [testset(ALPHA, "Alpha set"), testset(BETA, "Beta set")]
    Object.values(api).forEach((mock) => "mockReset" in mock && mock.mockReset())
    api.http.post.mockReset()
    api.page.mockImplementation(async () => ({testsets: [...server], nextCursor: null}))
    api.http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/unarchive")) {
            const id = url.split("/").at(-2)
            server = server.filter((item) => item.id !== id)
            return {data: {}}
        }
        // The latest revision read.
        return {
            data: {
                count: 1,
                testset_revisions: [{id: REVISION, testset_id: ALPHA, version: "3", slug: "rev-3"}],
            },
        }
    })
    // jsdom has no matchMedia: report a wide screen.
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: noop,
        removeEventListener: noop,
    })) as unknown as typeof window.matchMedia
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("ArchivedTestsetsTable", () => {
    it("Restore shows Test set restored and removes the row", async () => {
        await mount()
        expect(text()).toContain("Alpha set")
        await openKebab()
        await act(async () => menuItem("Restore")?.click())
        await flush()
        await flush()
        expect(api.http.post).toHaveBeenCalledWith(
            expect.stringContaining(`/simple/testsets/${ALPHA}/unarchive`),
            {},
            {params: {project_id: PROJECT}},
        )
        expect(api.success).toHaveBeenCalledWith("Test set restored")
        expect(text()).not.toContain("Alpha set")
        expect(text()).toContain("Beta set")
    })

    it("A failed restore shows Couldn't restore this test set and keeps the row", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(noop)
        api.http.post.mockRejectedValue(new Error("403 raw api text"))
        await mount()
        await openKebab()
        await act(async () => menuItem("Restore")?.click())
        await flush()
        expect(api.error).toHaveBeenCalledWith("Couldn't restore this test set")
        expect(JSON.stringify(api.error.mock.calls)).not.toContain("raw api text")
        expect(log).toHaveBeenCalled()
        expect(text()).toContain("Alpha set")
        log.mockRestore()
    })

    it("A second click while restoring sends no second request", async () => {
        let finish: () => void = noop
        api.http.post.mockImplementation(
            () => new Promise<{data: object}>((resolve) => (finish = () => resolve({data: {}}))),
        )
        await mount()
        await openKebab()
        const item = menuItem("Restore")
        await act(async () => {
            item?.click()
            item?.click()
        })
        await openKebab()
        await act(async () => menuItem("Restore")?.click())
        expect(api.http.post).toHaveBeenCalledTimes(1)
        await act(async () => finish())
    })

    it("Two restore calls in one tick send one request", async () => {
        let finish: () => void = noop
        api.http.post.mockImplementation(
            () => new Promise<{data: object}>((resolve) => (finish = () => resolve({data: {}}))),
        )
        let restore: (id: string) => Promise<void> = async () => undefined
        const HookProbe = () => {
            restore = useRestoreTestset(PROJECT).restore
            return null
        }
        await act(async () => {
            root.render(createElement(QueryClientProvider, {client}, createElement(HookProbe)))
        })
        await act(async () => {
            void restore(ALPHA)
            void restore(ALPHA)
        })
        expect(api.http.post).toHaveBeenCalledTimes(1)
        await act(async () => finish())
    })

    it("Restore is hidden without edit_testsets and View details stays", async () => {
        await mount({canRestore: false})
        expect(text()).toContain("Alpha set")
        await openKebab()
        expect(menuItem("Restore")).toBeUndefined()
        expect(menuItem("View details")).toBeDefined()
    })

    it("View details opens the latest revision, reading archived revisions too", async () => {
        await mount()
        await openKebab()
        await act(async () => menuItem("View details")?.click())
        await flush()
        expect(api.http.post).toHaveBeenCalledWith(
            expect.stringContaining("/testsets/revisions/query"),
            expect.objectContaining({
                testset_refs: [{id: ALPHA}],
                include_archived: true,
            }),
            {params: {project_id: PROJECT}},
        )
        expect(api.push).toHaveBeenCalledWith(`/w/ws/p/pr/testsets/${REVISION}`)
    })

    it("No archived testsets shows the empty text", async () => {
        server = []
        await mount()
        expect(text()).toContain("No archived test sets")
    })
})
