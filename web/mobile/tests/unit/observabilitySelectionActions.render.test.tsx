// @vitest-environment jsdom
/**
 * The traces table selects rows by span id. Delete and "Add selected to queue" act on traces, so
 * they must send the trace ids of the selected spans. Only HTTP is faked: the Fern traces client
 * for delete and axios for the queue add. The delete dialog and the queue save atom are real.
 */
import {act, type ReactNode} from "react"

import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {axios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore, Provider, useSetAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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
vi.mock("@agenta/observability", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/observability")>()),
    useObservability: () => ({fetchTraces, traces: TRACES, setSelectedTraceId: vi.fn()}),
    useSessions: () => ({refetchSessions: vi.fn()}),
}))
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
                <button onClick={onDelete}>Delete selected</button>
                {actionsSlot}
            </div>
        ),
        // The package popover calls this same save atom with `itemIds`, then `onItemsAdded`.
        AddActionsDropdown: ({
            queueAction,
        }: {
            queueAction: {itemIds: string[]; label: string; onItemsAdded?: () => void}
        }) => {
            const addTraces = useSetAtom(simpleQueueMolecule.actions.addTraces)
            return (
                <button
                    onClick={async () => {
                        await addTraces("queue-1", queueAction.itemIds)
                        queueAction.onItemsAdded?.()
                    }}
                >
                    {queueAction.label}
                </button>
            )
        },
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

describe("ObservabilityScreen selection actions", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const button = (label: string) =>
        [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)
    const click = async (label: string) => {
        const target = button(label)
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
        store.set(projectIdAtom, "pr")
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        act(() =>
            root.render(
                <Provider store={store}>
                    <ObservabilityScreen workspaceId="ws" projectId="pr" />
                </Provider>,
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
        await click("Delete selected")

        expect(document.body.textContent).toContain("Are you sure you want to delete 2 traces?")
        await click("Delete")

        expect(deleteTrace.mock.calls).toEqual([
            [{trace_id: "trace-a"}, {queryParams: {project_id: "pr"}, abortSignal: undefined}],
            [{trace_id: "trace-b"}, {queryParams: {project_id: "pr"}, abortSignal: undefined}],
        ])
        expect(selected()).toBe("0")
    })

    it("Add selected to queue sends the trace ids, counts traces, then clears the selection", async () => {
        const post = vi
            .spyOn(axios, "post")
            .mockResolvedValue({data: {count: 2, queue_id: "queue-1"}})

        await click("Select spans")
        await click("Add 2 selected to queue")

        expect(post).toHaveBeenCalledTimes(1)
        const [url, body, config] = post.mock.calls[0]
        expect(url).toMatch(/\/simple\/queues\/queue-1\/traces\/$/)
        expect(body).toEqual({trace_ids: ["trace-a", "trace-b"]})
        expect(config).toEqual({params: {project_id: "pr"}})
        expect(selected()).toBe("0")
    })
})
