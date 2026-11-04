// @vitest-environment jsdom
/**
 * The traces table selects rows by span id. Delete and "Add selected to queue" act on traces, so
 * they must send the trace ids of the selected spans. The Delete button, the delete dialog, the
 * Add menu, the queue picker, the selection atom and the queue save atom are the real package
 * code; the requests are faked at the Fern traces client and at axios. The table, the rest of the
 * toolbar and the traces rows are stubs.
 */
import {act, type ReactNode} from "react"

import {axios} from "@agenta/shared/api"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
// The queue picker is an antd Popover, which measures itself.
globalThis.ResizeObserver ??= class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
} as unknown as typeof ResizeObserver

const {router, deleteTrace, fetchTraces, TRACES} = vi.hoisted(() => ({
    router: {
        pathname: "/w/[workspace_id]/p/[project_id]/observability",
        query: {workspace_id: "ws", project_id: "pr"} as Record<string, string>,
        replace: vi.fn(),
    },
    deleteTrace: vi.fn(),
    fetchTraces: vi.fn(),
    // One trace with a child span, and a second trace. Rows are keyed by span id.
    TRACES: [
        {
            trace_id: "trace-a",
            span_id: "span-a-root",
            children: [{trace_id: "trace-a", span_id: "span-a-child"}],
        },
        {trace_id: "trace-b", span_id: "span-b-root"},
    ],
}))

vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getTracesClient: () => ({deleteTrace}),
}))
vi.mock("next/router", () => ({default: {push: vi.fn()}, useRouter: () => router}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => false,
    canDeveloperViewBeEnabled: () => false,
}))
vi.mock("@agenta/observability", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/observability")>()
    const {useAtom} = await import("jotai")
    return {
        ...actual,
        // The rows are fixed; the selection is the real shared atom the toolbar reads.
        useObservability: () => {
            const [selectedRowKeys, setSelectedRowKeys] = useAtom(actual.selectedRowKeysAtom)
            return {
                fetchTraces,
                traces: TRACES,
                setSelectedTraceId: vi.fn(),
                selectedRowKeys,
                setSelectedRowKeys,
            }
        },
        useSessions: () => ({refetchSessions: vi.fn()}),
    }
})
vi.mock("@agenta/observability-ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/observability-ui")>()
    return {
        ...actual,
        ObservabilityRangePicker: () => null,
        ObservabilityToolbar: ({
            onDelete,
            actionsSlot,
        }: {
            onDelete?: () => void
            actionsSlot?: ReactNode
        }) => (
            <div>
                {onDelete ? <actual.DeleteTracesButton onClick={onDelete} /> : null}
                {actionsSlot}
            </div>
        ),
    }
})
vi.mock("@agenta/ui", () => ({PageLayout: ({children}: {children: ReactNode}) => <>{children}</>}))
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
vi.mock("@/features/observability/SessionsTable", () => ({SessionsTable: () => null}))
vi.mock("@/features/observability/TracesFilters", () => ({TracesFilters: () => null}))
vi.mock("@/features/observability/TracesList", () => ({TracesList: () => null}))
vi.mock("@/features/observability/useTracesExportBinding", () => ({
    useTracesExportBinding: () => ({onExport: vi.fn(), isExporting: false}),
}))
// The table keys its rows by span id (`ObservabilityTracesTable` rowKey).
vi.mock("@/features/observability/TracesTable", () => ({
    TracesTable: ({
        selectedRowKeys,
        onSelectionChange,
    }: {
        selectedRowKeys: string[]
        onSelectionChange: (keys: string[]) => void
    }) => (
        <div>
            <span data-testid="selected">{selectedRowKeys.length}</span>
            <button
                onClick={() => onSelectionChange(["span-a-root", "span-a-child", "span-b-root"])}
            >
                Select spans
            </button>
        </div>
    ),
}))

import {ObservabilityScreen} from "@/features/observability/ObservabilityScreen"
import {queryClient} from "@/lib/queryClient"

describe("ObservabilityScreen selection actions", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const button = (label: string) =>
        [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)
    const click = async (label: string, {wait = false} = {}) => {
        const target = wait
            ? await vi.waitFor(() => {
                  const found = [...document.querySelectorAll("button")].find((b) =>
                      b.textContent?.includes(label),
                  )
                  expect(found).toBeDefined()
                  return found
              })
            : button(label)
        expect(target, `button "${label}"`).toBeDefined()
        await act(async () => {
            target?.click()
        })
    }
    const selected = () => host.querySelector("[data-testid='selected']")?.textContent

    beforeEach(() => {
        deleteTrace.mockReset().mockResolvedValue({count: 1, trace_id: "x"})
        fetchTraces.mockReset()
        store = createStore()
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, "pr")
        store.set(sessionAtom, true)
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        act(() =>
            root.render(
                <QueryClientProvider client={queryClient}>
                    <Provider store={store}>
                        <ObservabilityScreen workspaceId="ws" projectId="pr" />
                    </Provider>
                </QueryClientProvider>,
            ),
        )
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        vi.restoreAllMocks()
    })

    it("Delete sends one request per selected trace, by trace id, then clears the selection", async () => {
        await click("Select spans")
        const deleteButton = document.querySelector<HTMLButtonElement>(
            "button[aria-label='Delete selected traces']",
        )
        expect(deleteButton?.disabled).toBe(false)
        await act(async () => deleteButton?.click())

        expect(document.body.textContent).toContain("Are you sure you want to delete 2 traces?")
        const confirm = [...document.querySelectorAll("[role='alertdialog'] button")].find(
            (b) => b.textContent?.trim() === "Delete",
        ) as HTMLButtonElement | undefined
        expect(confirm).toBeDefined()
        await act(async () => confirm?.click())

        expect(deleteTrace.mock.calls).toEqual([
            [{trace_id: "trace-a"}, {queryParams: {project_id: "pr"}, abortSignal: undefined}],
            [{trace_id: "trace-b"}, {queryParams: {project_id: "pr"}, abortSignal: undefined}],
        ])
        expect(selected()).toBe("0")
    })

    it("Add selected to queue sends the trace ids, counts traces, then clears the selection", async () => {
        const queue = {id: "queue-1", run_id: "run-1", name: "Review queue", data: {kind: "traces"}}
        const post = vi
            .spyOn(axios, "post")
            .mockImplementation(async (url: string) =>
                url.endsWith("/simple/queues/query")
                    ? {data: {count: 1, queues: [queue]}}
                    : {data: {count: 2, queue_id: "queue-1"}},
            )

        await click("Select spans")
        // The menu sits inside the queue picker, which the package loads with `next/dynamic`.
        const addButton = await vi.waitFor(() => {
            const found = document.querySelector<HTMLButtonElement>("button[aria-label='Add']")
            expect(found).not.toBeNull()
            return found
        }, 20_000)
        await act(async () => {
            addButton?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
        const item = await vi.waitFor(() => {
            const found = [...document.querySelectorAll("[role='menuitem']")].find(
                (el) => el.textContent?.trim() === "Add 2 selected to queue",
            )
            expect(found).toBeDefined()
            return found as HTMLElement
        })
        await act(async () => item.click())
        await click("Review queue", {wait: true})

        const adds = post.mock.calls.filter(([url]) => String(url).includes("/traces/"))
        expect(adds).toHaveLength(1)
        const [url, body, config] = adds[0]
        expect(url).toMatch(/\/simple\/queues\/queue-1\/traces\/$/)
        expect(body).toEqual({trace_ids: ["trace-a", "trace-b"]})
        expect(config).toEqual({params: {project_id: "pr"}})
        expect(selected()).toBe("0")
    }, 30_000)
})
