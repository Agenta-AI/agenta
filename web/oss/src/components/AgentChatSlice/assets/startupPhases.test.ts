import {describe, expect, it} from "vitest"

import {
    INITIAL_STARTUP_LABEL,
    shouldShowStartupLadder,
    startupLabelFromDataPart,
} from "./startupPhases"

describe("observed startup labels", () => {
    it("starts with a claim that is true before the runner reports a phase", () => {
        expect(INITIAL_STARTUP_LABEL).toBe("Working")
    })

    it("maps the runner's observed environment boundaries", () => {
        expect(
            startupLabelFromDataPart({
                type: "data-agent-status",
                data: {phase: "environment_starting"},
            }),
        ).toBe("Starting the agent")
        expect(
            startupLabelFromDataPart({
                type: "data-agent-status",
                data: {phase: "environment_ready"},
            }),
        ).toBe("Agent ready")
    })

    it("ignores unrelated and unknown data", () => {
        expect(
            startupLabelFromDataPart({type: "data-other", data: {phase: "environment_ready"}}),
        ).toBeNull()
        expect(
            startupLabelFromDataPart({
                type: "data-agent-status",
                data: {phase: "future_phase"},
            }),
        ).toBeNull()
        expect(startupLabelFromDataPart(null)).toBeNull()
    })
})

describe("shouldShowStartupLadder", () => {
    it("shows safe initial feedback for a cold start", () => {
        expect(shouldShowStartupLadder({isAlive: false})).toBe(true)
    })

    it("keeps the plain loader for a warm turn", () => {
        expect(shouldShowStartupLadder({isAlive: true})).toBe(false)
    })
})
