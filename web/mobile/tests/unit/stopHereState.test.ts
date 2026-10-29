import {describe, expect, it} from "vitest"

import {cancelledStopAction} from "../../src/features/chat/stopHereState"

describe("mobile local Stop state", () => {
    it("settles a parked approval as soon as the server confirms cancellation", () => {
        expect(
            cancelledStopAction({
                parkedAtRequest: true,
                parkedAtResponse: true,
                streaming: false,
                retry: false,
                executionState: "stopping",
            }),
        ).toBe("settle-parked")
    })

    it("settles when a streaming run parks before cancellation returns", () => {
        expect(
            cancelledStopAction({
                parkedAtRequest: false,
                parkedAtResponse: true,
                streaming: false,
                retry: false,
                executionState: "stopping",
            }),
        ).toBe("settle-parked")
    })

    it("waits for terminal stream evidence after cancelling an active stream", () => {
        expect(
            cancelledStopAction({
                parkedAtRequest: false,
                parkedAtResponse: false,
                streaming: true,
                retry: false,
                executionState: "stopping",
            }),
        ).toBe("await-terminal")
    })

    it("hard-aborts an active stream after the watchdog retry is accepted", () => {
        expect(
            cancelledStopAction({
                parkedAtRequest: false,
                parkedAtResponse: false,
                streaming: true,
                retry: true,
                executionState: "stopping",
            }),
        ).toBe("abort-retry")
    })

    it("keeps Stopping for a run not streamed here until the server reflects the stop", () => {
        expect(
            cancelledStopAction({
                parkedAtRequest: false,
                parkedAtResponse: false,
                streaming: false,
                retry: false,
                executionState: "stopping",
            }),
        ).toBe("await-server")
    })

    it("settles a run not streamed here once the server reports it idle", () => {
        expect(
            cancelledStopAction({
                parkedAtRequest: false,
                parkedAtResponse: false,
                streaming: false,
                retry: false,
                executionState: "idle",
            }),
        ).toBe("settle-idle")
    })

    it("settles an acknowledged legacy Stop without waiting for the client deadline", () => {
        expect(
            cancelledStopAction({
                parkedAtRequest: false,
                parkedAtResponse: false,
                streaming: true,
                retry: false,
                executionState: "idle",
            }),
        ).toBe("abort-settled")
    })
})
