/**
 * Unit tests for extractTemplateVariables.
 *
 * Pins: mustache block markers (`{{#name}}`, `{{/name}}`, `{{^name}}`,
 * `{{!comment}}`, `{{> partial}}`, `{{.}}`) are NOT extracted as variables.
 * They are structural mustache syntax; treating them as variables produces
 * phantom input ports for "languages" / "comment" / etc.
 *
 * Plain variables, dotted access, and JSONPath ARE extracted.
 */
import {describe, expect, it} from "vitest"

import {extractTemplateVariables} from "../../src/runnable/utils"

describe("extractTemplateVariables", () => {
    describe("mustache", () => {
        it("extracts plain variables", () => {
            expect(extractTemplateVariables("Hello {{name}}", "mustache")).toEqual(["name"])
        })

        it("extracts dotted-name access", () => {
            expect(extractTemplateVariables("Region: {{geo.region}}", "mustache")).toEqual([
                "geo.region",
            ])
        })

        it("extracts JSONPath expressions verbatim", () => {
            expect(extractTemplateVariables("{{$.geo.region}}", "mustache")).toEqual([
                "$.geo.region",
            ])
        })

        it("skips section open `{{#name}}`", () => {
            expect(
                extractTemplateVariables("{{#languages}}{{.}}{{/languages}}", "mustache"),
            ).toEqual([])
        })

        it("skips inverted section open `{{^name}}`", () => {
            expect(extractTemplateVariables("{{^empty}}none{{/empty}}", "mustache")).toEqual([])
        })

        it("skips section close `{{/name}}`", () => {
            expect(extractTemplateVariables("hello {{/languages}} world", "mustache")).toEqual([])
        })

        it("skips comments `{{! ... }}`", () => {
            expect(extractTemplateVariables("hello {{! a comment }} world", "mustache")).toEqual([])
        })

        it("skips partials `{{> name}}`", () => {
            // Partials are unsupported at runtime, but the extractor must
            // not surface them as variables either.
            expect(extractTemplateVariables("hello {{> partial}} world", "mustache")).toEqual([])
        })

        it("skips the implicit iterator `{{.}}`", () => {
            expect(extractTemplateVariables("{{.}}", "mustache")).toEqual([])
        })

        it("extracts variables alongside block markers (filters only markers)", () => {
            const out = extractTemplateVariables(
                "Hi {{name}}, list: {{#items}}- {{.}}{{/items}}. End.",
                "mustache",
            )
            expect(out).toEqual(["name"])
        })

        it("deduplicates repeated variables", () => {
            expect(extractTemplateVariables("{{a}} {{a}} {{b}}", "mustache")).toEqual(["a", "b"])
        })
    })

    describe("curly (legacy)", () => {
        it("extracts {{name}} variables (same code path as mustache)", () => {
            expect(extractTemplateVariables("Hello {{name}}", "curly")).toEqual(["name"])
        })

        it("filters out section-like prefixes too (defensive — curly doesn't use them)", () => {
            // Curly doesn't have sections, but if a user pastes mustache
            // syntax into a curly prompt, we don't want phantom ports.
            expect(extractTemplateVariables("{{#items}}{{/items}}", "curly")).toEqual([])
        })
    })

    describe("fstring", () => {
        it("extracts {variable} with single braces", () => {
            expect(extractTemplateVariables("Hello {name}", "fstring")).toEqual(["name"])
        })

        it("treats {{ as escaped literal, not a variable", () => {
            expect(extractTemplateVariables("Hello {{name}}", "fstring")).toEqual([])
        })
    })
})
