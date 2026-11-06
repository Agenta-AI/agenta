// @vitest-environment jsdom
//
// A rewind goes to the server first, and the removed turns stay gone after the next read.
import {createElement, type ReactNode} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {act, renderHook, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {loadSessionMessagesMock, reloadSessionMessagesMock, rewindRequests, rewindAnswer} =
    vi.hoisted(() => ({
        loadSessionMessagesMock: vi.fn(),
        reloadSessionMessagesMock: vi.fn(),
        rewindRequests: vi.fn(),
        rewindAnswer: {current: Promise.resolve(true) as Promise<boolean>},
    }))

vi.mock("../../../src/assets/loadSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../src/assets/loadSession")>()),
    loadSessionMessages: loadSessionMessagesMock,
    reloadSessionMessages: reloadSessionMessagesMock,
}))

vi.mock("@agenta/playground/agent-chat", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/playground/agent-chat")>()
    return {...actual, buildAgentRequest: vi.fn(async () => null)}
})

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    return {
        ...actual,
        rewindSessionAtom: atom(null, (_get, _set, args: {sessionId: string; turnId: string}) => {
            rewindRequests(args)
            return rewindAnswer.current
        }),
        revalidateSessionMountsAtom: atom(null, () => {}),
        revalidateSessionRecordsAtom: atom(null, () => {}),
        revalidateSessionInteractionsAtom: atom(null, () => {}),
        revalidateSessionTurnsAtom: atom(null, () => {}),
        revalidateSessionTurnsOnTurnEndAtom: atom(null, () => {}),
        fetchSessionRecordsAtom: atom(null, () => ({records: null, refreshed: null})),
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
        fetchSessionSnapshot: vi.fn(async () => null),
        querySessionTranscript: vi.fn(async () => []),
        fetchSessionSnapshotAtom: atom(null, async () => null),
    }
})

vi.mock("@agenta/entities/trace", () => ({markTraceAsFresh: vi.fn()}))

import type {SessionTranscript} from "../../../src/assets/loadSession"
import {useAgentConversation} from "../../../src/hooks/useAgentConversation"
import {acceptedRunBySession} from "../../../src/state/sessionEphemera"

const user = (id: string, turnId: string, text: string): UIMessage =>
    ({id, role: "user", parts: [{type: "text", text}], metadata: {turnId}}) as UIMessage
const agent = (id: string, text: string): UIMessage =>
    ({id, role: "assistant", parts: [{type: "text", text}]}) as UIMessage

const THREE_TURNS = [
    user("u1", "t1", "one"),
    agent("a1", "ALPHA"),
    user("u2", "t2", "two"),
    agent("a2", "BRAVO"),
    user("u3", "t3", "three"),
    agent("a3", "CHARLIE"),
]

const transcript = (
    messages: UIMessage[],
    sequenceCursor: number,
    rewoundSequence?: number,
): SessionTranscript => ({
    messages,
    recordCount: messages.length,
    sequenceCursor,
    rewoundSequence,
})

let seq = 0
const nextSessionId = () => `rewind-test-${Date.now()}-${(seq += 1)}`

/** Mounts a session, returns the hook and the push that delivers a later server read. */
const openSession = async (opened: UIMessage[] = THREE_TURNS) => {
    let deliver: (next: SessionTranscript) => void = () => undefined
    loadSessionMessagesMock.mockImplementation(
        async (_id: string, onRefreshed: (next: SessionTranscript) => void) => {
            deliver = onRefreshed
            return transcript(opened, 12)
        },
    )
    const sessionId = nextSessionId()
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    const view = renderHook(() => useAgentConversation({entityId: "rev-1", sessionId}), {
        wrapper: ({children}: {children: ReactNode}) => createElement(Provider, {store}, children),
    })
    await waitFor(() => expect(view.result.current.messages).toHaveLength(opened.length))
    return {sessionId, view, push: (next: SessionTranscript) => act(async () => deliver(next))}
}

const texts = (messages: UIMessage[]) => messages.map((m) => (m.parts[0] as {text: string}).text)

