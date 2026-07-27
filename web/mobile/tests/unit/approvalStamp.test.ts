import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {stampApprovalResponses} from "../../src/features/chat/approvalStamp"

const gate = (id: string) => ({
    type: "tool-run_command",
    toolCallId: `call-${id}`,
    state: "approval-requested",
    input: {command: "ls"},
    approval: {id},
})

const transcript = (parts: unknown[]): UIMessage[] =>
    [
        {id: "u1", role: "user", parts: [{type: "text", text: "go"}]},
        {id: "a1", role: "assistant", parts},
    ] as unknown as UIMessage[]

describe("stampApprovalResponses", () => {
    it("stamps the targeted gate with the transcriptToMessages response shape", () => {
        const messages = transcript([gate("appr-1")])
        const next = stampApprovalResponses(messages, ["appr-1"], true)
        expect(next).not.toBe(messages)
        const part = (next[1].parts as Record<string, unknown>[])[0]
        expect(part.state).toBe("approval-responded")
        expect(part.approval).toEqual({id: "appr-1", approved: true})
        // Untouched fields survive — the SDK keys the envelope by toolCallId + input.
        expect(part.toolCallId).toBe("call-appr-1")
        expect(part.input).toEqual({command: "ls"})
    })

    it("stamps every listed gate in one pass (approve-all rides ONE resume)", () => {
        const messages = transcript([gate("a"), gate("b")])
        const next = stampApprovalResponses(messages, ["a", "b"], true)
        const parts = next[1].parts as Record<string, unknown>[]
        expect(parts.map((p) => p.state)).toEqual(["approval-responded", "approval-responded"])
    })

    it("records a deny as approved: false (deny also resumes)", () => {
        const next = stampApprovalResponses(transcript([gate("a")]), ["a"], false)
        expect((next[1].parts as Record<string, unknown>[])[0].approval).toEqual({
            id: "a",
            approved: false,
        })
    })

    it("returns the same array when the gate is gone or the tail is not an assistant turn", () => {
        const noGate = transcript([{type: "text", text: "done"}])
        expect(stampApprovalResponses(noGate, ["a"], true)).toBe(noGate)
        const userTail = [
            {id: "u1", role: "user", parts: [{type: "text", text: "hi"}]},
        ] as unknown as UIMessage[]
        expect(stampApprovalResponses(userTail, ["a"], true)).toBe(userTail)
        expect(stampApprovalResponses([], ["a"], true)).toEqual([])
    })

    it("does not mutate the input messages", () => {
        const messages = transcript([gate("a")])
        stampApprovalResponses(messages, ["a"], true)
        expect((messages[1].parts as Record<string, unknown>[])[0].state).toBe("approval-requested")
    })
})
