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
// validateTemplateVariable — JSONPath ($)
// ---------------------------------------------------------------------------

describe("validateTemplateVariable — JSONPath", () => {
    it("rejects bare '$' (no envelope slot after root)", () => {
        // On main: tokens after stripping '$.' are empty → invalid
        expect(validateTemplateVariable("$").valid).toBe(false)
    })

    it("accepts a well-formed JSONPath rooted at a known slot", () => {
        expect(validateTemplateVariable("$.inputs.country").valid).toBe(true)
        expect(validateTemplateVariable("$.outputs.result").valid).toBe(true)
    })

    it("rejects a JSONPath whose root is not a known envelope slot", () => {
        const result = validateTemplateVariable("$.arbitrary_column")
        expect(result.valid).toBe(false)
        expect(result.reason).toMatch(/unknown envelope slot/i)
    })

    it("includes a 'did-you-mean' suggestion for near-miss slot names", () => {
        const result = validateTemplateVariable("$.input.country") // 'input' ≈ 'inputs'
        expect(result.valid).toBe(false)
        expect(result.suggestion).toBe("inputs")
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

    it("rejects a pointer with an unknown root slot", () => {
        const result = validateTemplateVariable("/section")
        expect(result.valid).toBe(false)
        expect(result.reason).toMatch(/unknown envelope slot/i)
    })

    it("includes a 'did-you-mean' suggestion for near-miss slot names", () => {
        const result = validateTemplateVariable("/input/country")
        expect(result.valid).toBe(false)
        expect(result.suggestion).toBe("inputs")
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
        expect(isValidTemplateVariable("$.unknown_slot")).toBe(false)
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
