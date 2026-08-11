import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
    invalidateAgentsWorkflowQueries: vi.fn(() => Promise.resolve()),
    invalidateQueries: vi.fn(() => Promise.resolve()),
}))

vi.mock("@agenta/shared/api", () => ({
    queryClient: {invalidateQueries: mocks.invalidateQueries},
}))

vi.mock("@/oss/components/pages/agents/store", () => ({
    invalidateAgentsWorkflowQueries: mocks.invalidateAgentsWorkflowQueries,
}))

vi.mock("@/oss/lib/helpers/api", () => ({
    getAgentaApiUrl: () => "/api",
}))

vi.mock("@/oss/state/project", () => ({
    projectIdAtom: {},
}))

vi.mock("jotai", () => ({
    useAtomValue: () => "project-1",
}))

vi.mock("supertokens-auth-react/recipe/session", () => ({
    default: {attemptRefreshingSession: vi.fn(() => Promise.resolve(true))},
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
    const {default: ProjectWatch} = await import("./ProjectWatch")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(<ProjectWatch />)
    })
    return sources.at(-1)
}

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    sources.length = 0
    mocks.invalidateAgentsWorkflowQueries.mockClear()
    mocks.invalidateQueries.mockClear()
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

describe("ProjectWatch", () => {
    it("maps session changes to the project session-list prefix", async () => {
        const source = await mountProjectWatch()

        expect(source?.url).toBe("/api/sessions/watch?project_id=project-1")
        expect(source?.withCredentials).toBe(true)

        act(() => {
            source?.emit(
                "session-changed",
                JSON.stringify({type: "session-changed", entity: "session", id: "session-1"}),
            )
        })

        expect(mocks.invalidateQueries).toHaveBeenCalledWith({
            queryKey: ["session-list", "project-1"],
            exact: false,
        })
        expect(mocks.invalidateAgentsWorkflowQueries).not.toHaveBeenCalled()
    })

    it("maps workflow changes to the agents list and workflow artifact", async () => {
        const source = await mountProjectWatch()

        act(() => {
            source?.emit(
                "workflow-changed",
                JSON.stringify({
                    type: "workflow-changed",
                    entity: "workflow",
                    id: "workflow-1",
                }),
            )
        })

        expect(mocks.invalidateAgentsWorkflowQueries).toHaveBeenCalledOnce()
        expect(mocks.invalidateQueries).toHaveBeenCalledWith({
            queryKey: ["workflows", "artifact", "workflow-1"],
            exact: false,
        })
    })

    it("revalidates both list families when the stream is ready", async () => {
        const source = await mountProjectWatch()

        act(() => {
            source?.emit("ready")
        })

        expect(mocks.invalidateAgentsWorkflowQueries).toHaveBeenCalledOnce()
        expect(mocks.invalidateQueries).toHaveBeenCalledWith({
            queryKey: ["session-list", "project-1"],
            exact: false,
        })
        expect(mocks.invalidateQueries).toHaveBeenCalledWith({
            queryKey: ["workflows", "artifact"],
            exact: false,
        })
    })
})
