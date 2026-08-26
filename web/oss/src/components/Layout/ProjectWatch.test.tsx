import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
    invalidateQueries: vi.fn(() => Promise.resolve()),
    invalidateSessionListQueries: vi.fn(),
    invalidateWorkflowsListCache: vi.fn(),
    refreshSession: vi.fn(() => Promise.resolve(true)),
}))

vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "/api",
    getHostQueryClient: () => ({invalidateQueries: mocks.invalidateQueries}),
}))

vi.mock("@agenta/shared/state", () => ({
    projectIdAtom: {},
}))

vi.mock("@agenta/entities/session", () => ({
    invalidateSessionListQueries: mocks.invalidateSessionListQueries,
}))

vi.mock("@agenta/entities/workflow", () => ({
    invalidateWorkflowsListCache: mocks.invalidateWorkflowsListCache,
}))

vi.mock("jotai", () => ({
    useAtomValue: () => "project-1",
}))

const sources: FakeEventSource[] = []

class FakeEventSource {
    static readonly CLOSED = 2

    readonly url: string
    readonly withCredentials: boolean
    readyState = 1
    onopen: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    private listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()

    constructor(url: string | URL, options?: EventSourceInit) {
        this.url = String(url)
        this.withCredentials = options?.withCredentials ?? false
        sources.push(this)
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
        if (typeof listener !== "function") return
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener as (event: MessageEvent<string>) => void)
        this.listeners.set(type, listeners)
    }

    close() {
        this.readyState = FakeEventSource.CLOSED
    }

    emit(type: string, data = "{}") {
        const event = new MessageEvent<string>(type, {data})
        for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
}

const originalEventSource = globalThis.EventSource
let root: Root | null = null
let container: HTMLDivElement | null = null

const mountProjectWatch = async () => {
    const {ProjectWatch} = await import("@agenta/sessions/watch")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(<ProjectWatch refreshSession={mocks.refreshSession} />)
    })
    return sources.at(-1)
}

const agentsWorkflowsInvalidated = () =>
    mocks.invalidateQueries.mock.calls.some(([args]) => {
        const predicate = (args as {predicate?: (query: {queryKey: unknown[]}) => boolean})
            .predicate
        return Boolean(predicate?.({queryKey: ["agents-workflows", "project-1", null]}))
    })

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    sources.length = 0
    mocks.invalidateQueries.mockClear()
    mocks.invalidateSessionListQueries.mockClear()
    mocks.invalidateWorkflowsListCache.mockClear()
})

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    container?.remove()
    container = null
    globalThis.EventSource = originalEventSource
})

// The shared `@agenta/sessions/watch` mount, as the desktop wires it. `/m` mounts the same
// component with its own `refreshSession`, so this covers both apps' event mapping.
describe("ProjectWatch", () => {
    // Through the shared helper, not a `["session-list", projectId]` prefix: the sidebar and /m
    // nest the same options behind their own prefix, which a positional match never reaches.
    it("maps session changes to every session-list query", async () => {
        const source = await mountProjectWatch()

        expect(source?.url).toBe("/api/sessions/watch?project_id=project-1")
        expect(source?.withCredentials).toBe(true)

        act(() => {
            source?.emit(
                "session-changed",
                JSON.stringify({type: "session-changed", entity: "session", id: "session-1"}),
            )
        })

        expect(mocks.invalidateSessionListQueries).toHaveBeenCalledOnce()
        expect(mocks.invalidateWorkflowsListCache).not.toHaveBeenCalled()
    })

    it("maps workflow changes to every workflow list, on either host", async () => {
        const source = await mountProjectWatch()

        act(() => {
            source?.emit(
                "workflow-changed",
                JSON.stringify({type: "workflow-changed", entity: "workflow", id: "workflow-1"}),
            )
        })

        // The package keys (`workflows/apps`, `workflows/artifact`) plus the desktop agents
        // table's own `agents-workflows`, which exists on no other host.
        expect(mocks.invalidateWorkflowsListCache).toHaveBeenCalledOnce()
        expect(agentsWorkflowsInvalidated()).toBe(true)
        expect(mocks.invalidateSessionListQueries).not.toHaveBeenCalled()
    })

    it("revalidates both list families when the stream is ready", async () => {
        const source = await mountProjectWatch()

        act(() => {
            source?.emit("ready")
        })

        expect(mocks.invalidateSessionListQueries).toHaveBeenCalledOnce()
        expect(mocks.invalidateWorkflowsListCache).toHaveBeenCalledOnce()
        expect(agentsWorkflowsInvalidated()).toBe(true)
    })
})
