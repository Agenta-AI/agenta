import {describe, expect, it} from "vitest"

import {buildCodingAgentClipboard} from "./codingAgentClipboard"

describe("buildCodingAgentClipboard", () => {
    it("joins the install command, the instruction line, and the text", () => {
        expect(buildCodingAgentClipboard("Review my PRs")).toBe(
            "npx skills add Agenta-AI/agenta-skills\n\n" +
                "Then use the Agenta skills to create an agent that does the following:\n\n" +
                "Review my PRs",
        )
    })

    it("trims the text", () => {
        expect(buildCodingAgentClipboard("  hello  \n")).toMatch(/following:\n\nhello$/)
    })

    it("falls back to the placeholder when empty", () => {
        expect(buildCodingAgentClipboard("")).toMatch(/following:\n\n<describe your agent>$/)
    })

    it("falls back to the placeholder when whitespace-only", () => {
        expect(buildCodingAgentClipboard("   \n\t")).toMatch(/<describe your agent>$/)
    })
})
