import {describe, expect, it} from "vitest"

import {decidedByAnnotation, fromTriStateSelectValue, toTriStateSelectValue} from "./PolicyEditor"

describe("decidedByAnnotation", () => {
    it("renders disabled-with-reason when decided_by is capability, regardless of the level being edited", () => {
        expect(decidedByAnnotation("capability", "agent").kind).toBe("capability-denied")
        expect(decidedByAnnotation("capability", "space").kind).toBe("capability-denied")
        expect(decidedByAnnotation("capability", "grant").kind).toBe("capability-denied")
    })

    it("renders enabled-but-inert when decided_by names a level other than the one being edited", () => {
        // Agent-denied / space-permits fixture: the space control must still show
        // decided_by = agent, proving the UI doesn't just render its own stated value.
        const annotation = decidedByAnnotation("agent", "space")
        expect(annotation).toEqual(expect.objectContaining({kind: "inert", decidingLevel: "agent"}))
    })

    it("renders decided-here when the editing level itself decided the field", () => {
        expect(decidedByAnnotation("space", "space").kind).toBe("decided-here")
    })

    it("renders nothing when no level is given", () => {
        expect(decidedByAnnotation(undefined, "agent").kind).toBe("none")
    })
})

describe("tri-state boolean round-trip", () => {
    it("unstated (undefined/null) maps to the 'unstated' select value", () => {
        expect(toTriStateSelectValue(undefined)).toBe("unstated")
        expect(toTriStateSelectValue(null)).toBe("unstated")
    })

    it("true/false map to their own select values", () => {
        expect(toTriStateSelectValue(true)).toBe("true")
        expect(toTriStateSelectValue(false)).toBe("false")
    })

    it("clearing back to 'unstated' produces undefined, never false", () => {
        // Clearing a boolean field
        // must round-trip as absent/None in the PUT body, not false.
        expect(fromTriStateSelectValue("unstated")).toBeUndefined()
        expect(fromTriStateSelectValue("unstated")).not.toBe(false)
    })

    it("'true'/'false' select values map back to real booleans", () => {
        expect(fromTriStateSelectValue("true")).toBe(true)
        expect(fromTriStateSelectValue("false")).toBe(false)
    })

    it("round-trips true -> select -> true, and unstated -> select -> undefined", () => {
        expect(fromTriStateSelectValue(toTriStateSelectValue(true))).toBe(true)
        expect(fromTriStateSelectValue(toTriStateSelectValue(undefined))).toBeUndefined()
    })
})
