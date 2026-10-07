import {
    ChartScatter,
    Code,
    Cube,
    CurrencyCircleDollar,
    DotsThree,
    Flask,
    GearSix,
    GithubLogo,
    GoogleLogo,
    Handshake,
    Hash,
    Lifebuoy,
    LinkedinLogo,
    Megaphone,
    Microphone,
    Newspaper,
    OpenAiLogo,
    PenNib,
    RedditLogo,
    RocketLaunch,
    Scales,
    Student,
    Users,
    XLogo,
    YoutubeLogo,
} from "@phosphor-icons/react"

import type {OnboardingChoice} from "./onboardingChoices"

/** One question step; its `id` is its URL segment, its draft key and its analytics `step_key`. */
export interface OnboardingQuestionDef {
    id: string
    title: string
    subtitle: string
    /** The progress dot's label. */
    dot: string
    /** At most twelve, one per letter key. */
    choices: readonly OnboardingChoice[]
    enabled: boolean
    /** The PostHog person property the answer is set as. */
    personProperty?: string
}

/** The question steps, in order; add, remove, reorder or reword a question here. */
export const ONBOARDING_QUESTIONS = [
    {
        id: "role",
        title: "What kind of work do you do?",
        subtitle: "We’ll suggest agents that fit your work.",
        dot: "Your work",
        enabled: true,
        personProperty: "user_role_v2",
        choices: [
            {label: "Engineering", icon: Code, category: "Engineering"},
            {label: "Product", icon: Cube, category: "Engineering"},
            {label: "Design", icon: PenNib, category: "Engineering"},
            {label: "Sales", icon: Handshake, category: "Sales"},
            {label: "Marketing", icon: Megaphone, category: "Sales"},
            {label: "Customer support", icon: Lifebuoy, category: "Support"},
            {label: "Operations", icon: GearSix, category: "Ops"},
            {label: "Finance", icon: CurrencyCircleDollar, category: "Ops"},
            {label: "Legal", icon: Scales, category: "Ops"},
            {label: "Founder or exec", icon: RocketLaunch, category: "Ops"},
            {label: "Research", icon: Flask, category: "Knowledge"},
            {label: "Other", icon: DotsThree},
        ],
    },
    {
        id: "persona",
        title: "What best describes you?",
        subtitle: "We’ll tailor templates and tips to your role.",
        dot: "About you",
        enabled: true,
        personProperty: "user_persona_v1",
        choices: [
            {label: "Founder", icon: RocketLaunch, category: "Ops"},
            {label: "Engineer", icon: Code, category: "Engineering"},
            {label: "Product manager", icon: Cube, category: "Engineering"},
            {label: "Designer", icon: PenNib, category: "Engineering"},
            {label: "Data or ML", icon: ChartScatter, category: "Knowledge"},
            {label: "Marketing", icon: Megaphone, category: "Sales"},
            {label: "Sales", icon: Handshake, category: "Sales"},
            {label: "Support", icon: Lifebuoy, category: "Support"},
            {label: "Operations", icon: GearSix, category: "Ops"},
            {label: "Student", icon: Student},
            {label: "Other", icon: DotsThree},
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
            {label: "Google search", icon: GoogleLogo},
            {label: "ChatGPT or Claude", icon: OpenAiLogo},
            {label: "X", icon: XLogo},
            {label: "LinkedIn", icon: LinkedinLogo},
            {label: "YouTube", icon: YoutubeLogo},
            {label: "Reddit", icon: RedditLogo},
            {label: "GitHub", icon: GithubLogo},
            {label: "Hacker News", icon: Hash},
            {label: "Friend or colleague", icon: Users},
            {label: "Newsletter or blog", icon: Newspaper},
            {label: "Podcast", icon: Microphone},
            {label: "Other", icon: DotsThree},
        ],
    },
] as const satisfies readonly OnboardingQuestionDef[]

export type OnboardingQuestionId = (typeof ONBOARDING_QUESTIONS)[number]["id"]

/** Each answered question's choice label, by question id. */
export type OnboardingAnswers = Partial<Record<string, string>>

const QUESTIONS: readonly OnboardingQuestionDef[] = ONBOARDING_QUESTIONS

export const onboardingQuestion = (id: string) => QUESTIONS.find((question) => question.id === id)

/** The stored answers that still name a question and one of its choices. */
export const knownAnswers = (answers: OnboardingAnswers): OnboardingAnswers =>
    Object.fromEntries(
        Object.entries(answers).filter(([id, value]) =>
            onboardingQuestion(id)?.choices.some((choice) => choice.label === value),
        ),
    )

/** Whether a question's choices set the gallery's Recommended category. */
export const recommendsTemplates = (id: string) =>
    onboardingQuestion(id)?.choices.some((choice) => choice.category !== undefined) ?? false

/** The catalog category the answers put first under Recommended. */
export const recommendedCategory = (answers: OnboardingAnswers) =>
    QUESTIONS.map(
        ({id, choices}) => choices.find((choice) => choice.label === answers[id])?.category,
    ).find((category) => category !== undefined)

/** Answers become person properties only once given, so an empty one never overwrites. */
export const personProperties = (answers: OnboardingAnswers): Record<string, string> =>
    Object.fromEntries(
        QUESTIONS.flatMap(({id, personProperty}) => {
            const value = answers[id]
            return personProperty && value ? [[personProperty, value]] : []
        }),
    )
