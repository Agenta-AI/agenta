/**
 * resolveSchemaType — regression guard for nullable evaluator output
 * types.
 *
 * An evaluator output property declared nullable (`type: ["boolean",
 * "null"]` or `anyOf: [{type: "boolean"}, {type: "null"}]`) must still
 * resolve to its primitive type — otherwise the scenario filter bar
 * mistypes a boolean field and offers numeric operators.
 */

import {describe, expect, it} from "vitest"

import {resolveSchemaType} from "../../src/workflow/core/schemaType"

describe("resolveSchemaType", () => {
    it("returns a plain string type", () => {
        expect(resolveSchemaType({type: "boolean"})).toBe("boolean")
        expect(resolveSchemaType({type: "number"})).toBe("number")
    })

    it("treats a bare 'null' type as no type", () => {
        expect(resolveSchemaType({type: "null"})).toBe(undefined)
    })

    it("unwraps a nullable array type — first non-null entry", () => {
        expect(resolveSchemaType({type: ["boolean", "null"]})).toBe("boolean")
        expect(resolveSchemaType({type: ["null", "number"]})).toBe("number")
    })

    it("unwraps a nullable anyOf / oneOf union", () => {
        expect(resolveSchemaType({anyOf: [{type: "boolean"}, {type: "null"}]})).toBe("boolean")
        expect(resolveSchemaType({oneOf: [{type: "null"}, {type: "string"}]})).toBe("string")
    })

    it("returns undefined when no type is resolvable", () => {
        expect(resolveSchemaType({})).toBe(undefined)
        expect(resolveSchemaType(null)).toBe(undefined)
        expect(resolveSchemaType(undefined)).toBe(undefined)
        expect(resolveSchemaType({anyOf: [{type: "null"}]})).toBe(undefined)
    })
})
