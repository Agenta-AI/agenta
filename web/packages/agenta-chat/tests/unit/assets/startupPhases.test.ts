import {describe, expect, it} from "vitest"

import {
    stageWordAt,
    stageWords,
    startupPhaseFromDataPart,
    WORKING_WORDS,
} from "../../../src/assets/startupPhases"

describe("observed startup phases", () => {
    it("reads the runner's observed environment boundaries", () => {
        for (const phase of [
            "environment_starting",
            "preparing_workspace",
            "opening_session",
            "environment_ready",
        ]) {
            expect(startupPhaseFromDataPart({type: "data-agent-status", data: {phase}})).toBe(phase)
        }
    })

    it("ignores unrelated and unknown data", () => {
        expect(
            startupPhaseFromDataPart({type: "data-other", data: {phase: "environment_ready"}}),
        ).toBeNull()
        expect(
            startupPhaseFromDataPart({type: "data-agent-status", data: {phase: "future_phase"}}),
        ).toBeNull()
        expect(startupPhaseFromDataPart(null)).toBeNull()
    })

    it("rejects keys inherited from Object.prototype", () => {
        for (const phase of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
            expect(startupPhaseFromDataPart({type: "data-agent-status", data: {phase}})).toBeNull()
            expect(stageWords(phase)).toBe(WORKING_WORDS)
        }
    })
})

describe("stage words", () => {
    it("leads with the phase's own word, then cycles its loop while the phase lasts", () => {
        const words = stageWords("opening_session")
        expect(stageWordAt(words, 0)).toBe("Almost there")
        expect(stageWordAt(words, 1)).toBe("Opening the agent session")
        expect(stageWordAt(words, 2)).toBe("Starting the agent")
        expect(stageWordAt(words, 3)).toBe("Still starting up")
        expect(stageWordAt(words, 4)).toBe("Opening the agent session")
    })

    it("says Sending before any frame names the turn", () => {
        expect(stageWordAt(stageWords("sending"), 0)).toBe("Sending")
        expect(stageWordAt(stageWords("sending"), 5)).toBe("Sending")
    })

    it("rotates neutral words for a warm turn, an unknown stage, and none", () => {
        expect(stageWords("started")).toBe(WORKING_WORDS)
        expect(stageWords(null)).toBe(WORKING_WORDS)
        expect([0, 1, 2, 3].map((tick) => stageWordAt(WORKING_WORDS, tick))).toEqual([
            "Working",
            "Thinking",
            "Still working",
            "Working",
        ])
    })
})
