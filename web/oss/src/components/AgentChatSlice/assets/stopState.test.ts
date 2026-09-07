import {describe, expect, it} from "vitest"

import {isStoppingPhase, reduceStopPhase, type StopPhase} from "./stopState"

const transition = (events: Parameters<typeof reduceStopPhase>[1][]): StopPhase =>
    events.reduce(reduceStopPhase, "idle" as StopPhase)

describe("stop state", () => {
    it("enters stopping while the request is pending", () => {
        const phase = transition([{type: "request"}])

        expect(phase).toBe("requesting")
        expect(isStoppingPhase(phase)).toBe(true)
    })

    it("stays stopping after acceptance until the stream terminates", () => {
        const phase = transition([{type: "request"}, {type: "accepted"}])

        expect(phase).toBe("accepted")
        expect(isStoppingPhase(phase)).toBe(true)
        expect(reduceStopPhase(phase, {type: "terminal"})).toBe("stopped")
    })

    it("settles immediately when the server cancels a parked turn", () => {
        const phase = transition([{type: "request"}, {type: "cancelled", parked: true}])

        expect(phase).toBe("stopped")
        expect(isStoppingPhase(phase)).toBe(false)
    })

    it("keeps waiting for a streaming turn after the server accepts cancellation", () => {
        const phase = transition([{type: "request"}, {type: "cancelled", parked: false}])

        expect(phase).toBe("accepted")
        expect(isStoppingPhase(phase)).toBe(true)
    })

    it("remembers a terminal event that beats the response", () => {
        expect(transition([{type: "request"}, {type: "terminal"}, {type: "accepted"}])).toBe(
            "stopped",
        )
    })

    it("keeps an ordinary terminal event idle", () => {
        const phase = transition([{type: "terminal"}])

        expect(phase).toBe("idle")
        expect(isStoppingPhase(phase)).toBe(false)
    })

    it("makes an accepted stop retryable after the watchdog timeout", () => {
        const phase = transition([{type: "request"}, {type: "accepted"}, {type: "timeout"}])

        expect(phase).toBe("retryable")
        expect(isStoppingPhase(phase)).toBe(false)
        expect(reduceStopPhase(phase, {type: "terminal"})).toBe("stopped")
    })

    it.each(["failed", "already_idle"] as const)("returns to idle on %s", (type) => {
        expect(transition([{type: "request"}, {type}])).toBe("idle")
    })
})
