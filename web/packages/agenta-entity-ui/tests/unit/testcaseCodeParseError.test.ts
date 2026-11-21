import {describe, expect, it} from "vitest"

import {codeParseError, textMatchesValue} from "../../src/testcase/codeFormat"

describe("codeParseError", () => {
    it("names the problem in JSON that does not parse", () => {
        expect(codeParseError('{"question": "2+2"},,', "json")).toBeTruthy()
    })

    it("is null for JSON that parses", () => {
        expect(codeParseError('{"question": "2+2"}', "json")).toBeNull()
    })

    it("names the problem in YAML that does not parse", () => {
        expect(codeParseError("a: [1, 2", "yaml")).toBeTruthy()
        expect(codeParseError("a: 1", "yaml")).toBeNull()
    })
})

describe("textMatchesValue", () => {
    it("treats compact JSON the user typed as the same value, so it is not reformatted", () => {
        expect(textMatchesValue('{"q":"a"}', "json", {q: "a"})).toBe(true)
    })

    it("asks for a resync when the value changed outside the editor", () => {
        expect(textMatchesValue('{"q":"a"}', "json", {q: "b"})).toBe(false)
        expect(textMatchesValue('{"q":', "json", {q: "a"})).toBe(false)
    })
})
