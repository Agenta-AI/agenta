import {describe, expect, it} from "vitest"

import {composeWithStarterPrompt} from "@/features/chat/composerPrefill"

describe("composeWithStarterPrompt", () => {
    it("fills an empty composer with the starter prompt", () => {
        expect(composeWithStarterPrompt("", "I want a skill that")).toBe("I want a skill that")
    })

    it("treats a whitespace-only composer as empty", () => {
        expect(composeWithStarterPrompt(" \n ", "I want to connect")).toBe("I want to connect")
    })

    it("keeps an existing draft and starts the prompt on a new paragraph", () => {
        expect(composeWithStarterPrompt("Some notes\n", "I want an automation that")).toBe(
            "Some notes\n\nI want an automation that",
        )
    })
})
