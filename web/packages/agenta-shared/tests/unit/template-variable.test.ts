import {describe, expect, it} from "vitest"

import {
    extractTemplateExpression,
    isValidTemplateVariable,
    validateTemplateVariable,
} from "../../src/utils/templateVariable"

// ---------------------------------------------------------------------------
// validateTemplateVariable — empty / malformed
// ---------------------------------------------------------------------------

describe("validateTemplateVariable — empty / malformed", () => {
    it("rejects an empty expression", () => {
        const result = validateTemplateVariable("")
        expect(result.valid).toBe(false)
        expect(result.reason).toMatch(/empty/i)
    })

    it("rejects expressions with consecutive dots (..)", () => {
        expect(validateTemplateVariable("$.inputs..country").valid).toBe(false)
    })

    it("rejects expressions with consecutive slashes (//)", () => {
        expect(validateTemplateVariable("/inputs//country").valid).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// validateTemplateVariable — JSONPath ($.)
// ---------------------------------------------------------------------------

describe("validateTemplateVariable — JSONPath", () => {
    it("accepts a well-formed JSONPath", () => {
        expect(validateTemplateVariable("$.inputs.country").valid).toBe(true)
    })

    it("accepts bare '$' (whole context shorthand)", () => {
        expect(validateTemplateVariable("$").valid).toBe(true)
    })

    it("rejects '$<no-dot>' (malformed root)", () => {
        const result = validateTemplateVariable("$outputs.country")
        expect(result.valid).toBe(false)
    })

    it("rejects '$.' with no field after the dot", () => {
        expect(validateTemplateVariable("$.").valid).toBe(false)
    })

    it("accepts any root segment — does NOT validate against envelope slots (permissive)", () => {
        // Per mustache QA principle: $.arbitrary is valid; runtime validates
        expect(validateTemplateVariable("$.arbitrary_column").valid).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// validateTemplateVariable — JSON Pointer (/)
// ---------------------------------------------------------------------------

describe("validateTemplateVariable — JSON Pointer", () => {
    it("accepts a pointer rooted at a known envelope slot", () => {
        expect(validateTemplateVariable("/inputs/country").valid).toBe(true)
        expect(validateTemplateVariable("/outputs/result").valid).toBe(true)
    })

    it("rejects a multi-segment pointer with an unknown root slot", () => {
        const result = validateTemplateVariable("/unknown/field")
        expect(result.valid).toBe(false)
        expect(result.reason).toMatch(/unknown envelope slot/i)
    })

    it("includes a 'did-you-mean' suggestion for near-miss slot names", () => {
        const result = validateTemplateVariable("/input/country") // 'input' ≈ 'inputs'
        expect(result.valid).toBe(false)
        expect(result.suggestion).toBe("inputs")
    })

    it("accepts a single-segment identifier-shaped pointer unconditionally (mustache close tag)", () => {
        // e.g. {{/section}} — single segment, identifier-shaped → valid
        expect(validateTemplateVariable("/section").valid).toBe(true)
    })

    it("rejects '/' with no segments", () => {
        expect(validateTemplateVariable("/").valid).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// validateTemplateVariable — plain names / dot notation
// ---------------------------------------------------------------------------

describe("validateTemplateVariable — plain names", () => {
    it("accepts plain identifiers", () => {
        expect(validateTemplateVariable("question").valid).toBe(true)
        expect(validateTemplateVariable("my_variable").valid).toBe(true)
    })

    it("accepts dot-notation paths", () => {
        expect(validateTemplateVariable("user.name").valid).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// isValidTemplateVariable
// ---------------------------------------------------------------------------

describe("isValidTemplateVariable", () => {
    it("returns true for a valid expression", () => {
        expect(isValidTemplateVariable("$.inputs.country")).toBe(true)
    })

    it("returns false for an invalid expression", () => {
        expect(isValidTemplateVariable("")).toBe(false)
        expect(isValidTemplateVariable("$outputs.x")).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// extractTemplateExpression
// ---------------------------------------------------------------------------

describe("extractTemplateExpression", () => {
    it("strips {{ }} wrappers", () => {
        expect(extractTemplateExpression("{{ $.inputs.country }}")).toBe("$.inputs.country")
    })

    it("strips {% %} wrappers", () => {
        expect(extractTemplateExpression("{% if condition %}")).toBe("if condition")
    })

    it("strips {%- -%} wrappers (whitespace-trimming variants)", () => {
        expect(extractTemplateExpression("{%- block -%}")).toBe("block")
    })

    it("strips {# #} comment wrappers", () => {
        expect(extractTemplateExpression("{# comment #}")).toBe("comment")
    })

    it("returns the raw text when no wrapper is present", () => {
        expect(extractTemplateExpression("plain")).toBe("plain")
    })

    it("returns empty string for empty input", () => {
        expect(extractTemplateExpression("")).toBe("")
    })
})
