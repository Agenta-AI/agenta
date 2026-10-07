import {Users} from "@phosphor-icons/react"
import {onTestFinished} from "vitest"

import {
    ONBOARDING_QUESTIONS,
    type OnboardingQuestionDef,
} from "@/features/onboarding/onboardingQuestions"

export const TEAM_QUESTION: OnboardingQuestionDef = {
    id: "team",
    title: "How big is your team?",
    subtitle: "Count everyone who will use agents.",
    dot: "Your team",
    enabled: true,
    personProperty: "team_size_v1",
    choices: [
        {label: "Just me", icon: Users},
        {label: "2 to 10", icon: Users},
    ],
}

/** Appends a question to the app's registry for one test, as adding its entry would. */
export const registerQuestion = (question: OnboardingQuestionDef) => {
    const registry = ONBOARDING_QUESTIONS as unknown as OnboardingQuestionDef[]
    registry.push(question)
    onTestFinished(() => {
        registry.splice(registry.indexOf(question), 1)
    })
}
