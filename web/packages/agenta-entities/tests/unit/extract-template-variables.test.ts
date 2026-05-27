/**
 * Unit tests for extractTemplateVariables.
 *
 * Mustache block syntax falls into two buckets for port discovery:
 *
 *   keep (strip prefix → variable name):
 *     - `{{#name}}` — section opener: `name` IS a variable (the iterable
 *                      truthiness check), it still needs a value.
 *     - `{{^name}}` — inverted section opener: same — `name` is a variable.
 *     - `{{&name}}` — unescaped variable: `name` IS the variable.
 *
 *   skip entirely (structural / inert tokens):
 *     - `{{/name}}`      — section closer (boundary marker only).
 *     - `{{!comment}}`   — comment.
 *     - `{{> partial}}`  — partial template inclusion.
 *     - `{{.}}`          — implicit iterator (current item, no base name).
 *
 * Plain variables, dotted access, and JSONPath are extracted as-is.
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

        it("extracts section opener `{{#name}}` as a variable", () => {
            // The opener IS a variable — `name` needs a value (array to iterate
            // or truthy value to render the block). The closer below is just
            // a boundary marker so it stays skipped.
            expect(
                extractTemplateVariables("{{#languages}}{{.}}{{/languages}}", "mustache"),
            ).toEqual(["languages"])
        })

        it("extracts inverted section opener `{{^name}}` as a variable", () => {
            expect(extractTemplateVariables("{{^empty}}none{{/empty}}", "mustache")).toEqual([
                "empty",
            ])
        })

        it("extracts unescaped variable `{{&name}}`", () => {
            expect(extractTemplateVariables("Raw: {{&html}}", "mustache")).toEqual(["html"])
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

        it("extracts variables AND section openers, skips closers and `.`", () => {
            const out = extractTemplateVariables(
                "Hi {{name}}, list: {{#items}}- {{.}}{{/items}}. End.",
                "mustache",
            )
            expect(out).toEqual(["name", "items"])
        })

        it("deduplicates repeated variables", () => {
            expect(extractTemplateVariables("{{a}} {{a}} {{b}}", "mustache")).toEqual(["a", "b"])
        })

        it("deduplicates section opener against plain reference of same name", () => {
            // `{{items}}` followed by `{{#items}}...` should still produce
            // a single `items` port.
            expect(
                extractTemplateVariables(
                    "Plain: {{items}}; List: {{#items}}- {{.}}{{/items}}.",
                    "mustache",
                ),
            ).toEqual(["items"])
        })
    })

    describe("curly (legacy)", () => {
        it("extracts {{name}} variables (same code path as mustache)", () => {
            expect(extractTemplateVariables("Hello {{name}}", "curly")).toEqual(["name"])
        })

        it("strips section-like prefixes too (defensive — curly doesn't use them)", () => {
            // Curly doesn't have sections, but if a user pastes mustache
            // syntax into a curly prompt, the same prefix-stripping rule
            // surfaces the base name. `{{#items}}` → `items`.
            expect(extractTemplateVariables("{{#items}}{{/items}}", "curly")).toEqual(["items"])
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
