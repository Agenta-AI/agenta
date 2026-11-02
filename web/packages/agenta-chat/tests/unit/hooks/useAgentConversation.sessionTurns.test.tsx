// @vitest-environment jsdom
//
// The /m live chat reads the session turns at its stream's end and for records that show an ended turn.
import {createElement, type ReactNode} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {loadSessionMessagesMock, turnsRefreshed, turnEndsSeen} = vi.hoisted(() => ({
    loadSessionMessagesMock: vi.fn(),
    turnsRefreshed: vi.fn(),
    turnEndsSeen: vi.fn(),
}))

vi.mock("../../../src/assets/loadSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../src/assets/loadSession")>()),
    loadSessionMessages: loadSessionMessagesMock,
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
        revalidateSessionMountsAtom: atom(null, () => {}),
        revalidateSessionRecordsAtom: atom(null, () => {}),
        revalidateSessionInteractionsAtom: atom(null, () => {}),
        revalidateSessionTurnsAtom: atom(null, (_get, _set, sessionId: string) =>
            turnsRefreshed(sessionId),
        ),
        // The read rule is tested in entities; here the hook hands it only the ended turns.
        revalidateSessionTurnsOnTurnEndAtom: atom(
            null,
            (_get, _set, args: {sessionId: string; endedTraceIds: string[]}) => turnEndsSeen(args),
        ),
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
import {peekSessionChat} from "../../../src/state/sessionChats"
import {acceptedRunBySession, markSessionFresh} from "../../../src/state/sessionEphemera"

let seq = 0
const nextSessionId = () => `session-turns-test-${Date.now()}-${(seq += 1)}`

const mount = (sessionId: string) => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    return renderHook(() => useAgentConversation({entityId: "rev-1", sessionId}), {
        wrapper: ({children}: {children: ReactNode}) => createElement(Provider, {store}, children),
    })
}

describe("the live chat refreshes the session turns when a turn ends", () => {
    beforeEach(() => {
        loadSessionMessagesMock.mockReset()
        loadSessionMessagesMock.mockResolvedValue(null)
        turnsRefreshed.mockReset()
        acceptedRunBySession.clear()
        vi.stubGlobal("fetch", vi.fn())
    })

    it("on its own stream's finish", () => {
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        mount(sessionId)
        turnsRefreshed.mockReset()
        const answer = {
            id: "a1",
            role: "assistant",
            parts: [{type: "text", text: "done"}],
        } as unknown as UIMessage
        const {onFinish} = peekSessionChat(sessionId) as unknown as {
            onFinish: (event: Record<string, unknown>) => void
        }

        act(() =>
            onFinish({
                message: answer,
                messages: [answer],
                isAbort: false,
                isDisconnect: false,
                isError: false,
                finishReason: "stop",
            }),
        )

        expect(turnsRefreshed).toHaveBeenCalledWith(sessionId)
    })

    it("on a records refresh, passing only the turns that ended", async () => {
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(sessionId)
        turnEndsSeen.mockReset()
        const user = {id: "u1", role: "user", parts: [{type: "text", text: "go"}]}
        const assistant = (metadata: Record<string, unknown>, text: string) => ({
            id: "a1",
            role: "assistant",
            parts: [{type: "text", text}],
            metadata: {traceId: "0a1b2c3d00004000800000000000000f", ...metadata},
        })
        const transcript = (messages: unknown[], recordCount: number) =>
            ({messages, recordCount}) as unknown as SessionTranscript

        // A running turn's records events: tool calls, deltas.
        for (let n = 2; n <= 6; n += 1) {
            await act(async () => {
                await result.current.revalidate(transcript([user, assistant({}, `step ${n}`)], n))
            })
        }
        expect(turnEndsSeen.mock.calls.every(([args]) => args.endedTraceIds.length === 0)).toBe(
            true,
        )

        // The turn ends.
        await act(async () => {
            await result.current.revalidate(
                transcript([user, assistant({recordTerminal: true}, "done")], 7),
            )
        })
        expect(turnEndsSeen).toHaveBeenLastCalledWith({
            sessionId,
            endedTraceIds: ["0a1b2c3d00004000800000000000000f"],
        })
        expect(turnsRefreshed).not.toHaveBeenCalled()
    })

    it("on the fresh read a records refresh gets after the cached one", async () => {
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(sessionId)
        const user = {id: "u1", role: "user", parts: [{type: "text", text: "go"}]}
        const assistant = (metadata: Record<string, unknown>) => ({
            id: "a1",
            role: "assistant",
            parts: [{type: "text", text: "done"}],
            metadata: {traceId: "0a1b2c3d00004000800000000000000f", ...metadata},
        })
        loadSessionMessagesMock.mockImplementationOnce(
            async (_id: string, onRefreshed?: (t: SessionTranscript) => void) => {
                onRefreshed?.({
                    messages: [user, assistant({recordTerminal: true})],
                    recordCount: 3,
                } as unknown as SessionTranscript)
                return {
                    messages: [user, assistant({})],
                    recordCount: 2,
                } as unknown as SessionTranscript
            },
        )
        turnEndsSeen.mockReset()

        await act(async () => {
            await result.current.revalidate()
        })

        expect(turnEndsSeen).toHaveBeenCalledWith({
            sessionId,
            endedTraceIds: ["0a1b2c3d00004000800000000000000f"],
        })
    })
})
