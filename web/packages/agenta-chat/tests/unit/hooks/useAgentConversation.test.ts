// @vitest-environment jsdom
//
// Integration smoke for the headless conversation host. The stream engine is REAL
// (`useChat` + the negotiating transport parsing a mocked SSE `fetch`); only the app-layer
// seams are stubbed: the playground request builder (no live workflow config in a unit test)
// and the entities/session revalidation atoms (no query client here). The assertions cover
// genuine end-to-end behavior: send → queue → transport → streamed assistant turn →
// persist-on-settle → run-status publish, plus error stamping and the rewind plan.
import {createElement, type ReactNode} from "react"

import {buildAgentRequest} from "@agenta/playground/agent-chat"
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
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
    }
})

vi.mock("@agenta/entities/trace", () => ({
    markTraceAsFresh: vi.fn(),
}))

import {useAgentConversation} from "../../../src/hooks/useAgentConversation"
import {
    ACCEPTED_SENDER_DISCONNECT_MESSAGE,
    TRANSPORT_ERROR_MESSAGE,
} from "../../../src/model/error"
import {
    getSessionTurnId,
    markSessionFresh,
    setSessionTurnId,
} from "../../../src/state/sessionEphemera"
import {sessionMessagesAtom, sessionStatusAtomFamily} from "../../../src/state/sessionMessages"

const sseBody = (text: string, finishReason?: string): string => {
    const chunks = [
        {type: "start", messageId: `assist-${Math.random().toString(36).slice(2)}`},
        {type: "start-step"},
        {type: "text-start", id: "t1"},
        {type: "text-delta", id: "t1", delta: text},
        {type: "text-end", id: "t1"},
        {type: "finish-step"},
        {type: "finish", ...(finishReason ? {finishReason} : {})},
    ]
    return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n"
}

const streamResponse = (text: string): Response =>
    new Response(sseBody(text), {
        status: 200,
        headers: {"content-type": "text/event-stream"},
    })

const approvalResponse = (): Response => {
    const chunks = [
        {type: "start", messageId: "approval-assistant"},
        {type: "start-step"},
        {type: "tool-input-start", toolCallId: "call-1", toolName: "shell"},
        {type: "tool-input-available", toolCallId: "call-1", toolName: "shell", input: {}},
        {type: "tool-approval-request", approvalId: "approval-1", toolCallId: "call-1"},
        {type: "finish-step"},
        {type: "finish", finishReason: "tool-calls"},
    ]
    return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
        {status: 200, headers: {"content-type": "text/event-stream"}},
    )
}

const errorResponse = (): Response =>
    new Response(JSON.stringify({status: {code: 500, message: "boom"}}), {
        status: 500,
        headers: {"content-type": "application/json"},
    })

const sharedErrorResponse = (): Response => {
    const chunks = [
        {type: "start", messageId: "shared-error"},
        {type: "start-step"},
        {
            type: "data-session-accepted",
            data: {sessionId: "session-1", turnId: "turn-1", executionId: "turn-1"},
        },
        {type: "error", errorText: "shared provider failed"},
        {type: "finish-step"},
        {type: "finish"},
    ]
    const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")
    return new Response(`${body}data: [DONE]\n\n`, {
        status: 200,
        headers: {"content-type": "text/event-stream"},
    })
}

/** The shared sender's invoke stream accepted the turn, then the connection died — what a
 * backgrounded tab sees while the runner carries the turn on to completion. */
