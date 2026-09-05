import {createElement, type ReactNode} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {act, renderHook, waitFor} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
    fetchSessionSnapshot: vi.fn(),
    querySessionTranscript: vi.fn(),
    connectSessionLiveEvents: vi.fn(() => ({close: vi.fn()})),
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    return {
        ...actual,
        fetchSessionSnapshot: mocks.fetchSessionSnapshot,
        querySessionTranscript: mocks.querySessionTranscript,
    }
})

vi.mock("../../../src/transport/sessionLiveEvents", () => ({
    connectSessionLiveEvents: mocks.connectSessionLiveEvents,
}))

import {useSessionLivePreview} from "../../../src/hooks/useSessionLivePreview"

const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    return {promise, resolve}
}

describe("useSessionLivePreview", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.defineProperty(document, "visibilityState", {configurable: true, value: "visible"})
        vi.stubGlobal("EventSource", class {})
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it("loads and adopts the transcript through the snapshot before following its cursor", async () => {
        const records = deferred<[]>()
        const adopted = deferred<void>()
        const onDisconnect = vi.fn(() => adopted.promise)
        mocks.fetchSessionSnapshot.mockResolvedValue({read: {latest_sequence: 7}})
        mocks.querySessionTranscript.mockReturnValue(records.promise)
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const wrapper = ({children}: {children: ReactNode}) =>
            createElement(Provider, {store}, children)

        renderHook(
            () =>
                useSessionLivePreview({
                    sessionId: "session-1",
                    sharedReaderAdvertised: true,
                    runningElsewhere: true,
                    onDisconnect,
                }),
            {wrapper},
        )

        await waitFor(() =>
            expect(mocks.querySessionTranscript).toHaveBeenCalledWith({
                sessionId: "session-1",
                projectId: "project-1",
                throughSequence: 7,
            }),
        )
        expect(mocks.connectSessionLiveEvents).not.toHaveBeenCalled()

        await act(async () => records.resolve([]))
        await waitFor(() =>
            expect(onDisconnect).toHaveBeenCalledWith({messages: [], recordCount: 0}),
        )
        expect(mocks.connectSessionLiveEvents).not.toHaveBeenCalled()

        await act(async () => adopted.resolve())
        await waitFor(() =>
            expect(mocks.connectSessionLiveEvents).toHaveBeenCalledWith(
                expect.objectContaining({sessionId: "session-1", after: 7}),
            ),
        )
    })

    it("backs reconnects off and resets the delay only after ready", async () => {
        vi.useFakeTimers()
        mocks.fetchSessionSnapshot.mockResolvedValue({read: {latest_sequence: 7}})
        mocks.querySessionTranscript.mockResolvedValue([])
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const wrapper = ({children}: {children: ReactNode}) =>
            createElement(Provider, {store}, children)

        renderHook(
            () =>
                useSessionLivePreview({
                    sessionId: "session-1",
                    sharedReaderAdvertised: true,
                    runningElsewhere: true,
                    onDisconnect: vi.fn(),
                }),
            {wrapper},
        )
        await act(async () => {
            await Promise.resolve()
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(1)

        const first = mocks.connectSessionLiveEvents.mock.calls[0][0]
        act(() => first.onDisconnect({reason: "connection_lost", reconnect: true}))
        await act(async () => vi.advanceTimersByTimeAsync(4_999))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(1)
        await act(async () => vi.advanceTimersByTimeAsync(1))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(2)

        const second = mocks.connectSessionLiveEvents.mock.calls[1][0]
        act(() => second.onDisconnect({reason: "connection_lost", reconnect: true}))
        await act(async () => vi.advanceTimersByTimeAsync(9_999))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(2)
        await act(async () => vi.advanceTimersByTimeAsync(1))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(3)

        const third = mocks.connectSessionLiveEvents.mock.calls[2][0]
        act(() => third.onReady({watermark: 7}))
        act(() => third.onDisconnect({reason: "connection_lost", reconnect: true}))
        await act(async () => vi.advanceTimersByTimeAsync(4_999))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(3)
        await act(async () => vi.advanceTimersByTimeAsync(1))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(4)
    })
})
