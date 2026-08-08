// @vitest-environment jsdom
//
// Integration smoke for the headless conversation host. The stream engine is REAL
// (`useChat` + the negotiating transport parsing a mocked SSE `fetch`); only the app-layer
// seams are stubbed: the playground request builder (no live workflow config in a unit test)
// and the entities/session revalidation atoms (no query client here). The assertions cover
// genuine end-to-end behavior: send → queue → transport → streamed assistant turn →
// persist-on-settle → run-status publish, plus error stamping and the rewind plan.
import {createElement, type ReactNode} from "react"

import {act, renderHook, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/playground/agent-chat", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/playground/agent-chat")>()
    return {
        ...actual,
        buildAgentRequest: vi.fn(
            async (_entityId: string, _messages: UIMessage[], opts?: {sessionId?: string}) => ({
                invocationUrl: "https://agent.test/invoke",
                headers: {Accept: "text/event-stream", "content-type": "application/json"},
                requestBody: {session_id: opts?.sessionId},
            }),
        ),
    }
})

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    // Spread the real module: the fresh-session registry lives here now and these tests drive it
    // directly (`markSessionFresh`), so a mock that only lists the atoms below would drop it.
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    return {
        ...actual,
        revalidateSessionMountsAtom: atom(null, () => {}),
        revalidateSessionRecordsAtom: atom(null, () => {}),
        // The hydration seam's records fetch: "no server history" for these tests.
        fetchSessionRecordsAtom: atom(null, () => ({records: null, refreshed: null})),
    }
})

vi.mock("@agenta/entities/trace", () => ({
    markTraceAsFresh: vi.fn(),
}))

import {buildAgentRequest} from "@agenta/playground/agent-chat"

import {useAgentConversation} from "../../../src/hooks/useAgentConversation"
import {markSessionFresh} from "../../../src/state/sessionEphemera"
import {sessionMessagesAtom, sessionStatusAtomFamily} from "../../../src/state/sessionMessages"

const sseBody = (text: string): string => {
    const chunks = [
        {type: "start", messageId: `assist-${Math.random().toString(36).slice(2)}`},
        {type: "start-step"},
        {type: "text-start", id: "t1"},
        {type: "text-delta", id: "t1", delta: text},
        {type: "text-end", id: "t1"},
        {type: "finish-step"},
        {type: "finish"},
    ]
    return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n"
}

const streamResponse = (text: string): Response =>
    new Response(sseBody(text), {
        status: 200,
        headers: {"content-type": "text/event-stream"},
    })

const errorResponse = (): Response =>
    new Response(JSON.stringify({status: {code: 500, message: "boom"}}), {
        status: 500,
        headers: {"content-type": "application/json"},
    })

const fetchMock = vi.fn<typeof globalThis.fetch>()
vi.stubGlobal("fetch", fetchMock)

let seq = 0
const nextSessionId = () => `conv-test-${Date.now()}-${(seq += 1)}`

const mount = (store: ReturnType<typeof createStore>, entityId: string, sessionId: string) =>
    renderHook(() => useAgentConversation({entityId, sessionId}), {
        wrapper: ({children}: {children: ReactNode}) => createElement(Provider, {store}, children),
    })

beforeEach(() => {
    fetchMock.mockReset()
    vi.mocked(buildAgentRequest).mockClear()
})

