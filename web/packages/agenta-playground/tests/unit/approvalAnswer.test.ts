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
    heldResumeDecision,
    isResumeSend,
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

describe("isResumeSend", () => {
    it("reads a move into submitted as a request going out", () => {
        // `submitted` is entered from `makeRequest` and nowhere else, so this transition IS a send.
        expect(isResumeSend({from: "error", to: "submitted"})).toBe(true)
        expect(isResumeSend({from: "ready", to: "submitted"})).toBe(true)
    })

    it("does not read the original open stream as a send", () => {
        // The state at click time. Reading this as a send would drop the hold before anything went.
        expect(isResumeSend({from: "streaming", to: "streaming"})).toBe(false)
    })

    it("does not read a settle as a send", () => {
        expect(isResumeSend({from: "streaming", to: "error"})).toBe(false)
        expect(isResumeSend({from: "streaming", to: "ready"})).toBe(false)
    })

    it("counts one send once, not once per render", () => {
        expect(isResumeSend({from: "submitted", to: "submitted"})).toBe(false)
    })
})

describe("heldResumeDecision", () => {
    it("waits while the answered stream is still open", () => {
        expect(heldResumeDecision({busy: true, held: true, sent: false})).toBe("wait")
    })

    it("dispatches when the stream settles with nothing sent", () => {
        expect(heldResumeDecision({busy: false, held: true, sent: false})).toBe("dispatch")
    })

    it("releases the hold when a request really went out, without sending a second", () => {
        expect(heldResumeDecision({busy: true, held: true, sent: true})).toBe("release")
        expect(heldResumeDecision({busy: false, held: true, sent: true})).toBe("release")
    })

    it("does nothing when no resume is held", () => {
        expect(heldResumeDecision({busy: false, held: false, sent: false})).toBe("wait")
        expect(heldResumeDecision({busy: false, held: false, sent: true})).toBe("wait")
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

    it("holds while the answered stream is open, then dispatches once it settles", () => {
        const {action} = decide(true, "call_x|fc_y", true)
        expect(action).toBe("hold")
        const chat = drive("streaming", true)
        chat.step("streaming") // still the same open stream
        expect(chat.dispatches).toBe(0)
        chat.step("error")
        expect(chat.dispatches).toBe(1)
        chat.step("ready") // a later settle finds no hold
        expect(chat.dispatches).toBe(1)
    })
})

/**
 * The hook's held-resume effect, as a driver: one `step` per stream-state change.
 *
 * It exists because the whole defect lived in the ORDER of these steps, not in any single rule —
 * the predicate consumed the hold's token, then the SDK declined to send, and the hold refused a
 * dispatch for a request that never left.
 */
const drive = (initial: string, held: boolean) => {
    let previous = initial
    let holding = held
    const chat = {
        dispatches: 0,
        step(status: string) {
            const sent = isResumeSend({from: previous, to: status})
            previous = status
            const busy = status === "submitted" || status === "streaming"
            const decision = heldResumeDecision({busy, held: holding, sent})
            if (decision === "wait") return
            holding = false
            if (decision === "dispatch") chat.dispatches += 1
        },
        /** `handleStop`: the gate is void, so the hold goes with it. */
        stop() {
            holding = false
        },
        get held() {
            return holding
        },
    }
    return chat
}

describe("the SDK's finish path, which the hold has to survive", () => {
    it("leaves the hold armed when the predicate says yes on an errored stream", () => {
        // The SDK reads `if (sendAutomaticallyWhen(...) && !isError)`: the predicate runs FIRST and
        // its verdict is then thrown away. A predicate that consumed the hold would strand the
        // answer here — this is the measured deadlock, and why the wrapper is side-effect-free.
        const predicateVerdict = true
        const isError = true
        const sdkSent = predicateVerdict && !isError
        expect(sdkSent).toBe(false)

        const chat = drive("streaming", true)
        chat.step("error")
        expect(chat.dispatches).toBe(1)
    })

    it("clears the hold without a second dispatch when the SDK's own send is observed", () => {
        // A clean finish: the SDK's predicate is true, `isError` is false, so it sends by itself.
        const chat = drive("streaming", true)
        chat.step("submitted")
        expect(chat.dispatches).toBe(0)
        expect(chat.held).toBe(false)
        // And the resumed stream settling does not fire a duplicate.
        chat.step("streaming")
        chat.step("ready")
        expect(chat.dispatches).toBe(0)
    })

    it("sends nothing after a stop, even though a stop settles the stream", () => {
        const chat = drive("streaming", true)
        chat.stop()
        chat.step("ready") // what `stop()` leaves behind
        expect(chat.dispatches).toBe(0)
    })
})
