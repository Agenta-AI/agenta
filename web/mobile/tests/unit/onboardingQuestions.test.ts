import {describe, expect, it} from "vitest"

import type {OnboardingChoice} from "@/features/onboarding/onboardingChoices"
import {
    knownAnswers,
    ONBOARDING_QUESTIONS,
    onboardingQuestion,
    personProperties,
    recommendedCategory,
    signupSurveyProperties,
    writeInAnswer,
    writeInText,
    WRITE_IN_MAX,
} from "@/features/onboarding/onboardingQuestions"
import {onboardingSteps} from "@/features/onboarding/onboardingRoute"

/** The 12 letter keys a question can bind, so a question cannot outgrow the keyboard. */
const LETTER_KEYS = 12

describe("the question registry", () => {
    it("asks role, size and source before the fixed steps", () => {
        expect(onboardingSteps()).toEqual(["persona", "size", "source", "credits", "templates"])
    })

    it("keeps every question inside the keyboard and its labels unique", () => {
        ONBOARDING_QUESTIONS.forEach((question) => {
            expect(question.choices.length).toBeLessThanOrEqual(LETTER_KEYS)
            const labels = question.choices.map((choice) => choice.label)
            expect(new Set(labels).size).toBe(labels.length)
        })
    })

    it("asks for a line of text only on the Other choice of role and source", () => {
        const textChoices = ONBOARDING_QUESTIONS.flatMap((question) =>
            (question.choices as readonly OnboardingChoice[])
                .filter((choice) => choice.text)
                .map((choice) => `${question.id}:${choice.label}`),
        )
        expect(textChoices).toEqual(["persona:Other", "source:Other"])
    })

    it("writes the answers as the property names the signup survey already uses", () => {
        expect(
            personProperties({
                persona: "Hobbyist",
                size: "11-50",
                source: "GitHub",
            }),
        ).toEqual({
            user_role_v2: "Hobbyist",
            company_size_v2: "11-50",
            referral_source_v2: "GitHub",
        })
    })

    it("leaves a person property out until its question is answered", () => {
        expect(personProperties({persona: "Hobbyist"})).toEqual({user_role_v2: "Hobbyist"})
        expect(personProperties({persona: []})).toEqual({})
    })
})

describe("an Other write-in", () => {
    it("stores the choice label and the line, trimmed", () => {
        expect(writeInAnswer("Other", "  a co-op  ")).toBe("Other: a co-op")
        expect(writeInText("Other", "Other: a co-op")).toBe("a co-op")
    })

    it("is nothing until a line is typed, and never longer than the cap", () => {
        expect(writeInText("Other", "Other")).toBeNull()
        expect(writeInText("Other", "Other:    ")).toBeNull()
        expect(writeInText("Other", "Hobbyist")).toBeNull()
        const answer = writeInAnswer("Other", "x".repeat(WRITE_IN_MAX + 40))
        expect(writeInText("Other", answer)).toHaveLength(WRITE_IN_MAX)
    })

    it("survives a draft read, while an unknown label still goes", () => {
        expect(knownAnswers({persona: "Other: a co-op", source: "TikTok"})).toEqual({
            persona: "Other: a co-op",
        })
    })

    it("does not count a bare Other without its line as an answer", () => {
        expect(knownAnswers({persona: "Other", source: "Other:  "})).toEqual({})
    })

    it("keeps the answer out of the Recommended order, as any Other does", () => {
        expect(recommendedCategory({persona: "Other: a co-op"})).toBeUndefined()
        expect(recommendedCategory({persona: "Support"})).toBe("Support")
    })
})

describe("the role vocabulary", () => {
    it("names the buckets the signup survey already has", () => {
        const labels = onboardingQuestion("persona")!.choices.map((choice) => choice.label)
        expect(labels).toEqual([
            "Founder or Executive",
            "Freelancer / Consultant / Agency",
            "Engineer (AI, SWE, ML)",
            "Product Manager",
            "Sales",
            "Marketing",
            "Support",
            "IT / Operations",
            "Student",
            "Hobbyist",
            "Other",
        ])
    })
})

describe("the source vocabulary", () => {
    it("fits twelve chips and names the conference channel", () => {
        const labels = onboardingQuestion("source")!.choices.map((choice) => choice.label)
        expect(labels).toHaveLength(LETTER_KEYS)
        expect(labels).toContain("Conference or event")
        expect(labels).toContain("ChatGPT or Claude")
        expect(labels).toContain("Other")
    })
})

describe("the signup survey event", () => {
    const answers = {
        persona: "Marketing",
        size: "51-200",
        source: "Friend or colleague",
    }

    it("answers the live survey's questions by id, in the shapes its form sends", () => {
        expect(signupSurveyProperties(answers, "person@example.com")).toEqual({
            $survey_id: "019f3812-8ce3-0000-1123-8c254a48750d",
            $survey_name: "Signup 3 - Agents",
            "$survey_response_d71aec24-7e9b-4d89-9cd7-c8f366693367": "Marketing",
            "$survey_response_3b4ac88c-7530-46f1-b54a-c42bf6aca67a": "51-200",
            "$survey_response_e15a61d7-15b2-4ddd-9efd-b2e154005675": ["Friend or colleague"],
            "$survey_response_d6c2d8aa-d624-4736-a71b-25fe0b74d0e9": "person@example.com",
        })
    })

    it("sends a write-in as the typed line, without the Other prefix", () => {
        const properties = signupSurveyProperties(
            {...answers, persona: writeInAnswer("Other", "Teacher")},
            "person@example.com",
        )
        expect(properties["$survey_response_d71aec24-7e9b-4d89-9cd7-c8f366693367"]).toBe("Teacher")
    })

    it("omits an email it does not have", () => {
        expect(signupSurveyProperties(answers, null)).not.toHaveProperty(
            "$survey_response_d6c2d8aa-d624-4736-a71b-25fe0b74d0e9",
        )
    })
})
