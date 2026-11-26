import {describe, expect, it} from "vitest"

import {parseEntry} from "../../scripts/parse-entry.mjs"

const entry = (frontmatter: string, body = "Summary text.") =>
    [
        "---",
        'title: "A title"',
        "slug: a-slug",
        "date: 2026-11-24",
        "tags: [v0.131.0]",
        frontmatter,
        "---",
        "",
        "<Summary>",
        "",
        body,
        "",
        "</Summary>",
        "",
    ]
        .filter((line) => line !== "")
        .join("\n")

describe("parseEntry cover", () => {
    it("reads a known cover into the feature", () => {
        const parsed = parseEntry(entry("cover: builder"), "a.mdx")
        expect(parsed?.feature.cover).toBe("builder")
    })

    it("leaves the cover out when the entry has none", () => {
        const parsed = parseEntry(entry(""), "a.mdx")
        expect(parsed?.feature).not.toHaveProperty("cover")
    })

    it("fails on an unknown cover", () => {
        expect(() => parseEntry(entry("cover: poster"), "a.mdx")).toThrow(/cover must be one of/)
    })

    it("drops the cover when the entry has a demo video", () => {
        const parsed = parseEntry(
            entry("cover: models", '<Stream src="0123456789abcdef0123456789abcdef" />'),
            "a.mdx",
        )
        expect(parsed?.feature.streamVideoId).toBe("0123456789abcdef0123456789abcdef")
        expect(parsed?.feature).not.toHaveProperty("cover")
    })
})

describe("parseEntry upgrade_notes", () => {
    it("makes a docs path absolute", () => {
        const parsed = parseEntry(entry("upgrade_notes: /self-host/upgrading#steps"), "a.mdx")
        expect(parsed?.upgradeNotesLink).toBe("https://agenta.ai/docs/self-host/upgrading#steps")
    })

    it("keeps an https link", () => {
        const parsed = parseEntry(entry("upgrade_notes: https://example.com/steps"), "a.mdx")
        expect(parsed?.upgradeNotesLink).toBe("https://example.com/steps")
    })

    it("leaves the field out when the entry has none", () => {
        expect(parseEntry(entry(""), "a.mdx")).not.toHaveProperty("upgradeNotesLink")
    })

    it("fails on a link that is not https", () => {
        expect(() => parseEntry(entry("upgrade_notes: http://example.com"), "a.mdx")).toThrow(
            /upgrade_notes/,
        )
    })
})
