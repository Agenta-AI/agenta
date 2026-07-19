import type {SessionRecord} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {APPROVED_EXECUTION_RESULT_UNKNOWN, transcriptToMessages} from "./transcriptToMessages"

const record = (id: string, payload: Record<string, unknown>, sender = "agent"): SessionRecord => ({
    id,
    session_id: "session-1",
    project_id: "project-1",
    event_index: null,
    sender,
    session_update: String(payload.type),
    payload,
    created_at: null,
})

const approvalRecords = (): SessionRecord[] => [
    record("record-call", {
        type: "tool_call",
        id: "tool-1",
        name: "bash",
        input: {command: "ls"},
    }),
    record("record-request", {
        type: "interaction_request",
        id: "approval-1",
        kind: "user_approval",
        payload: {toolCallId: "tool-1"},
    }),
]

const firstPart = (records: SessionRecord[]): Record<string, unknown> => {
    const messages = transcriptToMessages(records)
    expect(messages).not.toBeNull()
    return messages?.[0].parts[0] as unknown as Record<string, unknown>
}

describe("transcriptToMessages approval hydration", () => {
    it("overlays a persisted approval response with the live response shape", () => {
        const part = firstPart([
            ...approvalRecords(),
            record("record-response", {
                type: "interaction_response",
                id: "approval-1",
                kind: "user_approval",
                payload: {toolCallId: "tool-1", approved: true},
            }),
        ])

        expect(part).toEqual({
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "approval-responded",
            input: {command: "ls"},
            approval: {id: "approval-1", approved: true},
        })
    })

    it("keeps an unanswered request pending", () => {
        const part = firstPart(approvalRecords())

        expect(part.state).toBe("approval-requested")
        expect(part.approval).toEqual({id: "approval-1"})
    })

    it("lets an executed tool result supersede a later approval response", () => {
        const part = firstPart([
            ...approvalRecords(),
            record("record-result", {
                type: "tool_result",
                id: "tool-1",
                output: "done",
            }),
            record("record-response", {
                type: "interaction_response",
                id: "approval-1",
                kind: "user_approval",
                payload: {toolCallId: "tool-1", approved: true},
            }),
        ])

        expect(part.state).toBe("output-available")
        expect(part.output).toBe("done")
        expect(part.approval).toEqual({id: "approval-1"})
    })

    it("falls back to the interaction id when the response omits the tool-call id", () => {
        const part = firstPart([
            ...approvalRecords(),
            record("record-response", {
                type: "interaction_response",
                id: "approval-1",
                kind: "user_approval",
                payload: {approved: false},
            }),
        ])

        expect(part.state).toBe("approval-responded")
        expect(part.approval).toEqual({id: "approval-1", approved: false})
    })

    it("reopens deferred call b when its turn-2 approval request arrives", () => {
        const messages = transcriptToMessages([
            record("record-user", {type: "message", text: "run both writes"}, "user"),
            record("record-call-a", {
                type: "tool_call",
                id: "tool-a",
                name: "bash",
                input: {command: "write a"},
            }),
            record("record-call-b", {
                type: "tool_call",
                id: "tool-b",
                name: "bash",
                input: {command: "write b"},
            }),
            record("record-request-a", {
                type: "interaction_request",
                id: "approval-a",
                kind: "user_approval",
                payload: {toolCallId: "tool-a"},
            }),
            record("record-result-b-deferred", {
                type: "tool_result",
                id: "tool-b",
                output: "DEFERRED_NOT_EXECUTED: paused for another approval; retry the same call if still required.",
                isError: true,
            }),
            record("record-done-turn-1", {type: "done"}),
            record("record-user-turn-2", {type: "message", text: "run both writes"}, "user"),
            record("record-response-a", {
                type: "interaction_response",
                id: "approval-a",
                kind: "user_approval",
                payload: {toolCallId: "tool-a", approved: true},
            }),
            record("record-request-b", {
                type: "interaction_request",
                id: "approval-b",
                kind: "user_approval",
                payload: {
                    toolCallId: "tool-b",
                    toolCall: {
                        toolCallId: "tool-b",
                        name: "bash",
                        rawInput: {command: "write b"},
                    },
                },
            }),
            record("record-result-a", {
                type: "tool_result",
                id: "tool-a",
                output: APPROVED_EXECUTION_RESULT_UNKNOWN,
                isError: true,
            }),
            record("record-done-turn-2", {type: "done"}),
        ])

        expect(messages).not.toBeNull()
        expect(messages?.[0]).toMatchObject({
            role: "user",
            parts: [{type: "text", text: "run both writes"}],
        })
        const assistantParts = messages
            ?.filter((message) => message.role === "assistant")
            .flatMap((message) => message.parts) as unknown as Record<string, unknown>[]
        const callA = assistantParts.find((part) => part.toolCallId === "tool-a")
        const callB = assistantParts.find((part) => part.toolCallId === "tool-b")

        expect(callA).toMatchObject({
            state: "output-error",
            errorText: APPROVED_EXECUTION_RESULT_UNKNOWN,
            approval: {id: "approval-a", approved: true},
        })
        expect(callB).toEqual({
            type: "tool-bash",
            toolCallId: "tool-b",
            state: "approval-requested",
            input: {command: "write b"},
            approval: {id: "approval-b"},
        })
        expect(assistantParts.filter((part) => part.state === "approval-requested")).toEqual([
            callB,
        ])
    })

    it("keeps a real tool error closed when a late approval request arrives", () => {
        const part = firstPart([
            record("record-call-b", {
                type: "tool_call",
                id: "tool-b",
                name: "bash",
                input: {command: "write b"},
            }),
            record("record-result-b", {
                type: "tool_result",
                id: "tool-b",
                output: "permission denied",
                isError: true,
            }),
            record("record-done-turn-1", {type: "done"}),
            record("record-request-b", {
                type: "interaction_request",
                id: "approval-b",
                kind: "user_approval",
                payload: {toolCallId: "tool-b"},
            }),
        ])

        expect(part).toEqual({
            type: "tool-bash",
            toolCallId: "tool-b",
            state: "output-error",
            input: {command: "write b"},
            errorText: "permission denied",
        })
    })
})
