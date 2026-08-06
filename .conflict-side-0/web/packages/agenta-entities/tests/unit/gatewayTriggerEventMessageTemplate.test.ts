/**
 * Token-template ⇆ inputs_fields for the subscription message composer.
 *
 * A single literal/selector stays a bare string; a mix becomes resolvable text parts.
 * Round-trips back to the editor template. No backend interpolation — the parts are
 * resolved leaf-by-leaf at delivery.
 */

import {describe, expect, it} from "vitest"

import {
    compileMessageTemplate,
    parseMessageTemplate,
    splitTemplate,
} from "../../src/gatewayTrigger/core/eventMessageTemplate"

describe("splitTemplate", () => {
    it("splits literal + token runs and maps dot paths to $ selectors", () => {
        expect(splitTemplate("Summarize: {{event.attributes.body}} please")).toEqual([
            {literal: "Summarize: "},
            {selector: "$.event.attributes.body"},
            {literal: " please"},
        ])
    })

    it("keeps explicit $ / pointer tokens as-is", () => {
        expect(splitTemplate("{{$.a}}{{/b}}")).toEqual([{selector: "$.a"}, {selector: "/b"}])
    })
})

describe("compileMessageTemplate (chat)", () => {
    it("single token → a bare selector string", () => {
        expect(compileMessageTemplate("{{event.attributes.body}}", true, "messages")).toEqual({
            messages: [{role: "user", content: "$.event.attributes.body"}],
        })
    })

    it("pure literal → a bare literal string", () => {
        expect(compileMessageTemplate("just do it", true, "messages")).toEqual({
            messages: [{role: "user", content: "just do it"}],
        })
    })

    it("mixed text + token → resolvable content parts", () => {
        expect(
            compileMessageTemplate("Reply to {{event.attributes.from}} now", true, "messages"),
        ).toEqual({
            messages: [
                {
                    role: "user",
                    content: [
                        {type: "text", text: "Reply to "},
                        {type: "text", text: "$.event.attributes.from"},
                        {type: "text", text: " now"},
                    ],
                },
            ],
        })
    })

    it("empty template → {}", () => {
        expect(compileMessageTemplate("   ", true, "messages")).toEqual({})
    })
})

describe("compileMessageTemplate (completion)", () => {
    it("maps to the primary input key", () => {
        expect(compileMessageTemplate("{{event.attributes.text}}", false, "query")).toEqual({
            query: "$.event.attributes.text",
        })
    })
})

describe("parseMessageTemplate round-trips", () => {
    it("reads a bare selector back to a token", () => {
        const inputs = JSON.stringify({
            messages: [{role: "user", content: "$.event.attributes.body"}],
        })
        expect(parseMessageTemplate(inputs, true, "messages")).toBe("{{event.attributes.body}}")
    })

    it("reads content parts back to a mixed template", () => {
        const inputs = JSON.stringify({
            messages: [
                {
                    role: "user",
                    content: [
                        {type: "text", text: "Reply to "},
                        {type: "text", text: "$.event.attributes.from"},
                    ],
                },
            ],
        })
        expect(parseMessageTemplate(inputs, true, "messages")).toBe(
            "Reply to {{event.attributes.from}}",
        )
    })

    it("round-trips compile → parse", () => {
        const template = "Summarize {{event.attributes.body}} for {{event.attributes.from}}"
        const compiled = JSON.stringify(compileMessageTemplate(template, true, "messages"))
        expect(parseMessageTemplate(compiled, true, "messages")).toBe(template)
    })

    it("returns empty for a non-message mapping", () => {
        expect(parseMessageTemplate(JSON.stringify({context: "$"}), true, "messages")).toBe("")
    })
})

describe("parseMessageTemplate strictness (non-representable → '')", () => {
    const j = (v: unknown) => JSON.stringify(v)

    it("rejects multiple messages", () => {
        expect(
            parseMessageTemplate(
                j({
                    messages: [
                        {role: "user", content: "a"},
                        {role: "user", content: "b"},
                    ],
                }),
                true,
                "messages",
            ),
        ).toBe("")
    })

    it("rejects a non-user role", () => {
        expect(
            parseMessageTemplate(
                j({messages: [{role: "assistant", content: "a"}]}),
                true,
                "messages",
            ),
        ).toBe("")
    })

    it("rejects non-text content parts", () => {
        expect(
            parseMessageTemplate(
                j({messages: [{role: "user", content: [{type: "image_url", url: "x"}]}]}),
                true,
                "messages",
            ),
        ).toBe("")
    })

    it("rejects extra keys alongside messages (compile would drop them)", () => {
        expect(
            parseMessageTemplate(
                j({messages: [{role: "user", content: "a"}], context: "$"}),
                true,
                "messages",
            ),
        ).toBe("")
    })

    it("completion: rejects extra keys beyond the primary input", () => {
        expect(parseMessageTemplate(j({query: "$.x", other: "y"}), false, "query")).toBe("")
    })
})
