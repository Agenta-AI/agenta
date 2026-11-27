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
    it("accepts bare '$' (whole-context compact JSON)", () => {
        // Bare '$' resolves the whole context object — valid per the runtime contract.
        expect(validateTemplateVariable("$").valid).toBe(true)
    })

    it("accepts a well-formed JSONPath rooted at a known slot", () => {
        expect(validateTemplateVariable("$.inputs.country").valid).toBe(true)
        expect(validateTemplateVariable("$.outputs.result").valid).toBe(true)
    })

    it("accepts a JSONPath with an unknown root (permissive — root becomes a testcase column)", () => {
        // Per post-mustache QA: any well-formed '$.x' is valid; slot mismatches
        // surface as runtime errors from the API, not UI errors.
        const result = validateTemplateVariable("$.arbitrary_column")
        expect(result.valid).toBe(true)
    })

    it("accepts a near-miss JSONPath without a typo suggestion (permissive)", () => {
        // The JSONPath branch no longer emits 'did-you-mean' hints; the user's
        // literal text wins and the root is treated as a testcase column name.
        const result = validateTemplateVariable("$.input.country")
        expect(result.valid).toBe(true)
        expect(result.suggestion).toBeUndefined()
    })

    it("rejects `$.` (root with trailing dot, no field)", () => {
        // Only the bare `$` is a valid empty form. `$.` has nothing
        // after the dot so it can never resolve at render time —
        // surface that as an authoring error in the editor.
        const result = validateTemplateVariable("$.")
        expect(result.valid).toBe(false)
        expect(result.reason).toMatch(/has no field/i)
    })

    it("rejects `$<not-dot>...` (JSONPath root without dot)", () => {
        // `$outputs.country` is not a JSONPath — JSONPath roots descend
        // with `.` (or end at the bare `$`). Typeahead inserts the `.`;
        // this branch is the safety net for when a user bypasses typeahead
        // and types or pastes a bare `$<name>` form.
        const noDot = validateTemplateVariable("$outputs.country")
        expect(noDot.valid).toBe(false)
        expect(noDot.reason).toMatch(/must be followed by `\.`/i)

        // Same for single-segment `$foo` — also rejected.
        const noDotSingle = validateTemplateVariable("$foo")
        expect(noDotSingle.valid).toBe(false)
        expect(noDotSingle.reason).toMatch(/must be followed by `\.`/i)

        // Same for `$1` or other non-dot characters.
        expect(validateTemplateVariable("$1").valid).toBe(false)
        expect(validateTemplateVariable("$[0]").valid).toBe(false)
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

    it("accepts a single-segment identifier (may be a mustache section close tag)", () => {
        // '/identifier' is ambiguous: it could be '{{/close}}' in mustache or a
        // JSON Pointer to an envelope slot. Single-segment paths are accepted
        // unconditionally; the runtime is the source of truth.
        const result = validateTemplateVariable("/section")
        expect(result.valid).toBe(true)
    })

    it("rejects a multi-segment pointer with an unknown root slot", () => {
        const result = validateTemplateVariable("/input/country")
        expect(result.valid).toBe(false)
        expect(result.suggestion).toBe("inputs")
    })

    it("rejects '/' with no segments", () => {
        expect(validateTemplateVariable("/").valid).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// validateTemplateVariable — mustache section close tags (single-segment /)
// ---------------------------------------------------------------------------

describe("validateTemplateVariable — mustache section close tags", () => {
    // {{#languages}}...{{/languages}} — the close tag is a mustache section
    // marker, not a JSON Pointer.

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
        expect(isValidTemplateVariable("$foo")).toBe(false) // missing '.' after '$'
        expect(isValidTemplateVariable("$.")).toBe(false) // trailing dot, no field
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
