/**
 * resolveSchemaType — regression guard for nullable evaluator output
 * types.
 *
 * An evaluator output property declared nullable (`type: ["boolean",
 * "null"]` or `anyOf: [{type: "boolean"}, {type: "null"}]`) must still
 * resolve to its primitive type — otherwise the scenario filter bar
 * mistypes a boolean field and offers numeric operators.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {resolveSchemaType} from "../schemaType"

describe("resolveSchemaType", () => {
    it("returns a plain string type", () => {
        assert.equal(resolveSchemaType({type: "boolean"}), "boolean")
        assert.equal(resolveSchemaType({type: "number"}), "number")
    })

    it("treats a bare 'null' type as no type", () => {
        assert.equal(resolveSchemaType({type: "null"}), undefined)
    })

    it("unwraps a nullable array type — first non-null entry", () => {
        assert.equal(resolveSchemaType({type: ["boolean", "null"]}), "boolean")
        assert.equal(resolveSchemaType({type: ["null", "number"]}), "number")
    })

    it("unwraps a nullable anyOf / oneOf union", () => {
        assert.equal(resolveSchemaType({anyOf: [{type: "boolean"}, {type: "null"}]}), "boolean")
        assert.equal(resolveSchemaType({oneOf: [{type: "null"}, {type: "string"}]}), "string")
    })

    it("returns undefined when no type is resolvable", () => {
        assert.equal(resolveSchemaType({}), undefined)
        assert.equal(resolveSchemaType(null), undefined)
        assert.equal(resolveSchemaType(undefined), undefined)
        assert.equal(resolveSchemaType({anyOf: [{type: "null"}]}), undefined)
    })
})
