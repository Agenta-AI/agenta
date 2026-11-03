// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    query: {workspace_id: "ws", project_id: "pr"} as Record<string, string>,
    replace: vi.fn(),
    list: {
        testsets: [] as {id: string; name: string}[],
        isPending: false,
        isError: false,
        refetch: vi.fn(),
        hasMore: false,
        loadMore: vi.fn(),
        isLoadingMore: false,
    },
    allowed: new Set<string>(),
}))

vi.mock("next/router", () => ({
    useRouter: () => ({
        query: state.query,
        pathname: "/w/[workspace_id]/p/[project_id]/testsets",
        isReady: true,
        replace: state.replace,
        push: vi.fn(),
        asPath: "/w/ws/p/pr/testsets",
        back: vi.fn(),
    }),
}))
vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: () => <p data-testid="not-found" />,
}))
vi.mock("@agenta/entities/shared/user", () => ({UserAuthorLabel: () => null}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: vi.fn()}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) => state.allowed.has(action),
}))
vi.mock("@/features/testsets/list/useTestsetsList", () => ({useTestsetsList: () => state.list}))
vi.mock("@/features/testsets/list/useTestsetCommitMessages", () => ({
    useTestsetCommitMessages: () => new Map(),
}))
vi.mock("@/features/testsets/list/useTestsetRowActions", () => ({
    useTestsetRowActions: () => ({
        openLatest: vi.fn(),
        exportTestset: vi.fn(),
        archive: vi.fn(),
        isBusy: () => false,
        isAnyBusy: false,
    }),
}))

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import {TestsetsListScreen} from "@/features/testsets/list/TestsetsListScreen"
import TestsetsPage from "@/pages/w/[workspace_id]/p/[project_id]/testsets/index"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("Testsets list screen", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const mount = (node: ReactNode) =>
        act(() => root.render(<Provider store={store}>{node}</Provider>))

    beforeEach(() => {
        vi.useFakeTimers()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
        store.set(activeUserIdAtom, "u1")
        state.query = {workspace_id: "ws", project_id: "pr"}
        state.replace.mockClear()
        state.allowed = new Set()
        state.list = {...state.list, testsets: [], isError: false, isPending: false}
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        vi.useRealTimers()
    })

    it("Testsets route shows not found while the view is hidden", async () => {
        expect(DEVELOPER_VIEWS.find((view) => view.id === "testsets")?.stage).toBe("hidden")
        await mount(<TestsetsPage />)
        expect(host.querySelector('[data-testid="not-found"]')).not.toBeNull()
        expect(host.textContent).not.toContain("Testsets")
    })

    it("The search term is kept in the URL", async () => {
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" />)
        const input = host.querySelector<HTMLInputElement>('input[aria-label="Search"]')!
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )!.set!
            setter.call(input, "alpha")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        expect(state.replace).not.toHaveBeenCalled()
        await act(async () => void vi.advanceTimersByTime(300))
        expect(state.replace).toHaveBeenCalledWith(
            {
                pathname: "/w/[workspace_id]/p/[project_id]/testsets",
                query: {
                    workspace_id: "ws",
                    project_id: "pr",
                    q: "alpha",
                },
            },
            undefined,
            {shallow: true},
        )
    })

    it("The search box starts from the term in the URL", async () => {
        state.query = {...state.query, q: "beta"}
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" />)
        expect(host.querySelector<HTMLInputElement>('input[aria-label="Search"]')?.value).toBe(
            "beta",
        )
        expect(state.replace).not.toHaveBeenCalled()
    })

    it("A failed load shows Could not load test sets with a retry", async () => {
        state.list = {...state.list, isError: true}
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" />)
        expect(host.textContent).toContain("Could not load test sets")
        expect(host.textContent).not.toContain("No test sets yet")
        const retry = Array.from(host.querySelectorAll("button")).find(
            (b) => b.textContent === "Try again",
        )
        await act(async () => retry?.click())
        expect(state.list.refetch).toHaveBeenCalled()
    })

    it("A failed Load more keeps the rows already loaded", async () => {
        state.list = {...state.list, isError: true, testsets: [{id: "t1", name: "Alpha set"}]}
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" />)
        expect(host.textContent).toContain("Alpha set")
        expect(host.textContent).not.toContain("Could not load test sets")
    })

    it("The search box follows a Back to another term", async () => {
        state.query = {...state.query, q: "beta"}
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" />)
        state.query = {workspace_id: "ws", project_id: "pr"}
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" />)
        await act(async () => void vi.advanceTimersByTime(400))
        expect(host.querySelector<HTMLInputElement>('input[aria-label="Search"]')?.value).toBe("")
        expect(state.replace).not.toHaveBeenCalled()
    })

    it("An empty project says so, and a search with no result offers Clear search", async () => {
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" />)
        expect(host.textContent).toContain("No test sets yet")
        state.query = {...state.query, q: "zeta"}
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" />)
        expect(host.textContent).toContain("No test sets match “zeta”")
    })

    it("Create new testset shows only to a reader who may edit and has a create flow", async () => {
        const onCreate = vi.fn()
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" onCreate={onCreate} />)
        expect(host.textContent).not.toContain("Create new testset")
        state.allowed = new Set(["edit_testsets"])
        await mount(<TestsetsListScreen workspaceId="ws" projectId="pr" onCreate={onCreate} />)
        expect(host.textContent).toContain("Create new testset")
    })
})
