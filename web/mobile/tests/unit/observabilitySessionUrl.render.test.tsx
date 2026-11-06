// @vitest-environment jsdom
/**
 * The open observability session lives in the address bar. The hook is the real one; the router
 * is a fake that records what it is asked to write. The screen is mounted with its chrome and
 * lists stubbed and the drawer replaced by a probe, so the test sees WHEN the screen mounts it
 * and WHAT it hands it.
 */
import {act, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {router, drawerProps} = vi.hoisted(() => ({
    router: {
        pathname: "/w/[workspace_id]/p/[project_id]/observability",
        query: {} as Record<string, string>,
        push: vi.fn(),
        replace: vi.fn(),
    },
    drawerProps: {current: null as null | Record<string, unknown>},
}))

vi.mock("next/router", () => ({default: router, useRouter: () => router}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => false,
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
    ObservabilityToolbar: () => null,
}))
// Renders the tabs the screen declares, so a test can switch between them.
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
                    {`tab-${item.key}`}
                </button>
            ))}
            {children}
        </>
    ),
}))
vi.mock("@agenta/ui/hooks", () => ({useIsNarrowScreen: () => false}))
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
    SessionsTable: ({onOpenSession}: {onOpenSession: (id: string) => void}) => (
        <button onClick={() => onOpenSession("session-b")}>open session-b</button>
    ),
}))
vi.mock("@/features/observability/TracesFilters", () => ({TracesFilters: () => null}))
vi.mock("@/features/observability/TracesList", () => ({TracesList: () => null}))
vi.mock("@/features/observability/TracesTable", () => ({TracesTable: () => null}))
vi.mock("@/features/observability/useTracesExportBinding", () => ({
    useTracesExportBinding: () => ({onExport: vi.fn(), isExporting: false}),
}))
vi.mock("@/features/observability/sessionDrawer/ObservabilitySessionDrawer", () => ({
    default: (props: {sessionId: string | null}) => {
        drawerProps.current = props
        return <div data-testid="drawer">{String(props.sessionId)}</div>
    },
}))

import {ObservabilityScreen} from "@/features/observability/ObservabilityScreen"

/** Retries an assertion, flushing React between tries so updates land inside `act`. */
const until = async (assertion: () => void) => {
    const deadline = Date.now() + 2000
    for (;;) {
        try {
            return assertion()
        } catch (error) {
            if (Date.now() > deadline) throw error
            await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
        }
    }
}

describe("observability session URL", () => {
    let root: Root
    let host: HTMLDivElement

    const render = () =>
        act(() =>
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <Provider store={createStore()}>
                        <ObservabilityScreen workspaceId="ws" projectId="pr" />
                    </Provider>
                </QueryClientProvider>,
            ),
        )
    const button = (label: string) =>
        [...document.querySelectorAll("button")].find((b) => b.textContent === label)
    const click = async (label: string) => {
        await act(async () => button(label)?.click())
    }
    const drawer = () => document.querySelector("[data-testid='drawer']")?.textContent

    beforeEach(() => {
        router.query = {workspace_id: "ws", project_id: "pr"}
        router.push.mockReset()
        router.replace.mockReset()
        drawerProps.current = null
        window.history.replaceState(null, "", "/observability")
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Clicking a session row writes session to the URL and keeps app", async () => {
        router.query = {workspace_id: "ws", project_id: "pr", app: "app-1", span: "old-span"}
        window.history.replaceState(null, "", "/observability?app=app-1&trace=t1&span=old-span")
        render()
        await click("tab-sessions")
        await click("open session-b")

        expect(router.push).toHaveBeenCalledTimes(1)
        expect(router.push).toHaveBeenCalledWith(
            {
                pathname: router.pathname,
                query: {
                    workspace_id: "ws",
                    project_id: "pr",
                    app: "app-1",
                    trace: "t1",
                    session: "session-b",
                },
            },
            undefined,
            {shallow: true},
        )
    })

    it("The drawer is not loaded until a session is open", async () => {
        render()
        expect(drawer()).toBeUndefined()
    })

    it("A link with session opens the drawer host with the session", async () => {
        router.query = {workspace_id: "ws", project_id: "pr", session: "session-a", span: "span-1"}
        render()
        await until(() => expect(drawer()).toBe("session-a"))
    })

    it("Switching tabs keeps the drawer tied to the URL", async () => {
        router.query = {workspace_id: "ws", project_id: "pr", session: "session-a"}
        render()
        await until(() => expect(drawer()).toContain("session-a"))
        await click("tab-traces")
        expect(drawer()).toContain("session-a")
        await click("tab-sessions")
        expect(drawer()).toContain("session-a")
    })

    it("Closing the URL slides the drawer out instead of unmounting it", async () => {
        router.query = {workspace_id: "ws", project_id: "pr", session: "session-a"}
        render()
        await until(() => expect(drawer()).toContain("session-a"))
        router.query = {workspace_id: "ws", project_id: "pr"}
        render()
        expect(drawer()).toContain("null")
    })
})
