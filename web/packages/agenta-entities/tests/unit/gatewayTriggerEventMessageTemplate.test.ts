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
    remapMessageTemplate,
    splitTemplate,
    templateSelectors,
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

const compile = (template: string, isChat = true, primaryKey = "messages", inputs = "{}") =>
    JSON.parse(compileMessageTemplate(inputs, template, isChat, primaryKey))

describe("compileMessageTemplate (chat)", () => {
    it("single token → one text part, so an array field stays text", () => {
        expect(compile("{{event.attributes.body}}")).toEqual({
            messages: [{role: "user", content: [{type: "text", text: "$.event.attributes.body"}]}],
        })
    })

    it("pure literal → a bare literal string", () => {
        expect(compile("just do it")).toEqual({
            messages: [{role: "user", content: "just do it"}],
        })
    })

    it("mixed text + token → resolvable content parts", () => {
        expect(compile("Reply to {{event.attributes.from}} now")).toEqual({
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
        expect(compile("   ")).toEqual({})
    })

    it("keeps sibling keys and replaces only the message", () => {
        const inputs = JSON.stringify({
            messages: [{role: "user", content: "Triage it"}],
            event: "$.event.attributes",
        })
        expect(compile("Review {{event.attributes.title}}", true, "messages", inputs)).toEqual({
            messages: [
                {
                    role: "user",
                    content: [
                        {type: "text", text: "Review "},
                        {type: "text", text: "$.event.attributes.title"},
                    ],
                },
            ],
            event: "$.event.attributes",
        })
    })

    it("an empty template removes only the message key", () => {
        const inputs = JSON.stringify({messages: [{role: "user", content: "a"}], event: "$"})
        expect(compile("", true, "messages", inputs)).toEqual({event: "$"})
    })
})

describe("compileMessageTemplate (completion)", () => {
    it("maps to the primary input key", () => {
        expect(compile("{{event.attributes.text}}", false, "query")).toEqual({
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
        const compiled = compileMessageTemplate("{}", template, true, "messages")
        expect(parseMessageTemplate(compiled, true, "messages")).toBe(template)
    })

    it("round-trips a bracket selector with a quoted key", () => {
        const template = 'Look at {{event.attributes["a.b"]}}'
        const compiled = compileMessageTemplate("{}", template, true, "messages")
        expect(JSON.parse(compiled).messages[0].content[1].text).toBe('$.event.attributes["a.b"]')
        expect(parseMessageTemplate(compiled, true, "messages")).toBe(template)
    })

    it("returns empty for a mapping with no message yet", () => {
        expect(parseMessageTemplate(JSON.stringify({context: "$"}), true, "messages")).toBe("")
        expect(parseMessageTemplate("{}", true, "messages")).toBe("")
    })

    it("ignores sibling keys next to the message", () => {
        expect(
            parseMessageTemplate(
                JSON.stringify({
                    messages: [{role: "user", content: "Triage it"}],
                    event: "$.event.attributes",
                }),
                true,
                "messages",
            ),
        ).toBe("Triage it")
    })
})

describe("parseMessageTemplate: a mapping the composer cannot show → null", () => {
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
        ).toBeNull()
    })

    it("rejects a non-user role", () => {
        expect(
            parseMessageTemplate(
                j({messages: [{role: "assistant", content: "a"}]}),
                true,
                "messages",
            ),
        ).toBeNull()
    })

    it("rejects non-text content parts", () => {
        expect(
            parseMessageTemplate(
                j({messages: [{role: "user", content: [{type: "image_url", url: "x"}]}]}),
                true,
                "messages",
            ),
        ).toBeNull()
    })

    it("completion: rejects a non-string primary input", () => {
        expect(parseMessageTemplate(j({query: {nested: 1}}), false, "query")).toBeNull()
    })
})

describe("templateSelectors", () => {
    it("lists the selectors in order", () => {
        expect(
            templateSelectors("Review {{event.attributes.title}} #{{event.attributes.number}}"),
        ).toEqual(["$.event.attributes.title", "$.event.attributes.number"])
    })
})

describe("remapMessageTemplate", () => {
    it("moves text plus a pill from a completion shape to a chat shape, keeping siblings", () => {
        const inputs = compileMessageTemplate(
            JSON.stringify({extra: "$.event.event_type"}),
            "Review {{event.attributes.title}}",
            false,
            "message",
        )
        const next = JSON.parse(
            remapMessageTemplate(
                inputs,
                {isChat: false, primaryKey: "message"},
                {isChat: true, primaryKey: "messages"},
            ),
        )
        expect(next).toEqual({
            extra: "$.event.event_type",
            messages: [
                {
                    role: "user",
                    content: [
                        {type: "text", text: "Review "},
                        {type: "text", text: "$.event.attributes.title"},
                    ],
                },
            ],
        })
    })

    it("leaves a mapping the composer cannot show untouched", () => {
        const inputs = JSON.stringify({
            messages: [
                {role: "system", content: "a"},
                {role: "user", content: "b"},
            ],
        })
        expect(
            remapMessageTemplate(
                inputs,
                {isChat: true, primaryKey: "messages"},
                {isChat: false, primaryKey: "message"},
            ),
        ).toBe(inputs)
    })
})
