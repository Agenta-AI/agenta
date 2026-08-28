// The durable half of an approval decision: the row resolution, and what retires the gate marker.
// The resume itself is the SDK's, so nothing here starts one.
import {describe, expect, it} from "vitest"

import {approvalResolution, isResumeSend} from "../../src/state/execution/approvalAnswer"

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

describe("isResumeSend", () => {
    it("reads a move into submitted as a request going out", () => {
        // `submitted` is entered from `makeRequest` and nowhere else, so this transition IS a send.
        expect(isResumeSend({from: "error", to: "submitted"})).toBe(true)
        expect(isResumeSend({from: "ready", to: "submitted"})).toBe(true)
    })

    it("does not read the open stream the card was answered on as a send", () => {
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

// The hook's gate-marker lifecycle: `answer` is the click, `step` is one stream-state change.
const drive = (initial: string) => {
    let previous = initial
    let marker: {kind: string; id: string} | null | undefined = null
    const chat = {
        written: [] as Record<string, unknown>[],
        answer(id: string, approved: boolean) {
            marker = {kind: "approval", id}
            chat.written.push(approvalResolution(id, approved))
        },
        step(status: string) {
            if (isResumeSend({from: previous, to: status})) marker = null
            previous = status
        },
        /** `handleStop`: the gate is void. */
        stop() {
            marker = null
        },
        get liveGate() {
            return marker
        },
    }
    return chat
}

describe("the click path", () => {
    it("writes the row for the verdict it was given", () => {
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", false)
        expect(chat.written).toEqual([{tool_call_id: "call_x|fc_y", verdict: "denied"}])
    })

    it("marks the gate live so the SDK's predicate resumes a decision made in this mount", () => {
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        expect(chat.liveGate).toEqual({kind: "approval", id: "call_x|fc_y"})
    })
})

describe("retiring the live gate", () => {
    it("keeps it through the park finish, then retires it on the SDK's resume", () => {
        // The window between is the point: the predicate is consulted at the finish and still
        // needs the marker, and only the send that follows may spend it.
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        chat.step("ready")
        expect(chat.liveGate).not.toBeNull()
        chat.step("submitted")
        expect(chat.liveGate).toBeNull()
    })

    it("does not retire it on an errored finish, where the SDK sends nothing", () => {
        // `if (sendAutomaticallyWhen(...) && !isError)`: the predicate's verdict is discarded, so
        // nothing was sent and the marker must survive.
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        chat.step("error")
        expect(chat.liveGate).not.toBeNull()
    })

    it("retires it on a stop, which resumes nothing", () => {
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        chat.stop()
        chat.step("ready")
        expect(chat.liveGate).toBeNull()
    })
})
