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

        it("skips delimiter-swap tags `{{=<% %>=}}`", () => {
            // Delimiter swap is a structural tag that reconfigures the
            // tokenizer at render time; it never references a variable.
            expect(
                extractTemplateVariables("{{=<% %>=}}<% name %><%={{ }}=%>", "mustache"),
            ).toEqual([])
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

        // Phase 2 scope-aware discovery — `extractTemplateVariables` now
        // emits dotted PATHS for variables inside sections. The section
        // opener still emits its bare name (the user must provide a value
        // for the section to render), and nested references join the
        // open-stack with `.` separators. `docs/designs/mustache-section
        // -support.md` §2b for the design.
        it("emits scoped paths for bare variables INSIDE a section block", () => {
            expect(extractTemplateVariables("{{#repo}}{{name}}{{/repo}}", "mustache")).toEqual([
                "repo",
                "repo.name",
            ])
        })

        it("emits both scoped + top-level variables outside the section", () => {
            // Mahmoud's exact example: `repo` is a section, `name` inside
            // joins as `repo.name`, `country.a` outside is its own top-level
            // dotted variable.
            expect(
                extractTemplateVariables("{{#repo}}{{name}}{{/repo}}{{country.a}}", "mustache"),
            ).toEqual(["repo", "repo.name", "country.a"])
        })

        it("emits scoped paths for unescaped variables inside a section", () => {
            // `{{&body}}` inside `{{#post}}` joins as `post.body`.
            expect(extractTemplateVariables("{{#post}}{{&body}}{{/post}}", "mustache")).toEqual([
                "post",
                "post.body",
            ])
        })

        it("emits scoped paths for nested section openers", () => {
            // `{{#org}}{{#users}}{{name}}{{/users}}{{/org}}` → all three
            // levels surface as paths: `org`, `org.users`, `org.users.name`.
            expect(
                extractTemplateVariables(
                    "{{#org}}{{#users}}{{name}}{{/users}}{{/org}}",
                    "mustache",
                ),
            ).toEqual(["org", "org.users", "org.users.name"])
        })

        it("resumes top-level extraction after a section closes", () => {
            // Sections close cleanly; the walker pops the path stack so the
            // `middle` variable between two sections is captured at root.
            expect(
                extractTemplateVariables(
                    "{{#a}}{{ai}}{{/a}}{{middle}}{{#b}}{{bi}}{{/b}}",
                    "mustache",
                ),
            ).toEqual(["a", "a.ai", "middle", "b", "b.bi"])
        })

        it("emits scoped paths under an inverted section", () => {
            // Inverted sections (`{{^x}}…{{/x}}`) have the same scope
            // semantics as regular sections for discovery purposes.
            expect(
                extractTemplateVariables("{{^empty}}fallback: {{detail}}{{/empty}}", "mustache"),
            ).toEqual(["empty", "empty.detail"])
        })

        it("handles unbalanced `{{/x}}` defensively (no underflow)", () => {
            // A stray closer with no matching open is recorded as an error
            // by the parser but the walker still proceeds. Subsequent
            // top-level variables stay visible.
            expect(extractTemplateVariables("{{/stray}}{{later}}", "mustache")).toEqual(["later"])
        })

        it("handles unclosed `{{#x}}` defensively", () => {
            // Unclosed section — parser treats the rest as scoped under
            // the still-open frame, so `later` surfaces as `unclosed.later`.
            // The editor will surface the imbalance separately (Phase 2e
            // validation); the discovery walker just keeps emitting paths.
            expect(extractTemplateVariables("{{#unclosed}}{{later}}", "mustache")).toEqual([
                "unclosed",
                "unclosed.later",
            ])
        })

        it("skips inheritance blocks (`{{$name}}`) — out of scope", () => {
            // Mustache spec defines blocks for template inheritance. We
            // don't render them on the FE, and they don't contribute
            // variables either. Same applies to parent templates.
            expect(extractTemplateVariables("{{$slot}}body{{/slot}}", "mustache")).toEqual([])
            expect(extractTemplateVariables("{{<base}}body{{/base}}", "mustache")).toEqual([])
        })

        it("preserves JSONPath as a top-level variable inside sections too", () => {
            // `{{$.geo.region}}` is Agenta JSONPath, NOT a block. Inside
            // a section it joins with the section name like any other var.
            expect(
                extractTemplateVariables("{{#ctx}}{{$.geo.region}}{{/ctx}}", "mustache"),
            ).toEqual(["ctx", "ctx.$.geo.region"])
        })
    })

    describe("curly (legacy)", () => {
        it("extracts {{name}} variables", () => {
            expect(extractTemplateVariables("Hello {{name}}", "curly")).toEqual(["name"])
        })

        it("extracts dotted access {{user.name}}", () => {
            expect(extractTemplateVariables("Hello {{user.name}}", "curly")).toEqual(["user.name"])
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
            expect(extractTemplateVariables("Hi {{name}}, list: {{#items}}.", "curly")).toEqual([
                "name",
            ])
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
        const out = extractMustacheSectionOpeners("{{#languages}}{{.}}{{/languages}}", "mustache")
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
            extractMustacheSectionOpeners("{{/name}} {{!c}} {{> p}} {{.}} {{plain}}", "mustache")
                .size,
        ).toBe(0)
    })

    it("deduplicates repeated openers and mixes plain vars cleanly", () => {
        const out = extractMustacheSectionOpeners(
            "{{#items}}{{name}}{{/items}} and again {{#items}}{{/items}}",
            "mustache",
        )
        expect(Array.from(out)).toEqual(["items"])
    })

    // Nested section paths — RFC Phase 2c-extended (nested-opener inference).
    // The walker emits dotted paths joined against the enclosing-sections
    // stack so the schema producer can emit array-of-objects at every depth.
    it("emits dotted paths for nested section openers", () => {
        const out = extractMustacheSectionOpeners(
            "{{#repos}}{{#contributors}}{{name}}{{/contributors}}{{/repos}}",
            "mustache",
        )
        expect(Array.from(out).sort()).toEqual(["repos", "repos.contributors"])
    })

    it("records section paths three levels deep", () => {
        const out = extractMustacheSectionOpeners(
            "{{#repos}}{{#contributors}}{{#tags}}{{name}}{{/tags}}{{/contributors}}{{/repos}}",
            "mustache",
        )
        expect(Array.from(out).sort()).toEqual([
            "repos",
            "repos.contributors",
            "repos.contributors.tags",
        ])
    })

    it("treats top-level + nested inverted sections the same way", () => {
        // `{{^empty}}…{{#fallback}}…{{/fallback}}{{/empty}}` — both are
        // section openers (inverted at the top, regular nested).
        const out = extractMustacheSectionOpeners(
            "{{^empty}}{{#fallback}}{{name}}{{/fallback}}{{/empty}}",
            "mustache",
        )
        expect(Array.from(out).sort()).toEqual(["empty", "empty.fallback"])
    })

    it("dedupes paths even when an opener appears twice at the same depth", () => {
        // Re-opening `users` inside two separate `org` blocks (same path)
        // contributes the same dotted-path entry.
        const out = extractMustacheSectionOpeners(
            "{{#org}}{{#users}}{{/users}}{{/org}}{{#org}}{{#users}}{{/users}}{{/org}}",
            "mustache",
        )
        expect(Array.from(out).sort()).toEqual(["org", "org.users"])
    })
})
