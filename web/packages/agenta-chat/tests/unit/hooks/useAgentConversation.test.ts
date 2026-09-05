// @vitest-environment jsdom
//
// Integration smoke for the headless conversation host. The stream engine is REAL
// (`useChat` + the negotiating transport parsing a mocked SSE `fetch`); only the app-layer
// seams are stubbed: the playground request builder (no live workflow config in a unit test)
// and the entities/session revalidation atoms (no query client here). The assertions cover
// genuine end-to-end behavior: send → queue → transport → streamed assistant turn →
// persist-on-settle → run-status publish, plus error stamping and the rewind plan.
import {createElement, type ReactNode} from "react"

import {
    fetchSessionSnapshot,
    querySessionTranscript,
    sessionLivePreviewAtomFamily,
    type SessionSnapshot,
} from "@agenta/entities/session"
import {buildAgentRequest} from "@agenta/playground/agent-chat"
import {projectIdAtom} from "@agenta/shared/state"
import {act, renderHook, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {capabilitiesViaAtom, snapshotViaAtom, resumeContinuation} = vi.hoisted(() => ({
    capabilitiesViaAtom: vi.fn(),
    snapshotViaAtom: vi.fn(),
    resumeContinuation: vi.fn(),
}))

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
        fetchSessionSnapshot: vi.fn(),
        querySessionTranscript: vi.fn(),
        fetchSessionCapabilitiesAtom: atom(null, (_get, _set, sessionId: string) =>
            capabilitiesViaAtom(sessionId),
        ),
        fetchSessionSnapshotAtom: atom(null, (_get, _set, sessionId: string) =>
            snapshotViaAtom(sessionId),
        ),
        resumeSessionContinuationAtom: atom(null, () => resumeContinuation()),
        sessionDurableApprovalsCapabilityAtom: atom(null, () => false),
    }
})

vi.mock("@agenta/entities/trace", () => ({
    markTraceAsFresh: vi.fn(),
}))

import {useAgentConversation} from "../../../src/hooks/useAgentConversation"
import {ACCEPTED_SENDER_DISCONNECT_MESSAGE, TRANSPORT_ERROR_MESSAGE} from "../../../src/model/error"
import {
    composerDraftBySession,
    getSessionTurnId,
    markSessionFresh,
    setSessionTurnId,
} from "../../../src/state/sessionEphemera"
import {sessionMessagesAtom, sessionStatusAtomFamily} from "../../../src/state/sessionMessages"
import {SHARED_SENDER_ACCEPTANCE_TIMEOUT_MS} from "../../../src/transport/AgentChatTransport"

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

const sharedBrowserPhraseServerErrorResponse = (): Response => {
    const chunks = [
        {type: "start", messageId: "shared-browser-phrase-error"},
        {type: "start-step"},
        {
            type: "data-session-accepted",
            data: {sessionId: "session-1", turnId: "turn-1", executionId: "turn-1"},
        },
        {
            type: "data-agent-error",
            data: {code: "runner_error", errorText: "Failed to fetch"},
        },
        {type: "error", errorText: "Failed to fetch"},
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

class FakeEventSource {
    static instances: FakeEventSource[] = []
    readonly listeners = new Map<string, (event: Event) => void>()
    onmessage: ((event: MessageEvent<string>) => void) | null = null
    onerror: (() => void) | null = null

    constructor(readonly url: string) {
        FakeEventSource.instances.push(this)
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        this.listeners.set(type, listener as (event: Event) => void)
    }

    ready(watermark = 0) {
        this.listeners.get("ready")?.(
            new MessageEvent("ready", {data: JSON.stringify({watermark})}),
        )
    }

    message(data: unknown) {
        this.onmessage?.(new MessageEvent("message", {data: JSON.stringify(data)}))
    }

    close() {}
}

const controlledLegacyResponse = () => {
    const encoder = new TextEncoder()
    let finish = () => {}
    const response = new Response(
        new ReadableStream({
            start(controller) {
                for (const chunk of [
                    {type: "start", messageId: "legacy-assistant"},
                    {type: "start-step"},
                    {type: "text-start", id: "legacy-text"},
                    {type: "text-delta", id: "legacy-text", delta: "legacy answer"},
                ])
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
                finish = () => {
                    for (const chunk of [
                        {type: "text-end", id: "legacy-text"},
                        {type: "finish-step"},
                        {type: "finish"},
                    ])
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                    controller.close()
                }
            },
        }),
        {status: 200, headers: {"content-type": "text/event-stream"}},
    )
    return {response, finish: () => finish()}
}

const controlledSharedResponse = (sessionId: string) => {
    const encoder = new TextEncoder()
    let finish = () => {}
    const response = new Response(
        new ReadableStream({
            start(controller) {
                for (const chunk of [
                    {type: "start", messageId: "shared-assistant"},
                    {type: "start-step"},
                    {
                        type: "data-session-accepted",
                        data: {sessionId, turnId: "turn-1", executionId: "turn-1"},
                        transient: true,
                    },
                ])
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
                finish = () => {
                    for (const chunk of [{type: "finish-step"}, {type: "finish"}])
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                    controller.close()
                }
            },
        }),
        {status: 200, headers: {"content-type": "text/event-stream"}},
    )
    return {response, finish: () => finish()}
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
    FakeEventSource.instances = []
    vi.stubGlobal("EventSource", FakeEventSource)
    fetchMock.mockReset()
    vi.mocked(fetchSessionSnapshot).mockReset()
    vi.mocked(fetchSessionSnapshot).mockResolvedValue({
        session: {
            session_id: "session-1",
            project_id: "project-1",
            capabilities: {shared_reader: true},
            flags: {is_running: false},
        },
        execution: null,
        pending: {inputs: [], interactions: []},
        read: {latest_sequence: 0, history_complete: true},
    } as SessionSnapshot)
    vi.mocked(querySessionTranscript).mockReset()
    vi.mocked(querySessionTranscript).mockResolvedValue([])
    snapshotViaAtom.mockReset()
    snapshotViaAtom.mockResolvedValue(null)
    capabilitiesViaAtom.mockReset()
    capabilitiesViaAtom.mockResolvedValue({durableApprovals: false, queue: false, steer: false})
    resumeContinuation.mockReset()
    resumeContinuation.mockResolvedValue(false)
    vi.mocked(buildAgentRequest).mockClear()
    // Restore the ready-workflow build: one test replaces it with a not-yet-loaded one, and
    // `mockClear` keeps the implementation.
    vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
        invocationUrl: "https://agent.test/invoke",
        headers: {Accept: "text/event-stream", "content-type": "application/json"},
        requestBody: {session_id: opts?.sessionId},
    }))
})

