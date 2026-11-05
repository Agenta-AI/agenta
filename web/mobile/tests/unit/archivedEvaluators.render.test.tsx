// @vitest-environment jsdom
import {act, createElement, lazy, Suspense, type ComponentType} from "react"

import {workflowIncludeArchivedAtom} from "@agenta/entities/workflow"
import {setProjectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const noop = vi.hoisted(() => () => undefined)
const state = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    perms: {} as Record<string, boolean>,
    recheck: vi.fn(),
    replace: vi.fn(),
}))
const api = vi.hoisted(() => ({
    queryWorkflows: vi.fn(),
    fetchWorkflowsBatch: vi.fn(),
    unarchiveWorkflow: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))
// Member names have their own test; this screen test needs no member query.
vi.mock("@/features/members/useBindWorkspaceMembers", () => ({
    useBindWorkspaceMembers: () => undefined,
}))
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    // One atom for every row: a fresh atom per render would re-subscribe forever.
    const templates = atom([])
    return {
        ...(await original<object>()),
        queryWorkflows: (...args: unknown[]) => api.queryWorkflows(...args),
        fetchWorkflowsBatch: (...args: unknown[]) => api.fetchWorkflowsBatch(...args),
        unarchiveWorkflow: (...args: unknown[]) => api.unarchiveWorkflow(...args),
        invalidateEvaluatorsListCache: noop,
        evaluatorTemplatesDataAtom: templates,
    }
})
vi.mock("@agenta/entities/shared/user", () => ({
    UserAuthorLabel: ({fallback}: {fallback?: string}) => createElement("span", null, fallback),
}))
vi.mock("@agenta/entity-ui/workflow", () => ({
    WorkflowTypeTag: () => createElement("span", {"data-testid": "type-tag"}),
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: api.success, error: api.error}}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: state.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluators/archived",
        replace: state.replace,
    }),
}))
vi.mock("next/dynamic", () => ({
    default: (load: () => Promise<ComponentType<object>>) => {
        const Lazy = lazy(async () => ({default: await load()}))
        return (props: object) =>
            createElement(Suspense, {fallback: null}, createElement(Lazy, props))
    },
}))
vi.mock("@/features/revisions/RevisionDrawerHost", () => ({
    RevisionDrawerHost: ({kind}: {kind: string}) =>
        createElement("div", {"data-testid": "drawer", "data-kind": kind}),
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => createElement("div", null, children),
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: noop}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) => state.perms[action] ?? true,
    useProjectPermissionState: (_project: string, action: string) => ({
        allowed: state.perms[action] ?? true,
        pending: false,
        failed: false,
        recheck: state.recheck,
    }),
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))

import {ArchivedEvaluatorsScreen} from "@/features/evaluators/ArchivedEvaluatorsScreen"

import {latestByWorkflow, makeArchivedServer, type EvaluatorServer} from "./evaluatorsFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let server: EvaluatorServer
let store = createStore()

const flush = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const mount = async () => {
    store = createStore()
    store.set(setProjectIdAtom, "pr")
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client: new QueryClient({defaultOptions: {queries: {retry: false}}})},
                    createElement(ArchivedEvaluatorsScreen, {workspaceId: "ws", projectId: "pr"}),
                ),
            ),
        )
    })
    await flush()
    await flush()
}

const text = () => host.textContent ?? ""
const kebab = () => document.querySelector<HTMLButtonElement>('[aria-label="Evaluator actions"]')
const menuItem = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === label,
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
    window.localStorage.clear()
    state.query = {}
    state.perms = {}
    state.recheck.mockReset()
    state.replace.mockReset()
    Object.values(api).forEach((mock) => mock.mockReset())
    server = makeArchivedServer()
    api.queryWorkflows.mockImplementation(async () => ({workflows: [...server.workflows]}))
    api.fetchWorkflowsBatch.mockImplementation(async () => latestByWorkflow(server.revisions))
    api.unarchiveWorkflow.mockImplementation(async (_project: string, id: string) => {
        server.workflows = server.workflows.filter((item) => item.id !== id)
        return {count: 1}
    })
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

