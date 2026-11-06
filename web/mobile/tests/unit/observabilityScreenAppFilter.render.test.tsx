// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {observabilityScopeAtom} from "@agenta/observability"
import {QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {router, viewEnabled, fetchTraces, fetchAnnotations, permissions} = vi.hoisted(() => ({
    fetchTraces: vi.fn(async () => undefined),
    fetchAnnotations: vi.fn(async () => undefined),
    permissions: {current: {} as Record<string, boolean>},
    router: {
        pathname: "/w/[workspace_id]/p/[project_id]/observability",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
    viewEnabled: {current: false as boolean | null},
}))

vi.mock("next/router", () => ({useRouter: () => router}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => viewEnabled.current,
}))
vi.mock("@agenta/observability", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/observability")>()),
    useObservability: () => ({
        fetchTraces,
        fetchAnnotations,
        traces: [],
        selectedRowKeys: [],
        setSelectedRowKeys: vi.fn(),
        filters: [],
        traceTabs: "trace",
    }),
    useSessions: () => ({refetchSessions: vi.fn()}),
}))
vi.mock("@agenta/observability-ui", () => ({
    useAutoRefresh: (refresh: () => Promise<void>) => ({refresh, refreshTrigger: 0}),
    ObservabilityRangePicker: () => null,
    AddActionsDropdown: () => null,
    DeleteTraceModal: () => null,
    deleteTraceModalAtom: {},
    ObservabilityToolbar: ({
        filtersSlot,
        onRefresh,
        onExport,
    }: {
        filtersSlot?: ReactNode
        onRefresh: () => Promise<void>
        onExport?: () => void
    }) => (
        <div>
            <button onClick={() => void onRefresh()}>refresh</button>
            {onExport ? <button onClick={onExport}>export</button> : null}
            {filtersSlot}
        </div>
    ),
}))
vi.mock("@agenta/ui", () => ({
    PageLayout: ({
        children,
        headerTabsProps,
    }: {
        children: ReactNode
        headerTabsProps: {items: {key: string}[]; onChange: (key: string) => void}
    }) => (
        <>
            {headerTabsProps.items.map((item) => (
                <button key={item.key} onClick={() => headerTabsProps.onChange(item.key)}>
                    {`tab ${item.key}`}
                </button>
            ))}
            {children}
        </>
    ),
}))
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
    useProjectPermission: () => true,
    useProjectPermissionState: () => ({pending: false, allowed: true}),
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => <>{children}</>,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/observability/SessionsList", () => ({SessionsList: () => null}))
vi.mock("@/features/observability/SessionsTable", () => ({
    SessionsTable: () => <div>sessions table</div>,
}))
vi.mock("@/features/observability/TracesFilters", () => ({TracesFilters: () => null}))
vi.mock("@/features/observability/TracesList", () => ({TracesList: () => null}))
vi.mock("@/features/observability/TracesTable", () => ({TracesTable: () => null}))
vi.mock("@/features/observability/useTracesExportBinding", () => ({
    useTracesExportBinding: () => ({
        onExport: vi.fn(),
        isExporting: false,
        canExportData: permissions.current.export !== false,
    }),
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
import {queryClient} from "@/lib/queryClient"

describe("ObservabilityScreen app filter", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const mount = () =>
        act(() =>
            root.render(
                <QueryClientProvider client={queryClient}>
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
        window.history.replaceState(null, "", "/")
        store = createStore()
        store.set(queryClientAtom, queryClient)
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

    it("Refresh reloads the annotations with the traces", async () => {
        fetchTraces.mockClear()
        fetchAnnotations.mockClear()
        mount()
        await click("refresh")
        expect(fetchTraces).toHaveBeenCalledTimes(1)
        expect(fetchAnnotations).toHaveBeenCalledTimes(1)
    })

    it("Export shows only to a role that may export data", () => {
        permissions.current = {export: false}
        mount()
        expect(host.textContent).not.toContain("export")
        act(() => root.unmount())
        root = createRoot(host)
        permissions.current = {}
        mount()
        expect(host.textContent).toContain("export")
    })

    it("The Sessions tab is kept in the URL", async () => {
        mount()
        expect(host.textContent).not.toContain("sessions table")
        await click("tab sessions")
        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: router.pathname,
                query: {workspace_id: "ws", project_id: "pr", tab: "sessions"},
            },
            undefined,
            {shallow: true},
        )

        // A reload or a link with the param opens Sessions.
        act(() => root.unmount())
        root = createRoot(host)
        router.query = {...router.query, tab: "sessions"}
        mount()
        expect(host.textContent).toContain("sessions table")
    })
})
