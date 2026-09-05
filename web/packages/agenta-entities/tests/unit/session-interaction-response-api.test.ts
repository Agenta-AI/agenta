import {beforeEach, describe, expect, it, vi} from "vitest"

const {respond} = vi.hoisted(() => ({respond: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({respondInteraction: respond}),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {respondInteraction} from "../../src/session/api/api"

const interaction = {
    id: "interaction-1",
    session_id: "session-1",
    turn_id: "turn-1",
    token: "approval-1",
    kind: "user_approval",
    status: "responded",
    data: {resolution: {approved: true}},
}

const response = (status: number, data: unknown) => ({
    withRawResponse: () => Promise.resolve({data, rawResponse: {status}}),
})

beforeEach(() => respond.mockReset())

describe("respondInteraction", () => {
    it("forwards the execution guard and stable retry key and recognizes durable 202", async () => {
        respond.mockReturnValue(
            response(202, {
                interaction,
                command: {id: "command-1", state: "pending"},
                execution: {id: "turn-2", state: "pending"},
            }),
        )

        const result = await respondInteraction({
            interactionId: "interaction-1",
            projectId: "project-1",
            answer: {approved: true, tool_call_id: "approval-1"},
            expectedExecutionId: "turn-1",
            idempotencyKey: "approval:interaction-1:approve",
        })

        expect(respond).toHaveBeenCalledWith(
            {
                interaction_id: "interaction-1",
                answer: {approved: true, tool_call_id: "approval-1"},
                expected_execution_id: "turn-1",
            },
            expect.objectContaining({
                queryParams: {project_id: "project-1"},
                headers: {"Idempotency-Key": "approval:interaction-1:approve"},
            }),
        )
        expect(result).toMatchObject({
            accepted: true,
            interaction: {id: "interaction-1"},
            command: {id: "command-1"},
            execution: {id: "turn-2"},
        })
    })

    it("sends a same-turn approval batch in one request", async () => {
        respond.mockReturnValue(
            response(202, {
                interaction,
                command: {id: "command-1", state: "pending"},
                execution: {id: "turn-2", state: "recoverable"},
            }),
        )

        const result = await respondInteraction({
            interactionId: "interaction-1",
            projectId: "project-1",
            answers: [
                {interactionId: "interaction-1", answer: {approved: true}},
                {interactionId: "interaction-2", answer: {approved: true}},
            ],
            expectedExecutionId: "turn-1",
            idempotencyKey: "approval-batch:interaction-1:2:approve",
        })

        expect(respond).toHaveBeenCalledWith(
            {
                interaction_id: "interaction-1",
                answers: [
                    {interaction_id: "interaction-1", answer: {approved: true}},
                    {interaction_id: "interaction-2", answer: {approved: true}},
                ],
                expected_execution_id: "turn-1",
            },
            expect.objectContaining({
                headers: {"Idempotency-Key": "approval-batch:interaction-1:2:approve"},
            }),
        )
        expect(result?.execution?.state).toBe("recoverable")
    })

    it("keeps the flag-off server dispatcher response distinguishable without local resume", async () => {
        respond.mockReturnValue(response(200, {interaction}))

        const result = await respondInteraction({
            interactionId: "interaction-1",
            projectId: "project-1",
            answer: {approved: true},
        })

        expect(result?.accepted).toBe(false)
    })
})
