import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getPendingApprovals} from "../../../src/model/approvals"
import approvalTurnFixture from "../fixtures/approvalTurn.json"

describe("getPendingApprovals", () => {
    it("returns pending approvals in transcript order", () => {
        const messages = approvalTurnFixture as UIMessage[]
        expect(getPendingApprovals(messages)).toEqual([
            {approvalId: "appr_1", toolName: "delete_file", input: {path: "notes.txt"}},
            {approvalId: "appr_2", toolName: "send_mail", input: {to: "a@b.com"}},
        ])
    })

    it("finds approvals before a trailing user message", () => {
        const messages = [
            ...(approvalTurnFixture as UIMessage[]),
            {
                id: "u2",
                role: "user",
                parts: [{type: "text", text: "hi"}],
            } as unknown as UIMessage,
        ]
        expect(getPendingApprovals(messages)).toEqual([
            {approvalId: "appr_1", toolName: "delete_file", input: {path: "notes.txt"}},
            {approvalId: "appr_2", toolName: "send_mail", input: {to: "a@b.com"}},
        ])
    })

    it("is empty for an empty message list", () => {
        expect(getPendingApprovals([])).toEqual([])
    })

    it.each(["done", "error"])(
        "retires a stale approval after its continuation is %s",
        (state) => {
            const [, message] = approvalTurnFixture as UIMessage[]
            const stale = {
                ...message,
                metadata: {
                    approvalContinuation: {
                        sourceExecutionId: "source-turn",
                        executionId: "continuation-turn",
                        state,
                        approvalIds: ["appr_1", "appr_2"],
                    },
                },
            } as UIMessage

            expect(getPendingApprovals([stale])).toEqual([])
        },
    )

    it("keeps a later interaction out of an earlier continuation's terminal sweep", () => {
        const [, message] = approvalTurnFixture as UIMessage[]
        const withLaterGate = {
            ...message,
            parts: [
                ...message.parts,
                {
                    type: "tool-create_issue",
                    toolCallId: "call_4",
                    state: "approval-requested",
                    input: {title: "Follow-up"},
                    approval: {id: "appr_3"},
                },
            ],
            metadata: {
                approvalContinuation: {
                    sourceExecutionId: "source-turn",
                    executionId: "continuation-turn",
                    state: "done",
                    approvalIds: ["appr_1", "appr_2"],
                },
            },
        } as UIMessage

        expect(getPendingApprovals([withLaterGate])).toEqual([
            {approvalId: "appr_3", toolName: "create_issue", input: {title: "Follow-up"}},
        ])
    })
})
