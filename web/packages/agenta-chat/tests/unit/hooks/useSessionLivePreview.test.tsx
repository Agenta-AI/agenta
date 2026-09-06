import {createElement, type ReactNode} from "react"

import type {SessionInteractionRowStates, SessionRecord} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {act, cleanup, renderHook, waitFor} from "@testing-library/react"
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
    sequence: null,
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
        cleanup()
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it("keeps the flag-off path snapshot-free", async () => {
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const wrapper = ({children}: {children: ReactNode}) =>
            createElement(Provider, {store}, children)

        const {result} = renderHook(
            () =>
                useSessionLivePreview({
                    sessionId: "session-1",
                    sharedReaderAdvertised: false,
                    runningElsewhere: true,
                    onDisconnect: vi.fn(),
                }),
            {wrapper},
        )

        await act(async () => Promise.resolve())
        expect(mocks.fetchSessionSnapshot).not.toHaveBeenCalled()
        expect(mocks.connectSessionLiveEvents).not.toHaveBeenCalled()
        expect(result.current.runningFromSnapshot).toBe(false)
        expect(result.current.readerReady).toBe(false)
    })

    it("treats a null-session snapshot as no reconnect data", async () => {
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: null,
            execution: null,
            execution_state: {state: "idle"},
            pending: {inputs: [], interactions: []},
            read: null,
            capabilities: {queue: true, steer: true},
        })
        const onDisconnect = vi.fn().mockResolvedValue(true)
        const onExecutionSettled = vi.fn()
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
                    onExecutionSettled,
                }),
            {wrapper},
        )

        await waitFor(() => expect(mocks.connectSessionLiveEvents).toHaveBeenCalledOnce())
        expect(mocks.querySessionTranscript).not.toHaveBeenCalled()
        expect(onDisconnect).toHaveBeenCalledWith(undefined)
        expect(onExecutionSettled).not.toHaveBeenCalled()
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

    it("keeps streamed text during durable adoption and preserves its cursor after a tool completes", async () => {
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: true}},
            execution: {turn_id: "turn-1", end_time: null},
            read: {latest_sequence: 0},
        })
        mocks.querySessionTranscript.mockResolvedValue([])
        const adopted = deferred<boolean>()
        const onDisconnect = vi.fn().mockResolvedValueOnce(true).mockReturnValue(adopted.promise)
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
                    onDisconnect,
                }),
            {wrapper},
        )
        await waitFor(() => expect(mocks.connectSessionLiveEvents).toHaveBeenCalledOnce())
        const connection = mocks.connectSessionLiveEvents.mock.calls[0][0]
        const emit = (
            index: number,
            type: string,
            payload: Record<string, unknown>,
            entity = "text-1",
        ) =>
            connection.onFrame({
                version: 1,
                kind: "frame",
                session_id: "session-1",
                execution_id: "turn-1",
                frame_or_event_id: `turn-1:${index}`,
                frame_index: index,
                entity_id: entity,
                type,
                payload,
                created_at: "2026-09-06T00:00:00Z",
            })
        act(() => {
            emit(0, "text-start", {})
            emit(1, "text-delta", {delta: "Still writing"})
            emit(
                2,
                "tool-input-available",
                {toolCallId: "tool-1", toolName: "shell", input: {}},
                "tool-1",
            )
            connection.onEvent({
                version: 1,
                kind: "event",
                session_id: "session-1",
                execution_id: "turn-1",
                frame_or_event_id: "record-1",
                sequence: 1,
                watermark: 1,
                type: "tool.completed",
                payload: {tool_call_id: "tool-1"},
                created_at: "2026-09-06T00:00:00Z",
            })
        })
        expect(result.current.messages[0].parts).toContainEqual({
            type: "text",
            text: "Still writing",
        })
        await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(2))
        act(() => emit(3, "text-delta", {delta: " more"}))
        await act(async () => adopted.resolve(true))
        expect(result.current.messages[0].parts).toEqual([
            {type: "text", text: "Still writing more"},
        ])
        act(() => emit(4, "text-delta", {delta: " text"}))
        expect(result.current.messages[0].parts).toEqual([
            {type: "text", text: "Still writing more text"},
        ])
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledOnce()
        act(() => connection.onDisconnect({reason: "connection_lost", reconnect: true}))
        expect(result.current.messages[0].parts).toEqual([
            {type: "text", text: "Still writing more text"},
        ])
    })

    it("retires snapshot-covered preview after reconnect while keeping unfinished text", async () => {
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: true}},
            execution: {turn_id: "turn-1", end_time: null},
            read: {latest_sequence: 0},
        })
        mocks.querySessionTranscript.mockResolvedValue([])
        const onDisconnect = vi.fn().mockResolvedValue(true)
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
                    onDisconnect,
                }),
            {wrapper},
        )
        await waitFor(() => expect(mocks.connectSessionLiveEvents).toHaveBeenCalledOnce())
        const first = mocks.connectSessionLiveEvents.mock.calls[0][0]
        const emit = (
            connection: typeof first,
            index: number,
            type: string,
            payload: Record<string, unknown>,
            entity: string,
        ) =>
            connection.onFrame({
                version: 1,
                kind: "frame",
                session_id: "session-1",
                execution_id: "turn-1",
                frame_or_event_id: `turn-1:${index}`,
                frame_index: index,
                entity_id: entity,
                type,
                payload,
                created_at: "2026-09-06T00:00:00Z",
            })
        act(() => {
            emit(first, 0, "text-start", {}, "text-1")
            emit(first, 1, "text-delta", {delta: "Saved answer"}, "text-1")
            emit(first, 2, "text-end", {}, "text-1")
            emit(first, 3, "text-start", {}, "text-2")
            emit(first, 4, "text-delta", {delta: "Live prefix"}, "text-2")
            first.onDisconnect({reason: "connection_lost", reconnect: true})
        })
        // Disconnection must not adopt an unbounded transcript while its matching
        // preview remains visible; snapshot recovery reconciles them together.
        expect(onDisconnect).toHaveBeenCalledOnce()
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: true}},
            execution: {turn_id: "turn-1", end_time: null},
            read: {latest_sequence: 1},
        })
        mocks.querySessionTranscript.mockResolvedValue([
            record("saved-row", {type: "message", message_id: "text-1", text: "Saved answer"}),
        ])
        act(() => {
            Object.defineProperty(document, "visibilityState", {
                configurable: true,
                value: "hidden",
            })
            document.dispatchEvent(new Event("visibilitychange"))
            Object.defineProperty(document, "visibilityState", {
                configurable: true,
                value: "visible",
            })
            document.dispatchEvent(new Event("visibilitychange"))
        })
        await waitFor(() => expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(2))
        expect(result.current.messages[0].parts).toEqual([{type: "text", text: "Live prefix"}])
        const second = mocks.connectSessionLiveEvents.mock.calls[1][0]
        expect(second.after).toBe(1)
        act(() => emit(second, 5, "text-delta", {delta: " continues"}, "text-2"))
        expect(result.current.messages[0].parts).toEqual([
            {type: "text", text: "Live prefix continues"},
        ])
        expect(onDisconnect.mock.calls.at(-1)?.[0].messages[0].parts).toContainEqual({
            type: "text",
            text: "Saved answer",
        })
        act(() => emit(second, 7, "text-delta", {delta: " missing middle"}, "text-2"))
        expect(onDisconnect).toHaveBeenCalledTimes(2)
        expect(result.current.messages[0].parts).toEqual([
            {type: "text", text: "Live prefix continues"},
        ])
    })

    it("does not let a pending retry interrupt a reader reopened after visibility changes", async () => {
        vi.useFakeTimers()
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: true}},
            execution: {turn_id: "execution-1", end_time: null},
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
        await act(async () => vi.advanceTimersByTimeAsync(0))
        const first = mocks.connectSessionLiveEvents.mock.calls[0][0]
        act(() => first.onDisconnect({reason: "connection_lost", reconnect: true}))
        await act(async () => {
            Object.defineProperty(document, "visibilityState", {
                configurable: true,
                value: "hidden",
            })
            document.dispatchEvent(new Event("visibilitychange"))
            Object.defineProperty(document, "visibilityState", {
                configurable: true,
                value: "visible",
            })
            document.dispatchEvent(new Event("visibilitychange"))
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(2)
        const second = mocks.connectSessionLiveEvents.mock.calls[1][0]
        act(() => second.onReady({watermark: 7}))
        expect(result.current.readerReady).toBe(true)
        await act(async () => vi.advanceTimersByTimeAsync(5_000))
        expect(mocks.connectSessionLiveEvents).toHaveBeenCalledTimes(2)
        expect(result.current.readerReady).toBe(true)
        expect(result.current.runningFromSnapshot).toBe(true)
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
