/**
 * Unit tests for the pure formatters in @agenta/entity-ui/view-types.
 *
 * Runs under @agenta/entity-ui's own vitest runner (added by #4393's
 * vitest.config.ts).
 */
import {describe, expect, it} from "vitest"

import {
    coerceTextEdit,
    parseJsonEdit,
    parseYamlEdit,
    valueToDisplay,
} from "../../src/view-types/formatters"

describe("formatters: valueToDisplay", () => {
    describe("nullish handling", () => {
        it("returns '' for null and undefined in every mode", () => {
            for (const mode of ["text", "markdown", "json", "yaml"] as const) {
                expect(valueToDisplay(null, mode)).toBe("")
                expect(valueToDisplay(undefined, mode)).toBe("")
            }
        })
    })

    describe("text and markdown mode", () => {
        it("passes strings through unchanged", () => {
            expect(valueToDisplay("hello", "text")).toBe("hello")
            expect(valueToDisplay("hello", "markdown")).toBe("hello")
        })

        it("converts primitives via String()", () => {
            expect(valueToDisplay(42, "text")).toBe("42")
            expect(valueToDisplay(true, "text")).toBe("true")
            expect(valueToDisplay(false, "text")).toBe("false")
        })

        it("renders objects/arrays as compact JSON (matches backend whole-value insertion)", () => {
            expect(valueToDisplay({a: 1}, "text")).toBe('{"a":1}')
            expect(valueToDisplay([1, 2], "text")).toBe("[1,2]")
        })

        it("keeps a JSON-shaped string as the raw string (gap-04: strings stay strings)", () => {
            const raw = '{"x":1}'
            expect(valueToDisplay(raw, "text")).toBe(raw)
        })
    })

    describe("json mode", () => {
        it("pretty-prints native objects and arrays", () => {
            expect(valueToDisplay({a: 1}, "json")).toBe('{\n  "a": 1\n}')
            expect(valueToDisplay([1, 2], "json")).toBe("[\n  1,\n  2\n]")
        })

        it("renders strings as JSON-literal (gap-04: strings stay strings — never parse)", () => {
            // Plain string → quoted JSON literal. Crucially NOT the raw
            // unquoted text, which the JSON code editor flags as a syntax
            // error.
            expect(valueToDisplay("Vanuatu", "json")).toBe('"Vanuatu"')
        })

        it("renders JSON-shaped strings AS STRINGS (never auto-parse into objects)", () => {
            // The metadata bug Mahmoud flagged: stringified JSON must NOT be
            // mistaken for an object. The display preserves the string type
            // by JSON-encoding the string literal (outer quotes, escaped
            // inner quotes) instead of parsing + pretty-printing.
            expect(valueToDisplay('{"a":1}', "json")).toBe('"{\\"a\\":1}"')
        })

        it("stringifies primitives as JSON literals", () => {
            expect(valueToDisplay(42, "json")).toBe("42")
            expect(valueToDisplay(true, "json")).toBe("true")
            expect(valueToDisplay(false, "json")).toBe("false")
        })
    })

    describe("yaml mode", () => {
        it("dumps native objects as YAML", () => {
            const out = valueToDisplay({a: 1, b: "two"}, "yaml")
            expect(out).toContain("a: 1")
            expect(out).toContain("b: two")
        })

        it("dumps strings AS STRINGS (never auto-parse JSON-shaped strings)", () => {
            // gap-04: type preservation in display. A string containing
            // JSON-shaped text gets yamlDump'd as a YAML scalar (quoted
            // because the leading `{` would otherwise be ambiguous), NOT
            // converted to a YAML mapping.
            const out = valueToDisplay('{"a":1}', "yaml")
            // The result is a YAML scalar — quoted or escaped depending on
            // js-yaml's choice, but it must NOT produce a `a: 1` mapping.
            expect(out).not.toMatch(/^a:\s/m)
            // And the original string content survives a YAML re-parse.
            // (Sanity check that we're dumping the string, not anything else.)
            expect(out).toContain('{"a":1}')
        })

        it("dumps plain strings as YAML plain scalars", () => {
            expect(valueToDisplay("hello world", "yaml").trim()).toBe("hello world")
        })

        it("returns empty string for empty containers (no flow-style `[]` / `{}` literal)", () => {
            // `js-yaml.dump([])` and `dump({})` only produce flow-style
            // literals because block style requires at least one item. The
            // result looks identical to JSON — confusing the user when they
            // explicitly picked YAML mode. Render as empty so the editor's
            // placeholder takes over and the user types fresh YAML.
            expect(valueToDisplay([], "yaml")).toBe("")
            expect(valueToDisplay({}, "yaml")).toBe("")
        })

        it("preserves string-typed empty-container LITERALS (gap-04)", () => {
            // `"[]"` is a STRING — it should NOT be parsed and then
            // emptied. It survives as a YAML string scalar.
            const out = valueToDisplay("[]", "yaml")
            expect(out).not.toBe("") // not suppressed (it's a string, not an empty array)
            expect(out).toContain("[]")
        })

        it("still dumps non-empty arrays / objects as block-style YAML", () => {
            const arr = valueToDisplay(["en", "fr"], "yaml")
            expect(arr).toContain("- en")
            expect(arr).toContain("- fr")
            const obj = valueToDisplay({foo: "bar"}, "yaml")
            expect(obj).toContain("foo: bar")
        })
    })
})

