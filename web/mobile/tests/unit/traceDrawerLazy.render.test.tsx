// @vitest-environment jsdom
/**
 * The trace drawer's body and its drill-in panels load on demand, not with the app shell. These
 * tests open the drawer from real entry points and check that it still arrives: a loading panel
 * first, then the drawer with the slots the shell registered, and the authors' names.
 */
import {act} from "react"

import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import {workspaceMembersAtom} from "@agenta/entities/organization"
import {activeUserIdAtom, playgroundInspectorEnabledAtom, projectIdAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {GlobalDrawers} from "@/features/app/GlobalDrawers"
import {TurnRow} from "@/features/chat/TurnRow"
import {TracesList} from "@/features/observability/TracesList"

import {WithQueryClient} from "../support/queryClient"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const loaded = vi.hoisted(() => ({spanPanel: false}))

const span = vi.hoisted(() => ({
    key: "span-1",
    trace_id: "trace-1",
    span_id: "span-1",
    span_name: "chat",
    span_type: "llm",
    start_time: "2026-09-26T10:00:00Z",
    end_time: "2026-09-26T10:00:02Z",
    attributes: {ag: {data: {inputs: {question: "What is the capital of Peru?"}}}},
}))

vi.mock("next/router", () => {
    const router = {
        pathname: "/w/[workspace_id]/p/[project_id]/observability",
        query: {workspace_id: "ws-1", project_id: "proj-1"},
        asPath: "/",
        basePath: "",
        push: vi.fn(async () => true),
    }
    return {useRouter: () => router}
})
vi.mock("@agenta/entities/access", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/access")>()),
        canViewSpansAtom: atom(() => true),
    }
})
// The drawer's data comes over HTTP; these return one span so the drawer has a trace to show.
vi.mock("@agenta/entities/trace", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/trace")>()),
    fetchPreviewTrace: async () => ({traces: {}}),
    transformTracesResponseToTree: (value: unknown) => value,
    transformTracingResponse: () => [span],
}))
vi.mock("@agenta/entities/annotation/dto", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/annotation/dto")>()),
    queryAllAnnotations: async () => ({annotations: []}),
}))
vi.mock("@agenta/entities/project", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/project")>()),
    fetchAllProjects: async () => [{organization_id: "org-1", workspace_id: "ws-1"}],
}))
vi.mock("@agenta/entities/organization", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/organization")>()),
    fetchSingleOrg: async () => ({
        default_workspace: {members: [{user: {id: "user-1", username: "Alex"}}]},
    }),
}))
// The traces list and the drawer read the packaged list hook; one span, no fetching.
vi.mock("@agenta/observability", async (importOriginal) => {
    // One object for every call, as the real hook returns stable values between renders.
    const result = {
        traces: [span],
        isLoading: false,
        isFetchingMore: false,
        hasMoreTraces: false,
        fetchMoreTraces: vi.fn(),
        isRateLimited: false,
        rateLimitMessage: null,
        filters: [],
        setFilters: vi.fn(),
        fetchTraces: vi.fn(),
        traceTabs: "trace",
        sort: {},
        limit: 50,
        setSelectedTraceId: vi.fn(),
        setSelectedNode: vi.fn(),
    }
    return {
        ...(await importOriginal<typeof import("@agenta/observability")>()),
        useObservability: () => result,
    }
})
// Records whether the drill-in panel module was loaded, without changing what it renders.
vi.mock("@/features/observability/TraceSpanPanel", async (importOriginal) => {
    loaded.spanPanel = true
    return importOriginal()
})
// The shell's add-to-queue picker, marked so the test can tell it from the package default.
vi.mock("@/features/annotations/AddToQueuePicker", () => ({
    default: ({children}: {children: React.ReactNode}) => (
        <div data-testid="m-add-to-queue">{children}</div>
    ),
}))

let host: HTMLDivElement | undefined
let root: Root | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
    document.body.innerHTML = ""
})

vi.setConfig({testTimeout: 30_000})

const render = async (node: React.ReactNode) => {
    const store = createStore()
    store.set(projectIdAtom, "proj-1")
    store.set(activeUserIdAtom, "qa-user")
    store.set(playgroundInspectorEnabledAtom, true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
        root!.render(
            <WithQueryClient>
                <Provider store={store}>
                    {node}
                    <GlobalDrawers />
                </Provider>
            </WithQueryClient>,
        )
    })
    return store
}

const drawerPanel = () => document.querySelector('[data-tour="trace-drawer"]')
const loadingPanel = () => document.querySelector('[aria-label="Loading trace"]')

/** Notes whether the loading panel was ever on screen, however briefly. */
const watchLoadingPanel = () => {
    const seen = {loading: false}
    const observer = new MutationObserver(() => {
        if (loadingPanel()) seen.loading = true
    })
    observer.observe(document.body, {childList: true, subtree: true})
    return {seen, stop: () => observer.disconnect()}
}

/**
 * Opens the drawer and waits for its body. The body's code loads once per page, so only the
 * first open in this file shows the loading panel; later opens get the body at once.
 */
const openAndExpectDrawer = async (open: () => void, {firstOpen}: {firstOpen: boolean}) => {
    const watch = watchLoadingPanel()
    await act(async () => open())
    await vi.waitFor(() => expect(drawerPanel()).not.toBeNull(), {timeout: 10_000})
    watch.stop()
    expect(watch.seen.loading).toBe(firstOpen)
    expect(loadingPanel()).toBeNull()
}

describe("the trace drawer loads on demand", () => {
    it("the app shell loads without the drill-in panel code", () => {
        // GlobalDrawers, TurnRow and TracesList are imported above: none of them pulls it in.
        expect(loaded.spanPanel).toBe(false)
    })

    it("opens from a chat turn's View trace action", async () => {
        const message = {
            id: "assistant-1",
            role: "assistant",
            parts: [{type: "text", text: "Done"}],
            metadata: {traceId: "trace-1"},
        } as UIMessage
        const [turn] = buildTurnViewModels([message], {
            busy: false,
            executedFor: createExecutedToolIdentityCache(),
        })
        await render(<TurnRow turn={turn} sessionId="session-1" />)
        expect(drawerPanel()).toBeNull()

        const viewTrace = document.querySelector<HTMLElement>('[aria-label="View trace"]')
        await openAndExpectDrawer(() => viewTrace!.click(), {firstOpen: true})
    })

    it("opens from a row of the traces list, with the shell's slots and the authors' names", async () => {
        const store = await render(<TracesListWithRow />)

        const row = document.querySelector<HTMLElement>('[data-testid="trace-row"] [role="button"]')
        await openAndExpectDrawer(() => row!.click(), {firstOpen: false})
        // The add-to-queue slot was registered by the shell, before the drawer chunk existed.
        await vi.waitFor(() =>
            expect(document.querySelector('[data-testid="m-add-to-queue"]')).not.toBeNull(),
        )
        // Nothing in this test binds a member list: the drawer does it when it opens.
        await vi.waitFor(() =>
            expect(store.get(workspaceMembersAtom).map((m) => m.user.username)).toEqual(["Alex"]),
        )
        // The overview panel is the drill-in slot, loaded now that a span is on screen.
        await vi.waitFor(() =>
            expect(document.body.textContent).toContain("What is the capital of Peru?"),
        )
        expect(loaded.spanPanel).toBe(true)
    })
})

/** The real traces list, fed one span through the packaged list hook. */
const TracesListWithRow = () => (
    <div data-testid="trace-row">
        <TracesList />
    </div>
)
