// @vitest-environment jsdom
//
// Integration smoke for the headless conversation host. Every send is durable: it is POSTed to the
// invocation URL with `on_busy`, and the turn's content reaches the transcript from the saved
// session records once the run stream ends. The resume paths (approval, client tool, regenerate)
// still run through the REAL `useChat` engine and its transport, parsing a mocked SSE `fetch`.
// Only the app-layer seams are stubbed: the playground request builder (no live workflow config
// in a unit test) and the entities/session atoms (no query client here). The assertions cover
// send → durable admission → records → settle → persist → run-status publish, the refusal path,
// the approval and secret resumes, and the rewind plan.
import {createElement, type ReactNode} from "react"

import {
    ApprovalNotPendingError,
    fetchSessionSnapshot,
    querySessionTranscript,
    type SessionRecord,
    type SessionSnapshot,
} from "@agenta/entities/session"
import {buildAgentRequest} from "@agenta/playground/agent-chat"
import {act, renderHook, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {snapshotViaAtom, resumeContinuation, respondAnswer} = vi.hoisted(() => ({
    snapshotViaAtom: vi.fn(),
    resumeContinuation: vi.fn(),
    respondAnswer: vi.fn(),
}))

/** The session record log the records query answers with. Every send is durable now, so a turn's
 * content reaches the transcript from here once its run stream ends, never from that stream. */
const recordLog = vi.hoisted(() => ({records: null as SessionRecord[] | null}))

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
        fetchSessionRecordsAtom: atom(null, () => ({records: recordLog.records, refreshed: null})),
        fetchSessionInteractionStatesAtom: atom(null, () => new Map()),
        fetchSessionSnapshot: vi.fn(),
        querySessionTranscript: vi.fn(),
        fetchSessionSnapshotAtom: atom(null, (_get, _set, sessionId: string) =>
            snapshotViaAtom(sessionId),
        ),
        resumeSessionContinuationAtom: atom(null, () => resumeContinuation()),
        respondInteractionAnswerAtom: atom(null, (_get, _set, args) => respondAnswer(args)),
    }
})

vi.mock("@agenta/entities/trace", () => ({
    markTraceAsFresh: vi.fn(),
}))