describe("formatters: coerceTextEdit", () => {
    it("preserves number type for numeric originals", () => {
        expect(coerceTextEdit("320", "number")).toBe(320)
        expect(coerceTextEdit("3.14", "number")).toBe(3.14)
        expect(coerceTextEdit("0", "number")).toBe(0)
        expect(coerceTextEdit("-5", "number")).toBe(-5)
    })

    it("falls back to the raw string for invalid number edits", () => {
        expect(coerceTextEdit("not-a-number", "number")).toBe("not-a-number")
    })

    it("returns '' (empty string sentinel) for empty number edits", () => {
        // Number(\"\") is 0, but that's a worse default than letting the
        // caller decide. Return empty string so caller can treat as "clear".
        expect(coerceTextEdit("", "number")).toBe("")
    })

    it("coerces 'true'/'false' for boolean originals", () => {
        expect(coerceTextEdit("true", "boolean")).toBe(true)
        expect(coerceTextEdit("false", "boolean")).toBe(false)
    })

    it("keeps the raw string for non-canonical boolean edits", () => {
        expect(coerceTextEdit("yes", "boolean")).toBe("yes")
        expect(coerceTextEdit("1", "boolean")).toBe("1")
    })

    it("coerces empty back to null for null originals", () => {
        expect(coerceTextEdit("", "null")).toBeNull()
        expect(coerceTextEdit("something", "null")).toBe("something")
    })

    it("passes strings through unchanged", () => {
        expect(coerceTextEdit("hello", "string")).toBe("hello")
        expect(coerceTextEdit('{"x":1}', "string")).toBe('{"x":1}')
    })
})

describe("formatters: parseJsonEdit", () => {
    it("returns {ok: true, value} for valid JSON", () => {
        expect(parseJsonEdit('{"a":1}')).toEqual({ok: true, value: {a: 1}})
        expect(parseJsonEdit("[1,2,3]")).toEqual({ok: true, value: [1, 2, 3]})
        expect(parseJsonEdit("42")).toEqual({ok: true, value: 42})
        expect(parseJsonEdit("true")).toEqual({ok: true, value: true})
        expect(parseJsonEdit("null")).toEqual({ok: true, value: null})
    })

    it("returns {ok: false} on parse failure", () => {
        expect(parseJsonEdit("not json")).toEqual({ok: false})
        expect(parseJsonEdit("{a:1}")).toEqual({ok: false})
        expect(parseJsonEdit("")).toEqual({ok: false})
    })
})

describe("formatters: parseYamlEdit", () => {
    it("returns {ok: true, value} for valid YAML", () => {
        const res = parseYamlEdit("a: 1\nb: two")
        expect(res.ok).toBe(true)
        if (res.ok) expect(res.value).toEqual({a: 1, b: "two"})
    })

    it("accepts plain strings (YAML treats them as scalars)", () => {
        const res = parseYamlEdit("hello world")
        expect(res.ok).toBe(true)
        if (res.ok) expect(res.value).toBe("hello world")
    })
})
