// @vitest-environment jsdom
import {act, createElement, lazy, Suspense, type ComponentType} from "react"

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
    queryRevisions: vi.fn(),
    archiveWorkflow: vi.fn(),
    findRuns: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    // One atom for every row: a fresh atom per render would re-subscribe forever.
    const templates = atom([])
    return {
        ...(await original<object>()),
        queryWorkflows: (...args: unknown[]) => api.queryWorkflows(...args),
        fetchWorkflowsBatch: (...args: unknown[]) => api.fetchWorkflowsBatch(...args),
        queryWorkflowRevisionsByWorkflows: (...args: unknown[]) => api.queryRevisions(...args),
        archiveWorkflow: (...args: unknown[]) => api.archiveWorkflow(...args),
        invalidateEvaluatorsListCache: noop,
        evaluatorTemplatesDataAtom: templates,
    }
})
vi.mock("@agenta/entities/evaluationRun", () => ({
    findEvaluationRunsUsing: (...args: unknown[]) => api.findRuns(...args),
}))
vi.mock("@agenta/entities/shared/user", () => ({
    UserAuthorLabel: ({fallback}: {fallback?: string}) => createElement("span", null, fallback),
}))
vi.mock("@agenta/entity-ui/workflow", () => ({
    WorkflowTypeTag: ({workflowKey}: {workflowKey?: string | null}) =>
        createElement("span", {"data-testid": "type-tag"}, workflowKey),
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: api.success, error: api.error}}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: state.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluators",
        replace: state.replace,
    }),
}))
// The drawer is a separate chunk. Stand in for it, and keep what the page hands it visible.
vi.mock("next/dynamic", () => ({
    default: (load: () => Promise<ComponentType<object>>) => {
        const Lazy = lazy(async () => ({default: await load()}))
        return (props: object) =>
            createElement(Suspense, {fallback: null}, createElement(Lazy, props))
    },
}))
vi.mock("@/features/revisions/RevisionDrawerHost", () => ({
    RevisionDrawerHost: ({kind, navigationIds}: {kind: string; navigationIds: string[]}) =>
        createElement("div", {
            "data-testid": "drawer",
            "data-kind": kind,
            "data-ids": navigationIds.join(","),
        }),
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

import {EvaluatorsScreen} from "@/features/evaluators/EvaluatorsScreen"

import {latestByWorkflow, makeEvaluatorServer, type EvaluatorServer} from "./evaluatorsFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let server: EvaluatorServer

const flush = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const mount = async () => {
    const store = createStore()
    store.set(setProjectIdAtom, "pr")
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client: new QueryClient({defaultOptions: {queries: {retry: false}}})},
                    createElement(EvaluatorsScreen, {workspaceId: "ws", projectId: "pr"}),
                ),
            ),
        )
    })
    await flush()
    await flush()
}

const text = () => host.textContent ?? ""
const headers = () => [...host.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent)
const button = (label: RegExp) =>
    [...document.querySelectorAll<HTMLElement>("button, a")].find((b) =>
        label.test(b.textContent ?? ""),
    )
