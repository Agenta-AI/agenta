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

        it("pretty-prints strings that ARE valid JSON", () => {
            expect(valueToDisplay('{"a":1}', "json")).toBe('{\n  "a": 1\n}')
        })

        it("returns the raw string when it is NOT valid JSON", () => {
            expect(valueToDisplay("hello", "json")).toBe("hello")
        })

        it("stringifies primitives as JSON literals", () => {
            expect(valueToDisplay(42, "json")).toBe("42")
            expect(valueToDisplay(true, "json")).toBe("true")
        })
    })

    describe("yaml mode", () => {
        it("dumps native objects as YAML", () => {
            const out = valueToDisplay({a: 1, b: "two"}, "yaml")
            expect(out).toContain("a: 1")
            expect(out).toContain("b: two")
        })

        it("dumps strings that ARE valid JSON as YAML", () => {
            const out = valueToDisplay('{"a":1}', "yaml")
            expect(out).toContain("a: 1")
        })

        it("returns the raw string when it is not valid JSON", () => {
            expect(valueToDisplay("hello world", "yaml").trim()).toBe("hello world")
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
