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
})
