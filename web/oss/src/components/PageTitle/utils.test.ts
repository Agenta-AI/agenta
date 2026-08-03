import {describe, expect, it} from "vitest"

import {
    DEFAULT_PAGE_TITLE,
    SESSION_TITLE_MAX_LENGTH,
    formatPageTitle,
    truncateTitlePart,
} from "./utils"

describe("formatPageTitle", () => {
    it("falls back when no semantic title is available", () => {
        expect(formatPageTitle()).toBe(DEFAULT_PAGE_TITLE)
        expect(formatPageTitle("   ")).toBe(DEFAULT_PAGE_TITLE)
    })

    it("normalizes parts and adds one separator", () => {
        expect(formatPageTitle("  Evaluation   runs ", " Marketing   Coworker ")).toBe(
            "Evaluation runs | Marketing Coworker",
        )
    })

    it("uses Agenta when the context is missing", () => {
        expect(formatPageTitle("Settings")).toBe("Settings | Agenta")
    })
})

describe("truncateTitlePart", () => {
    it("keeps an exact 60-character title", () => {
        const title = "a".repeat(SESSION_TITLE_MAX_LENGTH)
        expect(truncateTitlePart(title, SESSION_TITLE_MAX_LENGTH)).toBe(title)
    })

    it("caps a longer title at 60 characters with an ellipsis", () => {
        const title = truncateTitlePart("a".repeat(61), SESSION_TITLE_MAX_LENGTH)
        expect(title).toBe(`${"a".repeat(59)}…`)
        expect(title).toHaveLength(SESSION_TITLE_MAX_LENGTH)
    })

    it("does not split an emoji at the truncation boundary", () => {
        const title = truncateTitlePart(`${"a".repeat(59)}🙂b`, SESSION_TITLE_MAX_LENGTH)
        expect(title).toBe(`${"a".repeat(59)}…`)
    })
})
