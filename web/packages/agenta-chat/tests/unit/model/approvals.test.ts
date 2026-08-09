import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getPendingApprovals} from "../../../src/model/approvals"
import approvalTurnFixture from "../fixtures/approvalTurn.json"

describe("getPendingApprovals", () => {
    it("returns the pending approvals off the last assistant turn, in order", () => {
        const messages = approvalTurnFixture as UIMessage[]
        expect(getPendingApprovals(messages)).toEqual([
            {approvalId: "appr_1", toolName: "delete_file", input: {path: "notes.txt"}},
            {approvalId: "appr_2", toolName: "send_mail", input: {to: "a@b.com"}},
        ])
    })

    it("is empty when the last message is from the user", () => {
        const messages: UIMessage[] = [
            {
                id: "u1",
                role: "user",
                parts: [{type: "text", text: "hi"}],
            } as unknown as UIMessage,
        ]
        expect(getPendingApprovals(messages)).toEqual([])
    })

    it("is empty for an empty message list", () => {
        expect(getPendingApprovals([])).toEqual([])
    })
})