describe("ArchivedEvaluatorsScreen", () => {
    it("Lists archived evaluators newest archive first with a way back", async () => {
        await mount()
        const names = [...host.querySelectorAll('[title$="check"]')].map((n) => n.textContent)
        expect(names).toEqual(["Newer check", "Older check"])
        expect(text()).toContain("Archived Evaluators")
        const back = host.querySelector('[aria-label="Back to evaluators"]')
        expect(back?.getAttribute("href")).toBe("/w/ws/p/pr/evaluators?tab=automatic")
        expect(api.queryWorkflows).toHaveBeenCalledWith(
            expect.objectContaining({includeArchived: true}),
        )
    })

    it("A row with no tags still fills every column", async () => {
        await mount()
        const row = host.querySelector('[role="button"]')
        const headers = host.querySelectorAll('[role="columnheader"]')
        expect(row?.children).toHaveLength(headers.length)
    })

    it("The archived page can switch to human evaluators", async () => {
        await mount()
        expect(text()).not.toContain("Archived rating")
        const human = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) =>
            t.textContent?.includes("Human Evaluators"),
        )
        await act(async () => {
            human?.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0}))
            human?.click()
        })
        expect(state.replace).toHaveBeenCalledWith(
            expect.objectContaining({query: expect.objectContaining({tab: "human"})}),
            undefined,
            {shallow: true},
        )
    })

    it("Shows the human evaluators when the address asks for them", async () => {
        state.query = {tab: "human"}
        await mount()
        expect(text()).toContain("Archived rating")
        expect(text()).not.toContain("Newer check")
    })

    it("Restore removes the row and shows Evaluator restored", async () => {
        await mount()
        await openKebab()
        await act(async () => menuItem("Restore")?.click())
        await flush()
        await flush()
        expect(api.unarchiveWorkflow).toHaveBeenCalledWith("pr", "a2")
        expect(api.success).toHaveBeenCalledWith("Evaluator restored")
        expect(text()).not.toContain("Newer check")
        expect(text()).toContain("Older check")
    })

    it("A failed restore shows Couldn't restore this evaluator and keeps the row", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(noop)
        api.unarchiveWorkflow.mockRejectedValue(new Error("403 raw api text"))
        await mount()
        await openKebab()
        await act(async () => menuItem("Restore")?.click())
        await flush()
        expect(api.error).toHaveBeenCalledWith("Couldn't restore this evaluator")
        expect(JSON.stringify(api.error.mock.calls)).not.toContain("raw api text")
        expect(text()).toContain("Newer check")
        log.mockRestore()
    })

    it("A second click while restoring sends no second request", async () => {
        let finish: () => void = noop
        api.unarchiveWorkflow.mockImplementation(
            () => new Promise<void>((resolve) => (finish = resolve)),
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
        expect(api.unarchiveWorkflow).toHaveBeenCalledTimes(1)
        await act(async () => finish())
    })

    it("Restore is hidden without edit_evaluators", async () => {
        state.perms.edit_evaluators = false
        await mount()
        await openKebab()
        expect(menuItem("Open details")).toBeDefined()
        expect(menuItem("Restore")).toBeUndefined()
    })

    it("Clicking a row opens the evaluator drawer", async () => {
        await mount()
        const row = host.querySelector<HTMLElement>('[role="button"]')
        await act(async () => row?.click())
        expect(state.replace).toHaveBeenCalledWith(
            expect.objectContaining({query: expect.objectContaining({revisionId: "a2-r2"})}),
            undefined,
            {shallow: true},
        )
    })

    it("Without view_evaluators nothing is requested and the load error shows", async () => {
        state.perms.view_evaluators = false
        await mount()
        expect(text()).toContain("Could not load archived evaluators")
        expect(api.queryWorkflows).not.toHaveBeenCalled()
    })

    it("Try again also runs the view_evaluators lookup again", async () => {
        state.perms.view_evaluators = false
        await mount()
        const retry = [...host.querySelectorAll("button")].find((b) =>
            /try again/i.test(b.textContent ?? ""),
        )
        await act(async () => retry?.click())
        expect(state.recheck).toHaveBeenCalledTimes(1)
    })

    it("Opens the drawer with archived revisions included", async () => {
        await mount()
        expect(store.get(workflowIncludeArchivedAtom)).toBe(true)
    })

    it("A failed load shows a retry", async () => {
        api.queryWorkflows.mockRejectedValue(new Error("boom"))
        await mount()
        expect(text()).toContain("Could not load archived evaluators")
        expect(text()).not.toContain("No archived evaluators")
    })

    it("No archived evaluators shows the empty text", async () => {
        server.workflows = []
        await mount()
        expect(text()).toContain("No archived evaluators")
    })
})
