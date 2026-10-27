import {
    ChartLine,
    Code,
    Coffee,
    Cube,
    DotsThree,
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
    /** Several choices can be picked, then Continue moves on; the answer is a list. */
    multiple?: boolean
    /** The PostHog person property the answer is set as. */
    personProperty?: string
}

/**
 * The question steps, in order; add, remove, reorder or reword a question here.
 *
 * The labels are shared with the signup survey ("Signup 3 - Agents"), so an answer given
 * there and an answer given here land in the same bucket. Renaming one splits the history:
 * see docs/design/onboarding-revamp/questions-and-survey-parity.md for the mapping.
 */
export const ONBOARDING_QUESTIONS = [
    {
        id: "persona",
        title: "What best describes you?",
        subtitle: "We'll tailor templates and tips to your role.",
        dot: "About you",
        enabled: true,
        personProperty: "user_role_v2",
        choices: [
            {label: "Founder or Executive", icon: RocketLaunch, category: "Ops"},
            {label: "Freelancer / Consultant / Agency", icon: Handshake, category: "Sales"},
            {label: "Engineer (AI, SWE, ML)", icon: Code, category: "Engineering"},
            {label: "Product Manager", icon: Cube, category: "Engineering"},
            {label: "Sales", icon: ChartLine, category: "Sales"},
            {label: "Marketing", icon: Megaphone, category: "Sales"},
            {label: "Support", icon: Lifebuoy, category: "Support"},
            {label: "IT / Operations", icon: GearSix, category: "Ops"},
            {label: "Student", icon: Student},
            {label: "Hobbyist", icon: Coffee},
            {label: "Other", icon: DotsThree, text: true},
        ],
    },
    {
        id: "size",
        title: "How big is the company you work in?",
        subtitle: "So we can point you at the right setup.",
        dot: "Company size",
        enabled: true,
        personProperty: "company_size_v2",
        choices: [
            {label: "Solo"},
            {label: "2-10"},
            {label: "11-50"},
            {label: "51-200"},
            {label: "201+"},
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
            {label: "GitHub", icon: GithubLogo},
            {label: "Reddit", icon: RedditLogo},
            {label: "Hacker News", icon: Hash},
            {label: "X", icon: XLogo},
            {label: "LinkedIn", icon: LinkedinLogo},
            {label: "YouTube", icon: YoutubeLogo},
            {label: "Newsletter or blog", icon: Newspaper},
            {label: "Conference or event", icon: Microphone},
            {label: "Friend or colleague", icon: Users},
            {label: "Other", icon: DotsThree, text: true},
        ],
    },
] as const satisfies readonly OnboardingQuestionDef[]

export type OnboardingQuestionId = (typeof ONBOARDING_QUESTIONS)[number]["id"]

/** A choice label, or the labels picked on a multi-select question. */
export type OnboardingAnswer = string | readonly string[]

/** Each answered question's answer, by question id. */
export type OnboardingAnswers = Partial<Record<string, OnboardingAnswer>>

const QUESTIONS: readonly OnboardingQuestionDef[] = ONBOARDING_QUESTIONS

export const onboardingQuestion = (id: string) => QUESTIONS.find((question) => question.id === id)

/** An answer's labels in pick order; none when unanswered. */
export const answerLabels = (answer: OnboardingAnswer | undefined): readonly string[] =>
    answer === undefined ? [] : typeof answer === "string" ? [answer] : answer

/** The longest line a write-in accepts; the store keeps the whole choice label before it. */
export const WRITE_IN_MAX = 120

const WRITE_IN_SEPARATOR = ": "

/** What a choice with `text` stores: its label, then the line the user typed. */
export const writeInAnswer = (label: string, text: string) =>
    `${label}${WRITE_IN_SEPARATOR}${text.trim().slice(0, WRITE_IN_MAX)}`

/** The line inside a write-in answer, or `null` when the answer is not one for this choice. */
export const writeInText = (label: string, answer: string): string | null => {
    const prefix = `${label}${WRITE_IN_SEPARATOR}`
    if (!answer.startsWith(prefix)) return null
    const text = answer.slice(prefix.length).trim()
    return text.length > 0 ? text : null
}

/** Whether an answer names a choice, or is a write-in for one that asks for text. */
const namesChoice = (question: OnboardingQuestionDef, answer: string) =>
    question.choices.some(
        (choice) =>
            choice.label === answer ||
            (choice.text === true && writeInText(choice.label, answer) !== null),
    )

/** The stored answers fitted to the registry: unknown questions and choices go, shapes follow `multiple`. */
export const knownAnswers = (answers: OnboardingAnswers): OnboardingAnswers =>
    Object.fromEntries(
        Object.entries(answers).flatMap(([id, value]) => {
            const question = onboardingQuestion(id)
            if (!question) return []
            const labels = answerLabels(value).filter((label) => namesChoice(question, label))
            if (labels.length === 0) return []
            return [[id, question.multiple ? labels : labels[0]]]
        }),
    )

/** Whether a question's choices set the gallery's Recommended category. */
export const recommendsTemplates = (id: string) =>
    onboardingQuestion(id)?.choices.some((choice) => choice.category !== undefined) ?? false

/** The catalog category the answers put first under Recommended. */
export const recommendedCategory = (answers: OnboardingAnswers) =>
    QUESTIONS.flatMap(({id, choices}) =>
        answerLabels(answers[id]).map(
            (label) => choices.find((choice) => choice.label === label)?.category,
        ),
    ).find((category) => category !== undefined)

/** Answers become person properties only once given, so an empty one never overwrites. */
export const personProperties = (answers: OnboardingAnswers): Record<string, OnboardingAnswer> =>
    Object.fromEntries(
        QUESTIONS.flatMap(({id, personProperty}): [string, OnboardingAnswer][] => {
            const value = answers[id]
            return personProperty && value && answerLabels(value).length > 0
                ? [[personProperty, value]]
                : []
        }),
    )
