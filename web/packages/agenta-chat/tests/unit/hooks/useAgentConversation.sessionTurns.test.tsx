// @vitest-environment jsdom
//
// The /m live chat refreshes the session turns, the source of each footer's figures, on both paths
// that see a turn end: its own stream's finish, and a records refresh (how an observer sees
// another tab's turn end). The turns query does not poll while a turn runs, so without these the
// footer kept a running turn's empty figures.
import {createElement, type ReactNode} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {loadSessionMessagesMock, turnsRefreshed} = vi.hoisted(() => ({
    loadSessionMessagesMock: vi.fn(),
    turnsRefreshed: vi.fn(),
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
        fetchSessionRecordsAtom: atom(null, () => ({records: null, refreshed: null})),
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
        fetchSessionSnapshot: vi.fn(async () => null),
        querySessionTranscript: vi.fn(async () => []),
        fetchSessionSnapshotAtom: atom(null, async () => null),
    }
})

vi.mock("@agenta/entities/trace", () => ({markTraceAsFresh: vi.fn()}))

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

    it("on a records refresh, as an observer of another tab's turn", async () => {
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(sessionId)
        turnsRefreshed.mockReset()

        await act(async () => {
            await result.current.revalidate()
        })

        expect(turnsRefreshed).toHaveBeenCalledWith(sessionId)
    })
})
