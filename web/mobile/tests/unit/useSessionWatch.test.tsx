// @vitest-environment jsdom
import {act} from "react"

import {QueryClient, QueryClientProvider, type InvalidateQueryFilters} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@/lib/auth", () => ({tryRefreshSession: async () => undefined}))
vi.mock("@/lib/env", () => ({getApiUrl: () => "http://api.test"}))
vi.mock("@/features/chat/useSessionHeader", () => ({recheckSessionHeader: async () => undefined}))

import {useSessionWatch} from "@/features/chat/useSessionWatch"
import {livenessQueryKey} from "@/features/sessions/useLivenessPoll"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

class FakeEventSource {
    static CLOSED = 2
    static last: FakeEventSource | null = null
    readyState = 1
    onopen: (() => void) | null = null
    onerror: (() => void) | null = null
    private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>()
    constructor() {
        FakeEventSource.last = this
    }
    addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }
    close() {
        this.listeners.clear()
    }
    emit(type: string, data = "{}") {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(new MessageEvent(type, {data}))
        }
    }
}

const PROJECT = "project-1"
let root: Root
let client: QueryClient
let recordsCalls: number[]
let interactionPayloads: string[]
let invalidatedKeys: unknown[]

const Probe = ({sharedReaderAdvertised}: {sharedReaderAdvertised?: boolean}) => {
    useSessionWatch({
        sessionId: "session-1",
        projectId: PROJECT,
        onRecordsChanged: () => recordsCalls.push(Date.now()),
        onInteractionChanged: (event) => interactionPayloads.push(event.data),
        sharedReaderAdvertised,
    })
    return null
}

const livenessInvalidations = () =>
    invalidatedKeys.filter(
        (key) => JSON.stringify(key) === JSON.stringify(livenessQueryKey(PROJECT)),
    ).length

const emitEvery = async (type: string, count: number, gapMs: number) => {
    for (let i = 0; i < count; i++) {
        FakeEventSource.last?.emit(type, `{"n":${i}}`)
        await act(async () => vi.advanceTimersByTime(gapMs))
    }
}

beforeEach(async () => {
    vi.useFakeTimers({now: 0})
    vi.stubGlobal("EventSource", FakeEventSource)
    Object.defineProperty(document, "visibilityState", {configurable: true, value: "visible"})
    recordsCalls = []
    interactionPayloads = []
    invalidatedKeys = []
    client = new QueryClient()
    const invalidate = client.invalidateQueries.bind(client)
    client.invalidateQueries = ((filters?: InvalidateQueryFilters) => {
        invalidatedKeys.push(filters?.queryKey)
        return invalidate(filters)
    }) as typeof client.invalidateQueries
    root = createRoot(document.createElement("div"))
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <Probe />
            </QueryClientProvider>,
        ),
    )
})

afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe("useSessionWatch on connect", () => {
    const railKey = ["sidebar-sessions", PROJECT, [], "all", "7d", "chat", null]
    const railInvalidated = () => client.getQueryState(railKey)?.isInvalidated

    it("leaves a rail read moments ago alone, as the second stream of a switch does", async () => {
        client.setQueryData(railKey, [])
        await act(async () => vi.advanceTimersByTime(1_000))

        FakeEventSource.last?.emit("ready")

        expect(railInvalidated()).toBe(false)
    })

    it("re-reads an older rail, which the gap in the stream may have outdated", async () => {
        client.setQueryData(railKey, [])
        await act(async () => vi.advanceTimersByTime(3_000))

        FakeEventSource.last?.emit("ready")

        expect(railInvalidated()).toBe(true)
    })

    it("still re-reads a rail read moments ago when a lifecycle event says it moved", async () => {
        client.setQueryData(railKey, [])
        await act(async () => vi.advanceTimersByTime(1_000))

        FakeEventSource.last?.emit("lifecycle")

        expect(railInvalidated()).toBe(true)
    })

    it("keeps one stream when the shared-reader prop lands after the session row", async () => {
        const stream = FakeEventSource.last

        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <Probe sharedReaderAdvertised={false} />
                </QueryClientProvider>,
            ),
        )

        expect(FakeEventSource.last).toBe(stream)
    })
})

describe("useSessionWatch coalescing", () => {
    it("collapses 10 records-changed events in 200 ms into a leading and a trailing call", async () => {
        await emitEvery("records-changed", 10, 20)
        await act(async () => vi.advanceTimersByTime(2_000))

        expect(recordsCalls).toEqual([0, 500])
    })

    it("runs a trailing call after an event that lands inside the window", async () => {
        FakeEventSource.last?.emit("records-changed")
        await act(async () => vi.advanceTimersByTime(300))
        FakeEventSource.last?.emit("records-changed")
        await act(async () => vi.advanceTimersByTime(2_000))

        expect(recordsCalls).toEqual([0, 500])
    })

    it("collapses a burst of lifecycle events into two badge invalidations", async () => {
        await emitEvery("lifecycle", 10, 20)
        await act(async () => vi.advanceTimersByTime(2_000))

        expect(livenessInvalidations()).toBe(2)
    })

    it("hands every interaction event to onInteractionChanged", async () => {
        await emitEvery("interaction", 3, 20)
        await act(async () => vi.advanceTimersByTime(2_000))

        expect(interactionPayloads).toEqual(['{"n":0}', '{"n":1}', '{"n":2}'])
        expect(livenessInvalidations()).toBe(2)
    })

    it("drops the pending trailing call on unmount", async () => {
        await emitEvery("records-changed", 3, 20)
        await emitEvery("lifecycle", 3, 20)
        act(() => root.unmount())
        root = createRoot(document.createElement("div"))
        await act(async () => vi.advanceTimersByTime(2_000))

        expect(recordsCalls).toEqual([0])
        expect(livenessInvalidations()).toBe(1)
    })
})
