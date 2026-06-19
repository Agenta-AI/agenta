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

    describe("original-format escape hatch", () => {
        // Kaosiso, Slack #release-v100 (2026-06-01):
        //   "For old apps, after changing the prompt syntax from curly to
        //    mustache or jinja2, the curly option is removed from the
        //    dropdown. This means users cannot switch back to curly."
        //
        // Fix: the picker keeps the ORIGINAL format selectable for the
        // lifetime of the picker (a sticky useRef in PromptSchemaControl)
        // even if the user has navigated away to a non-legacy choice.

        it("keeps a legacy curly original visible after switching to mustache", () => {
            const values = buildTemplateFormatOptions("mustache", "curly").map((o) => o.value)
            expect(values).toContain("mustache")
            expect(values).toContain("jinja2")
            expect(values).toContain("curly")
            expect(values).not.toContain("fstring")
        })

        it("keeps a legacy fstring original visible after switching to jinja2", () => {
            const values = buildTemplateFormatOptions("jinja2", "fstring").map((o) => o.value)
            expect(values).toContain("jinja2")
            expect(values).toContain("mustache")
            expect(values).toContain("fstring")
            expect(values).not.toContain("curly")
        })

        it("keeps BOTH current legacy AND original legacy visible (rare but legal)", () => {
            // A fstring prompt was loaded, user switched to curly mid-
            // session, kept it. Both should remain selectable.
            const values = buildTemplateFormatOptions("curly", "fstring").map((o) => o.value)
            expect(values).toContain("curly")
            expect(values).toContain("fstring")
        })

        it("does not duplicate when original equals current", () => {
            // Loaded at mustache, stayed at mustache. The dropdown
            // should not double-list anything.
            const values = buildTemplateFormatOptions("mustache", "mustache").map((o) => o.value)
            expect(values).toEqual(["mustache", "jinja2"])
        })

        it("does not duplicate when original is one of the offered formats", () => {
            // Loaded at jinja2, switched to mustache. Both are in the
            // OFFERED set, no extra entries needed.
            const values = buildTemplateFormatOptions("mustache", "jinja2").map((o) => o.value)
            expect(values).toEqual(["mustache", "jinja2"])
        })

        it("omitting the original is equivalent to no-original behaviour", () => {
            // Callers that don't yet pass `original` get the pre-fix
            // behaviour — only current legacy stays visible. Important
            // for non-PromptSchemaControl callers that haven't been
            // updated.
            expect(buildTemplateFormatOptions("curly")).toEqual(
                buildTemplateFormatOptions("curly", undefined),
            )
        })
    })
})