const checkboxes = () => [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')]

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
    server = makeEvaluatorServer()
    api.queryWorkflows.mockImplementation(async () => ({workflows: server.workflows}))
    api.fetchWorkflowsBatch.mockImplementation(async () => latestByWorkflow(server.revisions))
    api.queryRevisions.mockImplementation(async (ids: string[]) => ({
        workflow_revisions: server.revisions.filter((r) => ids.includes(r.workflow_id)),
        windowing: {next: null},
    }))
    api.archiveWorkflow.mockResolvedValue({count: 1})
    api.findRuns.mockResolvedValue([])
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

describe("EvaluatorsScreen", () => {
    it("The automatic tab shows the Type column and the human tab shows Feedback instead", async () => {
        await mount()
        expect(headers()).toContain("Type")
        expect(headers()).not.toContain("Feedback")
        expect(text()).toContain("Exact match check")
        expect(text()).not.toContain("Quality rating")
    })

    it("The human tab shows the Feedback column and no Type column", async () => {
        state.query = {tab: "human"}
        await mount()
        expect(headers()).toContain("Feedback")
        expect(headers()).not.toContain("Type")
        expect(text()).toContain("Quality rating")
        expect(text()).toContain("rating")
        expect(text()).toContain("notes")
        expect(text()).not.toContain("Exact match check")
    })

    it("A row with no tags still fills every column", async () => {
        await mount()
        const row = host.querySelector('[role="button"]')
        expect(row?.children).toHaveLength(headers().length)
    })

    it("Revisions are grouped under their evaluator", async () => {
        await mount()
        expect(text()).toContain("Exact match check v3")
        expect(text()).toContain("Length check v1")
        // Revision 0 is the empty first commit: not a row.
        const exact = [...host.querySelectorAll('[aria-label^="Select Exact"]')]
        expect(exact).toHaveLength(3)
        expect(api.queryRevisions).toHaveBeenCalledWith(
            ["w1", "w2"],
            "pr",
            {is_evaluator: true, is_managed: true},
            expect.objectContaining({limit: 50, order: "descending"}),
        )
    })

    it("Selecting rows replaces Archived with Archive", async () => {
        await mount()
        expect(button(/^Archived$/)).toBeDefined()
        expect(button(/^Archive$/)).toBeUndefined()
        await act(async () => checkboxes()[0]?.click())
        expect(button(/^Archive$/)).toBeDefined()
        expect(button(/^Archived$/)).toBeUndefined()
    })

    it("Archive is hidden without edit_evaluators", async () => {
        state.perms.edit_evaluators = false
        await mount()
        expect(checkboxes()).toHaveLength(0)
        expect(document.querySelector('[aria-label="Evaluator actions"]')).not.toBeNull()
        await act(async () => {
            document
                .querySelector('[aria-label="Evaluator actions"]')
                ?.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
        })
        const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)
        expect(items).toContain("Configure")
        expect(items).not.toContain("Archive")
        expect(button(/^Archive$/)).toBeUndefined()
    })

    it("The row menu offers Copy ID and Copy Slug from the evaluator's own slug", async () => {
        await mount()
        await act(async () => {
            document
                .querySelector('[aria-label="Evaluator actions"]')
                ?.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
        })
        const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)
        expect(items).toEqual(["Configure", "Copy ID", "Copy Slug", "Archive"])
    })

    it("Clicking a row opens the evaluator drawer", async () => {
        await mount()
        expect(document.querySelector('[data-testid="drawer"]')).toBeNull()
        const row = host.querySelector<HTMLElement>('[role="button"]')
        await act(async () => row?.click())
        expect(state.replace).toHaveBeenCalledWith(
            expect.objectContaining({query: expect.objectContaining({revisionId: "w1-r3"})}),
            undefined,
            {shallow: true},
        )
    })

    it("The drawer opens on the revision in the address, as an evaluator drawer, and only then", async () => {
        state.query = {revisionId: "w1-r2"}
        await mount()
        await flush()
        const drawer = document.querySelector('[data-testid="drawer"]')
        expect(drawer?.getAttribute("data-kind")).toBe("evaluator")
        expect(drawer?.getAttribute("data-ids")).toBe("w1-r3,w1-r2,w1-r1,w2-r1")
    })

    it("Archiving a selected evaluator asks first, then archives it", async () => {
        await mount()
        await act(async () => checkboxes()[0]?.click())
        await act(async () => button(/^Archive$/)?.click())
        expect(document.body.textContent).toContain("Archive evaluator")
        expect(document.body.textContent).toContain(
            "Are you sure you want to archive Exact match check v3?",
        )
        expect(api.archiveWorkflow).not.toHaveBeenCalled()
        const confirm = [
            ...document.querySelectorAll<HTMLElement>('[role="alertdialog"] button'),
        ].find((b) => b.textContent === "Archive")
        await act(async () => confirm?.click())
        await flush()
        expect(api.archiveWorkflow).toHaveBeenCalledWith("pr", "w1")
        expect(api.success).toHaveBeenCalledWith("Evaluator archived")
    })

    it("An evaluator in use is not archived and the dialog says so", async () => {
        api.findRuns.mockResolvedValue(["run-1"])
        await mount()
        await act(async () => checkboxes()[0]?.click())
        await act(async () => button(/^Archive$/)?.click())
        const confirm = [
            ...document.querySelectorAll<HTMLElement>('[role="alertdialog"] button'),
        ].find((b) => b.textContent === "Archive")
        await act(async () => confirm?.click())
        await flush()
        expect(document.body.textContent).toContain("Evaluator in use")
        expect(document.body.textContent).toContain("currently in use by 1 evaluation.")
        expect(api.archiveWorkflow).not.toHaveBeenCalled()
    })

    it("A viewer without view_evaluation_runs archives without the in-use check", async () => {
        state.perms.view_evaluation_runs = false
        await mount()
        await act(async () => checkboxes()[0]?.click())
        await act(async () => button(/^Archive$/)?.click())
        const confirm = [
            ...document.querySelectorAll<HTMLElement>('[role="alertdialog"] button'),
        ].find((b) => b.textContent === "Archive")
        await act(async () => confirm?.click())
        await flush()
        expect(api.findRuns).not.toHaveBeenCalled()
        expect(api.archiveWorkflow).toHaveBeenCalledWith("pr", "w1")
    })

    it("Without view_evaluators nothing is requested and the load error shows", async () => {
        state.perms.view_evaluators = false
        state.query = {revisionId: "w1-r2"}
        await mount()
        expect(text()).toContain("Could not load evaluators")
        expect(api.queryWorkflows).not.toHaveBeenCalled()
        expect(document.querySelector('[data-testid="drawer"]')).toBeNull()
    })

    it("Try again also runs the view_evaluators lookup again", async () => {
        state.perms.view_evaluators = false
        await mount()
        await act(async () => button(/try again/i)?.click())
        expect(state.recheck).toHaveBeenCalledTimes(1)
    })

    it("A failed load shows a retry", async () => {
        api.queryWorkflows.mockRejectedValue(new Error("boom"))
        await mount()
        expect(text()).toContain("Could not load evaluators")
        expect(text()).not.toContain("No automatic evaluators")
        const retry = button(/try again/i)
        expect(retry).toBeDefined()
        await act(async () => retry?.click())
        expect(api.queryWorkflows).toHaveBeenCalledTimes(2)
    })

    it("An empty tab says so", async () => {
        server.workflows = []
        await mount()
        expect(text()).toContain("No automatic evaluators")
    })
})
