// @vitest-environment jsdom
/**
 * The annotation queues screen: which of the four states shows, and who sees "New Queue".
 * The list hook, the table and the page chrome are replaced, so no request is sent.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    list: {} as Record<string, unknown>,
    canEdit: true,
    refetch: vi.fn(),
    clearSearch: vi.fn(),
    setKind: vi.fn(),
}))

vi.mock("@agenta/annotation", async () => {
    const {atom} = await import("jotai")
    return {
        createQueueDrawerDefaultKindAtom: atom<"traces" | "testcases">("traces"),
        createQueueDrawerOpenAtom: atom(false),
        createQueueDrawerSelectionAtom: atom<unknown>(null),
    }
})
vi.mock("@/features/annotations/useQueueList", () => ({useQueueList: () => fixture.list}))
vi.mock("@/features/annotations/useQueueDelete", () => ({
    useQueueDelete: () => ({
        target: null,
        isDeleting: false,
        error: null,
        requestDelete: vi.fn(),
        confirm: vi.fn(),
        cancel: vi.fn(),
    }),
}))
vi.mock("@/features/annotations/QueueDeleteDialog", () => ({QueueDeleteDialog: () => null}))
vi.mock("@/features/annotations/CreateQueueSheetHost", () => ({CreateQueueSheetHost: () => null}))
vi.mock("@/features/annotations/QueueListTable", () => ({
    QueueListTable: ({rows, empty}: {rows: {id: string}[]; empty: React.ReactNode}) =>
        rows.length === 0 ? <>{empty}</> : <div data-testid="rows">{rows.length}</div>,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => fixture.canEdit,
}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({header, children}: {header: React.ReactNode; children: React.ReactNode}) => (
        <div>
            {header}
            {children}
        </div>
    ),
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))

import {QueueListScreen} from "@/features/annotations/QueueListScreen"

let host: HTMLDivElement
let root: Root

const setList = (patch: Record<string, unknown> = {}) => {
    fixture.list = {
        rows: [],
        isLoading: false,
        isError: false,
        hasMore: false,
        isLoadingMore: false,
        loadMore: vi.fn(),
        refetch: fixture.refetch,
        search: "",
        setSearch: vi.fn(),
        appliedSearch: "",
        clearSearch: fixture.clearSearch,
        kind: null,
        setKind: fixture.setKind,
        ...patch,
    }
}

const render = async () => {
    await act(async () => root.render(<QueueListScreen workspaceId="w" projectId="p" />))
}
const buttonLabels = () => Array.from(host.querySelectorAll("button")).map((b) => b.textContent)
const click = async (label: string) => {
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)
    expect(button).toBeDefined()
    await act(async () => button!.click())
}

beforeEach(() => {
    fixture.canEdit = true
    vi.clearAllMocks()
    setList()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the annotation queues screen", () => {
    it("No queues shows Create your first annotation queue", async () => {
        await render()
        expect(host.textContent).toContain("Create your first annotation queue")
        expect(host.textContent).toContain("Learn More")
        expect(host.querySelector("h1")?.textContent).toBe("Queues")
    })

    it("A search with no match shows the search term and Clear search", async () => {
        setList({appliedSearch: "billing", search: "billing"})
        await render()
        expect(host.textContent).toContain("No queues match your search")
        expect(host.textContent).toContain('No annotation queues matched "billing"')
        await click("Clear search")
        expect(fixture.clearSearch).toHaveBeenCalled()
    })

    it("A type filter with no match shows Clear filter, not the first run state", async () => {
        setList({kind: "testcases"})
        await render()
        expect(host.textContent).toContain("No queues match your filters")
        expect(host.textContent).not.toContain("Create your first annotation queue")
        await click("Clear filter")
        expect(fixture.setKind).toHaveBeenCalledWith(null)
    })

    it("A failed load shows Could not load annotation queues with a retry", async () => {
        setList({isError: true})
        await render()
        expect(host.textContent).toContain("Could not load annotation queues")
        expect(host.textContent).not.toContain("Create your first annotation queue")
        const retry = Array.from(host.querySelectorAll("button")).find((b) =>
            /retry|try again/i.test(b.textContent ?? ""),
        )
        expect(retry).toBeDefined()
        await act(async () => retry!.click())
        expect(fixture.refetch).toHaveBeenCalled()
    })

    it("New Queue is hidden without edit rights", async () => {
        await render()
        expect(buttonLabels()).toContain("New Queue")
        fixture.canEdit = false
        await render()
        expect(buttonLabels()).not.toContain("New Queue")
    })
})
