import {describe, expect, it} from "vitest"

import {buildFormFieldsFromSchema} from "../../src/utils/gatewayToolSchema"

const schemaWithFormats = () => ({
    type: "object",
    properties: {
        note: {type: "string", title: "Note", format: "multiline"},
        due: {type: "string", format: "date"},
        at: {type: "string", format: "date-time"},
        contact: {type: "string", format: "email"},
        link: {type: "string", format: "uri"},
        odd: {type: "string", format: "hologram"},
        level: {type: "string", enum: ["low", "high"], format: "date"},
        count: {type: "integer", format: "date"},
        nested: {
            type: "object",
            properties: {when: {type: "string", format: "date"}},
        },
        rows: {
            type: "array",
            items: {type: "object", properties: {day: {type: "string", format: "date"}}},
        },
    },
    required: ["note"],
})

describe("buildFormFieldsFromSchema — baseline", () => {
    it("maps primitive, enum, object, and array properties", () => {
        const fields = buildFormFieldsFromSchema(schemaWithFormats())
        const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
        expect(byName.note.type).toBe("string")
        expect(byName.note.required).toBe(true)
        expect(byName.count.type).toBe("number")
        expect(byName.level.type).toBe("enum")
        expect(byName.level.enumValues).toEqual(["low", "high"])
        expect(byName.nested.type).toBe("object")
        expect(byName.nested.children?.[0]?.name).toBe("nested.when")
        expect(byName.rows.type).toBe("array")
        expect(byName.rows.itemChildren?.[0]?.name).toBe("day")
    })
})

describe("buildFormFieldsFromSchema — formats flag", () => {
    // CRITICAL regression: gateway-tool execution forms call without opts and must render
    // unchanged — no `format` key may appear anywhere with the flag off.
    it("flag off (default): output is identical to pre-flag behavior — no format keys", () => {
        const off = buildFormFieldsFromSchema(schemaWithFormats())
        const collect = (fields: typeof off): boolean[] =>
            fields.flatMap((f) => [
                "format" in f,
                ...(f.children ? collect(f.children) : []),
                ...(f.itemChildren ? collect(f.itemChildren) : []),
            ])
        expect(collect(off).some(Boolean)).toBe(false)
        expect(off).toEqual(buildFormFieldsFromSchema(schemaWithFormats(), "", {}))
        expect(off).toEqual(buildFormFieldsFromSchema(schemaWithFormats(), "", {formats: false}))
    })

    it("flag on: known string formats surface on the descriptor", () => {
        const fields = buildFormFieldsFromSchema(schemaWithFormats(), "", {formats: true})
        const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
        expect(byName.note.format).toBe("multiline")
        expect(byName.due.format).toBe("date")
        expect(byName.at.format).toBe("date-time")
        expect(byName.contact.format).toBe("email")
        expect(byName.link.format).toBe("uri")
    })

    it("flag on: unknown formats fall back silently (no format key)", () => {
        const fields = buildFormFieldsFromSchema(schemaWithFormats(), "", {formats: true})
        const odd = fields.find((f) => f.name === "odd")
        expect(odd && "format" in odd).toBe(false)
    })

    it("flag on: format aliases normalize to canonical", () => {
        const schema = {
            type: "object",
            properties: {
                a: {type: "string", format: "textarea"},
                b: {type: "string", format: "multi-line"},
                c: {type: "string", format: "MULTILINE"},
                d: {type: "string", format: "url"},
            },
        }
        const byName = Object.fromEntries(
            buildFormFieldsFromSchema(schema, "", {formats: true}).map((f) => [f.name, f]),
        )
        expect(byName.a.format).toBe("multiline")
        expect(byName.b.format).toBe("multiline")
        expect(byName.c.format).toBe("multiline")
        expect(byName.d.format).toBe("uri")
    })

    it("flag on: enum wins over format; non-string types never get a format", () => {
        const fields = buildFormFieldsFromSchema(schemaWithFormats(), "", {formats: true})
        const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
        expect("format" in byName.level).toBe(false)
        expect("format" in byName.count).toBe(false)
    })

    it("flag on: threads through nested objects and array item children", () => {
        const fields = buildFormFieldsFromSchema(schemaWithFormats(), "", {formats: true})
        const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
        expect(byName.nested.children?.[0]?.format).toBe("date")
        expect(byName.rows.itemChildren?.[0]?.format).toBe("date")
    })
})

