import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, expect, it, vi} from "vitest"
const {respond, transition} = vi.hoisted(() => ({respond: vi.fn(), transition: vi.fn()}))
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
                        },
                    ],
                ]),
        ),
    }
})
import {respondInteractionAnswerAtom} from "../../src/session/state/interactionAnswer"
beforeEach(() => {
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
