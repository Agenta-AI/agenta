/**
 * Unit tests for the template-format picker options helper.
 *
 * Pin: the design doc + WP-B3 web-handoff guarantee:
 *   - New / mustache / jinja2 → ["mustache", "jinja2"]
 *   - Curly stored → ["mustache", "jinja2", "curly"]   (legacy appended)
 *   - F-string stored → ["mustache", "jinja2", "fstring"]
 *   - Mustache is the default (first option, hint "default")
 *   - Legacy formats never offered to new prompts
 *   - Unknown / future formats: appended, never coerced
 *
 * Stopgap location: agenta-entity-ui doesn't have its own vitest runner yet.
 * Cross-package relative import below is a test-time dep only.
 */
import {describe, expect, it} from "vitest"

import {
    buildTemplateFormatOptions,
    DEFAULT_TEMPLATE_FORMAT,
} from "../../../agenta-entity-ui/src/template-format/templateFormatOptions"

describe("buildTemplateFormatOptions", () => {
    describe("new prompt (no currentFormat)", () => {
        it("offers exactly mustache + jinja2 when value is null", () => {
            const opts = buildTemplateFormatOptions(null)
            expect(opts.map((o) => o.value)).toEqual(["mustache", "jinja2"])
        })

        it("offers exactly mustache + jinja2 when value is undefined", () => {
            const opts = buildTemplateFormatOptions(undefined)
            expect(opts.map((o) => o.value)).toEqual(["mustache", "jinja2"])
        })

        it("offers exactly mustache + jinja2 when value is empty string", () => {
            const opts = buildTemplateFormatOptions("")
            expect(opts.map((o) => o.value)).toEqual(["mustache", "jinja2"])
        })

        it("marks mustache as the default", () => {
            const opts = buildTemplateFormatOptions(null)
            expect(opts[0]).toEqual({value: "mustache", label: "Mustache", hint: "default"})
        })

        it("DEFAULT_TEMPLATE_FORMAT is mustache (matches the first offered option)", () => {
            expect(DEFAULT_TEMPLATE_FORMAT).toBe("mustache")
        })
    })

    describe("prompt already on an offered format", () => {
        it("returns the same offered set when current is mustache", () => {
            const opts = buildTemplateFormatOptions("mustache")
            expect(opts.map((o) => o.value)).toEqual(["mustache", "jinja2"])
        })

        it("returns the same offered set when current is jinja2", () => {
            const opts = buildTemplateFormatOptions("jinja2")
            expect(opts.map((o) => o.value)).toEqual(["mustache", "jinja2"])
        })
    })

    describe("prompt on a legacy format", () => {
        it("appends curly to the offered set when current is curly", () => {
            const opts = buildTemplateFormatOptions("curly")
            expect(opts.map((o) => o.value)).toEqual(["mustache", "jinja2", "curly"])
        })

        it("appends fstring when current is fstring", () => {
            const opts = buildTemplateFormatOptions("fstring")
            expect(opts.map((o) => o.value)).toEqual(["mustache", "jinja2", "fstring"])
        })

        it("tags appended legacy option with hint 'legacy'", () => {
            const opts = buildTemplateFormatOptions("curly")
            const curly = opts.find((o) => o.value === "curly")
            expect(curly?.hint).toBe("legacy")
        })

        it("does NOT mark mustache as legacy when a legacy is current", () => {
            const opts = buildTemplateFormatOptions("curly")
            const mustache = opts.find((o) => o.value === "mustache")
            expect(mustache?.hint).toBe("default")
        })
    })

    describe("unknown formats (defensive — future values, stale data)", () => {
        it("appends the unknown value so the user keeps the ability to see + change it", () => {
            const opts = buildTemplateFormatOptions("future_format")
            expect(opts.map((o) => o.value)).toEqual(["mustache", "jinja2", "future_format"])
        })

        it("does not tag unknown values as 'legacy'", () => {
            const opts = buildTemplateFormatOptions("future_format")
            const future = opts.find((o) => o.value === "future_format")
            expect(future?.hint).toBeUndefined()
        })
    })

    describe("never coerce, never silently drop", () => {
        it("preserves the current value across calls (idempotent)", () => {
            const fromCurly = buildTemplateFormatOptions("curly")
            const fromCurlyAgain = buildTemplateFormatOptions("curly")
            expect(fromCurly).toEqual(fromCurlyAgain)
        })

        it("returned options always include a sensible label", () => {
            for (const current of [null, undefined, "mustache", "jinja2", "curly", "fstring"]) {
                const opts = buildTemplateFormatOptions(current as string | null | undefined)
                for (const opt of opts) {
                    expect(typeof opt.label).toBe("string")
                    expect(opt.label.length).toBeGreaterThan(0)
                }
            }
        })
    })
})
