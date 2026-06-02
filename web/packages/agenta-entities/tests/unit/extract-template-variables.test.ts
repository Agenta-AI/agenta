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

// ─── Typing-state behaviour ──────────────────────────────────────────────
//
// While the user TYPES (rather than pasting a complete prompt), the parser
// receives progressively-more-complete input. These tests pin down the
// behaviour at each intermediate stage so we don't regress into early/
// noisy variable extraction or parser crashes on malformed inputs. The
// concern is from JP / Mahmoud's 2026-05-28 QA — when extraction surfaced
// half-formed variables too eagerly, the cursor jumped out of the auto-
// closed `{{|}}` token mid-word. The cursor fix was at the editor layer
// (`TokenPlugin.tsx`); these tests cover the COMPLEMENTARY guarantee at
// the walker layer: stable, conservative output across every typing stage.

describe("extractTemplateVariables — typing-state behaviour (mustache)", () => {
    // Models the REAL editor flow: `AutoCloseTokenBracesPlugin` closes
    // every `{{` to `{{|}}` (cursor between), so tokens are syntactically
    // complete at every typing stage — there is no intermediate `{{#repos`
    // (no `}}`) state to worry about. These tests pin the walker's output
    // at each autoclose-complete intermediate token.
    //
    // Background — JP / Mahmoud 2026-05-28 QA: the cursor-jump fix at the
    // editor layer (`TokenPlugin.tsx`) keeps the caret inside the
    // auto-closed brace pair, so partial names like `{{#r}}` exist as
    // complete tokens. These tests verify the walker doesn't surface
    // confusing output at those intermediate stages.

    const cases: Array<[string, string[], string]> = [
        ["", [], "empty editor"],
        ["{{}}", [], "autoclose only — empty token"],
        ["{{#}}", [], "typed `#` (empty section name) — walker skips empty"],
        ["{{#r}}", ["r"], "single-char section opener typed"],
        ["{{#re}}", ["re"], "two-char section opener"],
        ["{{#rep}}", ["rep"], "three-char"],
        ["{{#repo}}", ["repo"], "four-char"],
        ["{{#repos}}", ["repos"], "section opener name fully typed"],
        ["{{#repos}}{{}}", ["repos"], "opened inner token (still empty)"],
        ["{{#repos}}{{n}}", ["repos", "repos.n"], "single char inner var"],
        ["{{#repos}}{{na}}", ["repos", "repos.na"], "two char"],
        ["{{#repos}}{{nam}}", ["repos", "repos.nam"], "three char"],
        ["{{#repos}}{{name}}", ["repos", "repos.name"], "inner variable name complete"],
        [
            "{{#repos}}{{name}}{{/}}",
            ["repos", "repos.name"],
            "started close tag, empty name — no new emissions",
        ],
        ["{{#repos}}{{name}}{{/r}}", ["repos", "repos.name"], "partial close — no new emissions"],
        ["{{#repos}}{{name}}{{/repos}}", ["repos", "repos.name"], "close tag complete"],
        [
            "{{#repos}}{{name}}{{/repos}}{{}}",
            ["repos", "repos.name"],
            "started top-level var (empty)",
        ],
        [
            "{{#repos}}{{name}}{{/repos}}{{c}}",
            ["repos", "repos.name", "c"],
            "single char top-level var",
        ],
        [
            "{{#repos}}{{name}}{{/repos}}{{country.a}}",
            ["repos", "repos.name", "country.a"],
            "top-level dotted variable complete",
        ],
    ]

    for (const [input, expected, label] of cases) {
        it(`stage: ${label} (${JSON.stringify(input)})`, () => {
            expect(extractTemplateVariables(input, "mustache")).toEqual(expected)
        })
    }

    it("doesn't crash on unclosed nested sections (still valid AST)", () => {
        // The editor's autoclose closes `{{` but it doesn't auto-pair
        // a `{{/repos}}`. User has typed both open tokens but no
        // matching close yet. Parser reports the unbalanced sections
        // but still produces a sane AST; walker emits paths normally.
        expect(extractTemplateVariables("{{#repos}}{{#contributors}}", "mustache")).toEqual([
            "repos",
            "repos.contributors",
        ])
    })

    it("`{{#}}{{name}}{{/}}` — empty section names don't leak leading dots", () => {
        // If the user hits `{{#` and immediately starts typing the
        // inner variable without naming the section first, the section
        // has no name. The walker mustn't push the empty name onto
        // the path stack — otherwise `name` would join as `.name`.
        expect(extractTemplateVariables("{{#}}{{name}}{{/}}", "mustache")).toEqual(["name"])
    })

    it("`{{#r}}` (in-progress section name) emits the partial name", () => {
        // Walker reads what the parser parsed — if the name is `r`,
        // that's a real (if partial) section name. Same as pre-Phase-2.
        expect(extractTemplateVariables("{{#r}}{{/r}}", "mustache")).toEqual(["r"])
    })

    it("partial close tags (`{{/r}}`) don't introduce phantom variables", () => {
        // A closing tag with a partial name doesn't emit anything by
        // itself — closing tags never produce variables, only update
        // the section stack. If the open was `repos` and the close
        // got typed as `{{/r}}` (mismatch), the parser still produces
        // a mismatched-close error but the walker doesn't crash.
        expect(extractTemplateVariables("{{#repos}}{{name}}{{/r}}", "mustache")).toEqual([
            "repos",
            "repos.name",
        ])
    })
})

