/**
 * The unmount-mid-stream blocker on PR #6658, desktop side.
 *
 * A durable send's run stream outlives the mount that started it. When it completes it calls
 * `onExecuted`, which on this host is `refreshFromRecords`, and THAT starts a records read of its
 * own. The mount can go away while that read is in flight. `state/sessionChats.ts` deliberately
 * preserves the same `Chat` across a remount, so the old adopter still holds a working
 * `setMessages` and a working persistence atom, and it still holds the OLD mount's watermark refs
 * — so its stale snapshot passes its own guard and replaces a newer transcript, on screen and on
 * disk.
 *
 * Codex's reproduction, reproduced here against the real hook: start from two messages, unmount
 * while the read is in flight, remount onto the same preserved chat, adopt six newer messages,
 * then release the old four-message snapshot. Six must survive.
 */
import {act, createElement, StrictMode, type ReactNode} from "react"

import type {SessionTranscript} from "@agenta/chat/assets"
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
    loadSessionMessages: vi.fn(),
}))

vi.mock("@agenta/chat/assets", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/chat/assets")>()),
    loadSessionMessages: mocks.loadSessionMessages,
}))

vi.mock("@agenta/chat/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/chat/state")>()),
    hasSessionChat: () => false,
    // Keeps the hydration and revalidate-on-open effects out of the way: this suite drives the
    // adoption path explicitly, one call at a time.
    isSessionFresh: () => true,
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    return {
        ...actual,
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
        revalidateSessionRecordsAtom: atom(null, () => {}),
        revalidateSessionInteractionsAtom: atom(null, () => {}),
    }
})

vi.mock("../state/liveness", async () => {
    const {atom} = await import("jotai")
    const liveness = atom({
        isLoading: false,
        nest: {isRunning: false},
        sharedReader: false,
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

const message = (n: number): UIMessage =>
    ({
        id: `m${n}`,
        role: n % 2 === 1 ? "user" : "assistant",
        parts: [{type: "text", text: `message ${n}`}],
    }) as unknown as UIMessage

const transcript = (count: number, sequence: number): SessionTranscript =>
    ({
        messages: Array.from({length: count}, (_, i) => message(i + 1)),
        recordCount: count,
        sequenceCursor: sequence,
    }) as unknown as SessionTranscript

/**
 * The chat instance the session registry preserves across the remount. Both mounts write into it,
 * which is the whole reason session keys cannot separate them.
 */
const preservedChat = () => {
    const state = {
        messages: [message(1), message(2)] as UIMessage[],
        persisted: [] as UIMessage[][],
    }
    return {
        state,
        setMessages: vi.fn((next: UIMessage[]) => {
            state.messages = next
        }),
        persistMessages: vi.fn((args: {messages: UIMessage[]}) => {
            state.persisted.push(args.messages)
        }),
    }
}

/** One mount of the hook: its OWN watermark refs, writing into the shared chat above. */
const mountHydration = (
    chat: ReturnType<typeof preservedChat>,
    watermark: number,
    wrap: (node: ReactNode) => ReactNode,
) => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    const messagesRef = {current: chat.state.messages}
    const recordWatermarkRef = {current: watermark as number | undefined}
    const sequenceWatermarkRef = {current: watermark as number | undefined}
    let api: ReturnType<typeof useSessionHydration> | undefined
    const Probe = () => {
        messagesRef.current = chat.state.messages
        api = useSessionHydration({
            sessionId: "session-1",
            initialMessages: [],
            messagesRef,
            busyRef: {current: false},
            seenIdsRef: {current: new Set<string>()},
            restoredIdsRef: {current: new Set<string>()},
            recordWatermarkRef,
            sequenceWatermarkRef,
            busy: false,
            setMessages: chat.setMessages,
            persistMessages: chat.persistMessages,
            clearRunError: vi.fn(),
            intent: {armJump: vi.fn(), stickRef: {current: false}} as unknown as ScrollIntent,
            pendingResumeRef: {current: null},
        })
        return null
    }
    const root = createRoot(document.createElement("div"))
    return {
        render: async () => {
            await act(async () => {
                root.render(createElement(Provider, {store}, wrap(createElement(Probe))))
            })
        },
        api: () => api!,
        unmount: () => act(() => root.unmount()),
    }
}

const plain = (node: ReactNode) => node
const strict = (node: ReactNode) => createElement(StrictMode, null, node)

describe.each([
    ["without StrictMode", plain],
    ["under StrictMode", strict],
])("desktop adoption after an unmount mid-stream (%s)", (_label, wrap) => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("keeps the newer transcript when a read started before the unmount resolves after it", async () => {
        const chat = preservedChat()

        // The read `onExecuted` starts, held open across the unmount.
        let release: ((t: SessionTranscript) => void) | undefined
        mocks.loadSessionMessages.mockImplementationOnce(
            () =>
                new Promise<SessionTranscript>((resolve) => {
                    release = resolve
                }),
        )

        const first = mountHydration(chat, 2, wrap)
        await first.render()
        const stalePass = first.api().refreshFromRecords()
        await vi.waitFor(() => expect(release).toBeDefined())

        // The user navigates away mid-stream.
        first.unmount()

        // ...and back. A fresh mount, its own watermark refs, the SAME chat instance.
        const second = mountHydration(chat, 2, wrap)
        await second.render()
        await act(async () => {
            await second.api().refreshFromRecords(transcript(6, 6))
        })
        expect(chat.state.messages).toHaveLength(6)

        // Now the old mount's read comes back with what the transcript looked like before.
        await act(async () => {
            release!(transcript(4, 4))
            await stalePass
        })

        expect(chat.state.messages).toHaveLength(6)
        expect(chat.setMessages).toHaveBeenCalledTimes(1)
        expect(chat.state.persisted).toHaveLength(1)
        expect(chat.state.persisted[0]).toHaveLength(6)
        second.unmount()
    })

    it("still adopts through the live mount while the stale read is outstanding", async () => {
        // Sensitivity: the assertion above must fail because the guard held, not because this
        // harness never reaches an adoption at all.
        const chat = preservedChat()
        let release: ((t: SessionTranscript) => void) | undefined
        mocks.loadSessionMessages.mockImplementationOnce(
            () =>
                new Promise<SessionTranscript>((resolve) => {
                    release = resolve
                }),
        )

        const first = mountHydration(chat, 2, wrap)
        await first.render()
        const stalePass = first.api().refreshFromRecords()
        await vi.waitFor(() => expect(release).toBeDefined())
        first.unmount()

        const second = mountHydration(chat, 2, wrap)
        await second.render()
        // The live mount adopts twice, the second time over its own first adoption.
        await act(async () => {
            await second.api().refreshFromRecords(transcript(4, 4))
        })
        expect(chat.state.messages).toHaveLength(4)
        await act(async () => {
            await second.api().refreshFromRecords(transcript(6, 6))
        })
        expect(chat.state.messages).toHaveLength(6)

        await act(async () => {
            release!(transcript(4, 4))
            await stalePass
        })
        expect(chat.state.messages).toHaveLength(6)
        second.unmount()
    })
})
