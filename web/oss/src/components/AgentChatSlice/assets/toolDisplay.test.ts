import {describe, expect, it} from "vitest"

import {CALL_DESCRIPTION_MAX_LENGTH, extractCallDescription, partToolName} from "./toolDisplay"

// The agent's own note about a builder tool call (R12). It rides in the call's arguments, so the
// tool card reads it straight off `input` on both the live and the replay path.
describe("extractCallDescription", () => {
    it("reads the agent's note off the call input", () => {
        expect(
            extractCallDescription({
                description: "Adding the pdf-tools skill you asked for.",
                workflow_revision: {message: "Add the pdf-tools skill."},
            }),
        ).toEqual({text: "Adding the pdf-tools skill you asked for.", truncated: false})
    })

    it("returns null when the agent wrote no note", () => {
        expect(extractCallDescription({workflow_revision: {message: "m"}})).toBeNull()
    })

    it("treats a blank note as no note", () => {
        expect(extractCallDescription({description: "   "})).toBeNull()
        expect(extractCallDescription({description: ""})).toBeNull()
    })

    it("trims surrounding whitespace", () => {
        expect(extractCallDescription({description: "  why  "})?.text).toBe("why")
    })

    it("ignores a non-string description", () => {
        expect(extractCallDescription({description: 42})).toBeNull()
        expect(extractCallDescription({description: {nested: "no"}})).toBeNull()
        expect(extractCallDescription({description: null})).toBeNull()
    })

    it("survives inputs that are not objects", () => {
        expect(extractCallDescription(undefined)).toBeNull()
        expect(extractCallDescription(null)).toBeNull()
        expect(extractCallDescription("plain")).toBeNull()
        expect(extractCallDescription(["description"])).toBeNull()
    })

    it("cuts an over-long note and says it cut it", () => {
        const long = "a".repeat(CALL_DESCRIPTION_MAX_LENGTH + 50)
        const result = extractCallDescription({description: long})
        expect(result?.truncated).toBe(true)
        expect(result?.text).toHaveLength(CALL_DESCRIPTION_MAX_LENGTH)
    })

    it("does not mark a note at exactly the limit as cut", () => {
        const exact = "a".repeat(CALL_DESCRIPTION_MAX_LENGTH)
        expect(extractCallDescription({description: exact})).toEqual({
            text: exact,
            truncated: false,
        })
    })
})

describe("partToolName", () => {
    it("strips the tool- prefix from a typed part", () => {
        expect(partToolName({type: "tool-commit_revision"} as never)).toBe("commit_revision")
    })

    it("reads toolName off a dynamic part", () => {
        expect(partToolName({type: "dynamic-tool", toolName: "test_run"} as never)).toBe("test_run")
    })
})
