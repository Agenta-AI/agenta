/**
 * Unit tests for the agent-lane queued-message release gate.
 *
 * The load-bearing rule is HITL SAFETY: a queued user message must NOT be released while the
 * conversation is paused on a tool-approval gate (`approval-requested`) or in the tick after the
 * user answered it but before `useChat` auto-resumes (`approval-responded`). Releasing there
 * would inject a user turn between the assistant's tool gate and its resume.
 */
import {describe, expect, it} from "vitest"

import {canReleaseQueuedMessage, isHitlPending} from "../../src/state/execution/agentMessageQueue"

const user = (text: string) => ({id: "u1", role: "user", parts: [{type: "text", text}]})

const assistantText = (text: string) => ({
    id: "a1",
    role: "assistant",
    parts: [{type: "text", text}],
})

const assistantWithTool = (state: string, approved?: boolean) => ({
    id: "a1",
    role: "assistant",
    parts: [
        {type: "step-start"},
        {
            type: "tool-deleteFile",
            toolCallId: "call_1",
            state,
            input: {path: "/x"},
            approval: approved === undefined ? {id: "perm_1"} : {id: "perm_1", approved},
        },
    ],
})

describe("isHitlPending", () => {
    it("is true while awaiting the user's decision (approval-requested)", () => {
        expect(isHitlPending([user("do it"), assistantWithTool("approval-requested")])).toBe(true)
    })

    it("is true right after a decision, before the resume fires (approval-responded)", () => {
        expect(isHitlPending([user("do it"), assistantWithTool("approval-responded", true)])).toBe(
            true,
        )
    })

    it("is false once the tool has run (output-available)", () => {
        expect(isHitlPending([user("do it"), assistantWithTool("output-available")])).toBe(false)
    })

    it("is false for a plain text answer", () => {
        expect(isHitlPending([user("hi"), assistantText("hello")])).toBe(false)
    })

    it("is false when the last turn is the user (mid-send)", () => {
        expect(isHitlPending([assistantText("hello"), user("again")])).toBe(false)
    })

    it("is false for an empty conversation", () => {
        expect(isHitlPending([])).toBe(false)
    })
})

describe("canReleaseQueuedMessage", () => {
    it("releases when idle on a settled text answer", () => {
        expect(canReleaseQueuedMessage("ready", [user("hi"), assistantText("hello")])).toBe(true)
    })

    it("does NOT release while streaming", () => {
        expect(canReleaseQueuedMessage("streaming", [user("hi"), assistantText("…")])).toBe(false)
    })

    it("does NOT release while submitted", () => {
        expect(canReleaseQueuedMessage("submitted", [user("hi")])).toBe(false)
    })

    it("does NOT release on error (queue is held for retry/clear)", () => {
        expect(canReleaseQueuedMessage("error", [user("hi"), assistantText("partial")])).toBe(false)
    })

    it("does NOT release while a tool approval is pending, even though status is ready", () => {
        expect(
            canReleaseQueuedMessage("ready", [
                user("do it"),
                assistantWithTool("approval-requested"),
            ]),
        ).toBe(false)
    })

    it("does NOT release in the pre-resume window after an approval is answered", () => {
        // `approval-responded` → agentShouldResumeAfterApproval is about to fire; holding the queue
        // lets the resume run first.
        expect(
            canReleaseQueuedMessage("ready", [
                user("do it"),
                assistantWithTool("approval-responded", true),
            ]),
        ).toBe(false)
    })

    it("releases once the approved tool has produced output and the turn settled", () => {
        expect(
            canReleaseQueuedMessage("ready", [
                user("do it"),
                assistantWithTool("output-available"),
            ]),
        ).toBe(true)
    })
})
