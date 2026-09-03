import {describe, expect, it} from "vitest"

import {looksLikeMarkdown} from "../../src/Editor/plugins/markdown/utils/paste"

describe("looksLikeMarkdown", () => {
    it.each([
        "# Heading\n\nParagraph",
        "- first\n- second",
        "1. first\n2. second",
        "> quoted text",
        "```ts\nconst value = true\n```",
        "This is **bold** text",
        "Read the [documentation](https://example.com)",
    ])("recognizes Markdown syntax in pasted text", (value) => {
        expect(looksLikeMarkdown(value)).toBe(true)
    })

    it.each([
        "A normal sentence with punctuation.",
        "https://example.com/path_(one)",
        "Price is 10 * 2 dollars",
        "Email support@example.com",
    ])("does not treat plain text as Markdown", (value) => {
        expect(looksLikeMarkdown(value)).toBe(false)
    })
})
