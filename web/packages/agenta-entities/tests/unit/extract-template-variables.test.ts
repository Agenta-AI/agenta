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

import {extractMustacheSectionOpeners, extractTemplateVariables} from "../../src/runnable/utils"

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
        it("extracts {{name}} variables", () => {
            expect(extractTemplateVariables("Hello {{name}}", "curly")).toEqual(["name"])
        })

        it("extracts dotted access {{user.name}}", () => {
            expect(extractTemplateVariables("Hello {{user.name}}", "curly")).toEqual([
                "user.name",
            ])
        })

        it("SKIPS mustache-style markers (no section semantics in curly)", () => {
            // Curly has no section / inverted-section / comment / partial
            // syntax. If the user types `{{#items}}` it's an authoring
            // error (mustache syntax pasted in). Don't extract — the
            // editor still highlights the bad token visually, but no
            // phantom port appears in the playground. The user can fix
            // the template instead of being silently "helped".
            expect(extractTemplateVariables("{{#items}}{{/items}}", "curly")).toEqual([])
            expect(extractTemplateVariables("{{^empty}}none{{/empty}}", "curly")).toEqual([])
            expect(extractTemplateVariables("{{&unescaped}}", "curly")).toEqual([])
            expect(extractTemplateVariables("{{!comment}}", "curly")).toEqual([])
            expect(extractTemplateVariables("{{> partial}}", "curly")).toEqual([])
            expect(extractTemplateVariables("{{.}}", "curly")).toEqual([])
        })

        it("still extracts plain variables next to a bad mustache token", () => {
            // Mixed authoring: the legit `{{name}}` survives; the
            // `{{#items}}` mistake is dropped.
            expect(extractTemplateVariables("Hi {{name}}, list: {{#items}}.", "curly")).toEqual(
                ["name"],
            )
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

describe("extractMustacheSectionOpeners", () => {
    it("returns an empty set for non-mustache formats", () => {
        // Section semantics are mustache-specific. Other formats don't get
        // the hint even if `#name` appears in their templates.
        expect(extractMustacheSectionOpeners("{{#name}}{{/name}}", "curly").size).toBe(0)
        expect(extractMustacheSectionOpeners("{{#name}}{{/name}}", "jinja2").size).toBe(0)
        expect(extractMustacheSectionOpeners("{#name}{/name}", "fstring").size).toBe(0)
    })

    it("picks up `{{#name}}` openers", () => {
        const out = extractMustacheSectionOpeners(
            "{{#languages}}{{.}}{{/languages}}",
            "mustache",
        )
        expect(Array.from(out)).toEqual(["languages"])
    })

    it("picks up `{{^name}}` inverted-section openers", () => {
        const out = extractMustacheSectionOpeners("{{^empty}}none{{/empty}}", "mustache")
        expect(Array.from(out)).toEqual(["empty"])
    })

    it("excludes `{{&name}}` (unescape is a variable, not a section)", () => {
        expect(extractMustacheSectionOpeners("{{&html}}", "mustache").size).toBe(0)
    })

    it("excludes closers, comments, partials, the implicit iterator, and plain vars", () => {
        expect(
            extractMustacheSectionOpeners(
                "{{/name}} {{!c}} {{> p}} {{.}} {{plain}}",
                "mustache",
            ).size,
        ).toBe(0)
    })

    it("deduplicates repeated openers and mixes plain vars cleanly", () => {
        const out = extractMustacheSectionOpeners(
            "{{#items}}{{name}}{{/items}} and again {{#items}}{{/items}}",
            "mustache",
        )
        expect(Array.from(out)).toEqual(["items"])
    })
})
