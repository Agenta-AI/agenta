import {describe, expect, it} from "vitest"

import {cancelledStopAction} from "../../src/features/chat/stopHereState"

describe("mobile local Stop state", () => {
    it("settles a parked approval as soon as the server confirms cancellation", () => {
        expect(cancelledStopAction({parked: true, streaming: false, retry: false})).toBe(
            "settle-parked",
        )
    })

    it("waits for terminal stream evidence after cancelling an active stream", () => {
        expect(cancelledStopAction({parked: false, streaming: true, retry: false})).toBe(
            "await-terminal",
        )
    })

    it("hard-aborts an active stream after the watchdog retry is accepted", () => {
        expect(cancelledStopAction({parked: false, streaming: true, retry: true})).toBe(
            "abort-retry",
        )
    })
})
