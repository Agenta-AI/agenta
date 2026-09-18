import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, expect, it, vi} from "vitest"

const {respond, transition} = vi.hoisted(() => ({respond: vi.fn(), transition: vi.fn()}))
let rowStatus: "pending" | "responded" | "resolved" | "cancelled" = "pending"
vi.mock("../../src/session/api/api", () => ({
    respondInteraction: respond,
    transitionInteraction: transition,
    fetchSessionDurableApprovalsCapability: vi.fn(),
    resumeSessionContinuation: vi.fn(),
}))
vi.mock("../../src/session/state/interactionStatus", async () => {
    const {atom} = await import("jotai")
    return {
        sessionInteractionRowsQueryKey: () => ["interaction-rows"],
        fetchSessionInteractionStatesAtom: atom(
            null,
            () =>
                new Map([
                    [
                        "questionnaire",
                        {
                            id: "interaction-id",
                            toolCallId: "questionnaire",
                            token: "token",
                            turnId: "queued-parent",
                            status: rowStatus,
                            kind: "client_tool",
                        },
                    ],
                ]),
        ),
    }
})
import {
    respondInteractionAnswerAtom,
    respondInteractionAnswersAtom,
} from "../../src/session/state/interactionAnswer"

beforeEach(() => {
    rowStatus = "pending"
    respond.mockReset().mockResolvedValue({
        accepted: true,
        execution: {id: "answer-child", state: "pending_delivery"},
    })
    transition.mockReset()
})

it("preserves questionnaire content and stable retry identity without legacy transition", async () => {
    const store = createStore()
    store.set(projectIdAtom, "project-id")
    store.set(queryClientAtom, new QueryClient())
    const resolution = {
        tool_call_id: "questionnaire",
        tool_name: "request_input",
        outcome: "completed",
        output: {action: "accept", content: {goal: "Correctness", unchangedDefault: "yes"}},
    }
    const args = {sessionId: "session-id", toolCallId: "questionnaire", resolution}
    expect(await store.set(respondInteractionAnswerAtom, args)).toEqual({
        durable: true,
        recoverable: false,
        executionId: "answer-child",
    })
    await store.set(respondInteractionAnswerAtom, args)
    expect(respond).toHaveBeenNthCalledWith(1, {
        projectId: "project-id",
        interactionId: "interaction-id",
        answer: resolution,
        expectedExecutionId: "queued-parent",
        idempotencyKey: "client-tool:interaction-id",
    })
    expect(respond.mock.calls[1]).toEqual(respond.mock.calls[0])
    expect(transition).not.toHaveBeenCalled()
})

it("preserves native approval answer and retry identity", async () => {
    const store = createStore()
    store.set(projectIdAtom, "project-id")
    store.set(queryClientAtom, new QueryClient())
    await store.set(respondInteractionAnswerAtom, {
        sessionId: "session-id",
        toolCallId: "questionnaire",
        approved: false,
    })
    expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
            answer: {approved: false, tool_call_id: "questionnaire"},
            idempotencyKey: "approval:interaction-id:deny",
        }),
    )
})

it.each(["responded", "resolved", "cancelled"] as const)(
    "does not submit a %s interaction row",
    async (status) => {
        rowStatus = status
        const store = createStore()
        store.set(projectIdAtom, "project-id")
        store.set(queryClientAtom, new QueryClient())

        await expect(
            store.set(respondInteractionAnswerAtom, {
                sessionId: "session-id",
                toolCallId: "questionnaire",
                approved: true,
            }),
        ).rejects.toThrow("This approval is no longer pending. Refresh and retry.")
        expect(respond).not.toHaveBeenCalled()
    },
)

it("does not submit a batch containing a terminal interaction row", async () => {
    rowStatus = "cancelled"
    const store = createStore()
    store.set(projectIdAtom, "project-id")
    store.set(queryClientAtom, new QueryClient())

    await expect(
        store.set(respondInteractionAnswersAtom, {
            sessionId: "session-id",
            toolCallIds: ["questionnaire"],
            approved: true,
        }),
    ).rejects.toThrow("One or more approvals are no longer pending. Refresh and retry.")
    expect(respond).not.toHaveBeenCalled()
})
