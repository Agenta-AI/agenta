// @vitest-environment jsdom
/**
 * The test set page: which state it shows, and how the drawer moves through the rows. The
 * editor, the header, the toolbar and the grid are stubs here; each has its own tests.
 */
import {act, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {atom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import TestsetDetailPage from "@/pages/w/[workspace_id]/p/[project_id]/testsets/[testset_id]"

const REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"

const state = vi.hoisted(() => ({
    viewEnabled: true as boolean | null,
    editor: {} as Record<string, unknown>,
    drawer: null as null | Record<string, unknown>,
    openRow: null as null | ((id: string) => void),
}))

vi.mock("next/router", () => ({
    useRouter: () => ({
        query: {workspace_id: "ws", project_id: "pr", testset_id: REVISION},
        push: vi.fn(),
    }),
}))
vi.mock("next/dynamic", () => ({
    default: () => (props: Record<string, unknown>) => {
        state.drawer = props
        return null
    },
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => state.viewEnabled,
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/PageNotFound", () => ({
    PageNotFound: () => <p data-testid="not-found">not found</p>,
}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: vi.fn()}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
vi.mock("@/features/testsets/detail/useTestsetEditor", () => ({
    useTestsetEditor: () => state.editor,
}))
vi.mock("@/features/testsets/detail/TestsetHeader", () => ({
    TestsetHeader: () => <p data-testid="header" />,
}))
vi.mock("@/features/testsets/detail/TestsetToolbar", () => ({TestsetToolbar: () => null}))
vi.mock("@/features/testsets/detail/TestsetGrid", () => ({
    TestsetGrid: ({onOpenRow}: {onOpenRow: (id: string) => void}) => {
        state.openRow = onOpenRow
        return <p data-testid="grid" />
    },
}))
vi.mock("@agenta/entities/testcase", () => {
    const rows = atom([
        {id: "case-1", key: "case-1"},
        {id: "case-2", key: "case-2"},
    ])
    const columns = atom([{key: "question"}])
    return {testcaseDataController: {selectors: {rows: () => rows, columns: () => columns}}}
})
vi.mock("@agenta/entity-ui/testcase", async () => ({
    useTestcaseDrawerNavigation: (
        await import("../../../packages/agenta-entity-ui/src/testcase/useTestcaseDrawerNavigation")
    ).useTestcaseDrawerNavigation,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const loadedEditor = (over: Record<string, unknown> = {}) => ({
    header: {testsetId: "set-1", testsetName: "Refund questions", revisionVersion: 2},
    isNew: false,
    notFound: false,
    isPending: false,
    isError: false,
    readOnly: false,
    tableConfig: {scopeId: "scope", revisionId: REVISION, includeNewRows: true},
    ...over,
})

describe("Test set page", () => {
    let root: Root
    let host: HTMLDivElement
    let queryClient: QueryClient
    const render = () =>
        act(() =>
            root.render(
                <QueryClientProvider client={queryClient}>
                    <TestsetDetailPage />
                </QueryClientProvider>,
            ),
        )
    const testId = (id: string) => host.querySelector(`[data-testid="${id}"]`)

    beforeEach(() => {
        vi.clearAllMocks()
        state.viewEnabled = true
        state.editor = loadedEditor()
        state.drawer = null
        state.openRow = null
        queryClient = new QueryClient()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Testset detail route shows not found while the view is hidden", () => {
        state.viewEnabled = false
        render()
        expect(testId("not-found")).not.toBeNull()
        expect(testId("grid")).toBeNull()
    })

    it("An id that is not a revision id shows not found", () => {
        state.editor = loadedEditor({notFound: true, header: null})
        render()
        expect(testId("not-found")).not.toBeNull()
    })

    it("A revision the server does not know shows not found", () => {
        state.editor = loadedEditor({header: null})
        render()
        expect(testId("not-found")).not.toBeNull()
    })

    it("A failed revision load shows Could not load this test set with a retry", async () => {
        const refetch = vi.spyOn(queryClient, "refetchQueries").mockResolvedValue(undefined)
        state.editor = loadedEditor({isError: true, header: null})
        render()
        expect(host.textContent).toContain("Could not load this test set")
        expect(testId("grid")).toBeNull()

        const retry = Array.from(host.querySelectorAll("button")).find((button) =>
            /retry|try again/i.test(button.textContent ?? ""),
        )
        await act(async () => retry?.click())
        expect(refetch).toHaveBeenCalledWith({queryKey: ["revision", "pr", REVISION]})
    })

    it("While the revision loads, the page shows its skeleton", () => {
        state.editor = loadedEditor({isPending: true, header: null})
        render()
        expect(host.querySelector('[aria-label="Loading test set"]')).not.toBeNull()
        expect(testId("header")).toBeNull()
    })

    it("Next and previous move through the visible rows", () => {
        render()
        expect(state.drawer).toBeNull()
        act(() => state.openRow?.("case-1"))
        expect(state.drawer).toMatchObject({
            testcaseId: "case-1",
            testcaseNumber: 1,
            hasPrevious: false,
            hasNext: true,
        })

        act(() => (state.drawer?.onNext as () => void)())
        expect(state.drawer).toMatchObject({
            testcaseId: "case-2",
            hasPrevious: true,
            hasNext: false,
        })

        act(() => (state.drawer?.onPrevious as () => void)())
        expect(state.drawer).toMatchObject({testcaseId: "case-1"})
    })

    it("While a save runs, the drawer opens view only", () => {
        state.editor = loadedEditor({readOnly: true})
        render()
        act(() => state.openRow?.("case-2"))
        expect(state.drawer).toMatchObject({testcaseId: "case-2", viewOnly: true})
    })
})