const sharedDroppedStreamResponse = (): Response => {
    const chunks = [
        {type: "start", messageId: "shared-dropped"},
        {type: "start-step"},
        {
            // Transient, as the runner sends it: it reaches `onData` and never the transcript.
            type: "data-session-accepted",
            data: {sessionId: "session-1", turnId: "turn-1", executionId: "turn-1"},
            transient: true,
        },
    ]
    return new Response(
        new ReadableStream({
            async start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(
                        new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`),
                    )
                }
                // Let the client read the acceptance first. `controller.error` resets the queue, so
                // erroring in the same tick would throw away what was just enqueued.
                await new Promise((resolve) => setTimeout(resolve, 20))
                controller.error(new TypeError("Failed to fetch"))
            },
        }),
        {status: 200, headers: {"content-type": "text/event-stream"}},
    )
}

const fetchMock = vi.fn<typeof globalThis.fetch>()
vi.stubGlobal("fetch", fetchMock)

let seq = 0
const nextSessionId = () => `conv-test-${Date.now()}-${(seq += 1)}`

const mount = (store: ReturnType<typeof createStore>, entityId: string, sessionId: string) =>
    renderHook(
        ({entityId: id}: {entityId: string}) => useAgentConversation({entityId: id, sessionId}),
        {
            initialProps: {entityId},
            wrapper: ({children}: {children: ReactNode}) =>
                createElement(Provider, {store}, children),
        },
    )

beforeEach(() => {
    fetchMock.mockReset()
    vi.mocked(buildAgentRequest).mockClear()
    // Restore the ready-workflow build: one test replaces it with a not-yet-loaded one, and
    // `mockClear` keeps the implementation.
    vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
        invocationUrl: "https://agent.test/invoke",
        headers: {Accept: "text/event-stream", "content-type": "application/json"},
        requestBody: {session_id: opts?.sessionId},
    }))
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

    it("clears the previous execution guard before a second send", async () => {
        fetchMock.mockImplementation(async () => streamResponse("answer"))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "first"})
        })
        await waitFor(() => expect(result.current.status).toBe("ready"), {timeout: 5000})
        setSessionTurnId(sessionId, "turn-old")

        await act(async () => {
            await result.current.send({text: "second"})
        })

        expect(getSessionTurnId(sessionId)).toBeUndefined()
    })

    it("clears the parked turn guard when an approval automatically resumes", async () => {
        fetchMock
            .mockResolvedValueOnce(approvalResponse())
            .mockResolvedValueOnce(streamResponse("done"))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "needs approval"})
        })
        await waitFor(() => expect(result.current.approvals.open).toBe(true), {timeout: 5000})
        setSessionTurnId(sessionId, "parked-turn")

        act(() => result.current.approvals.respond(true))

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {timeout: 5000})
        expect(getSessionTurnId(sessionId)).toBeUndefined()
    })

    it("survives a revision switch mid-stream instead of aborting the turn", async () => {
        // Auto-commit (#6126) mints a new revision while the agent is running, and the surface
        // follows it. If that arrives as a REMOUNT the unmount teardown calls stop() and kills the
        // live turn — which is what a revision in the mount key did on /m. The engine is built to
        // take it as a prop: `useChat` is pinned to `sessionId` and the request builder reads the
        // revision through a ref.
        let releaseStream: () => void = () => {}
        const streamOpen = new Promise<void>((resolve) => {
            releaseStream = resolve
        })
        fetchMock.mockImplementation(
            async () =>
                new Response(
                    new ReadableStream({
                        async start(controller) {
                            controller.enqueue(new TextEncoder().encode(sseBody("done")))
                            await streamOpen
                            controller.close()
                        },
                    }),
                    {status: 200, headers: {"content-type": "text/event-stream"}},
                ),
        )

        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result, rerender} = mount(store, "rev-before", sessionId)

        act(() => {
            void result.current.send({text: "go"})
        })
        await waitFor(() => expect(result.current.runStatus).toBe("running"))

        // The commit lands: the surface re-renders with the new revision.
        rerender({entityId: "rev-after"})

        // Still the same live turn — not aborted, not restarted.
        expect(result.current.runStatus).toBe("running")
        expect(fetchMock).toHaveBeenCalledTimes(1)

        await act(async () => {
            releaseStream()
            await streamOpen
        })
        await waitFor(() => expect(result.current.runStatus).toBe("idle"), {timeout: 5000})
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

    // M3: the first message to a NEWLY created agent failed with "no invocation URL". The
    // workflow entity carrying that URL is still being fetched when the hand-off fires the
    // stashed first message, and this builder returns null until it lands. Failing on the first
    // null made a new user's first action fail; the desktop bounded the same build in #6042.
    it("waits out a workflow whose invocation URL has not loaded yet, instead of failing the send", async () => {
        fetchMock.mockResolvedValue(streamResponse("Hello back"))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)

        // Null twice — the entity fetch lands on the third build, ~600ms in.
        let builds = 0
        vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => {
            builds += 1
            if (builds < 3) return null
            return {
                invocationUrl: "https://agent.test/invoke",
                headers: {Accept: "text/event-stream", "content-type": "application/json"},
                requestBody: {session_id: opts?.sessionId},
            }
        })

        const {result} = mount(store, "rev-1", sessionId)
        await act(async () => {
            await result.current.send({text: "my first message"})
        })

        await waitFor(
            () => {
                expect(result.current.status).toBe("ready")
                expect(result.current.messages).toHaveLength(2)
            },
            {timeout: 5000},
        )
        // The build was retried rather than failed on the first null.
        expect(builds).toBeGreaterThanOrEqual(3)
        // The turn answered rather than carrying the missing-URL error.
        await waitFor(() => {
            expect(result.current.turns[1].status.hasAnswer).toBe(true)
            expect(result.current.turns[1].status.isError).toBe(false)
        })
        expect(result.current.runStatus).toBe("idle")
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

    it("maps a stream-delivered user Stop to the neutral stopped state", async () => {
        fetchMock.mockResolvedValue(
            new Response(sseBody("partial answer", "other"), {
                status: 200,
                headers: {"content-type": "text/event-stream"},
            }),
        )
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "start"})
        })
        await waitFor(() => expect(result.current.status).toBe("ready"), {timeout: 5000})

        expect(result.current.stopped).toBe(true)
        expect(result.current.error).toBeUndefined()
        expect(result.current.runStatus).toBe("idle")
    })

    /**
     * Increment 5, two tabs on one session: the sender's invoke stream carries acceptance and
     * errors only, so a stream that dies while the tab is backgrounded says nothing about the turn
     * — the runner finishes it and writes it to the session log. The stamp is live feedback and
     * must not outlive the reload, or the next open paints "Could not reach Agenta" over a turn
     * that completed server-side (browser evidence 2026-09-04, session 4d21415e).
     */
    it("shows an accepted disconnect as ephemeral connection state", async () => {
        vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
            invocationUrl: "https://agent.test/invoke",
            headers: {
                Accept: "text/event-stream",
                "content-type": "application/json",
                "x-ag-session-response": "shared",
            },
            requestBody: {session_id: opts?.sessionId},
        }))
        // Accepted, then the connection died — what a backgrounded tab's closed stream leaves.
        fetchMock.mockResolvedValue(sharedDroppedStreamResponse())
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "One more short line, please."})
        })
        await waitFor(() => {
            expect(result.current.connectionWarning).toBe(ACCEPTED_SENDER_DISCONNECT_MESSAGE)
            expect(result.current.error).toBeUndefined()
            expect(result.current.runStatus).not.toBe("error")
            expect(result.current.turns.some((turn) => turn.status.isError)).toBe(false)
        })

        // Durable: only the user turn. Nothing here can repaint the failure after a reload, and
        // the count the adoption guard compares stays equal to what the log holds.
        await waitFor(() => {
            const persisted = store.get(sessionMessagesAtom)[sessionId]
            expect(persisted).toHaveLength(1)
            expect(persisted[0].role).toBe("user")
            expect(persisted.some((m) => (m.metadata as {runError?: unknown})?.runError)).toBe(
                false,
            )
        })
    })

    /**
     * The other half of the rule. A stream that dies BEFORE the acceptance may describe a turn that
     * never started, so that card is the only signal the user gets and it has to survive the
     * reload.
     */
    it("keeps a failure the server never accepted, so the reload still shows it", async () => {
        vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
            invocationUrl: "https://agent.test/invoke",
            headers: {
                Accept: "text/event-stream",
                "content-type": "application/json",
                "x-ag-session-response": "shared",
            },
            requestBody: {session_id: opts?.sessionId},
        }))
        // The request never left: no acceptance, no turn id, nothing to converge on.
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "this one never left"})
        })
        await waitFor(() => expect(result.current.runStatus).toBe("error"), {timeout: 5000})
        expect(result.current.connectionWarning).toBeUndefined()

        await waitFor(() => {
            const persisted = store.get(sessionMessagesAtom)[sessionId]
            expect(persisted).toHaveLength(2)
            const stamped = persisted[1].metadata as {runError?: {message?: string}}
            expect(stamped.runError?.message).toBe(TRANSPORT_ERROR_MESSAGE)
        })
    })

    it("renders an invoke error that shares the acceptance carrier", async () => {
        vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
            invocationUrl: "https://agent.test/invoke",
            headers: {
                Accept: "text/event-stream",
                "content-type": "application/json",
                "x-ag-session-response": "shared",
            },
            requestBody: {session_id: opts?.sessionId},
        }))
        fetchMock.mockResolvedValue(sharedErrorResponse())
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "explode on the shared path"})
        })
        await waitFor(() => expect(result.current.runStatus).toBe("error"), {timeout: 5000})
        expect(result.current.connectionWarning).toBeUndefined()

        await waitFor(() => {
            const sharedCarriers = result.current.messages.filter(
                (message) =>
                    (message.metadata as {sharedSender?: boolean} | undefined)?.sharedSender,
            )
            expect(sharedCarriers).toHaveLength(1)
            expect(
                (sharedCarriers[0].metadata as {runError?: {message?: string}}).runError?.message,
            ).toBe("shared provider failed")
        })
        const last = result.current.turns[result.current.turns.length - 1]
        expect(last.status.errorText).toBe("shared provider failed")
        expect(last.status.isError).toBe(true)
    })
})
