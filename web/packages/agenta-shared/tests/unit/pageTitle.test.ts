import {describe, expect, it} from "vitest"

import {DEFAULT_PAGE_TITLE, formatPageTitle} from "../../src/utils/pageTitle"

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
