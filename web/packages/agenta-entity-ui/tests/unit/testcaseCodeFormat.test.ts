import {describe, expect, it, vi} from "vitest"

import {
    codeErrorText,
    codeParseError,
    parseCodeString,
    textMatchesValue,
    toCodeString,
} from "../../src/testcase/codeFormat"

const metadata = [
    "{",
    '  "source": "email",',
    '  "parsed_at": "2026-11-20T08:12:00Z",',
    '  "confidence": 0.93,',
    '  "flags": ["gift", "rush"]',
    "}",
].join("\n")

describe("codeParseError", () => {
    it("names a missing comma in the line it belongs to, inside a line", () => {
        const text = metadata.replace('"gift", "rush"', '"gift" "rush"')
        expect(codeParseError(text, "json")).toMatchObject({problem: "missingComma", line: 5})
    })

    it("names a missing comma at the end of a line in that line, not the next one", () => {
        const text = metadata.replace("0.93,", "0.93")
        expect(codeParseError(text, "json")).toMatchObject({problem: "missingComma", line: 4})
    })

    it("names a missing quote", () => {
        const text = metadata.replace('"email"', '"email')
        expect(codeParseError(text, "json")).toMatchObject({problem: "missingQuote", line: 2})
    })

    it("names an extra comma before a closing bracket", () => {
        const text = metadata.replace('["gift", "rush"]', '["gift", "rush"],')
        expect(codeParseError(text, "json")).toMatchObject({problem: "extraComma", line: 5})
    })

    it("names text that ends too early", () => {
        expect(codeParseError('{"a": [1, 2', "json")).toMatchObject({problem: "endsEarly"})
    })

    it("names an extra comma in a short list, and a word with no quotes", () => {
        expect(codeParseError("[1, ]", "json")).toMatchObject({problem: "extraComma", line: 1})
        expect(codeParseError('{\n  "tier": gold\n}', "json")).toMatchObject({
            problem: "missingQuote",
            line: 2,
        })
    })

    it("finds the problem and its line when the browser's message gives no position", () => {
        // Chrome words the error like this, with no "position N".
        const parse = vi.spyOn(JSON, "parse").mockImplementation(() => {
            throw new SyntaxError("Unexpected token ']', \"[1, ]\" is not valid JSON")
        })
        try {
            expect(codeParseError("[\n  1,\n]", "json")).toMatchObject({
                problem: "extraComma",
                line: 2,
            })
            const text = metadata.replace("0.93,", "0.93")
            expect(codeParseError(text, "json")).toMatchObject({problem: "missingComma", line: 4})
        } finally {
            parse.mockRestore()
        }
    })

    it("gives the line of a YAML error", () => {
        const error = codeParseError("a: 1\nb: [1, 2\nc: 3", "yaml")
        expect(error?.problem).toBe("other")
        expect(error?.line).toBeGreaterThan(1)
    })

    it("returns null for text that parses", () => {
        expect(codeParseError(metadata, "json")).toBeNull()
        expect(codeParseError("a: 1", "yaml")).toBeNull()
    })
})

describe("codeErrorText", () => {
    it("says the decided sentence with the line", () => {
        expect(codeErrorText({message: "", line: 5, problem: "missingComma"}, "json")).toBe(
            "Not valid JSON: a comma is missing in line 5. The field keeps its last valid value until you fix it.",
        )
    })

    it("leaves the line out when the parser gives none", () => {
        expect(codeErrorText({message: "", line: null, problem: "other"}, "yaml")).toBe(
            "Not valid YAML: the text has an error. The field keeps its last valid value until you fix it.",
        )
    })
})

describe("textMatchesValue", () => {
    it("compares an array with the array, so a typed array keeps its formatting", () => {
        const typed = '[\n  "a",   "b"\n]'
        expect(textMatchesValue(typed, "json", ["a", "b"])).toBe(true)
        expect(textMatchesValue(typed, "json", {})).toBe(false)
    })

    it("sees an outside change of an array", () => {
        expect(textMatchesValue('["a", "b"]', "json", ["a", "b", "c"])).toBe(false)
    })

    it("compares a primitive and YAML", () => {
        expect(textMatchesValue("42", "json", 42)).toBe(true)
        expect(textMatchesValue("- a\n- b\n", "yaml", ["a", "b"])).toBe(true)
    })

    it("compares nested objects by value: key order and spaces do not count", () => {
        const value = {a: {b: [1, {c: "x"}]}, d: null}
        expect(textMatchesValue('{"d":null,"a":{"b":[1,{"c":"x"}]}}', "json", value)).toBe(true)
        expect(
            textMatchesValue('{\n  "a": {"b": [1, {"c": "x"}]},\n  "d": null\n}', "json", value),
        ).toBe(true)
        // The order inside a list counts, and so does a type.
        expect(textMatchesValue('{"a":{"b":[{"c":"x"},1]},"d":null}', "json", value)).toBe(false)
        expect(textMatchesValue('{"a":{"b":[1,{"c":"x"}]},"d":"null"}', "json", value)).toBe(false)
    })

    it("tells a missing value from null", () => {
        expect(textMatchesValue("null", "json", undefined)).toBe(false)
        expect(textMatchesValue("", "yaml", null)).toBe(true)
    })

    it("is false for text that does not parse", () => {
        expect(textMatchesValue("[1,", "json", [1])).toBe(false)
    })
})

describe("toCodeString and parseCodeString", () => {
    it("round trip a value", () => {
        const value = {a: [1, {b: true}]}
        expect(parseCodeString(toCodeString(value, "json"), "json", null)).toEqual(value)
        expect(parseCodeString(toCodeString(value, "yaml"), "yaml", null)).toEqual(value)
        expect(parseCodeString("{", "json", "fallback")).toBe("fallback")
        // An empty YAML document is null, so a cleared field is not dropped from the row.
        expect(parseCodeString("", "yaml", "fallback")).toBeNull()
        expect(codeParseError("", "yaml")).toBeNull()
    })
})
