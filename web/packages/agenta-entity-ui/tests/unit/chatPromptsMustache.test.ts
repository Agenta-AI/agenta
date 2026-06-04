/**
 * Regression pin for mustache recognition in prompt template-variable extraction.
 *
 * WP-B3 adds ``mustache`` as a template format. ``extractPromptTemplateContext``
 * (in ``@agenta/shared``) must recognize a stored ``mustache`` format instead of
 * coercing it, and must extract ``{{var}}`` tokens from message content when
 * ``inputKeys`` is absent. These tests fail if mustache recognition is lost.
 */

import {extractPromptTemplateContext} from "@agenta/shared/utils"
import {describe, it, expect} from "vitest"

describe("extractPromptTemplateContext — mustache", () => {
    it("preserves a stored mustache template_format (does not coerce to curly)", () => {
        const {templateFormat} = extractPromptTemplateContext([
            {template_format: "mustache", messages: []},
        ])
        expect(templateFormat).toBe("mustache")
    })

    it("recognizes the camelCase templateFormat key too", () => {
        const {templateFormat} = extractPromptTemplateContext([
            {templateFormat: "mustache", messages: []},
        ])
        expect(templateFormat).toBe("mustache")
    })

    it("extracts {{var}} tokens from mustache message content when inputKeys is absent", () => {
        const {templateFormat, tokens} = extractPromptTemplateContext([
            {
                template_format: "mustache",
                messages: [
                    {role: "system", content: "You judge {{question}}."},
                    {role: "user", content: "Answer: {{answer}} for {{question}}"},
                ],
            },
        ])
        expect(templateFormat).toBe("mustache")
        // {{question}} appears twice but is de-duplicated; order is set-insertion.
        expect(new Set(tokens)).toEqual(new Set(["question", "answer"]))
    })

    it("still defaults to curly when no format is declared", () => {
        const {templateFormat} = extractPromptTemplateContext([{messages: []}])
        expect(templateFormat).toBe("curly")
    })

    // Mustache treats {{ name }} and {{name}} as equivalent (whitespace inside the
    // delimiters is ignored), so token extraction must match spaced tags too.
    it("extracts mustache tokens with inner whitespace ({{ name }})", () => {
        const {tokens} = extractPromptTemplateContext([
            {
                template_format: "mustache",
                messages: [
                    {role: "system", content: "Judge {{ question }} now."},
                    {role: "user", content: "A: {{answer}} / {{  question  }}"},
                ],
            },
        ])
        // spaced and unspaced forms resolve to the same identifier and de-dupe
        expect(new Set(tokens)).toEqual(new Set(["question", "answer"]))
    })

    it("extracts curly tokens with inner whitespace too", () => {
        const {tokens} = extractPromptTemplateContext([
            {
                template_format: "curly",
                messages: [{role: "user", content: "{{ name }} and {{ city }}"}],
            },
        ])
        expect(new Set(tokens)).toEqual(new Set(["name", "city"]))
    })
})
