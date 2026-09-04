// @vitest-environment jsdom
import {createElement, type ReactNode} from "react"

import {fetchSessionSnapshot, type SessionSnapshot} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {act, renderHook, waitFor} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/session", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/session")>()),
    fetchSessionSnapshot: vi.fn(),
}))

import {useSessionLivePreview} from "../../../src/hooks/useSessionLivePreview"

class FakeEventSource {
    static instances: FakeEventSource[] = []
    readonly listeners = new Map<string, (event: Event) => void>()
    onmessage: ((event: MessageEvent<string>) => void) | null = null
    onerror: (() => void) | null = null
    closed = false

    constructor(
        readonly url: string,
        readonly options?: EventSourceInit,
    ) {
        FakeEventSource.instances.push(this)
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        this.listeners.set(type, listener as (event: Event) => void)
    }

    emit(type: string) {
        this.listeners.get(type)?.(new Event(type))
    }

    close() {
        this.closed = true
    }
}

const snapshot = (sharedReader: boolean): SessionSnapshot =>
    ({
        session: {
            session_id: "session-1",
            project_id: "project-1",
            capabilities: {shared_reader: sharedReader},
            flags: {is_running: true},
        },
        execution: {turn_id: "turn-1", end_time: null},
        pending: {inputs: [], interactions: []},
        read: {latest_sequence: 42, history_complete: true},
    }) as SessionSnapshot

const wrapper = (store: ReturnType<typeof createStore>) =>
    function Wrapper({children}: {children: ReactNode}) {
        return createElement(Provider, {store}, children)
    }

describe("useSessionLivePreview sender subscription", () => {
    beforeEach(() => {
        FakeEventSource.instances = []
        vi.stubGlobal("EventSource", FakeEventSource)
        vi.mocked(fetchSessionSnapshot).mockReset()
    })

    it("subscribes an advertised sender and follows after the snapshot watermark", async () => {
        vi.mocked(fetchSessionSnapshot).mockResolvedValue(snapshot(true))
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const onReadyChange = vi.fn()

        const {result} = renderHook(
            () =>
                useSessionLivePreview({
                    sessionId: "session-1",
                    sharedReaderAdvertised: true,
                    runningElsewhere: false,
                    sender: true,
                    onReadyChange,
                    onDisconnect: vi.fn(),
                }),
            {wrapper: wrapper(store)},
        )

        await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
        expect(FakeEventSource.instances[0].url).toMatch(/\?after=42$/)
        expect(result.current.runningFromSnapshot).toBe(true)
        act(() => FakeEventSource.instances[0].emit("ready"))
        expect(onReadyChange).toHaveBeenLastCalledWith(true)
    })

    it("makes no snapshot request or running claim when the capability is off", async () => {
        const store = createStore()
        store.set(projectIdAtom, "project-1")

        const {result} = renderHook(
            () =>
                useSessionLivePreview({
                    sessionId: "session-1",
                    sharedReaderAdvertised: false,
                    runningElsewhere: false,
                    sender: true,
                    onDisconnect: vi.fn(),
                }),
            {wrapper: wrapper(store)},
        )

        await act(async () => {})
        expect(fetchSessionSnapshot).not.toHaveBeenCalled()
        expect(FakeEventSource.instances).toHaveLength(0)
        expect(result.current.runningFromSnapshot).toBe(false)
    })

    it("keeps the sender connection open across remote-running state changes", async () => {
        vi.mocked(fetchSessionSnapshot).mockResolvedValue(snapshot(true))
        const store = createStore()
        store.set(projectIdAtom, "project-1")

        const {rerender} = renderHook(
            ({runningElsewhere}: {runningElsewhere: boolean}) =>
                useSessionLivePreview({
                    sessionId: "session-1",
                    sharedReaderAdvertised: true,
                    runningElsewhere,
                    sender: true,
                    onDisconnect: vi.fn(),
                }),
            {initialProps: {runningElsewhere: false}, wrapper: wrapper(store)},
        )

        await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
        rerender({runningElsewhere: true})

        expect(fetchSessionSnapshot).toHaveBeenCalledOnce()
        expect(FakeEventSource.instances).toHaveLength(1)
        expect(FakeEventSource.instances[0].closed).toBe(false)
    })
})
