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

    it("remembers a terminal event that beats the response", () => {
        expect(transition([{type: "request"}, {type: "terminal"}, {type: "accepted"}])).toBe(
            "stopped",
        )
    })

    it.each(["failed", "already_idle"] as const)("returns to idle on %s", (type) => {
        expect(transition([{type: "request"}, {type}])).toBe("idle")
    })
})
