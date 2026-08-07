import {describe, expect, it} from "vitest"

import {formatToolValue, stripFence} from "../../../src/assets/toolFormat"

describe("stripFence", () => {
    it("strips a fence that spans the whole string", () => {
        expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    })

    it("leaves inner fenced blocks intact when they don't span the whole string", () => {
        const value = "see ```inline``` here"
        expect(stripFence(value)).toBe(value)
    })

    it("returns plain text unchanged", () => {
        expect(stripFence("plain text")).toBe("plain text")
    })
})

describe("formatToolValue", () => {
    it("returns an empty string for null/undefined", () => {
        expect(formatToolValue(null)).toBe("")
        expect(formatToolValue(undefined)).toBe("")
    })

    it("pretty-prints a JSON string", () => {
        expect(formatToolValue('{"a":1}')).toBe('{\n  "a": 1\n}')
    })

    it("pretty-prints a fence-wrapped JSON string", () => {
        expect(formatToolValue('```json\n{"a":1}\n```')).toBe('{\n  "a": 1\n}')
    })

    it("pretty-prints an object value", () => {
        expect(formatToolValue({a: 1})).toBe('{\n  "a": 1\n}')
    })

    it("does not reformat a bare primitive-looking string", () => {
        expect(formatToolValue("42")).toBe("42")
        expect(formatToolValue("true")).toBe("true")
    })

    it("returns a plain non-JSON string as-is (fence-stripped)", () => {
        expect(formatToolValue("just a sentence.")).toBe("just a sentence.")
    })
})
