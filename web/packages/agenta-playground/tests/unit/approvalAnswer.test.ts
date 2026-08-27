/**
 * The durable half of an approval decision — the row resolution and the resume dispatch ordering.
 *
 * Both exist because the part-state route is racy for a gateway approval: the run stream is still
 * open when the card is answered, so the SDK skips its own dispatch, and a re-seed from the stored
 * transcript can discard the local `approval-responded` flip before anything retries. The decision
 * therefore goes to the interaction row, and the resume is dispatched on the STREAM's state, never
 * on the part's.
 */
import {describe, expect, it} from "vitest"

import {
    approvalResolution,
    approvalResumeAction,
    shouldDispatchHeldResume,
} from "../../src/state/execution/approvalAnswer"

describe("approvalResolution", () => {
    // The runner reads `verdict` and no other key, so these two assertions are the contract.
    it("writes verdict exactly 'approved', with the join key", () => {
        expect(approvalResolution("call_a|fc_b", true)).toEqual({
            tool_call_id: "call_a|fc_b",
            verdict: "approved",
        })
    })

    it("writes verdict exactly 'denied' — a denial is stated, not implied by omission", () => {
        expect(approvalResolution("call_a|fc_b", false)).toEqual({
            tool_call_id: "call_a|fc_b",
            verdict: "denied",
        })
    })

    it("carries no second spelling of the decision beside verdict", () => {
        // A stray `approved`/`outcome` would give a future reader two candidate sources of truth.
        expect(Object.keys(approvalResolution("call_a|fc_b", true)).sort()).toEqual([
            "tool_call_id",
            "verdict",
        ])
    })

    it("echoes the approval id as the tool call id — they are the same value on the row", () => {
        // The runner stamps the composite onto `data.request.tool_call_id`, which is what the
        // answer joins on, so a divergence here would silently fail to find the row.
        const id = "call_28oVRjlW6ILtQ8Txn7S14hKh|fc_0ba4af9815c87426016a8fb5b5a02087d28b0c4a9f05"
        expect(approvalResolution(id, true).tool_call_id).toBe(id)
    })
})

describe("approvalResumeAction", () => {
    it("dispatches immediately when the stream is idle", () => {
        expect(approvalResumeAction(false)).toBe("dispatch")
    })

    it("holds while the stream is busy — the SDK's own guard refuses a send there", () => {
        expect(approvalResumeAction(true)).toBe("hold")
    })
})

describe("shouldDispatchHeldResume", () => {
    const marker = {kind: "approval", id: "perm_1"}

    it("fires once the stream stops being busy", () => {
        expect(shouldDispatchHeldResume({busy: false, held: true, marker})).toBe(true)
    })

    it("waits while the stream is still busy", () => {
        expect(shouldDispatchHeldResume({busy: true, held: true, marker})).toBe(false)
    })

    it("does nothing when no resume is held", () => {
        expect(shouldDispatchHeldResume({busy: false, held: false, marker})).toBe(false)
    })

    it("does not send a second request when the marker was already consumed", () => {
        // `null` is set by the SDK's own auto-resume when it dispatches, and by a stop.
        expect(shouldDispatchHeldResume({busy: false, held: true, marker: null})).toBe(false)
    })

    it("still fires when the marker was cleared to undefined by a stream error", () => {
        expect(shouldDispatchHeldResume({busy: false, held: true, marker: undefined})).toBe(true)
    })
})

describe("the decision-time ordering, end to end", () => {
    /** The click path: answer the row, then either dispatch or hold. */
    const decide = (busy: boolean, approvalId: string, approved: boolean) => ({
        written: approvalResolution(approvalId, approved),
        action: approvalResumeAction(busy),
    })

    it("answers the row even when the resume has to wait (the gateway case)", () => {
        const {written, action} = decide(true, "call_x|fc_y", true)
        expect(action).toBe("hold")
        // The answer is durable regardless of whether the resume can go out yet.
        expect(written).toEqual({tool_call_id: "call_x|fc_y", verdict: "approved"})
    })

    it("answers and dispatches together when the stream is already idle", () => {
        const {written, action} = decide(false, "call_x|fc_y", false)
        expect(action).toBe("dispatch")
        expect(written.verdict).toBe("denied")
    })

    it("a held gateway approval dispatches exactly once when the stream settles", () => {
        const {action} = decide(true, "call_x|fc_y", true)
        expect(action).toBe("hold")
        const marker = {kind: "approval", id: "call_x|fc_y"}
        // Still streaming: nothing goes out.
        expect(shouldDispatchHeldResume({busy: true, held: true, marker})).toBe(false)
        // Stream settles: the held resume fires.
        expect(shouldDispatchHeldResume({busy: false, held: true, marker})).toBe(true)
        // Once the hold is cleared, a later settle does not fire again.
        expect(shouldDispatchHeldResume({busy: false, held: false, marker})).toBe(false)
    })
})