import {useAgentConversation} from "../../../src/hooks/useAgentConversation"
import {
    composerDraftBySession,
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

const errorResponse = (): Response =>
    new Response(JSON.stringify({status: {code: 500, message: "boom"}}), {
        status: 500,
        headers: {"content-type": "application/json"},
    })

const displayText = (message: UIMessage): string | undefined =>
    (message.parts.find((part) => part.type === "text") as {text?: string} | undefined)?.text

let recordSequence = 0
const sessionRecord = (
    sessionId: string,
    sender: "user" | "agent",
    payload: Record<string, unknown>,
    turnId: string,
): SessionRecord => {
    recordSequence += 1
    return {
        id: `record-${recordSequence}`,
        session_id: sessionId,
        project_id: "project-1",
        sequence: recordSequence,
        event_index: null,
        sender,
        session_update: String(payload.type),
        payload,
        turn_id: turnId,
        created_at: null,
    }
}

/** One completed turn as the runner saves it: the user row, the answer, and its terminal. */
const completedTurnRecords = (
    sessionId: string,
    userText: string,
    answer: string,
    turnId: string,
): SessionRecord[] => [
    sessionRecord(sessionId, "user", {type: "message", text: userText}, turnId),
    sessionRecord(sessionId, "agent", {type: "message", text: answer}, turnId),
    sessionRecord(sessionId, "agent", {type: "done"}, turnId),
]

/** A turn the runner parked on a tool approval. */
const approvalTurnRecords = (sessionId: string, userText: string): SessionRecord[] => [
    sessionRecord(sessionId, "user", {type: "message", text: userText}, "turn-1"),
    sessionRecord(
        sessionId,
        "agent",
        {type: "tool_call", id: "call-1", name: "shell", input: {}},
        "turn-1",
    ),
    sessionRecord(
        sessionId,
        "agent",
        {
            type: "interaction_request",
            id: "approval-1",
            kind: "user_approval",
            payload: {toolCallId: "call-1"},
        },
        "turn-1",
    ),
    sessionRecord(sessionId, "agent", {type: "done", stopReason: "paused"}, "turn-1"),
]

/** Serve `records` as the saved log once the durable invoke for them has been made. */
const saveOnInvoke = (records: () => SessionRecord[]) => async () => {
    recordLog.records = records()
    return durableRunResponse()
}

/** The body of the durable invoke. Its content is never rendered; only its end matters. */
const durableRunResponse = (): Response =>
    new Response(sseBody("not rendered"), {
        status: 200,
        headers: {"content-type": "text/event-stream"},
    })

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
    respondAnswer
        .mockReset()
        .mockResolvedValue({durable: true, recoverable: false, executionId: "questionnaire-child"})
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
    recordLog.records = null
    recordSequence = 0
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

describe("useAgentConversation", () => {
    it("keeps a Steer draft when durable admission is refused", async () => {
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
        })
        fetchMock.mockResolvedValue(new Response(null, {status: 409}))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        composerDraftBySession.set(sessionId, "keep steering draft")
        const {result} = mount(store, "rev-1", sessionId)
        await waitFor(() => expect(result.current.inputBusy).toBe(true))

        await act(async () => {
            await expect(result.current.steer({text: "keep steering draft"})).rejects.toThrow(
                "The input was not accepted (409).",
            )
        })

        expect(composerDraftBySession.get(sessionId)).toBe("keep steering draft")
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
            on_busy: "steer",
        })
    })

    // An empty text part reaches the model as an empty text content block, which Anthropic-family
    // models refuse. v0.119.0 omitted it and the durable path still does (risk map, entry 5).
    it("sends an attachment-only message with no text part", async () => {
        fetchMock.mockResolvedValue(streamResponse("Got the file"))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        const attachment = {
            type: "file" as const,
            url: "https://files.test/report.pdf",
            mediaType: "application/pdf",
        }
        await act(async () => {
            await result.current.send({text: "", parts: [attachment]})
        })
        await waitFor(() => expect(vi.mocked(buildAgentRequest)).toHaveBeenCalled())

        const outbound = vi.mocked(buildAgentRequest).mock.calls.at(-1)?.[1].at(-1)
        expect(outbound?.parts).toEqual([attachment])
    })

    it("runs a full turn: send → run → settle → persist + status publish", async () => {
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId) // brand-new session: no hydration fetch
        fetchMock.mockImplementation(async () => {
            recordLog.records = completedTurnRecords(sessionId, "hi there", "Hello back", "turn-1")
            return durableRunResponse()
        })
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

        // The request went through the playground builder with the LIVE entity + session…
        expect(vi.mocked(buildAgentRequest)).toHaveBeenCalledWith(
            "rev-1",
            expect.any(Array),
            expect.objectContaining({sessionId}),
        )
        // …and was admitted durably: one invoke, queued behind any running turn.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("https://agent.test/invoke")
        expect(JSON.parse(String(init?.body))).toMatchObject({
            session_id: sessionId,
            on_busy: "queue",
        })

        // Turn view models: user turn + answered assistant turn, read back from the saved records.
        await waitFor(() => expect(result.current.turns).toHaveLength(2))
        expect(result.current.turns[0].isUser).toBe(true)
        expect(result.current.turns[1].status.hasAnswer).toBe(true)
        const answer = result.current.messages[1].parts.find((p) => p.type === "text") as
            | {text?: string}
            | undefined
        expect(answer?.text).toBe("Hello back")

        // Settle wrote the conversation to the package message store…
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

    it("reports an already-answered gate on the dock, not on the transcript", async () => {
        // The other path into the same refusal. `sendToolOutput` had no handler at all, so a
        // replayed client-tool answer threw into nothing; the dock's `settle` awaits through
        // `Promise.allSettled` and puts the reason on its own card, which is where a reader is
        // looking when they press Approve. Two surfaces, one refusal, and the transcript stays out
        // of it: the run has not failed.
        respondAnswer.mockRejectedValue(new ApprovalNotPendingError())
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        fetchMock.mockImplementationOnce(
            saveOnInvoke(() => approvalTurnRecords(sessionId, "needs approval")),
        )
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await result.current.send({text: "needs approval"})
        })
        await waitFor(() => expect(result.current.approvals.open).toBe(true), {timeout: 5000})

        await act(async () => result.current.approvals.respond(true))

        await waitFor(() =>
            expect(result.current.approvals.errorText).toBe(
                "This approval is no longer pending. Refresh and retry.",
            ),
        )
        expect(result.current.approvals.answered).toBe(false)
        // Re-armed, so the reader can act again after refreshing.
        expect(result.current.approvals.responding).toBe(false)
        expect(result.current.error).toBeUndefined()
        expect(result.current.turns.at(-1)?.status.showError).not.toBe(true)
        expect(result.current.runStatus).not.toBe("error")
    })

    it("survives a revision switch mid-run instead of aborting the turn", async () => {
        // Auto-commit (#6126) mints a new revision while the agent is running, and the surface
        // follows it. If that arrives as a REMOUNT the unmount teardown drops the live turn —
        // which is what a revision in the mount key did on /m. The engine is built to take it as
        // a prop: the chat is pinned to `sessionId` and the request builder reads the revision
        // through a ref.
        let releaseStream: () => void = () => {}
        const streamOpen = new Promise<void>((resolve) => {
            releaseStream = resolve
        })
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        fetchMock.mockImplementation(async () => {
            recordLog.records = completedTurnRecords(sessionId, "go", "done", "turn-1")
            return new Response(
                new ReadableStream({
                    async start(controller) {
                        controller.enqueue(new TextEncoder().encode(sseBody("done")))
                        await streamOpen
                        controller.close()
                    },
                }),
                {status: 200, headers: {"content-type": "text/event-stream"}},
            )
        })
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
        // The run stream ending still settles the turn from its saved records.
        await waitFor(
            () => {
                expect(result.current.runStatus).toBe("idle")
                expect(result.current.messages).toHaveLength(2)
            },
            {timeout: 5000},
        )
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("rewinding a user message truncates the conversation and hands back its text", async () => {
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        fetchMock.mockImplementation(
            saveOnInvoke(() => completedTurnRecords(sessionId, "rewind me", "answer", "turn-1")),
        )
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
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        // Two turns here; each invoke saves only its own turn, as a log truncated by the rewind
        // would read.
        fetchMock
            .mockImplementationOnce(
                saveOnInvoke(() => completedTurnRecords(sessionId, "first", "answer", "turn-1")),
            )
            .mockImplementationOnce(
                saveOnInvoke(() => completedTurnRecords(sessionId, "second", "answer", "turn-2")),
            )
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
        expect(displayText(result.current.messages[0])).toBe("second")

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

    it("rejects a refused send with the stated reason and keeps the composer draft", async () => {
        // A refused invoke never started a turn, so nothing is stamped on the transcript: the
        // refusal goes back to the composer, which keeps the text for another try.
        fetchMock.mockResolvedValue(errorResponse())
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        composerDraftBySession.set(sessionId, "explode")
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await expect(result.current.send({text: "explode"})).rejects.toMatchObject({
                name: "SendRefusedError",
                status: 500,
                statedReason: "boom",
                message: "boom",
            })
        })

        expect(fetchMock).toHaveBeenCalledOnce()
        expect(composerDraftBySession.get(sessionId)).toBe("explode")
        expect(result.current.messages).toHaveLength(0)
        expect(result.current.turns).toHaveLength(0)
    })
})

