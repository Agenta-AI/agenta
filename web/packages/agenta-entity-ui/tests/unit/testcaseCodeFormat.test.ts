import {describe, expect, it, vi} from "vitest"

import {
    codeErrorText,
    codeParseError,
    parseCodeString,
    textMatchesValue,
    toCodeString,
    withShownEnd,
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

describe("codeParseError on a backslash JSON does not allow", () => {
    it("names the line of the escape, not the end of the text", () => {
        const text = '{\n  "path": "C:\\work",\n  "ok": true\n}'
        expect(codeParseError(text, "json")?.line).toBe(2)
        expect(codeParseError('{\n  "a": "\\u12",\n  "b": 1\n}', "json")?.line).toBe(2)
        expect(codeParseError('{"a": "\\u00e9\\n"}', "json")).toBeNull()
    })
})

describe("codeErrorText", () => {
    it("says the decided sentence with the line", () => {
        expect(codeErrorText({line: 5, problem: "missingComma"}, "json")).toBe(
            "Not valid JSON: a comma is missing in line 5. The field keeps its last valid value until you fix it.",
        )
    })

    it("leaves the line out when the parser gives none", () => {
        expect(codeErrorText({line: null, problem: "other"}, "yaml")).toBe(
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

/** Values whose text form is easy to get wrong: types, spaces, line breaks, YAML look-alikes. */
const SAMPLES: unknown[] = [
    {padded: "  two spaces  ", numeric: "12", truthy: "true", nulled: "null", empty: ""},
    {zero: 0, ratio: 3.25, negative: -7, flag: false, nothing: null},
    {lines: "line one\r\nline two\n\n", tab: "\t", unicode: "héllo 🌍"},
    {date: "2024-01-01", yes: "yes", on: "on", tilde: "~", exp: "1e3", hex: "0x10", octal: "012"},
    {hash: "#x", colon: "k: v", lead: " a", trail: "a ", long: "x ".repeat(80)},
    {nested: {a: {b: [1, {c: null}], d: "x\n"}}, list: [null, true, 2, "x"], none: [], blank: {}},
    {last_keeps_breaks: "a\n\nb\n\n"},
    ["a\n\n"],
    "  text  ",
    12,
    null,
]

describe("text round trip", () => {
    it.each(SAMPLES.map((value) => [JSON.stringify(value), value]))(
        "JSON and YAML text of %s reads back the same value",
        (_name, value) => {
            for (const format of ["json", "yaml"] as const) {
                const text = toCodeString(value, format)
                expect(parseCodeString(text, format, Symbol("failed"))).toStrictEqual(value)
                // As the code editor sends it back: without the end of the text.
                const sent = withShownEnd(text.trimEnd(), text, format)
                expect(parseCodeString(sent, format, Symbol("failed"))).toStrictEqual(value)
            }
        },
    )
})

describe("withShownEnd", () => {
    it("puts back the end of the YAML text the editor was given while the last line is the same", () => {
        expect(withShownEnd("x: |+\n  a", "x: |+\n  a\n\n", "yaml")).toBe("x: |+\n  a\n\n")
        expect(withShownEnd("y: 2\nx: |+\n  a", "y: 1\nx: |+\n  a\n\n", "yaml")).toBe(
            "y: 2\nx: |+\n  a\n\n",
        )
    })

    it("takes an edit of the last value as sent, and JSON as sent", () => {
        expect(withShownEnd("x: |+\n  goodbye", "x: |+\n  hello\n\n\n", "yaml")).toBe(
            "x: |+\n  goodbye",
        )
        expect(withShownEnd('{"a": 2}  ', '{"a": 1}', "json")).toBe('{"a": 2}  ')
    })
})

describe("codeErrorText for the whole test case", () => {
    it("says the test case keeps its last valid value", () => {
        expect(codeErrorText({line: null, problem: "notObject"}, "json", "testcase")).toBe(
            "Not valid JSON: the test case must be an object. The test case keeps its last valid value until you fix it.",
        )
        expect(codeErrorText({line: 3, problem: "missingComma"}, "yaml", "testcase")).toBe(
            "Not valid YAML: a comma is missing in line 3. The test case keeps its last valid value until you fix it.",
        )
    })
})
