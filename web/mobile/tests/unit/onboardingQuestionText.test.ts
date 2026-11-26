import questionsCatalog from "@agenta/i18n/catalogs/onboarding.questions"
import {describe, expect, it} from "vitest"

import {ONBOARDING_QUESTIONS} from "@/features/onboarding/onboardingQuestions"

const english = questionsCatalog.en

describe("onboarding question text", () => {
    it("holds the registry's own English for every question and choice", () => {
        for (const question of ONBOARDING_QUESTIONS) {
            expect(english[`${question.id}Title`]).toBe(question.title)
            expect(english[`${question.id}Subtitle`]).toBe(question.subtitle)
            expect(english[`${question.id}Dot`]).toBe(question.dot)
            question.choices.forEach((choice, index) => {
                expect(english[`${question.id}Choice${index}`]).toBe(choice.label)
            })
        }
    })
})
