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
    it("keeps an unanswered source until step 4 and rejects an unsupported one", () => {
        const draft = {
            step: 4,
            role: "Engineering",
            source: "",
            name: "",
            task: "",
            templateKey: null,
        }
        saveOnboardingDraft("draft", draft)
        expect(readOnboardingDraft("draft").step).toBe(4)
        saveOnboardingDraft("draft", {...draft, step: 5})
        expect(readOnboardingDraft("draft")).toEqual({})
        saveOnboardingDraft("draft", {...draft, step: 1, source: "Removed source"})
        expect(readOnboardingDraft("draft")).toEqual({})
    })
})
