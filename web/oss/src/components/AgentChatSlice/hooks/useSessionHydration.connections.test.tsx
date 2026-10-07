/**
 * QA5W-1: what one conversation holds open, and what a failed first read of its history shows.
 *
 * - One session stream per conversation on screen: the records relay stays closed while the live
 *   event stream carries the session (shared reader advertised), and opens again for an approval
 *   card waiting on an answer, the one thing the live stream does not carry.
 * - A failed first read is not an empty history: the skeleton stays and the read runs again,
 *   instead of "History no longer available" over a session that saved everything.
 */
import {act, createElement} from "react"

import type {SessionTranscript} from "@agenta/chat/assets"
import {projectIdAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {type ScrollIntent} from "./useScrollIntent"
import {useSessionHydration} from "./useSessionHydration"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const mocks = vi.hoisted(() => ({
    loadSessionMessages: vi.fn(),
    watchEnabled: [] as boolean[],
    sharedReader: false,
    hitlPending: false,
}))

vi.mock("@agenta/chat/assets", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/chat/assets")>()),
    loadSessionMessages: mocks.loadSessionMessages,
}))

vi.mock("@agenta/chat/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/chat/state")>()),
    hasSessionChat: () => false,
    isSessionFresh: () => false,
}))

vi.mock("@agenta/playground", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/playground")>()),
    isHitlPending: () => mocks.hitlPending,
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    return {
        ...actual,
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
        fetchSessionRecordsAtom: atom(null, () => ({records: []})),
        revalidateSessionRecordsAtom: atom(null, () => {}),
        revalidateSessionInteractionsAtom: atom(null, () => {}),
        invalidateSessionDurableApprovalsCapability: vi.fn(),
    }
})

vi.mock("../state/liveness", async () => {
    const {atom} = await import("jotai")
    const liveness = atom(() => ({
        isLoading: false,
        nest: {isRunning: false},
        sharedReader: mocks.sharedReader,
        stoppingTurnId: null,
        turnId: null,
    }))
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

vi.mock("./useSessionRecordsWatch", () => ({
    useSessionRecordsWatch: ({enabled}: {enabled: boolean}) => {
        mocks.watchEnabled.push(enabled)
    },
}))

const transcript = (count: number): SessionTranscript =>
    ({
        messages: Array.from(
            {length: count},
            (_, i) =>
                ({
                    id: `m${i + 1}`,
                    role: i % 2 === 0 ? "user" : "assistant",
                    parts: [{type: "text", text: `message ${i + 1}`}],
                }) as unknown as UIMessage,
        ),
        recordCount: count,
        sequenceCursor: count,
    }) as unknown as SessionTranscript

const mountHydration = async () => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    let api: ReturnType<typeof useSessionHydration> | undefined
    const setMessages = vi.fn()
    const Probe = () => {
        api = useSessionHydration({
            sessionId: "session-1",
            initialMessages: [],
            messagesRef: {current: []},
            busyRef: {current: false},
            seenIdsRef: {current: new Set<string>()},
            restoredIdsRef: {current: new Set<string>()},
            recordWatermarkRef: {current: undefined},
            sequenceWatermarkRef: {current: undefined},
            busy: false,
            setMessages,
            persistMessages: vi.fn(),
            clearRunError: vi.fn(),
            intent: {armJump: vi.fn(), stickRef: {current: false}} as unknown as ScrollIntent,
            pendingResumeRef: {current: null},
        })
        return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => {
        root.render(createElement(Provider, {store}, createElement(Probe)))
    })
    return {api: () => api!, setMessages, unmount: () => act(() => root.unmount())}
}

describe("useSessionHydration connections and failed reads", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.watchEnabled = []
        mocks.sharedReader = false
        mocks.hitlPending = false
        mocks.loadSessionMessages.mockResolvedValue(transcript(2))
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("opens the records relay only when the live event stream does not carry the session", async () => {
        const legacy = await mountHydration()
        expect(mocks.watchEnabled.at(-1)).toBe(true)
        legacy.unmount()

        mocks.sharedReader = true
        const shared = await mountHydration()
        expect(mocks.watchEnabled.at(-1)).toBe(false)
        shared.unmount()

        // An approval card waits on an answer that moves only the interaction row.
        mocks.hitlPending = true
        const gated = await mountHydration()
        expect(mocks.watchEnabled.at(-1)).toBe(true)
        gated.unmount()
    })

    it("keeps the skeleton and reads again when the first read of the history fails", async () => {
        vi.useFakeTimers()
        mocks.loadSessionMessages.mockResolvedValueOnce(null).mockResolvedValueOnce(transcript(2))
        const view = await mountHydration()

        expect(view.api().isHydrating).toBe(true)
        expect(view.api().hydratedEmpty).toBe(false)
        expect(mocks.loadSessionMessages).toHaveBeenCalledTimes(1)

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_000)
        })

        expect(mocks.loadSessionMessages).toHaveBeenCalledTimes(2)
        expect(view.api().isHydrating).toBe(false)
        expect(view.api().hydratedEmpty).toBe(false)
        expect(view.setMessages).toHaveBeenCalledWith(transcript(2).messages)
        view.unmount()
    })

    it("still reports a history that the server confirms is empty", async () => {
        mocks.loadSessionMessages.mockResolvedValue(transcript(0))
        const view = await mountHydration()

        expect(view.api().isHydrating).toBe(false)
        expect(view.api().hydratedEmpty).toBe(true)
        view.unmount()
    })
})
