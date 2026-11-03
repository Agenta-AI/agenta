// @vitest-environment jsdom
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const noop = vi.hoisted(() => () => undefined)
const api = vi.hoisted(() => ({
    queryWorkflows: vi.fn(),
    ensureAgentFlags: vi.fn(),
    unarchiveWorkflow: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    // One atom for every row: a fresh atom per render would re-subscribe forever.
    const appType = atom("chat")
    return {
        ...(await original<object>()),
        queryWorkflows: (...args: unknown[]) => api.queryWorkflows(...args),
        ensureAgentFlags: (...args: unknown[]) => api.ensureAgentFlags(...args),
        unarchiveWorkflow: (...args: unknown[]) => api.unarchiveWorkflow(...args),
        workflowAppTypeAtomFamily: () => appType,
    }
})
vi.mock("@agenta/entities/shared/user", () => ({
    UserAuthorLabel: ({fallback}: {fallback?: string}) => createElement("span", null, fallback),
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: api.success, error: api.error},
}))

import {ArchivedAppsTable} from "@/features/archived-apps/ArchivedAppsTable"
import {toArchivedAppRow} from "@/features/archived-apps/archivedAppsView"
import {ArchivedAppsEmpty} from "@/features/archived-apps/states/ArchivedAppsEmpty"
import {useArchivedApps} from "@/features/archived-apps/useArchivedApps"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const workflow = (id: string, name: string) => ({
    id,
    name,
    deleted_at: "2026-10-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
})

let host: HTMLDivElement
let root: Root
let client: QueryClient
let server: ReturnType<typeof workflow>[]
let cleared = false

const Probe = ({canRestore = true}: {canRestore?: boolean}) => {
    const archived = useArchivedApps({projectId: "p1", search: ""})
    return createElement(ArchivedAppsTable, {
        rows: archived.apps.map(toArchivedAppRow),
        projectId: "p1",
        canRestore,
        isLoading: archived.isPending,
        empty: createElement(ArchivedAppsEmpty, {
            term: "zzz",
            onClear: () => {
                cleared = true
            },
        }),
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
const kebab = () => document.querySelector<HTMLButtonElement>('[aria-label="App actions"]')
const restoreItem = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
        item.textContent?.includes("Restore"),
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
    server = [workflow("a1", "Support bot"), workflow("a2", "Summarizer")]
    cleared = false
    Object.values(api).forEach((mock) => mock.mockReset())
    api.ensureAgentFlags.mockResolvedValue(new Map())
    api.queryWorkflows.mockImplementation(async () => ({workflows: [...server]}))
    api.unarchiveWorkflow.mockImplementation(async (_project: string, id: string) => {
        server = server.filter((item) => item.id !== id)
        return {count: 1}
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

describe("ArchivedAppsTable", () => {
    it("Restore removes the row and shows App restored", async () => {
        await mount()
        expect(text()).toContain("Support bot")
        await openKebab()
        await act(async () => restoreItem()?.click())
        await flush()
        await flush()
        expect(api.unarchiveWorkflow).toHaveBeenCalledWith("p1", "a1")
        expect(api.success).toHaveBeenCalledWith("App restored")
        expect(text()).not.toContain("Support bot")
        expect(text()).toContain("Summarizer")
    })

    it("A failed restore shows Couldn't restore this app and keeps the row", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(noop)
        api.unarchiveWorkflow.mockRejectedValue(new Error("403 raw api text"))
        await mount()
        await openKebab()
        await act(async () => restoreItem()?.click())
        await flush()
        expect(api.error).toHaveBeenCalledWith("Couldn't restore this app")
        expect(JSON.stringify(api.error.mock.calls)).not.toContain("raw api text")
        expect(log).toHaveBeenCalled()
        expect(text()).toContain("Support bot")
        log.mockRestore()
    })

    it("Restore is hidden without edit_workflows", async () => {
        await mount({canRestore: false})
        expect(text()).toContain("Support bot")
        expect(kebab()).toBeNull()
    })

    it("A second click while restoring sends no second request", async () => {
        let finish: () => void = noop
        api.unarchiveWorkflow.mockImplementation(
            () => new Promise<void>((resolve) => (finish = resolve)),
        )
        await mount()
        await openKebab()
        const item = restoreItem()
        await act(async () => {
            item?.click()
            item?.click()
        })
        await openKebab()
        await act(async () => restoreItem()?.click())
        expect(api.unarchiveWorkflow).toHaveBeenCalledTimes(1)
        await act(async () => finish())
    })

    it("No archived apps shows the empty text", async () => {
        server = []
        await act(async () => {
            root.render(
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(ArchivedAppsTable, {
                        rows: [],
                        projectId: "p1",
                        canRestore: true,
                        isLoading: false,
                        empty: createElement(ArchivedAppsEmpty, {}),
                    }),
                ),
            )
        })
        expect(text()).toContain("No archived apps")
    })

    it("A search with no match offers Clear search", async () => {
        server = []
        await mount()
        expect(text()).toContain("No archived apps match “zzz”")
        const clear = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Clear search",
        )
        await act(async () => clear?.click())
        expect(cleared).toBe(true)
    })
})
