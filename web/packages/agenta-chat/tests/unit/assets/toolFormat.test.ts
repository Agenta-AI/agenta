import {describe, expect, it} from "vitest"

import {formatToolValue, stripFence} from "../../../src/assets/toolFormat"

describe("stripFence", () => {
    it("strips a fence that spans the whole string", () => {
        expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    })

    it("strips a fence with no language tag", () => {
        expect(stripFence("```\nhello\n```")).toBe("hello")
    })

    it("strips a dash-bearing language tag", () => {
        expect(stripFence("```my-lang\nbody\n```")).toBe("body")
    })

    it("tolerates whitespace around the fence", () => {
        expect(stripFence('  ```json\n{"a":1}\n```  ')).toBe('{"a":1}')
    })

    it("leaves inner fenced blocks intact when they don't span the whole string", () => {
        const value = "see ```inline``` here"
        expect(stripFence(value)).toBe(value)
    })

    it("keeps an inner fence inside a body the outer fence does span", () => {
        expect(stripFence("```\na ```b``` c\n```")).toBe("a ```b``` c")
    })

    it("returns plain text unchanged", () => {
        expect(stripFence("plain text")).toBe("plain text")
    })

    it("returns empty and whitespace-only input unchanged (untrimmed)", () => {
        expect(stripFence("")).toBe("")
        expect(stripFence("   \n  ")).toBe("   \n  ")
    })

    it("needs both fences: a lone opening or closing fence is not stripped", () => {
        expect(stripFence("```oops")).toBe("```oops")
        expect(stripFence("oops```")).toBe("oops```")
        expect(stripFence("```")).toBe("```")
        expect(stripFence("````")).toBe("````")
    })

    describe("no-newline fences (the tag runs to the first non-[\\w-] character)", () => {
        // Long-standing behaviour, pinned deliberately: with no newline the whole tag-alphabet run
        // is read as the language tag, so an all-word body is consumed as a tag and leaves "".
        it("treats an all-word body as a bare tag", () => {
            expect(stripFence("```hello```")).toBe("")
            expect(stripFence("``````")).toBe("")
            expect(stripFence("```\n```")).toBe("")
        })

        it("keeps everything from the first non-tag character on", () => {
            expect(stripFence('```json{"a":1}```')).toBe('{"a":1}')
            expect(stripFence("```js code\nmore\n```")).toBe("code\nmore")
        })
    })

    // CodeQL "polynomial regular expression used on uncontrolled data": the old
    // /^```[\w-]*\n?([\s\S]*?)\n?```$/ let [\w-]* and [\s\S]*? both match the same dashes, so an
    // unclosed fence made the engine try every split point. 200k dashes took ~3s; the scan is ~0.1ms.
    it("stays linear on an unclosed fence followed by many dashes", () => {
        const hostile = "```" + "-".repeat(200_000)
        const start = performance.now()
        expect(stripFence(hostile)).toBe(hostile)
        expect(performance.now() - start).toBeLessThan(250)
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
