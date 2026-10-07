import {
    Article,
    ChartLine,
    ChartScatter,
    Code,
    Cube,
    DotsThree,
    EnvelopeSimple,
    GearSix,
    GithubLogo,
    GoogleLogo,
    Handshake,
    Hash,
    Kanban,
    Lifebuoy,
    LinkedinLogo,
    MagnifyingGlass,
    Megaphone,
    Microphone,
    Newspaper,
    OpenAiLogo,
    PenNib,
    RedditLogo,
    RocketLaunch,
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
        id: "persona",
        title: "What best describes you?",
        subtitle: "We’ll tailor templates and tips to your role.",
        dot: "About you",
        enabled: true,
        personProperty: "user_persona_v1",
        choices: [
            {label: "Founder", icon: RocketLaunch},
            {label: "Engineer", icon: Code},
            {label: "Product manager", icon: Cube},
            {label: "Designer", icon: PenNib},
            {label: "Data or ML", icon: ChartScatter},
            {label: "Marketing", icon: Megaphone},
            {label: "Sales", icon: Handshake},
            {label: "Support", icon: Lifebuoy},
            {label: "Operations", icon: GearSix},
            {label: "Student", icon: Student},
            {label: "Other", icon: DotsThree},
        ],
    },
    {
        id: "use_case",
        title: "What should your agents help with?",
        subtitle: "We’ll suggest agents for it first.",
        dot: "Your goal",
        enabled: true,
        personProperty: "use_case_v1",
        choices: [
            {label: "Code and pull requests", icon: Code, category: "Engineering"},
            {label: "Customer support", icon: Lifebuoy, category: "Support"},
            {label: "Sales and outreach", icon: Handshake, category: "Sales"},
            {label: "Marketing and content", icon: Article, category: "Sales"},
            {label: "Research", icon: MagnifyingGlass, category: "Knowledge"},
            {label: "Reports and metrics", icon: ChartLine, category: "Ops"},
            {label: "Email and calendar", icon: EnvelopeSimple, category: "Ops"},
            {label: "Team operations", icon: Kanban, category: "Ops"},
            {label: "Something else", icon: DotsThree},
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
