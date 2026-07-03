/**
 * Unit tests for the agent-lane queued-message release gate.
 *
 * The load-bearing rule is HITL SAFETY: a queued user message must NOT be released while the
 * conversation is paused on a tool-approval gate (`approval-requested`) or in the tick after the
 * user answered it but before `useChat` auto-resumes (`approval-responded`). Releasing there
 * would inject a user turn between the assistant's tool gate and its resume. The pre-resume hold is
 * owned by `agentShouldResumeAfterApproval` (composed into `canReleaseQueuedMessage`), NOT by
 * `isHitlPending` — which tracks only the user-actionable `approval-requested` gate, in lockstep
 * with the ApprovalDock, so a settled-but-un-resumed turn can't freeze the queue with no dock.
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

/**
 * The orphan-wedge: the user answered an approval (`approval-responded`) but the resume run died
 * before the approved tool transitioned, leaving a sibling tool call stuck `input-available`. The
 * turn has settled, `agentShouldResumeAfterApproval` won't fire (a sibling isn't settled), and no
 * `approval-requested` remains → the dock is empty. This state must NOT freeze the queue.
 */
const assistantWithOrphanApproval = () => ({
    id: "a1",
    role: "assistant",
    parts: [
        {type: "step-start"},
        {
            type: "tool-deleteFile",
            toolCallId: "call_1",
            state: "approval-responded",
            input: {path: "/x"},
            approval: {id: "perm_1", approved: true},
        },
        {type: "tool-listFiles", toolCallId: "call_2", state: "input-available", input: {}},
    ],
})

describe("isHitlPending", () => {
    it("is true while awaiting the user's decision (approval-requested)", () => {
        expect(isHitlPending([user("do it"), assistantWithTool("approval-requested")])).toBe(true)
    })

    it("is false after a decision (approval-responded) — the pre-resume hold is the resume predicate's job, not this", () => {
        expect(isHitlPending([user("do it"), assistantWithTool("approval-responded", true)])).toBe(
            false,
        )
    })

    it("is false for an orphaned approval-responded turn (no approval-requested → nothing to act on)", () => {
        expect(isHitlPending([user("do it"), assistantWithOrphanApproval()])).toBe(false)
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

    it("releases on error so a failed turn re-sends the queued message (which clears the error)", () => {
        expect(canReleaseQueuedMessage("error", [user("hi"), assistantText("partial")])).toBe(true)
    })

    it("does NOT release on error while a tool approval is still pending", () => {
        expect(
            canReleaseQueuedMessage("error", [
                user("do it"),
                assistantWithTool("approval-requested"),
            ]),
        ).toBe(false)
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

    it("does NOT release in the pre-resume window after a denial is answered", () => {
        // Deny also resumes (the runner gets the denial round-trip), so the queue must hold here too.
        expect(
            canReleaseQueuedMessage("ready", [
                user("do it"),
                assistantWithTool("approval-responded", false),
            ]),
        ).toBe(false)
    })

    it("RELEASES an orphaned approval-responded turn so a wedged run can't freeze the queue forever", () => {
        // Resume died before the approved tool transitioned; a sibling is stuck `input-available`, so
        // `agentShouldResumeAfterApproval` is false and no `approval-requested` remains (empty dock).
        // The queue must release here — the freed message re-sends and recovers the wedged turn.
        expect(
            canReleaseQueuedMessage("ready", [user("do it"), assistantWithOrphanApproval()]),
        ).toBe(true)
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
