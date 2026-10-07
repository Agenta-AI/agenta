import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {DEFAULT_AGENT_ICON} from "@agenta/ui/agent-icon"
import {z} from "zod"

import type {ConnectedApps} from "./onboardingApps"
import {RECOMMENDED, templateGlyph, type GalleryCategory} from "./onboardingChoices"
import {
    knownAnswers,
    recommendsTemplates,
    type OnboardingAnswers,
    type OnboardingQuestionId,
} from "./onboardingQuestions"
import {isOnboardingStep, type OnboardingStep} from "./onboardingRoute"

/** A glyph name from the agent-icon catalog and a colour. */
export interface OnboardingIconPick {
    icon: string
    color: string
}

/** The blank start's agent, edited in the scratch panel. */
export interface OnboardingAgent {
    name: string
    icon: OnboardingIconPick
    firstMessage: string
}

/** What the user chose and typed; where they are lives in the URL. */
export interface OnboardingDraft {
    answers: OnboardingAnswers
    category: GalleryCategory
    agent: OnboardingAgent
    /** Steps already reported as completed, so each is reported once. */
    completed: OnboardingStep[]
}

export const ONBOARDING_NAME_MAX = 100
export const ONBOARDING_TEXT_MAX = 10000

export const BLANK_AGENT: OnboardingAgent = {
    name: "",
    icon: {icon: DEFAULT_AGENT_ICON.icon, color: DEFAULT_AGENT_ICON.color},
    firstMessage: "",
}

export const EMPTY_ONBOARDING_DRAFT: OnboardingDraft = {
    answers: {},
    category: RECOMMENDED,
    agent: BLANK_AGENT,
    completed: [],
}

export type OnboardingAction =
    | {type: "answer"; question: OnboardingQuestionId; value: string}
    | {type: "category"; category: GalleryCategory}
    | {type: "agent"; patch: Partial<OnboardingAgent>}
    | {type: "completed"; step: OnboardingStep}

export const onboardingReducer = (
    draft: OnboardingDraft,
    action: OnboardingAction,
): OnboardingDraft => {
    switch (action.type) {
        case "answer": {
            if (draft.answers[action.question] === action.value) return draft
            const answers = {...draft.answers, [action.question]: action.value}
            // The gallery's Recommended slice follows the answer that orders it.
            return recommendsTemplates(action.question)
                ? {...draft, answers, category: RECOMMENDED}
                : {...draft, answers}
        }
        case "category":
            return {...draft, category: action.category}
        case "agent": {
            const agent = {...draft.agent, ...action.patch}
            return {
                ...draft,
                agent: {
                    ...agent,
                    name: agent.name.slice(0, ONBOARDING_NAME_MAX),
                    firstMessage: agent.firstMessage.slice(0, ONBOARDING_TEXT_MAX),
                },
            }
        }
        case "completed":
            return draft.completed.includes(action.step)
                ? draft
                : {...draft, completed: [...draft.completed, action.step]}
    }
}

export const FIRST_AGENT_FALLBACK_NAME = "My first agent"

/** What Create commits. */
export interface FirstAgentInput {
    name: string
    firstMessage: string
    /** The template whose package Create loads; `null` for a blank start. */
    templateKey: string | null
    icon: OnboardingIconPick
    /** Integration keys whose connections join the agent as tools. */
    apps: string[]
}

/** A blank start, once it has a first message. */
export const blankAgentInput = (
    agent: OnboardingAgent,
    firstMessage: string,
): FirstAgentInput | null => {
    const message = firstMessage.trim()
    if (!message) return null
    return {
        name: agent.name.trim() || FIRST_AGENT_FALLBACK_NAME,
        firstMessage: message,
        templateKey: null,
        icon: agent.icon,
        apps: [],
    }
}

/** A template's package, with its look and the apps it uses that are already connected. */
export const templateAgentInput = (
    template: AgentStarterTemplate,
    connected: ConnectedApps,
): FirstAgentInput => ({
    name: template.name,
    firstMessage: "",
    templateKey: template.key,
    icon: {icon: templateGlyph(template), color: template.color},
    apps: templateProviderSlugs(template).filter((key) => connected.has(key)),
})

/** Per user: a preview on any project resumes the same answers. */
export const onboardingDraftKey = (userId: string) => `agenta:onboarding:draft:v4:${userId}`

const iconSchema = z.object({icon: z.string().min(1), color: z.string().min(1)})

const draftSchema = z.object({
    answers: z.record(z.string(), z.string()),
    category: z.string().min(1),
    agent: z.object({
        name: z.string().max(ONBOARDING_NAME_MAX),
        icon: iconSchema,
        firstMessage: z.string().max(ONBOARDING_TEXT_MAX),
    }),
    completed: z.array(z.string()),
})

/** The saved draft without answers or steps the registry no longer has, else a fresh one. */
export const readOnboardingDraft = (key: string): OnboardingDraft => {
    try {
        const raw = window.sessionStorage.getItem(key)
        if (!raw) return EMPTY_ONBOARDING_DRAFT
        const parsed = draftSchema.safeParse(JSON.parse(raw))
        if (!parsed.success) return EMPTY_ONBOARDING_DRAFT
        const {answers, completed, ...rest} = parsed.data
        return {
            ...rest,
            answers: knownAnswers(answers),
            completed: completed.filter(isOnboardingStep),
        }
    } catch {
        return EMPTY_ONBOARDING_DRAFT
    }
}

export const saveOnboardingDraft = (key: string, draft: OnboardingDraft | null) => {
    try {
        if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft))
        else window.sessionStorage.removeItem(key)
    } catch {
        // Storage restrictions must not block onboarding.
    }
}
