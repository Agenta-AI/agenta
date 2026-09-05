import {createElement, type ReactNode} from "react"

import type {SessionInteractionRowStates, SessionRecord} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {act, renderHook, waitFor} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
    fetchSessionSnapshot: vi.fn(),
    querySessionTranscript: vi.fn(),
    connectSessionLiveEvents: vi.fn(() => ({close: vi.fn()})),
    interactionRowStates: new Map() as SessionInteractionRowStates,
    revalidateInteractionStates: vi.fn(),
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    return {
        ...actual,
        fetchSessionInteractionStatesAtom: atom(null, () => mocks.interactionRowStates),
        revalidateSessionInteractionsAtom: atom(null, () => mocks.revalidateInteractionStates()),
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

const record = (id: string, payload: Record<string, unknown>): SessionRecord => ({
    id,
    session_id: "session-1",
    project_id: "project-1",
    event_index: null,
    sender: "agent",
    session_update: String(payload.type),
    payload,
    created_at: null,
})

describe("useSessionLivePreview", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.interactionRowStates = new Map()
        Object.defineProperty(document, "visibilityState", {configurable: true, value: "visible"})
        vi.stubGlobal("EventSource", class {})
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it("loads and adopts the transcript through the snapshot before following its cursor", async () => {
        const records = deferred<[]>()
        const adopted = deferred<boolean>()
        const onDisconnect = vi.fn(() => adopted.promise)
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: false}},
            execution: null,
            read: {latest_sequence: 7},
        })
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
            expect(onDisconnect).toHaveBeenCalledWith({
                messages: [],
                recordCount: 0,
                sequenceCursor: 7,
                interactionRows: mocks.interactionRowStates,
            }),
        )
        expect(mocks.connectSessionLiveEvents).not.toHaveBeenCalled()

        await act(async () => adopted.resolve(true))
        await waitFor(() =>
            expect(mocks.connectSessionLiveEvents).toHaveBeenCalledWith(
                expect.objectContaining({sessionId: "session-1", after: 7}),
            ),
        )
    })

    it("does not follow a snapshot cursor the host refused to adopt", async () => {
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: false}},
            execution: null,
            read: {latest_sequence: 7},
        })
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
                    onDisconnect: vi.fn().mockResolvedValue(false),
                }),
            {wrapper},
        )

        await waitFor(() => expect(mocks.querySessionTranscript).toHaveBeenCalledOnce())
        expect(mocks.connectSessionLiveEvents).not.toHaveBeenCalled()
    })

    it.each(["rejected", "undefined"] as const)(
        "backs off when the bounded transcript read is %s",
        async (failure) => {
            vi.useFakeTimers()
            mocks.fetchSessionSnapshot.mockResolvedValue({
                session: {flags: {is_running: false}},
                execution: null,
                read: {latest_sequence: 7},
            })
            if (failure === "rejected") {
                mocks.querySessionTranscript
                    .mockRejectedValueOnce(new Error("network changed"))
                    .mockResolvedValueOnce([])
            } else {
                mocks.querySessionTranscript
                    .mockResolvedValueOnce(undefined)
                    .mockResolvedValueOnce([])
            }
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
                        onDisconnect: vi.fn().mockResolvedValue(true),
                    }),
                {wrapper},
            )

            await act(async () => {
                await Promise.resolve()
                await Promise.resolve()
                await Promise.resolve()
            })
            expect(mocks.querySessionTranscript).toHaveBeenCalledTimes(1)
            expect(mocks.connectSessionLiveEvents).not.toHaveBeenCalled()

            await act(async () => vi.advanceTimersByTimeAsync(4_999))
            expect(mocks.querySessionTranscript).toHaveBeenCalledTimes(1)
            await act(async () => vi.advanceTimersByTimeAsync(1))
            expect(mocks.querySessionTranscript).toHaveBeenCalledTimes(2)
            expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(1)
        },
    )

    it.each(["responded", "resolved", "cancelled"] as const)(
        "joins %s interaction lifecycle before adopting the bounded transcript",
        async (status) => {
            mocks.fetchSessionSnapshot.mockResolvedValue({
                session: {flags: {is_running: false}},
                execution: null,
                read: {latest_sequence: 3},
            })
            mocks.querySessionTranscript.mockResolvedValue([
                record("r-call", {
                    type: "tool_call",
                    id: "tool-1",
                    name: "request_input",
                    input: {question: "Continue?"},
                }),
                record("r-request", {
                    type: "interaction_request",
                    id: "interaction-1",
                    kind: "client_tool",
                    payload: {toolCallId: "tool-1", toolName: "request_input"},
                }),
                record("r-done", {type: "done", stopReason: "paused"}),
            ])
            mocks.interactionRowStates = new Map([
                [
                    "interaction-1",
                    {
                        token: "interaction-1",
                        toolCallId: "tool-1",
                        kind: "client_tool",
                        status,
                    },
                ],
            ]) as SessionInteractionRowStates
            const onDisconnect = vi.fn().mockResolvedValue(true)
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

            await waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce())
            const transcript = onDisconnect.mock.calls[0][0]
            expect(transcript.interactionRows).toBe(mocks.interactionRowStates)
            expect(transcript.messages[0].parts).toContainEqual(
                expect.objectContaining({toolCallId: "tool-1", state: "output-available"}),
            )
        },
    )

    it("shows and settles a watched interaction from durable record events", async () => {
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: true}},
            execution: {turn_id: "turn-1", end_time: null},
            read: {latest_sequence: 1},
        })
        mocks.querySessionTranscript.mockResolvedValueOnce([])
        const onDisconnect = vi.fn().mockResolvedValue(true)
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

        await waitFor(() => expect(mocks.connectSessionLiveEvents).toHaveBeenCalledOnce())
        const connection = mocks.connectSessionLiveEvents.mock.calls[0][0]
        const requestRecords = [
            record("r-call", {
                type: "tool_call",
                id: "tool-1",
                name: "request_connection",
                input: {integration: "github"},
            }),
            record("r-request", {
                type: "interaction_request",
                id: "interaction-1",
                kind: "client_tool",
                payload: {toolCallId: "tool-1", toolName: "request_connection"},
            }),
        ]
        mocks.querySessionTranscript.mockResolvedValueOnce(requestRecords)

        act(() =>
            connection.onEvent({
                version: 1,
                kind: "event",
                session_id: "session-1",
                execution_id: "turn-1",
                frame_or_event_id: "r-request",
                sequence: 2,
                watermark: 2,
                type: "interaction.requested",
                payload: {interaction_id: "interaction-1", kind: "client_tool"},
                created_at: "2026-09-05T12:00:00Z",
            }),
        )

        await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(2))
        expect(onDisconnect.mock.calls[1][0].messages[0].parts).toContainEqual(
            expect.objectContaining({toolCallId: "tool-1", state: "input-available"}),
        )

        mocks.querySessionTranscript.mockResolvedValueOnce([
            ...requestRecords,
            record("r-result", {
                type: "tool_result",
                id: "tool-1",
                data: {connected: true},
            }),
        ])
        act(() =>
            connection.onEvent({
                version: 1,
                kind: "event",
                session_id: "session-1",
                execution_id: "turn-1",
                frame_or_event_id: "r-response",
                sequence: 3,
                watermark: 3,
                type: "tool.completed",
                payload: {
                    tool_call_id: "tool-1",
                    name: "request_connection",
                    input: {integration: "github"},
                    output: {connected: true},
                    status: "completed",
                },
                created_at: "2026-09-05T12:00:01Z",
            }),
        )

        await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(3))
        expect(onDisconnect.mock.calls[2][0].messages[0].parts).toContainEqual(
            expect.objectContaining({toolCallId: "tool-1", state: "output-available"}),
        )
        expect(mocks.revalidateInteractionStates).toHaveBeenCalledOnce()
    })

    it("backs reconnects off and resets the delay only after ready", async () => {
        vi.useFakeTimers()
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: false}},
            execution: null,
            read: {latest_sequence: 7},
        })
        mocks.querySessionTranscript.mockResolvedValue([])
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const wrapper = ({children}: {children: ReactNode}) =>
            createElement(Provider, {store}, children)

        const {result} = renderHook(
            () =>
                useSessionLivePreview({
                    sessionId: "session-1",
                    sharedReaderAdvertised: true,
                    runningElsewhere: true,
                    onDisconnect: vi.fn().mockResolvedValue(true),
                }),
            {wrapper},
        )
        await act(async () => {
            await Promise.resolve()
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(result.current.readerReady).toBe(false)
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
        expect(result.current.readerReady).toBe(true)
        act(() => third.onDisconnect({reason: "connection_lost", reconnect: true}))
        expect(result.current.readerReady).toBe(false)
        await act(async () => vi.advanceTimersByTimeAsync(4_999))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(3)
        await act(async () => vi.advanceTimersByTimeAsync(1))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(4)
    })
})
