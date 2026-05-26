/**
 * Unit tests for validateTemplateVariable.
 *
 * The validator decides whether a `{{...}}` token gets the "valid" style
 * (green) or the "invalid" red-dashed treatment in the Lexical editor. It
 * lives in `@agenta/shared/utils/templateVariable.ts`.
 *
 * Why these tests live in agenta-entities: agenta-shared has no vitest
 * runner of its own. Same stopgap pattern as the other tests in this
 * folder. Cross-package relative import below is a test-time dep only.
 */
import {describe, expect, it} from "vitest"

import {validateTemplateVariable} from "../../../agenta-shared/src/utils/templateVariable"

describe("validateTemplateVariable", () => {
    describe("plain names + dot notation", () => {
        it("accepts a plain variable name", () => {
            expect(validateTemplateVariable("country")).toEqual({valid: true})
        })

        it("accepts dotted access", () => {
            expect(validateTemplateVariable("geo.region")).toEqual({valid: true})
            expect(validateTemplateVariable("geo.coordinates.lat")).toEqual({valid: true})
        })

        it("rejects an empty expression", () => {
            expect(validateTemplateVariable("").valid).toBe(false)
        })

        it("rejects expressions with consecutive separators", () => {
            expect(validateTemplateVariable("a..b").valid).toBe(false)
            expect(validateTemplateVariable("/a//b").valid).toBe(false)
        })
    })

    describe("JSONPath ($-prefixed)", () => {
        it("accepts when rooted at a known envelope slot", () => {
            expect(validateTemplateVariable("$.inputs.country").valid).toBe(true)
            expect(validateTemplateVariable("$.outputs.answer").valid).toBe(true)
            expect(validateTemplateVariable("$.parameters.temperature").valid).toBe(true)
            expect(validateTemplateVariable("$.trace.span_id").valid).toBe(true)
        })

        it("rejects when rooted at an unknown segment", () => {
            const result = validateTemplateVariable("$.geo.region")
            expect(result.valid).toBe(false)
            expect(result.reason).toMatch(/Unknown envelope slot/i)
        })

        it("suggests the nearest envelope slot on typos", () => {
            const result = validateTemplateVariable("$.input.country")
            expect(result.valid).toBe(false)
            expect(result.suggestion).toBe("inputs")
        })
    })

    describe("JSON Pointer (/-prefixed) — multi-segment", () => {
        it("accepts multi-segment paths rooted at a known slot", () => {
            expect(validateTemplateVariable("/inputs/country").valid).toBe(true)
            expect(validateTemplateVariable("/outputs/answer/iso").valid).toBe(true)
        })

        it("rejects multi-segment paths rooted at an unknown slot", () => {
            const result = validateTemplateVariable("/input/country")
            expect(result.valid).toBe(false)
            expect(result.suggestion).toBe("inputs")
        })
    })

    describe("mustache section close tags (single-segment /-prefixed)", () => {
        // {{#languages}}...{{/languages}} — the close tag is a mustache section
        // marker, not a JSON Pointer. Before this branch's fix, the validator
        // mistook it for a JSON Pointer and rejected it because `languages`
        // isn't in KNOWN_ENVELOPE_SLOTS.

        it("accepts `/identifier` (simple mustache section close)", () => {
            expect(validateTemplateVariable("/languages").valid).toBe(true)
            expect(validateTemplateVariable("/items").valid).toBe(true)
            expect(validateTemplateVariable("/users").valid).toBe(true)
        })

        it("accepts `/dotted.identifier` (mustache dotted section close)", () => {
            expect(validateTemplateVariable("/profile.name").valid).toBe(true)
            expect(validateTemplateVariable("/a.b.c").valid).toBe(true)
        })

        it("accepts `/_underscored`", () => {
            expect(validateTemplateVariable("/_private").valid).toBe(true)
        })

        it("does NOT short-circuit multi-segment JSON Pointers", () => {
            // Multi-segment paths still go through the envelope-slot check.
            const result = validateTemplateVariable("/wrong/path")
            expect(result.valid).toBe(false)
            expect(result.reason).toMatch(/Unknown envelope slot/i)
        })

        it("rejects identifier-shaped paths that aren't valid identifiers (numeric leading)", () => {
            // Numeric-leading isn't a valid mustache identifier or an envelope
            // slot — fall through to JSON Pointer validation and reject.
            expect(validateTemplateVariable("/123abc").valid).toBe(false)
        })
    })
})
