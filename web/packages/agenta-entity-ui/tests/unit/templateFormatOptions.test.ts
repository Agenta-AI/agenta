/**
 * Regression pin for the prompt template-format picker.
 *
 * The picker must only OFFER ``mustache`` and ``jinja2`` to new prompts. The
 * legacy ``curly`` and ``fstring`` formats were hidden at some point and then
 * reappeared in a regression; these tests fail if that hiding is lost again.
 *
 * A prompt that already stores a legacy format must still see it as an option
 * so it renders correctly and is not silently coerced to another format.
 */

import {describe, it, expect} from "vitest"

import {
    buildTemplateFormatOptions,
    OFFERED_TEMPLATE_FORMATS,
} from "../../src/DrillInView/SchemaControls/templateFormatOptions"

describe("buildTemplateFormatOptions", () => {
    it("offers only mustache and jinja2 to a new (mustache) prompt", () => {
        const values = buildTemplateFormatOptions("mustache").map((o) => o.value)
        expect(values).toEqual(["mustache", "jinja2"])
    })

    it("never offers curly or fstring as new choices", () => {
        for (const current of ["mustache", "jinja2"] as const) {
            const values = buildTemplateFormatOptions(current).map((o) => o.value)
            expect(values).not.toContain("curly")
            expect(values).not.toContain("fstring")
        }
    })

    it("keeps a legacy curly selection visible without offering it to others", () => {
        const values = buildTemplateFormatOptions("curly").map((o) => o.value)
        // The stored legacy format is appended so the prompt is not coerced...
        expect(values).toContain("curly")
        // ...but mustache and jinja2 remain the offered alternatives.
        expect(values).toContain("mustache")
        expect(values).toContain("jinja2")
        expect(values).not.toContain("fstring")
    })

    it("keeps a legacy fstring selection visible", () => {
        const values = buildTemplateFormatOptions("fstring").map((o) => o.value)
        expect(values).toContain("fstring")
        expect(values).not.toContain("curly")
    })

    it("does not duplicate the current format when it is already offered", () => {
        const values = buildTemplateFormatOptions("jinja2").map((o) => o.value)
        expect(values).toEqual(["mustache", "jinja2"])
    })

    it("labels every offered/selected value", () => {
        for (const o of buildTemplateFormatOptions("curly")) {
            expect(o.label).toMatch(/Prompt Syntax:/)
        }
    })

    it("exposes the offered set as exactly mustache + jinja2", () => {
        expect(OFFERED_TEMPLATE_FORMATS).toEqual(["mustache", "jinja2"])
    })
})
