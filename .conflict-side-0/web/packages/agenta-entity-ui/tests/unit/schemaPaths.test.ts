/**
 * Unit pins for the tool-parameter path helpers driving the master/detail editor. They guard the
 * tricky bits: rename preserves property order + remaps `required`, type-switch rebuilds the def,
 * and the `{items:true}` sentinel descends into array items for add/remove at depth.
 */
import {describe, expect, it} from "vitest"

import {
    addPropertyAt,
    getNodeAt,
    isRequiredAt,
    pathLabel,
    removeNodeAt,
    renamePropertyAt,
    setNodeAt,
    toggleRequiredAt,
    type Schema,
} from "../../src/DrillInView/SchemaControls/agentTemplate/schemaPaths"

const base = (): Schema => ({
    type: "object",
    properties: {
        query: {type: "string"},
        filters: {
            type: "object",
            properties: {
                max_age: {type: "number"},
                sources: {type: "array", items: {type: "string"}},
            },
            required: ["max_age"],
        },
        limit: {type: "number"},
    },
    required: ["query"],
})

describe("schemaPaths", () => {
    it("resolves nested and array-item nodes", () => {
        const s = base()
        expect(getNodeAt(s, [{p: "filters"}, {p: "sources"}])).toMatchObject({type: "array"})
        // Descend into an object item via the {items:true} sentinel.
        const arrObj = setNodeAt(s, [{p: "filters"}, {p: "sources"}], {
            type: "array",
            items: {type: "object", properties: {url: {type: "string"}}, required: []},
        })
        expect(
            getNodeAt(arrObj, [{p: "filters"}, {p: "sources"}, {items: true}, {p: "url"}]),
        ).toMatchObject({type: "string"})
    })

    it("renames a property preserving order and remapping required", () => {
        const s = base()
        const next = renamePropertyAt(s, [], "query", "q")
        const props = next.properties as Record<string, Schema>
        expect(Object.keys(props)).toEqual(["q", "filters", "limit"])
        expect(next.required).toEqual(["q"])
    })

    it("rejects a rename onto an existing key (returns same reference)", () => {
        const s = base()
        expect(renamePropertyAt(s, [], "query", "limit")).toBe(s)
    })

    it("switches type by replacing the def (children dropped) via setNodeAt", () => {
        const s = base()
        const next = setNodeAt(s, [{p: "filters"}], {type: "string"})
        expect(getNodeAt(next, [{p: "filters"}])).toEqual({type: "string"})
        // Sibling untouched.
        expect(getNodeAt(next, [{p: "query"}])).toEqual({type: "string"})
    })

    it("adds a fresh property with a non-colliding key and toggles required", () => {
        const s = base()
        const {schema, key} = addPropertyAt(s, [{p: "filters"}])
        expect(key).toBe("param3")
        expect(getNodeAt(schema, [{p: "filters"}, {p: key}])).toEqual({type: "string"})
        const req = toggleRequiredAt(schema, [{p: "filters"}], key, true)
        expect(isRequiredAt(req, [{p: "filters"}], key)).toBe(true)
    })

    it("removes a property and drops it from required", () => {
        const s = base()
        const next = removeNodeAt(s, [{p: "filters"}], "max_age")
        expect(getNodeAt(next, [{p: "filters"}, {p: "max_age"}])).toBeNull()
        expect(getNodeAt(next, [{p: "filters"}])?.required).toEqual([])
    })

    it("labels a path as an uppercase breadcrumb", () => {
        expect(pathLabel([{p: "filters"}, {p: "sources"}])).toBe("FILTERS · SOURCES")
        expect(pathLabel([{p: "sources"}, {items: true}, {p: "url"}])).toBe("SOURCES · [ ] · URL")
    })
})
