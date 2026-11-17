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
    failedLookups: new Set<string>(),
    recheck: vi.fn(),
    replace: vi.fn(),
    beta: false,
    createdLocal: "local-new" as string | null,
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
        queryWorkflowRevisionsByWorkflows: (...args: unknown[]) => api.queryRevisions(...args),
        archiveWorkflow: (...args: unknown[]) => api.archiveWorkflow(...args),
        invalidateEvaluatorsListCache: noop,
        createEvaluatorFromTemplate: async () => state.createdLocal,
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
// The create surfaces are separate chunks. Stand in for them, and keep what the page hands them.
vi.mock("@/features/evaluators/human/HumanEvaluatorSheet", () => ({
    HumanEvaluatorSheet: ({editing}: {editing: {workflow: {id: string}} | null}) =>
        createElement("div", {
            "data-testid": "human-sheet",
            "data-editing": editing?.workflow.id ?? "",
        }),
}))
vi.mock("@agenta/shared/state", async (original) => {
    const {atom} = await import("jotai")
    return {
        ...(await original<object>()),
        betaDeveloperModeActiveAtom: atom(() => state.beta),
    }
})
// The picker and the editable drawer are separate chunks too.
vi.mock("@/features/evaluators/create/EvaluatorTemplatePicker", () => ({
    EvaluatorTemplatePicker: ({onPick}: {onPick: (template: {key: string}) => void}) =>
        createElement(
            "button",
            {"data-testid": "template-picker", onClick: () => onPick({key: "auto_regex_test"})},
            "Pick Regex Test",
        ),
}))
vi.mock("@/features/evaluators/create/EvaluatorEditorDrawer", () => ({
    EvaluatorEditorDrawer: ({
        revisionId,
        onSaved,
        onClose,
    }: {
        revisionId: string
        onSaved: (id: string) => void
        onClose: () => void
    }) =>
        createElement(
            "div",
            {"data-testid": "editor-drawer", "data-revision": revisionId},
            createElement("button", {onClick: () => onSaved("w9-r1")}, "Create in drawer"),
            createElement("button", {onClick: onClose}, "Close drawer"),
        ),
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => createElement("div", null, children),
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: noop}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) => state.perms[action] ?? true,
    useProjectPermissionState: (_project: string, action: string) => ({
        allowed: state.failedLookups.has(action) ? false : (state.perms[action] ?? true),
        pending: false,
        failed: state.failedLookups.has(action),
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
const rowBox = (name: string) => host.querySelector<HTMLElement>(`[aria-label="Select ${name}"]`)

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    window.localStorage.clear()
    state.query = {}
    state.perms = {}
    state.failedLookups = new Set()
    state.recheck.mockReset()
    state.replace.mockReset()
    state.beta = false
    state.createdLocal = "local-new"
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

    it("Without a tab in the address the Automatic tab opens, whatever tab was last used", async () => {
        window.localStorage.setItem("agenta:evaluators:category", "human")
        await mount()
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

    it("One row per evaluator on its latest version, newest first", async () => {
        await mount()
        const names = [...host.querySelectorAll('[role="button"] span[title]')].map(
            (cell) => cell.textContent,
        )
        expect(names).toEqual(["Exact match check", "Length check"])
        expect(text()).toContain("v3")
        // Older revisions load only when the reader expands an evaluator.
        expect(api.queryRevisions).not.toHaveBeenCalled()
    })

    it("Expanding an evaluator lists its older revisions under it, without revision 0", async () => {
        await mount()
        expect(host.querySelector('[aria-label="Show older versions of Length check"]')).toBeNull()
        const expand = host.querySelector<HTMLElement>(
            '[aria-label="Show older versions of Exact match check"]',
        )
        await act(async () => expand?.click())
        await flush()
        expect(api.queryRevisions).toHaveBeenCalledWith(
            ["w1"],
            "pr",
            {is_evaluator: true, is_managed: true},
            expect.objectContaining({order: "descending"}),
        )
        const rows = [...host.querySelectorAll('[role="button"]')].map((row) => row.textContent)
        expect(rows).toHaveLength(4)
        expect(rows[1]).toContain("v2")
        expect(rows[2]).toContain("v1")
        expect(rows[3]).toContain("Length check")
        // An older revision cannot be selected: only evaluators are archived.
        expect(host.querySelectorAll('[aria-label="Select Exact match check"]')).toHaveLength(1)
        expect(state.replace).not.toHaveBeenCalled()
    })

    it("Selecting a row shows the selection bar with Archive, and select all takes every evaluator", async () => {
        await mount()
        expect(button(/^Archive$/)).toBeUndefined()
        await act(async () => rowBox("Exact match check")?.click())
        expect(text()).toContain("1 selected")
        expect(button(/^Archive$/)).toBeDefined()
        await act(async () => rowBox("all")?.click())
        expect(text()).toContain("2 selected")
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

    it("The automatic tab has no Create new: automatic create comes with the editable drawer", async () => {
        await mount()
        expect(button(/^Create new$/)).toBeUndefined()
    })

    it("Create new opens an empty human evaluator form on the human tab", async () => {
        state.query = {tab: "human"}
        await mount()
        await act(async () => button(/^Create new$/)?.click())
        await flush()
        const sheet = document.querySelector('[data-testid="human-sheet"]')
        expect(sheet?.getAttribute("data-editing")).toBe("")
    })

    it("Create new is hidden without edit_evaluators", async () => {
        state.perms.edit_evaluators = false
        state.query = {tab: "human"}
        await mount()
        expect(button(/^Create new$/)).toBeUndefined()
    })

    it("An empty human tab offers to create the first evaluator", async () => {
        server.workflows = []
        state.query = {tab: "human"}
        await mount()
        await act(async () => button(/^Create evaluator$/)?.click())
        await flush()
        expect(document.querySelector('[data-testid="human-sheet"]')).not.toBeNull()
    })

    it("A human row without edit_evaluators opens the read-only drawer", async () => {
        state.perms.edit_evaluators = false
        state.query = {tab: "human"}
        await mount()
        await act(async () => {
            document
                .querySelector('[aria-label="Evaluator actions"]')
                ?.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
        })
        const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)
        expect(items[0]).toBe("Open details")
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })
        const row = host.querySelector<HTMLElement>('[role="button"]')
        await act(async () => row?.click())
        expect(document.querySelector('[data-testid="human-sheet"]')).toBeNull()
        expect(state.replace).toHaveBeenCalled()
    })

    it("A human row opens its edit form, and its menu says Edit", async () => {
        state.query = {tab: "human"}
        await mount()
        await act(async () => {
            document
                .querySelector('[aria-label="Evaluator actions"]')
                ?.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
        })
        const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)
        expect(items[0]).toBe("Edit")
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })
        const row = host.querySelector<HTMLElement>('[role="button"]')
        await act(async () => row?.click())
        await flush()
        const sheet = document.querySelector('[data-testid="human-sheet"]')
        expect(sheet?.getAttribute("data-editing")).not.toBe("")
        expect(state.replace).not.toHaveBeenCalled()
    })

    it("An older human revision opens the read-only drawer on itself, not the edit form", async () => {
        state.query = {tab: "human"}
        await mount()
        const expand = host.querySelector<HTMLElement>('[aria-label^="Show older versions of"]')
        await act(async () => expand?.click())
        await flush()
        const rows = [...host.querySelectorAll<HTMLElement>('[role="button"]')]
        // The latest revision is v2; the row under it is v1.
        const older = rows.find((row) => row.textContent?.includes("Quality ratingv1"))
        expect(older).toBeDefined()
        await act(async () => older?.click())
        await flush()
        expect(document.querySelector('[data-testid="human-sheet"]')).toBeNull()
        expect(state.replace).toHaveBeenCalled()
    })

    it("Without beta developer mode there is no automatic create and a row opens the read-only drawer", async () => {
        state.query = {revisionId: "w1-r3"}
        await mount()
        await flush()
        expect(button(/^Create new$/)).toBeUndefined()
        expect(document.querySelector('[data-testid="drawer"]')).not.toBeNull()
        expect(document.querySelector('[data-testid="editor-drawer"]')).toBeNull()
    })

    it("In beta developer mode a row opens the editable drawer on that revision", async () => {
        state.beta = true
        state.query = {revisionId: "w1-r2"}
        await mount()
        await flush()
        const editor = document.querySelector('[data-testid="editor-drawer"]')
        expect(editor?.getAttribute("data-revision")).toBe("w1-r2")
        expect(document.querySelector('[data-testid="drawer"]')).toBeNull()
    })

    it("A picked template opens the editable drawer on the new local evaluator, which stays open after Create", async () => {
        state.beta = true
        await mount()
        await act(async () => button(/^Create new$/)?.click())
        await flush()
        await act(async () => button(/^Pick Regex Test$/)?.click())
        await flush()
        expect(document.querySelector('[data-testid="template-picker"]')).toBeNull()
        const editor = () => document.querySelector('[data-testid="editor-drawer"]')
        expect(editor()?.getAttribute("data-revision")).toBe("local-new")
        await act(async () => button(/^Create in drawer$/)?.click())
        // The address names the new evaluator; until it does, the drawer stays on the draft.
        expect(state.replace).toHaveBeenCalledWith(
            expect.objectContaining({query: expect.objectContaining({revisionId: "w9-r1"})}),
            undefined,
            {shallow: true},
        )
        expect(editor()).not.toBeNull()
    })

    it("A template that cannot be opened leaves the picker open", async () => {
        state.beta = true
        state.createdLocal = null
        await mount()
        await act(async () => button(/^Create new$/)?.click())
        await flush()
        await act(async () => button(/^Pick Regex Test$/)?.click())
        await flush()
        expect(document.querySelector('[data-testid="template-picker"]')).not.toBeNull()
        expect(document.querySelector('[data-testid="editor-drawer"]')).toBeNull()
        expect(api.error).toHaveBeenCalled()
    })

    it("In beta mode the human tab creates with the human form, not the template picker", async () => {
        state.beta = true
        state.query = {tab: "human"}
        await mount()
        await act(async () => button(/^Create new$/)?.click())
        await flush()
        expect(document.querySelector('[data-testid="human-sheet"]')).not.toBeNull()
        expect(document.querySelector('[data-testid="template-picker"]')).toBeNull()
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
        expect(drawer?.getAttribute("data-ids")).toBe("w1-r3,w2-r1")
    })

    it("Archiving a selected evaluator asks first, then archives it", async () => {
        await mount()
        await act(async () => rowBox("Exact match check")?.click())
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
        await act(async () => rowBox("Exact match check")?.click())
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
        await act(async () => rowBox("Exact match check")?.click())
        await act(async () => button(/^Archive$/)?.click())
        const confirm = [
            ...document.querySelectorAll<HTMLElement>('[role="alertdialog"] button'),
        ].find((b) => b.textContent === "Archive")
        await act(async () => confirm?.click())
        await flush()
        expect(api.findRuns).not.toHaveBeenCalled()
        expect(api.archiveWorkflow).toHaveBeenCalledWith("pr", "w1")
    })

    it("A failed view_evaluation_runs lookup still runs the in-use check", async () => {
        state.failedLookups.add("view_evaluation_runs")
        api.findRuns.mockResolvedValue(["run-1"])
        await mount()
        await act(async () => rowBox("Exact match check")?.click())
        await act(async () => button(/^Archive$/)?.click())
        const confirm = [
            ...document.querySelectorAll<HTMLElement>('[role="alertdialog"] button'),
        ].find((b) => b.textContent === "Archive")
        await act(async () => confirm?.click())
        await flush()
        expect(api.findRuns).toHaveBeenCalled()
        expect(document.body.textContent).toContain("Evaluator in use")
        expect(api.archiveWorkflow).not.toHaveBeenCalled()
    })

    it("A failed lookup and a failed in-use check block the archive and show the error", async () => {
        state.failedLookups.add("view_evaluation_runs")
        api.findRuns.mockRejectedValue(new Error("network"))
        await mount()
        await act(async () => rowBox("Exact match check")?.click())
        await act(async () => button(/^Archive$/)?.click())
        const confirm = [
            ...document.querySelectorAll<HTMLElement>('[role="alertdialog"] button'),
        ].find((b) => b.textContent === "Archive")
        await act(async () => confirm?.click())
        await flush()
        expect(api.archiveWorkflow).not.toHaveBeenCalled()
        expect(api.error).toHaveBeenCalledWith("Failed to archive evaluators")
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
