import {afterEach, describe, expect, it} from "vitest"

import {readOnboardingDraft, saveOnboardingDraft} from "./draft"

afterEach(() => window.sessionStorage.clear())

describe("onboarding draft", () => {
    it("clears the saved form after creation", () => {
        saveOnboardingDraft("draft", {
            step: 3,
            role: "Engineering",
            source: "GitHub",
            name: "",
            task: "",
            templateKey: null,
        })
        expect(readOnboardingDraft("draft").step).toBe(3)
        saveOnboardingDraft("draft", null)
        expect(readOnboardingDraft("draft")).toEqual({})
    })
    it("ignores malformed or incomplete stored forms", () => {
        window.sessionStorage.setItem("draft", "{")
        expect(readOnboardingDraft("draft")).toEqual({})
        window.sessionStorage.setItem("draft", JSON.stringify({step: 5}))
        expect(readOnboardingDraft("draft")).toEqual({})
    })
})
