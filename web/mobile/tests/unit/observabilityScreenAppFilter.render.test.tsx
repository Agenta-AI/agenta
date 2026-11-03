// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {observabilityScopeAtom} from "@agenta/observability"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {router, viewEnabled, canEnable} = vi.hoisted(() => ({
    router: {
        pathname: "/w/[workspace_id]/p/[project_id]/observability",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
    viewEnabled: {current: false as boolean | null},
    canEnable: {current: true},
}))

vi.mock("next/router", () => ({useRouter: () => router}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => viewEnabled.current,
    canDeveloperViewBeEnabled: () => canEnable.current,
}))
vi.mock("@agenta/observability", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/observability")>()),
    useObservability: () => ({
        fetchTraces: vi.fn(),
        traces: [],
        selectedRowKeys: [],
        setSelectedRowKeys: vi.fn(),
    }),
    useSessions: () => ({refetchSessions: vi.fn()}),
}))
vi.mock("@agenta/observability-ui", () => ({
    ObservabilityRangePicker: () => null,
    AddActionsDropdown: () => null,
    DeleteTraceModal: () => null,
    deleteTraceModalAtom: {},
    ObservabilityToolbar: ({filtersSlot}: {filtersSlot?: ReactNode}) => <div>{filtersSlot}</div>,
}))
vi.mock("@agenta/ui", () => ({PageLayout: ({children}: {children: ReactNode}) => <>{children}</>}))
vi.mock("@agenta/ui/hooks", () => ({useIsNarrowScreen: () => false}))
vi.mock("jotai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("jotai")>()
    return {...actual, useSetAtom: () => vi.fn()}
})
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({children}: {children: ReactNode}) => <>{children}</>,
}))
vi.mock("@/lib/context", () => ({projectHomeUrl: () => "/home"}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: vi.fn()}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermissionState: () => ({pending: false, allowed: true}),
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => <>{children}</>,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/observability/SessionsList", () => ({SessionsList: () => null}))
vi.mock("@/features/observability/SessionsTable", () => ({SessionsTable: () => null}))
vi.mock("@/features/observability/TracesFilters", () => ({TracesFilters: () => null}))
vi.mock("@/features/observability/TracesList", () => ({TracesList: () => null}))
vi.mock("@/features/observability/TracesTable", () => ({TracesTable: () => null}))
vi.mock("@/features/observability/useTracesExportBinding", () => ({
    useTracesExportBinding: () => ({onExport: vi.fn(), isExporting: false}),
}))
vi.mock("@/features/observability/ObservabilityAppFilter", () => ({
    ObservabilityAppFilter: ({
        value,
        onChange,
    }: {
        value: string | null
        onChange: (appId: string | null) => void
    }) => (
        <div data-testid="app-filter" data-value={value ?? ""}>
            <button onClick={() => onChange("app-1")}>pick</button>
            <button onClick={() => onChange(null)}>all</button>
        </div>
    ),
}))

import {ObservabilityScreen} from "@/features/observability/ObservabilityScreen"

describe("ObservabilityScreen app filter", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const mount = () =>
        act(() =>
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <Provider store={store}>
                        <ObservabilityScreen workspaceId="ws" projectId="pr" />
                    </Provider>
                </QueryClientProvider>,
            ),
        )
    const click = (label: string) =>
        act(() => {
            ;[...host.querySelectorAll("button")]
                .find((button) => button.textContent === label)
                ?.click()
        })

    beforeEach(() => {
        router.query = {workspace_id: "ws", project_id: "pr"}
        router.replace.mockClear()
        viewEnabled.current = true
        canEnable.current = true
        window.history.replaceState(null, "", "/")
        store = createStore()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("With the view hidden the toolbar has no app picker", () => {
        viewEnabled.current = false
        router.query = {...router.query, app: "app-1"}
        mount()

        expect(host.querySelector("[data-testid='app-filter']")).toBeNull()
        // `?app=` is ignored: the scope stays project wide.
        expect(store.get(observabilityScopeAtom)).toEqual({appId: null, routeAppId: null})
    })

    it("With the user not yet known the toolbar has no app picker", () => {
        viewEnabled.current = null
        mount()

        expect(host.querySelector("[data-testid='app-filter']")).toBeNull()
    })

    it("A link with an app waits for the view answer before it renders the content", () => {
        viewEnabled.current = null
        router.query = {...router.query, app: "app-1"}
        mount()

        expect(host.innerHTML).toBe("")
        expect(store.get(observabilityScopeAtom)).toEqual({appId: null, routeAppId: null})
    })

    it("A view that cannot be on renders the content at once, without waiting for the user", () => {
        viewEnabled.current = null
        canEnable.current = false
        router.query = {...router.query, app: "app-1"}
        mount()

        expect(host.innerHTML).not.toBe("")
        expect(store.get(observabilityScopeAtom)).toEqual({appId: null, routeAppId: null})
    })

    it("Choosing an app writes app to the URL and keeps the trace param", () => {
        window.history.replaceState(null, "", "/?trace=t1")
        mount()
        click("pick")

        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: router.pathname,
                query: {trace: "t1", app: "app-1", workspace_id: "ws", project_id: "pr"},
            },
            undefined,
            {shallow: true},
        )
    })

    it("Choosing All apps removes app from the URL", () => {
        window.history.replaceState(null, "", "/?trace=t1&app=app-1")
        router.query = {...router.query, app: "app-1"}
        mount()
        click("all")

        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: router.pathname,
                query: {trace: "t1", workspace_id: "ws", project_id: "pr"},
            },
            undefined,
            {shallow: true},
        )
    })

    it("An app in the URL scopes the queries while the view is on", () => {
        router.query = {...router.query, app: "app-1"}
        mount()

        expect(store.get(observabilityScopeAtom)).toEqual({appId: "app-1", routeAppId: "app-1"})
    })
})