describe("extractTemplateVariables — non-mustache regressions", () => {
    // Curly and jinja2 must keep their existing behaviour after the
    // mustache branch swap to the parser. The mustache-marker exclusion
    // guard widened to include `$<=` (spec block / parent / delimiter
    // sigils), so verify ordinary `$.path` and dotted names still flow.

    describe("curly (literal-key contract)", () => {
        it("extracts a plain variable", () => {
            expect(extractTemplateVariables("Hello {{name}}", "curly")).toEqual(["name"])
        })

        it("keeps dotted names verbatim (literal key per backend resolver)", () => {
            // Backend curly resolver does literal-key-first lookup, so
            // `{{user.name}}` maps to a testcase column LITERALLY named
            // `user.name`. The walker preserves this verbatim.
            expect(extractTemplateVariables("Hi {{user.name}}", "curly")).toEqual(["user.name"])
        })

        it("rejects mustache-style section openers as malformed (`{{#x}}`)", () => {
            // In a curly prompt, `{{#items}}` is an authoring error —
            // curly has no section semantics. Walker excludes it so
            // there's no phantom `items` port.
            expect(extractTemplateVariables("{{#items}}", "curly")).toEqual([])
        })

        it("rejects mustache-style block / parent / delimiter sigils", () => {
            expect(extractTemplateVariables("{{$slot}}", "curly")).toEqual([])
            expect(extractTemplateVariables("{{<base}}", "curly")).toEqual([])
            expect(extractTemplateVariables("{{=<% %>=}}", "curly")).toEqual([])
        })

        it("doesn't crash mid-typing on unclosed `{{`", () => {
            expect(extractTemplateVariables("Hi {{na", "curly")).toEqual([])
        })
    })

    describe("jinja2", () => {
        it("extracts a plain variable", () => {
            expect(extractTemplateVariables("Hello {{name}}", "jinja2")).toEqual(["name"])
        })

        it("extracts dotted attribute access", () => {
            // Jinja2 follows mustache-style nested-dot semantics at the
            // parsing level (the backend resolves both attrs and items).
            expect(extractTemplateVariables("Region: {{geo.region}}", "jinja2")).toEqual([
                "geo.region",
            ])
        })

        it("excludes mustache structural tags", () => {
            expect(extractTemplateVariables("{{#items}}", "jinja2")).toEqual([])
        })
    })

    describe("fstring", () => {
        it("extracts single-brace variables", () => {
            expect(extractTemplateVariables("Hello {name}", "fstring")).toEqual(["name"])
        })

        it("does NOT extract from `{{x}}` (escaped braces in f-strings)", () => {
            // f-string escapes `{{` and `}}` as LITERAL braces. So a
            // template that contains `{{x}}` literally produces the
            // characters `{x}` at render time — NO variable.
            expect(extractTemplateVariables("Hi {{x}}", "fstring")).toEqual([])
        })
    })
})
