import {Users} from "@phosphor-icons/react"
import {afterEach, beforeEach, onTestFinished} from "vitest"

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

/** The two questions the flow tests were written against, independent of the app's list. */
export const TEST_QUESTIONS: readonly OnboardingQuestionDef[] = [
    {
        id: "role",
        title: "What kind of work do you do?",
        subtitle: "We’ll suggest agents that fit your work.",
        dot: "Your work",
        enabled: true,
        personProperty: "user_role_v2",
        choices: [
            {label: "Engineering", icon: Users, category: "Engineering"},
            {label: "Product", icon: Users, category: "Engineering"},
            {label: "Design", icon: Users, category: "Engineering"},
            {label: "Sales", icon: Users, category: "Sales"},
            {label: "Marketing", icon: Users, category: "Sales"},
            {label: "Customer support", icon: Users, category: "Support"},
            {label: "Operations", icon: Users, category: "Ops"},
            {label: "Finance", icon: Users, category: "Ops"},
            {label: "Legal", icon: Users, category: "Ops"},
            {label: "Founder or exec", icon: Users, category: "Ops"},
            {label: "Research", icon: Users, category: "Knowledge"},
            {label: "Other", icon: Users},
        ],
    },
    {
        id: "source",
        title: "How did you hear about Agenta?",
        subtitle: "Pick the one that fits best.",
        dot: "How you found us",
        enabled: true,
        personProperty: "referral_source_v2",
        choices: [
            {label: "Google search", icon: Users},
            {label: "ChatGPT or Claude", icon: Users},
            {label: "X", icon: Users},
            {label: "LinkedIn", icon: Users},
            {label: "YouTube", icon: Users},
            {label: "Reddit", icon: Users},
            {label: "GitHub", icon: Users},
            {label: "Hacker News", icon: Users},
            {label: "Friend or colleague", icon: Users},
            {label: "Newsletter or blog", icon: Users},
            {label: "Podcast", icon: Users},
            {label: "Other", icon: Users},
        ],
    },
]

/** Swaps the app's question list for `TEST_QUESTIONS` around each test in the calling file. */
export const withTestQuestions = () => {
    const registry = ONBOARDING_QUESTIONS as unknown as OnboardingQuestionDef[]
    const original = [...registry]
    beforeEach(() => registry.splice(0, registry.length, ...TEST_QUESTIONS))
    afterEach(() => registry.splice(0, registry.length, ...original))
}