describe("server-owned client-tool answers", () => {
    it.each([false, true])(
        "submits client-tool answer durably without a competing local resume (error=%s)",
        async (failed) => {
            resumeContinuation.mockResolvedValue(true)
            const store = createStore()
            const sessionId = nextSessionId()
            markSessionFresh(sessionId)
            const {result} = mount(store, "rev-1", sessionId)
            const output = {action: "accept", content: {goal: "Correctness"}}

            await act(async () => {
                await result.current.sendToolOutput({
                    toolName: "request_input",
                    toolCallId: "questionnaire",
                    ...(failed ? {errorText: "Questionnaire could not be rendered"} : {output}),
                })
            })

            expect(respondAnswer).toHaveBeenCalledWith({
                sessionId,
                toolCallId: "questionnaire",
                resolution: {
                    tool_call_id: "questionnaire",
                    tool_name: "request_input",
                    ...(failed
                        ? {outcome: "error", error: "Questionnaire could not be rendered"}
                        : {outcome: "completed", output}),
                },
            })
            expect(resumeContinuation).not.toHaveBeenCalled()
            expect(fetchMock).not.toHaveBeenCalled()
        },
    )

    /** The shape Fern throws for a conflict: the status, and the route's body with its code. */
    const conflict = (code: string, message: string) =>
        Object.assign(new Error(message), {
            statusCode: 409,
            body: {code, message, retryable: false},
        })

    // `landed` is what the settle reports back: true when the gate is closed (written, or already
    // closed before us), false when the answer did not go in and the gate is still open.
    const answerOnce = async (
        result: {current: {sendToolOutput: (input: object) => Promise<boolean>}},
        landed: boolean,
    ) => {
        await act(async () => {
            await expect(
                result.current.sendToolOutput({
                    toolName: "request_input",
                    toolCallId: "questionnaire",
                    output: {action: "accept", content: {goal: "Correctness"}},
                }),
            ).resolves.toBe(landed)
        })
    }

    it("settles quietly when the server says the interaction already moved on", async () => {
        // The other half of the same condition. D139 recognised only the local guard, where no
        // pending row is found among the cached ones; the server answers 409 when the row moved on
        // underneath the decision, and nothing converted that into the settled branch, so the
        // transcript grew a run-failure callout for an approval that had gone through.
        //
        // Narrower than it reads: the route accepts a repeat of the SAME answer under the same
        // idempotency key, and accepts a row already answered with the same resolution, so a plain
        // replay never conflicts at all.
        respondAnswer.mockRejectedValue(
            conflict("execution_terminal", "The interaction is no longer pending."),
        )
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await answerOnce(result, true)

        expect(result.current.error).toBeUndefined()
        expect(result.current.turns.at(-1)?.status.showError).not.toBe(true)
        expect(result.current.runStatus).not.toBe("error")
    })

    it("shows the conflict that says the answer went somewhere else", async () => {
        // Same status, different answer. `execution_mismatch` means this interaction belongs to a
        // different execution, so the reader's decision did not land where they thought and the
        // callout is exactly where they should learn it. Keying the settled branch on 409 rather
        // than on the body's code would have swallowed this one.
        respondAnswer.mockRejectedValue(
            conflict("execution_mismatch", "The interaction belongs to a different execution."),
        )
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await answerOnce(result, false)

        await waitFor(() => {
            const last = result.current.turns.at(-1)
            expect(last?.status.showError).toBe(true)
            expect(last?.status.errorText).toContain(
                "The interaction belongs to a different execution.",
            )
        })
    })

    it("shows a reused idempotency key too, which is a different answer under one key", async () => {
        respondAnswer.mockRejectedValue(
            conflict(
                "idempotency_key_reused",
                "This idempotency key was already used for a different response.",
            ),
        )
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await answerOnce(result, false)

        await waitFor(() => expect(result.current.turns.at(-1)?.status.showError).toBe(true))
    })

    // Reloading a transcript after an approved gate replays its tool output, and the gate the
    // first submit settled is not pending any more. Nothing caught the rejection: dev showed the
    // Next error overlay reading "This approval is no longer pending. Refresh and retry." and
    // production got a silently dead approval. The mobile dock has always read it as settled.
    it("treats an answer for an already-settled gate as settled, not as a failure", async () => {
        respondAnswer.mockRejectedValue(new ApprovalNotPendingError())
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await expect(
                result.current.sendToolOutput({
                    toolName: "request_input",
                    toolCallId: "questionnaire",
                    output: {action: "accept", content: {goal: "Correctness"}},
                }),
            ).resolves.toBe(true)
        })

        expect(result.current.error).toBeUndefined()
        expect(result.current.turns.at(-1)?.status.showError).not.toBe(true)
        expect(result.current.runStatus).not.toBe("error")
    })

    it("puts a real submission failure on the transcript instead of nowhere", async () => {
        // The other half of the same missing handler: a refusal that is not "already answered"
        // has to reach the reader, and the run-failure callout is where this conversation says so.
        respondAnswer.mockRejectedValue(new Error("Approval could not be submitted."))
        const store = createStore()
        const sessionId = nextSessionId()
        markSessionFresh(sessionId)
        const {result} = mount(store, "rev-1", sessionId)

        await act(async () => {
            await expect(
                result.current.sendToolOutput({
                    toolName: "request_input",
                    toolCallId: "questionnaire",
                    output: {action: "accept", content: {goal: "Correctness"}},
                }),
            ).resolves.toBe(false)
        })

        await waitFor(() => {
            const last = result.current.turns.at(-1)
            expect(last?.status.showError).toBe(true)
            expect(last?.status.errorText).toContain("Approval could not be submitted.")
        })
    })
})
