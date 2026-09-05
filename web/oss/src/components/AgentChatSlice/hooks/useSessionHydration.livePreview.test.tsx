import {act, createElement} from "react"

import {useSessionLivePreview} from "@agenta/chat/hooks"
import type {SessionRecord} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {type ScrollIntent} from "./useScrollIntent"
import {useSessionHydration} from "./useSessionHydration"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const mocks = vi.hoisted(() => ({
    fetchSessionSnapshot: vi.fn(),
    querySessionTranscript: vi.fn(),
    loadSessionMessages: vi.fn(),
    openedUrls: [] as string[],
}))

vi.mock("@agenta/chat/assets", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/chat/assets")>()),
    loadSessionMessages: mocks.loadSessionMessages,
}))

vi.mock("@agenta/chat/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/chat/state")>()),
    hasSessionChat: () => false,
    isSessionFresh: () => true,
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    return {
        ...actual,
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
        fetchSessionSnapshot: mocks.fetchSessionSnapshot,
        querySessionTranscript: mocks.querySessionTranscript,
    }
})

vi.mock("../state/liveness", async () => {
    const {atom} = await import("jotai")
    const liveness = atom({
        isLoading: false,
        nest: {isRunning: false},
        sharedReader: true,
        stoppingTurnId: null,
        turnId: null,
    })
    const runningElsewhere = atom(false)
    return {
        sessionLivenessAtomFamily: () => liveness,
        sessionRunningElsewhereAtomFamily: () => runningElsewhere,
    }
})

vi.mock("../state/scope", () => ({useChatScopeKey: () => "scope-1"}))

vi.mock("../state/sessions", async () => {
    const {atom} = await import("jotai")
    const activeSessionId = atom("session-1")
    return {activeSessionIdAtomFamily: () => activeSessionId}
})

vi.mock("./useSessionRecordsWatch", () => ({useSessionRecordsWatch: () => undefined}))

const record = (id: string, sequence: number, payload: Record<string, unknown>): SessionRecord => ({
    id,
    session_id: "session-1",
    project_id: "project-1",
    sequence,
    event_index: null,
    sender: "agent",
    session_update: String(payload.type),
    payload,
    created_at: null,
})

describe("desktop durable reconnect", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.openedUrls.length = 0
        mocks.fetchSessionSnapshot.mockResolvedValue({
            session: {flags: {is_running: false}},
            execution: null,
            read: {latest_sequence: 10},
        })
        mocks.querySessionTranscript.mockResolvedValue([
            record("record-8", 8, {type: "message", text: "durable reply"}),
            record("record-10", 10, {type: "done"}),
        ])
        Object.defineProperty(document, "visibilityState", {configurable: true, value: "visible"})
        vi.stubGlobal(
            "EventSource",
            class {
                onmessage = null
                onerror = null

                constructor(url: string | URL) {
                    mocks.openedUrls.push(String(url))
                }

                addEventListener() {}
                close() {}
            },
        )
    })

    it("opens SSE after the desktop adapter adopts the bounded snapshot", async () => {
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const messagesRef = {current: [] as UIMessage[]}
        const recordWatermarkRef = {current: undefined as number | undefined}
        const sequenceWatermarkRef = {current: undefined as number | undefined}
        const setMessages = vi.fn()
        const busyRef = {current: false}
        const seenIdsRef = {current: new Set<string>()}
        const restoredIdsRef = {current: new Set<string>()}
        const persistMessages = vi.fn()
        const intent = {
            armJump: vi.fn(),
            stickRef: {current: false},
        } as unknown as ScrollIntent
        const pendingResumeRef = {current: null}
        const container = document.createElement("div")
        const root = createRoot(container)
        let hydration: ReturnType<typeof useSessionHydration> | undefined

        const Probe = () => {
            hydration = useSessionHydration({
                sessionId: "session-1",
                initialMessages: [],
                messagesRef,
                busyRef,
                seenIdsRef,
                restoredIdsRef,
                recordWatermarkRef,
                sequenceWatermarkRef,
                busy: false,
                setMessages,
                persistMessages,
                clearRunError: vi.fn(),
                intent,
                pendingResumeRef,
            })
            useSessionLivePreview({
                sessionId: "session-1",
                sharedReaderAdvertised: true,
                runningElsewhere: true,
                onDisconnect: hydration.refreshFromRecords,
            })
            return null
        }

        await act(async () => {
            root.render(createElement(Provider, {store}, createElement(Probe)))
        })
        await vi.waitFor(() => expect(mocks.openedUrls).toHaveLength(1))
        expect(recordWatermarkRef.current).toBe(2)
        expect(sequenceWatermarkRef.current).toBe(10)
        expect(setMessages).toHaveBeenCalledOnce()
        expect(mocks.openedUrls[0]).toContain("/sessions/session-1/events?after=10")

        messagesRef.current = setMessages.mock.calls[0][0]
        const laterMessages = [
            {
                id: "assistant-1",
                role: "assistant",
                parts: [{type: "text", text: "new retained tail"}],
            } as UIMessage,
        ]
        await expect(
            hydration!.refreshFromRecords({
                messages: laterMessages,
                recordCount: 2,
                sequenceCursor: 11,
            }),
        ).resolves.toBe(true)
        expect(recordWatermarkRef.current).toBe(2)
        expect(sequenceWatermarkRef.current).toBe(11)
        expect(setMessages).toHaveBeenLastCalledWith(laterMessages)
        act(() => root.unmount())
    })

    it.each(["rejected", "undefined"] as const)(
        "keeps the desktop transcript when a watch-triggered read is %s",
        async (failure) => {
            if (failure === "rejected") {
                mocks.loadSessionMessages.mockRejectedValueOnce(new Error("network changed"))
            } else {
                mocks.loadSessionMessages.mockResolvedValueOnce(undefined)
            }
            const store = createStore()
            store.set(projectIdAtom, "project-1")
            const messagesRef = {current: [] as UIMessage[]}
            const setMessages = vi.fn()
            const container = document.createElement("div")
            const root = createRoot(container)
            let hydration: ReturnType<typeof useSessionHydration> | undefined

            const Probe = () => {
                hydration = useSessionHydration({
                    sessionId: "session-1",
                    initialMessages: [],
                    messagesRef,
                    busyRef: {current: false},
                    seenIdsRef: {current: new Set<string>()},
                    restoredIdsRef: {current: new Set<string>()},
                    recordWatermarkRef: {current: undefined},
                    sequenceWatermarkRef: {current: undefined},
                    busy: false,
                    setMessages,
                    persistMessages: vi.fn(),
                    intent: {
                        armJump: vi.fn(),
                        stickRef: {current: false},
                    } as unknown as ScrollIntent,
                    pendingResumeRef: {current: null},
                })
                return null
            }

            await act(async () => {
                root.render(createElement(Provider, {store}, createElement(Probe)))
            })
            let adopted: boolean | undefined
            await act(async () => {
                adopted = await hydration!.refreshFromRecords(
                    new MessageEvent("records-changed") as never,
                )
            })

            expect(adopted).toBe(false)
            expect(setMessages).not.toHaveBeenCalled()
            act(() => root.unmount())
        },
    )
})
