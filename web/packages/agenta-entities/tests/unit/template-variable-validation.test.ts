/**
 * Unit tests for validateTemplateVariable.
 *
 * The validator decides whether a `{{...}}` token gets the "valid" style
 * (green) or the "invalid" red-dashed treatment in the Lexical editor. It
 * lives in `@agenta/shared/utils/templateVariable.ts`.
 *
 * Why these tests live in agenta-entities: agenta-shared has no vitest
 * runner of its own. Same stopgap pattern as the other tests in this
 * folder. We import via the workspace path alias rather than a relative
 * path that would couple this test to the package's folder layout.
 */
import {describe, expect, it} from "vitest"

import {validateTemplateVariable} from "@agenta/shared/utils"

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

        it("accepts when rooted at a testcase top-level column (RFC: keys are spread)", () => {
            // Per RFC: testcase top-level keys are spread into the render
            // context, so `{{$.profile.name}}` resolves against the spread
            // `profile` key. The validator must not gate this.
            expect(validateTemplateVariable("$.geo.region").valid).toBe(true)
            expect(validateTemplateVariable("$.profile.name").valid).toBe(true)
            expect(validateTemplateVariable("$.profile.tags[0]").valid).toBe(true)
            expect(validateTemplateVariable("$.country").valid).toBe(true)
        })

        // Post-mustache QA (Slack #release-v100, 2026-05-28): Mahmoud + JP
        // aligned that the playground does NOT validate JSONPath roots
        // against the envelope-slot list. Any well-formed `$.<segment>...`
        // surfaces a variable named after the root segment. Format
        // mismatches surface as runtime errors from the API, not UI errors.
        // The previous "did you mean…?" typo-detection behaviour is gone.
        it("accepts roots that prefix-match envelope slots (no typo gating)", () => {
            // Previously rejected: `input`/`output`/`out` near-typos of slots.
            expect(validateTemplateVariable("$.input.country").valid).toBe(true)
            expect(validateTemplateVariable("$.output.answer").valid).toBe(true)
            expect(validateTemplateVariable("$.out.iso").valid).toBe(true)
        })

        it("does not return a `suggestion` field for JSONPath", () => {
            // Suggestion field is only emitted by the JSON Pointer branch
            // post-2026-05-28. The JSONPath branch never returns it now.
            expect(validateTemplateVariable("$.input.country").suggestion).toBeUndefined()
            expect(validateTemplateVariable("$.output.answer").suggestion).toBeUndefined()
        })

        it("accepts the bare root `$` (whole context as compact JSON)", () => {
            expect(validateTemplateVariable("$").valid).toBe(true)
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
            // with `.` (or end at the bare `$`). Per Mahmoud's QA on the
            // mustache rollout, typeahead steers users to insert the `.`
            // automatically; this branch is the safety net for when a user
            // bypasses typeahead and types or pastes a bare `$<name>` form.
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