afterEach(() => vi.useRealTimers())

describe("useAgentConversation", () => {
    it("releases one mobile-held message after a flag-off shared turn finishes", async () => {
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const first = controlledSharedResponse(sessionId)
        const second = controlledSharedResponse(sessionId)
        fetchMock.mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response)
        vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
            invocationUrl: "https://agent.test/invoke",
            headers: {
                Accept: "text/event-stream",
                "content-type": "application/json",
                ...(opts?.sharedResponse ? {"x-ag-session-response": "shared"} : {}),
            },
            requestBody: {session_id: opts?.sessionId},
        }))
        const {result} = renderHook(
            () =>
                useAgentConversation({
                    entityId: "rev-1",
                    sessionId,
                    sharedReaderAdvertised: true,
                }),
            {
                wrapper: ({children}: {children: ReactNode}) =>
                    createElement(Provider, {store}, children),
            },
        )

        await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
        act(() => FakeEventSource.instances[0].ready())
        await waitFor(() => expect(result.current.readerReady).toBe(true))

        act(() => void result.current.send({text: "start"}))
        await waitFor(() => expect(result.current.acceptedRunPending).toBe(true))
        act(() => void result.current.send({text: "held on mobile"}))
        expect(result.current.queued.map((message) => message.text)).toEqual(["held on mobile"])
        expect(fetchMock).toHaveBeenCalledTimes(1)

        act(() => first.finish())

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
        expect(result.current.queued).toHaveLength(0)
        act(() => second.finish())
        await waitFor(() => expect(result.current.acceptedRunPending).toBe(false))
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("keeps a Steer draft when durable admission is refused", async () => {
        capabilitiesViaAtom.mockResolvedValue({
            durableApprovals: true,
            queue: true,
            steer: true,
        })
        snapshotViaAtom.mockResolvedValue({
            session: {
                id: "11111111-1111-4111-8111-111111111111",
                project_id: "22222222-2222-4222-8222-222222222222",
                session_id: "session-1",
            },
            execution: null,
            execution_state: {id: "turn-1", state: "running"},
            read: {latest_sequence: 0, history_complete: true},
            pending: {inputs: [], interactions: []},
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })
        fetchMock.mockResolvedValue(new Response(null, {status: 409}))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        composerDraftBySession.set(sessionId, "keep steering draft")
        const {result} = mount(store, "rev-1", sessionId)
        await waitFor(() => expect(result.current.steerEnabled).toBe(true))

        await act(async () => {
            await expect(result.current.steer({text: "keep steering draft"})).rejects.toThrow(
                "The input was not accepted (409).",
            )
        })

        expect(composerDraftBySession.get(sessionId)).toBe("keep steering draft")
    })

    it("redelivers a durable continuation before request build and suppresses direct invoke", async () => {
        resumeContinuation.mockResolvedValueOnce(true)
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "do not race"})
        })
        await waitFor(() => expect(result.current.status).toBe("error"))

        expect(resumeContinuation).toHaveBeenCalledOnce()
        expect(vi.mocked(buildAgentRequest)).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(result.current.error).toEqual({
            code: "continuation_resumed",
            message:
                "A saved approval is resuming. Wait for it to finish, then try this message again.",
        })
    })

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

    it("keeps a pre-ready turn on the legacy delivery source when the shared reader opens mid-run", async () => {
        const legacy = controlledLegacyResponse()
        fetchMock.mockResolvedValue(legacy.response)
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = renderHook(
            () =>
                useAgentConversation({
                    entityId: "rev-1",
                    sessionId,
                    sharedReaderAdvertised: true,
                }),
            {
                wrapper: ({children}: {children: ReactNode}) =>
                    createElement(Provider, {store}, children),
            },
        )

        await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
        act(() => void result.current.send({text: "answer once"}))
        await waitFor(() =>
            expect(vi.mocked(buildAgentRequest)).toHaveBeenLastCalledWith(
                "rev-1",
                expect.any(Array),
                expect.objectContaining({sessionId, sharedResponse: false}),
            ),
        )
        await waitFor(() =>
            expect(
                result.current.messages.some(
                    (message) =>
                        message.role === "assistant" &&
                        message.parts.some(
                            (part) => part.type === "text" && part.text === "legacy answer",
                        ),
                ),
            ).toBe(true),
        )

        act(() => {
            FakeEventSource.instances[0].ready()
            for (const [frameIndex, type, payload] of [
                [0, "text-start", {}],
                [1, "text-delta", {delta: "shared duplicate"}],
            ] as const)
                FakeEventSource.instances[0].message({
                    version: 1,
                    kind: "frame",
                    session_id: sessionId,
                    execution_id: "execution-1",
                    frame_or_event_id: `frame-${frameIndex}`,
                    frame_index: frameIndex,
                    entity_id: "text-1",
                    type,
                    payload,
                    created_at: "2026-09-05T12:00:00Z",
                })
        })

        await waitFor(() =>
            expect(store.get(sessionLivePreviewAtomFamily(sessionId)).executionOrder).toEqual([
                "execution-1",
            ]),
        )
        expect(
            result.current.messages.filter((message) => message.role === "assistant"),
        ).toHaveLength(1)
        expect(
            result.current.messages.some((message) => message.id.startsWith("live-preview-")),
        ).toBe(false)

        act(() => legacy.finish())
        await waitFor(() => expect(result.current.status).toBe("ready"))
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
            expect(result.current.acceptedRunPending).toBe(true)
            expect(result.current.runStatus).toBe("running")
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
     * An accepted shared turn is NOT a local stream. Its content arrives on the session events
     * channel, so the durable snapshot behind those frames stays adoptable — and it has to be,
     * because `hydrateAndOpen` only opens the events stream once `revalidate` adopts or confirms
     * the bounded transcript. Treating `acceptedRunPending` as busy refused both, so a shared turn
     * whose stream dropped mid-run reconnected forever and never came back.
     */
    it("adopts the durable transcript while a shared turn is accepted but disconnected", async () => {
        vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
            invocationUrl: "https://agent.test/invoke",
            headers: {
                Accept: "text/event-stream",
                "content-type": "application/json",
                "x-ag-session-response": "shared",
            },
            requestBody: {session_id: opts?.sessionId},
        }))
        fetchMock.mockResolvedValue(sharedDroppedStreamResponse())
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "Draft the release note."})
        })
        await waitFor(() => {
            expect(result.current.acceptedRunPending).toBe(true)
            expect(result.current.status).not.toBe("streaming")
        })

        const serverMessages: UIMessage[] = [
            {
                id: "srv-user",
                role: "user",
                parts: [{type: "text", text: "Draft the release note."}],
            },
            {id: "srv-assistant", role: "assistant", parts: [{type: "text", text: "Here it is."}]},
        ]
        const revalidate = result.current.revalidate as unknown as (
            transcript: unknown,
        ) => Promise<boolean>
        let adopted = false
        await act(async () => {
            adopted = await revalidate({
                messages: serverMessages,
                recordCount: 2,
                sequenceCursor: 2,
            })
        })

        expect(adopted).toBe(true)
        await waitFor(() => {
            const persisted = store.get(sessionMessagesAtom)[sessionId]
            expect(persisted.map((message) => message.id)).toEqual(["srv-user", "srv-assistant"])
        })
    })

    /**
     * The other half of the rule. A stream that dies BEFORE the acceptance may describe a turn that
     * never started, so that card is the only signal the user gets and it has to survive the
     * reload.
     */
    it("turns an offline-before-send hang into a retryable failure card", async () => {
        vi.useFakeTimers()
        vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
            invocationUrl: "https://agent.test/invoke",
            headers: {
                Accept: "text/event-stream",
                "content-type": "application/json",
                "x-ag-session-response": "shared",
            },
            requestBody: {session_id: opts?.sessionId},
        }))
        // Chromium can leave an offline fetch pending instead of rejecting it.
        fetchMock.mockImplementation(() => new Promise<Response>(() => undefined))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        act(() => void result.current.send({text: "this one never left"}))
        await act(() => vi.advanceTimersByTimeAsync(SHARED_SENDER_ACCEPTANCE_TIMEOUT_MS))
        vi.useRealTimers()
        await waitFor(() => expect(result.current.runStatus).toBe("error"), {timeout: 5000})
        expect(result.current.connectionWarning).toBeUndefined()
        const failedTurn = result.current.turns.at(-1)
        expect(failedTurn?.message.role).toBe("assistant")
        expect(failedTurn?.status).toMatchObject({
            showError: true,
            errorText: TRANSPORT_ERROR_MESSAGE,
        })
        expect(result.current.rewind(failedTurn!.message)).not.toBeNull()

        await waitFor(() => {
            const persisted = store.get(sessionMessagesAtom)[sessionId]
            expect(persisted).toHaveLength(2)
            expect(persisted[0]).toMatchObject({
                role: "user",
                parts: [{type: "text", text: "this one never left"}],
            })
            const stamped = persisted[1].metadata as {runError?: {message?: string}}
            expect(stamped.runError?.message).toBe(TRANSPORT_ERROR_MESSAGE)
        })
    })

    it("resets acceptance before an immediate next-request failure", async () => {
        vi.mocked(buildAgentRequest)
            .mockImplementationOnce(async (_entityId, _messages, opts) => ({
                invocationUrl: "https://agent.test/invoke",
                headers: {
                    Accept: "text/event-stream",
                    "content-type": "application/json",
                    "x-ag-session-response": "shared",
                },
                requestBody: {session_id: opts?.sessionId},
            }))
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        fetchMock.mockImplementationOnce(async () => sharedDroppedStreamResponse())
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = renderHook(
            () =>
                useAgentConversation({
                    entityId: "rev-1",
                    sessionId,
                    sharedReaderAdvertised: true,
                }),
            {
                wrapper: ({children}: {children: ReactNode}) =>
                    createElement(Provider, {store}, children),
            },
        )

        await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
        act(() => void result.current.send({text: "accepted first"}))
        await waitFor(() => {
            expect(result.current.connectionWarning).toBe(ACCEPTED_SENDER_DISCONNECT_MESSAGE)
            expect(result.current.acceptedRunPending).toBe(true)
        })

        act(() =>
            FakeEventSource.instances[0].message({
                version: 1,
                kind: "event",
                session_id: sessionId,
                execution_id: "turn-1",
                frame_or_event_id: "lost-1",
                sequence: 1,
                watermark: 1,
                type: "execution.lost",
                payload: {},
                created_at: "2026-09-05T12:00:00Z",
            }),
        )
        await waitFor(() => expect(result.current.acceptedRunPending).toBe(false))

        act(() => void result.current.send({text: "fails before acceptance"}))
        await waitFor(() => {
            expect(result.current.connectionWarning).toBeUndefined()
            expect(result.current.error).toEqual({
                message: TRANSPORT_ERROR_MESSAGE,
                transport: true,
            })
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

    it("keeps a runner failure whose text matches a browser disconnect phrase as a run error", async () => {
        vi.mocked(buildAgentRequest).mockImplementation(async (_entityId, _messages, opts) => ({
            invocationUrl: "https://agent.test/invoke",
            headers: {
                Accept: "text/event-stream",
                "content-type": "application/json",
                "x-ag-session-response": "shared",
            },
            requestBody: {session_id: opts?.sessionId},
        }))
        fetchMock.mockResolvedValue(sharedBrowserPhraseServerErrorResponse())
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "surface the runner failure"})
        })
        await waitFor(() => expect(result.current.runStatus).toBe("error"), {timeout: 5000})

        expect(result.current.connectionWarning).toBeUndefined()
        expect(result.current.error).toEqual({message: "Failed to fetch"})
        await waitFor(() => {
            const last = result.current.turns[result.current.turns.length - 1]
            expect(last.status.errorText).toBe("Failed to fetch")
            expect(last.status.isError).toBe(true)
        })
    })
})
