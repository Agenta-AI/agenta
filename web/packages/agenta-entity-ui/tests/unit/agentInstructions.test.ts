/**
 * Reading an agent template's `instructions`. The object form `{agents_md}` is the contract; a
 * bare string is stored on some revisions and must read as the same text, not as "empty".
 */
import {describe, expect, it} from "vitest"

import {agentConfigSummary} from "../../src/agent/agentConfigSummary"
import {agentInstructionsText} from "../../src/agent/agentInstructions"

describe("agentInstructionsText", () => {
    it("reads the object form", () => {
        expect(agentInstructionsText({agents_md: "Be brief."})).toBe("Be brief.")
    })

    it("reads a bare string as shorthand for the object form", () => {
        expect(agentInstructionsText("Be brief.")).toBe("Be brief.")
    })

    it("returns null when instructions are missing", () => {
        expect(agentInstructionsText(undefined)).toBeNull()
        expect(agentInstructionsText(null)).toBeNull()
        expect(agentInstructionsText({})).toBeNull()
    })

    it("returns null for non-string shapes", () => {
        expect(agentInstructionsText(42)).toBeNull()
        expect(agentInstructionsText(["Be brief."])).toBeNull()
        expect(agentInstructionsText({agents_md: 42})).toBeNull()
        expect(agentInstructionsText({agents_md: null})).toBeNull()
    })
})

describe("agentConfigSummary instructions", () => {
    it("summarizes string-form instructions like the object form", () => {
        const fromString = agentConfigSummary({agent: {instructions: "You are the QA bot."}})
        const fromObject = agentConfigSummary({
            agent: {instructions: {agents_md: "You are the QA bot."}},
        })
        expect(fromString.instructions).toBe("You are the QA bot.")
        expect(fromString.instructionWords).toBe(5)
        expect(fromString).toEqual(fromObject)
    })
})