describe("useAgentConversation", () => {
    it("runs a full turn: send → stream → settle → persist + status publish", async () => {
        fetchMock.mockResolvedValue(streamResponse("Hello back"))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId) // brand-new session: no hydration fetch
        const {result} = mount(store, "rev-1", sessionId)

        expect(result.current.isEmpty).toBe(true)
        expect(result.current.isHydrating).toBe(false)
        expect(result.current.runStatus).toBe("idle")
        expect(result.current.status).toBe("ready")

        await act(async () => {
            await result.current.send({text: "hi there"})
        })
        await waitFor(
            () => {
                expect(result.current.status).toBe("ready")
                expect(result.current.messages).toHaveLength(2)
            },
            {timeout: 5000},
        )

        // The request went through the playground builder with the LIVE entity + session.
        expect(vi.mocked(buildAgentRequest)).toHaveBeenCalledWith(
            "rev-1",
            expect.any(Array),
            expect.objectContaining({sessionId}),
        )

        // Turn view models: user turn + answered assistant turn.
        expect(result.current.turns).toHaveLength(2)
        expect(result.current.turns[0].isUser).toBe(true)
        expect(result.current.turns[1].status.hasAnswer).toBe(true)
        const answer = result.current.messages[1].parts.find((p) => p.type === "text") as
            | {text?: string}
            | undefined
        expect(answer?.text).toBe("Hello back")

        // Persist-on-settle wrote the conversation to the package message store…
        expect(store.get(sessionMessagesAtom)[sessionId]).toHaveLength(2)
        // …and the published run status is back to idle.
        expect(store.get(sessionStatusAtomFamily(sessionId))).toBe("idle")
        expect(result.current.runStatus).toBe("idle")
        expect(result.current.isEmpty).toBe(false)
    })

    it("rewinding a user message truncates the conversation and hands back its text", async () => {
        fetchMock.mockResolvedValue(streamResponse("answer"))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "rewind me"})
        })
        await waitFor(() => expect(result.current.messages).toHaveLength(2), {timeout: 5000})

        const plan = result.current.rewind(result.current.messages[0])
        expect(plan).not.toBeNull()
        expect(plan?.sideEffects).toEqual([])
        expect(plan?.restoreText).toBe("rewind me")
        await act(async () => {
            plan?.confirm()
        })
        // The stream throttle coalesces UI commits — the truncation lands a beat later.
        await waitFor(() => expect(result.current.messages).toHaveLength(0), {timeout: 5000})
    })

    // The skin holds the plan open across its warning dialog, so the transcript can move
    // underneath it. Truncating against the scan-time snapshot would wipe whatever replaced it.
    it("a stale rewind plan leaves a transcript its target no longer belongs to alone", async () => {
        // Two turns here, so each send needs its own unread body.
        fetchMock.mockImplementation(async () => streamResponse("answer"))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "first"})
        })
        await waitFor(() => expect(result.current.messages).toHaveLength(2), {timeout: 5000})

        const plan = result.current.rewind(result.current.messages[0])
        await act(async () => {
            plan?.confirm()
        })
        await waitFor(() => expect(result.current.messages).toHaveLength(0), {timeout: 5000})

        await act(async () => {
            await result.current.send({text: "second"})
        })
        await waitFor(() => expect(result.current.messages).toHaveLength(2), {timeout: 5000})

        // Confirming the now-stale plan must not truncate the conversation that replaced it.
        // A truncation commits one throttle window later (50ms), so wait past it before
        // asserting nothing happened.
        await act(async () => {
            plan?.confirm()
            await new Promise((resolve) => setTimeout(resolve, 400))
        })
        expect(result.current.messages).toHaveLength(2)
    })

    it("seeds from the persisted store and skips hydration for cached sessions", async () => {
        const store = createStore()
        const sessionId = nextSessionId()
        const cached = [
            {id: "u1", role: "user", parts: [{type: "text", text: "earlier"}]},
            {id: "a1", role: "assistant", parts: [{type: "text", text: "before"}]},
        ] as UIMessage[]
        store.set(sessionMessagesAtom, {[sessionId]: cached})
        const {result} = mount(store, "rev-1", sessionId)

        expect(result.current.isHydrating).toBe(false)
        expect(result.current.messages).toHaveLength(2)
        expect(result.current.isEmpty).toBe(false)
        // The revalidate-on-open pass found no server records — the cache stays authoritative.
        await waitFor(() => expect(result.current.messages).toHaveLength(2))
        expect(result.current.historyUnavailable).toBe(false)
    })

    it("flags a known-but-empty session as history-unavailable after hydration", async () => {
        const store = createStore()
        const sessionId = nextSessionId() // NOT fresh, NOT cached → hydration path
        const {result} = mount(store, "rev-1", sessionId)

        expect(result.current.isHydrating).toBe(true)
        await waitFor(() => expect(result.current.isHydrating).toBe(false), {timeout: 5000})
        expect(result.current.historyUnavailable).toBe(true)
        expect(result.current.isEmpty).toBe(true)
    })

    it("stamps a stream failure onto the turn and reports the parsed error", async () => {
        fetchMock.mockResolvedValue(errorResponse())
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "explode"})
        })
        await waitFor(() => expect(result.current.runStatus).toBe("error"), {timeout: 5000})

        expect(result.current.error?.message).toBe("boom")
        // The failure landed on a stamped assistant carrier turn, surfaced via the turn model.
        await waitFor(() => {
            const last = result.current.turns[result.current.turns.length - 1]
            expect(last.status.errorText).toBe("boom")
            expect(last.status.isError).toBe(true)
        })
    })
})