describe("buildFormFieldsFromSchema — openEnums flag", () => {
    // CRITICAL regression: gateway-tool execution forms call without opts — enums stay strict, so
    // no `allowCustomEnum` key may appear with the flag off.
    it("flag off (default): no allowCustomEnum key anywhere", () => {
        const off = buildFormFieldsFromSchema(schemaWithFormats())
        expect(off.some((f) => "allowCustomEnum" in f)).toBe(false)
        expect(off).toEqual(buildFormFieldsFromSchema(schemaWithFormats(), "", {openEnums: false}))
    })

    it("flag on: enum fields get allowCustomEnum; non-enum fields do not", () => {
        const fields = buildFormFieldsFromSchema(schemaWithFormats(), "", {openEnums: true})
        const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
        expect(byName.level.allowCustomEnum).toBe(true)
        expect("allowCustomEnum" in byName.note).toBe(false)
        expect("allowCustomEnum" in byName.count).toBe(false)
    })

    it("flag on: string-items arrays become multi-select; object-items arrays do not", () => {
        const schema = {
            type: "object",
            properties: {
                actions: {
                    type: "array",
                    items: {type: "string", enum: ["send", "list"]},
                    default: ["send"],
                },
                repos: {type: "array", items: {type: "string"}},
                rows: {type: "array", items: {type: "object", properties: {a: {type: "string"}}}},
            },
        }
        const byName = Object.fromEntries(
            buildFormFieldsFromSchema(schema, "", {openEnums: true}).map((f) => [f.name, f]),
        )
        expect(byName.actions.multiple).toBe(true)
        expect(byName.actions.allowCustomEnum).toBe(true)
        expect(byName.actions.enumValues).toEqual(["send", "list"])
        expect(byName.actions.default).toEqual(["send"])
        expect(byName.repos.multiple).toBe(true)
        expect(byName.repos.enumValues).toBeUndefined()
        expect("multiple" in byName.rows).toBe(false)

        // Flag off (gateway forms): arrays keep the Form.List shape — no multiple key anywhere.
        const off = buildFormFieldsFromSchema(schema)
        expect(off.some((f) => "multiple" in f)).toBe(false)
    })

    it("flag on: oneOf options surface as enumOptions (single + multi), enum derived from consts", () => {
        const schema = {
            type: "object",
            properties: {
                process: {
                    type: "string",
                    oneOf: [
                        {const: "merge_main", title: "Merge to main", description: "Daily check"},
                        {const: "gh_releases", title: "GitHub releases"},
                    ],
                },
                channels: {
                    type: "array",
                    items: {type: "string", oneOf: [{const: "slack", title: "Slack"}]},
                },
            },
        }
        const byName = Object.fromEntries(
            buildFormFieldsFromSchema(schema, "", {openEnums: true}).map((f) => [f.name, f]),
        )
        expect(byName.process.type).toBe("enum")
        expect(byName.process.enumValues).toEqual(["merge_main", "gh_releases"])
        expect(byName.process.enumOptions).toEqual([
            {value: "merge_main", label: "Merge to main", description: "Daily check"},
            {value: "gh_releases", label: "GitHub releases"},
        ])
        expect(byName.channels.multiple).toBe(true)
        expect(byName.channels.enumValues).toEqual(["slack"])
        expect(byName.channels.enumOptions).toEqual([{value: "slack", label: "Slack"}])

        // Flag off (gateway forms): oneOf is ignored — no enumOptions key, no enum promotion.
        const off = buildFormFieldsFromSchema(schema)
        expect(off.some((f) => "enumOptions" in f)).toBe(false)
        expect(off.find((f) => f.name === "process")?.type).toBe("string")
    })
})
