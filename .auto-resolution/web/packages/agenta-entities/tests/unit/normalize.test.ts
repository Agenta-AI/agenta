/**
 * Unit tests for normalizeValueForComparison
 *
 * This utility is used by createEntityDraftState to determine whether a local
 * edit differs from the server value. Getting this right is critical — a bug
 * here causes the UI to either show spurious "unsaved" badges or silently drop
 * real changes.
 */

import {describe, it, expect} from "vitest"

import {normalizeValueForComparison} from "../../src/shared/molecule/createEntityDraftState"

describe("normalizeValueForComparison", () => {
    // ── Empty / nullish ───────────────────────────────────────────────────────

    describe("empty and nullish values", () => {
        it("returns '' for null", () => {
            expect(normalizeValueForComparison(null)).toBe("")
        })

        it("returns '' for undefined", () => {
            expect(normalizeValueForComparison(undefined)).toBe("")
        })

        it("returns '' for empty string", () => {
            expect(normalizeValueForComparison("")).toBe("")
        })
    })

    // ── Plain strings ─────────────────────────────────────────────────────────

    describe("plain strings", () => {
        it("returns the string unchanged when it is not valid JSON", () => {
            expect(normalizeValueForComparison("hello world")).toBe("hello world")
        })

        it("returns the string unchanged when it contains special characters", () => {
            expect(normalizeValueForComparison("hello\nworld")).toBe("hello\nworld")
        })
    })

    // ── JSON strings ──────────────────────────────────────────────────────────

    describe("JSON strings (key-order normalisation)", () => {
        it("sorts keys so {b,a} and {a,b} are equal", () => {
            const bFirst = JSON.stringify({b: 2, a: 1})
            const aFirst = JSON.stringify({a: 1, b: 2})
            expect(normalizeValueForComparison(bFirst)).toBe(normalizeValueForComparison(aFirst))
        })

        it("returns canonical JSON with keys sorted alphabetically", () => {
            const input = JSON.stringify({z: 3, a: 1, m: 2})
            expect(normalizeValueForComparison(input)).toBe('{"a":1,"m":2,"z":3}')
        })

        it("handles nested objects — sorts keys at every level", () => {
            const input = JSON.stringify({outer: {b: 2, a: 1}})
            expect(normalizeValueForComparison(input)).toBe('{"outer":{"a":1,"b":2}}')
        })

        it("handles arrays of objects inside JSON strings", () => {
            const input = JSON.stringify([
                {b: 2, a: 1},
                {d: 4, c: 3},
            ])
            expect(normalizeValueForComparison(input)).toBe('[{"a":1,"b":2},{"c":3,"d":4}]')
        })

        it("treats a JSON string and the equivalent object as equal", () => {
            const asString = JSON.stringify({b: 2, a: 1})
            const asObject = {a: 1, b: 2}
            expect(normalizeValueForComparison(asString)).toBe(
                normalizeValueForComparison(asObject),
            )
        })
    })

    // ── Objects ───────────────────────────────────────────────────────────────

    describe("objects", () => {
        it("serializes a plain object with sorted keys", () => {
            expect(normalizeValueForComparison({z: 1, a: 2})).toBe('{"a":2,"z":1}')
        })

        it("handles empty object", () => {
            expect(normalizeValueForComparison({})).toBe("{}")
        })

        it("handles nested objects", () => {
            const obj = {outer: {b: 2, a: 1}, x: 0}
            expect(normalizeValueForComparison(obj)).toBe('{"outer":{"a":1,"b":2},"x":0}')
        })

        it("handles arrays", () => {
            expect(normalizeValueForComparison([1, 2, 3])).toBe("[1,2,3]")
        })
    })

    // ── Primitives ────────────────────────────────────────────────────────────

    describe("primitives", () => {
        it("converts numbers to string", () => {
            expect(normalizeValueForComparison(42)).toBe("42")
        })

        it("converts true to string", () => {
            expect(normalizeValueForComparison(true)).toBe("true")
        })

        it("converts false to string", () => {
            expect(normalizeValueForComparison(false)).toBe("false")
        })

        it("converts 0 to string", () => {
            expect(normalizeValueForComparison(0)).toBe("0")
        })
    })
})