describe("rewinding a turn", () => {
    beforeEach(() => {
        loadSessionMessagesMock.mockReset()
        reloadSessionMessagesMock.mockReset()
        reloadSessionMessagesMock.mockResolvedValue(false)
        rewindRequests.mockReset()
        rewindAnswer.current = Promise.resolve(true)
        acceptedRunBySession.clear()
        vi.stubGlobal("fetch", vi.fn())
    })

    it("tells the server which turn to remove, then truncates", async () => {
        const {sessionId, view} = await openSession()

        const plan = view.result.current.rewind(THREE_TURNS[2])
        await act(async () => {
            await expect(plan?.confirm()).resolves.toBe(true)
        })

        expect(rewindRequests).toHaveBeenCalledWith({sessionId, turnId: "t2"})
        expect(texts(view.result.current.messages)).toEqual(["one", "ALPHA"])
    })

    it("rewinding the first turn empties the transcript", async () => {
        const {view} = await openSession()

        const plan = view.result.current.rewind(THREE_TURNS[0])
        await act(async () => {
            await plan?.confirm()
        })

        expect(view.result.current.messages).toEqual([])
    })

    it("keeps every turn when the server refuses", async () => {
        rewindAnswer.current = Promise.resolve(false)
        const {view} = await openSession()

        const plan = view.result.current.rewind(THREE_TURNS[2])
        await act(async () => {
            await expect(plan?.confirm()).resolves.toBe(false)
        })

        expect(view.result.current.messages).toHaveLength(6)
    })

    it("removes a send that never reached the log from this screen alone", async () => {
        const unsent = {...THREE_TURNS[2], metadata: undefined} as UIMessage
        const {view} = await openSession([THREE_TURNS[0], THREE_TURNS[1], unsent])

        const plan = view.result.current.rewind(unsent)
        await act(async () => {
            await expect(plan?.confirm()).resolves.toBe(true)
        })

        expect(rewindRequests).not.toHaveBeenCalled()
        expect(texts(view.result.current.messages)).toEqual(["one", "ALPHA"])
    })

    it("finds the durable turn of a message not adopted yet", async () => {
        const unsynced = {...THREE_TURNS[2], metadata: undefined} as UIMessage
        const {sessionId, view} = await openSession([THREE_TURNS[0], THREE_TURNS[1], unsynced])
        reloadSessionMessagesMock.mockImplementation(
            async (_id: string, deliver: (next: SessionTranscript) => void) => {
                deliver(transcript(THREE_TURNS, 13))
                return true
            },
        )

        const plan = view.result.current.rewind(unsynced)
        await act(async () => {
            await plan?.confirm()
        })

        expect(rewindRequests).toHaveBeenCalledWith({sessionId, turnId: "t2"})
    })

    it("starts no second rewind while one is in flight", async () => {
        let answer: (value: boolean) => void = () => undefined
        rewindAnswer.current = new Promise((resolve) => (answer = resolve))
        const {view} = await openSession()

        const plan = view.result.current.rewind(THREE_TURNS[2])
        let done: Promise<boolean> | undefined
        act(() => {
            done = plan?.confirm()
        })

        expect(view.result.current.rewind(THREE_TURNS[0])).toBeNull()
        await act(async () => {
            answer(true)
            await done
        })
        expect(view.result.current.rewind(THREE_TURNS[0])).not.toBeNull()
    })

    it("a cached read from before the rewind does not bring the turns back", async () => {
        const {view, push} = await openSession()
        const plan = view.result.current.rewind(THREE_TURNS[2])
        await act(async () => {
            await plan?.confirm()
        })

        await push(transcript(THREE_TURNS, 12))

        expect(texts(view.result.current.messages)).toEqual(["one", "ALPHA"])
    })

    it("the turn sent after a rewind shows without the removed turns", async () => {
        const {view, push} = await openSession()
        const plan = view.result.current.rewind(THREE_TURNS[2])
        await act(async () => {
            await plan?.confirm()
        })

        await push(
            transcript(
                [THREE_TURNS[0], THREE_TURNS[1], user("u4", "t4", "edited"), agent("a4", "NONE")],
                17,
                13,
            ),
        )

        expect(texts(view.result.current.messages)).toEqual(["one", "ALPHA", "edited", "NONE"])
    })

    it("another browser adopts a rewind it did not make", async () => {
        const {view, push} = await openSession()

        await push(transcript(THREE_TURNS.slice(0, 2), 13, 13))

        expect(texts(view.result.current.messages)).toEqual(["one", "ALPHA"])
    })
})
