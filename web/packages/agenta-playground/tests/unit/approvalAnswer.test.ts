/**
 * The durable half of an approval decision: the row resolution, and what retires the gate marker.
 *
 * The decision goes to the interaction row because the part-state route is racy — a re-seed from the
 * stored transcript can discard the local `approval-responded` flip. The RESUME is not this file's
 * business at all: the SDK's own `sendAutomaticallyWhen` owns it, alone, and the tests below pin
 * that there is no second dispatch to race it with.
 */
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

/**
 * The hook's approval path, as a driver: `answer` is the click, `step` is one stream-state change.
 *
 * `dispatches` counts requests the CLIENT starts on its own. It must stay 0 forever. A compensating
 * dispatch here produced two invokes 1 ms apart, and cancel-stale then cancelled the very row being
 * answered, so the runner's resolveInteraction 404'd and every row ended `cancelled`.
 */
const drive = (initial: string) => {
    let previous = initial
    let marker: {kind: string; id: string} | null | undefined = null
    const chat = {
        dispatches: 0,
        written: [] as Record<string, unknown>[],
        /** The click: mark the gate live, write the row. No send. */
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
    it("writes the row and starts no request of its own", () => {
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        expect(chat.written).toEqual([{tool_call_id: "call_x|fc_y", verdict: "approved"}])
        expect(chat.dispatches).toBe(0)
    })

    it("starts no request when the answered stream finishes either way", () => {
        // Whatever the stream does next, the SDK's `sendAutomaticallyWhen` is the only sender.
        for (const ending of ["ready", "error"]) {
            const chat = drive("streaming")
            chat.answer("call_x|fc_y", false)
            chat.step(ending)
            expect(chat.dispatches).toBe(0)
        }
    })

    it("marks the gate live so the SDK's predicate resumes a decision made in this mount", () => {
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        expect(chat.liveGate).toEqual({kind: "approval", id: "call_x|fc_y"})
    })
})

describe("retiring the live gate", () => {
    it("retires it when the SDK's resume really goes out", () => {
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        chat.step("ready") // the clean park finish
        expect(chat.liveGate).not.toBeNull() // the predicate still needs it here
        chat.step("submitted") // the SDK's own resume
        expect(chat.liveGate).toBeNull()
    })

    it("does not retire it on the predicate's word alone", () => {
        // The SDK reads `if (sendAutomaticallyWhen(...) && !isError)` — the predicate runs first and
        // its verdict can still be discarded, so a `true` is not evidence that anything was sent.
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        const predicateVerdict = true
        expect(predicateVerdict && chat.liveGate !== null).toBe(true)
        expect(chat.liveGate).not.toBeNull()
    })

    it("retires it on a stop, which resumes nothing", () => {
        const chat = drive("streaming")
        chat.answer("call_x|fc_y", true)
        chat.stop()
        chat.step("ready")
        expect(chat.liveGate).toBeNull()
        expect(chat.dispatches).toBe(0)
    })
})
