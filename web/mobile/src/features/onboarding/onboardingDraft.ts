import {templateBuilderMessage, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {DEFAULT_AGENT_ICON} from "@agenta/ui/agent-icon"
import {z} from "zod"

import {
    ONBOARDING_ROLES,
    ONBOARDING_SOURCES,
    RECOMMENDED,
    templateGlyph,
    type GalleryCategory,
    type OnboardingRole,
    type OnboardingSource,
} from "./onboardingChoices"

/** Canonical order; analytics numbers steps by it. */
export const ONBOARDING_STEPS = ["role", "referral", "credits", "gallery", "creator"] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/** The header counts four steps: the gallery and the creator share the last one. */
export const PROGRESS_TOTAL = 4
export const PROGRESS: Record<OnboardingStep, number> = {
    role: 1,
    referral: 2,
    credits: 3,
    gallery: 4,
    creator: 4,
}

export const PREVIOUS: Record<OnboardingStep, OnboardingStep | null> = {
    role: null,
    referral: "role",
    credits: "referral",
    gallery: "credits",
    creator: "gallery",
}

/** Each step's heading id: focus lands on it, and its choices are labelled by it. */
export const onboardingHeadingId = (step: OnboardingStep) => `onboarding-heading-${step}`

export const onboardingStepNumber = (step: OnboardingStep) => ONBOARDING_STEPS.indexOf(step) + 1

/** A glyph name from the agent-icon catalog and a colour. */
export interface OnboardingIconPick {
    icon: string
    color: string
}

/** The agent the creator edits and Create commits. */
export interface OnboardingAgent {
    name: string
    icon: OnboardingIconPick
    instructions: string
    /** Tool integration keys the user chose; only connected ones join the agent. */
    apps: string[]
    firstMessage: string
}

export interface OnboardingDraft {
    step: OnboardingStep
    role: OnboardingRole | null
    source: OnboardingSource | null
    category: GalleryCategory
    /** The focused gallery template; `null` focuses the first one listed. */
    focus: string | null
    /** The template the creator was filled from, if any. */
    templateKey: string | null
    agent: OnboardingAgent
}

export const ONBOARDING_NAME_MAX = 100
export const ONBOARDING_TEXT_MAX = 10000

export const BLANK_AGENT: OnboardingAgent = {
    name: "",
    icon: {icon: DEFAULT_AGENT_ICON.icon, color: DEFAULT_AGENT_ICON.color},
    instructions: "",
    apps: [],
    firstMessage: "",
}

export const EMPTY_ONBOARDING_DRAFT: OnboardingDraft = {
    step: "role",
    role: null,
    source: null,
    category: RECOMMENDED,
    focus: null,
    templateKey: null,
    agent: BLANK_AGENT,
}

export const agentFromTemplate = (template: AgentStarterTemplate): OnboardingAgent => ({
    name: template.name,
    icon: {icon: templateGlyph(template), color: template.color},
    instructions: template.instructions,
    apps: [],
    firstMessage: templateBuilderMessage(template),
})

export type OnboardingAction =
    | {type: "step"; step: OnboardingStep}
    | {type: "role"; role: OnboardingRole}
    | {type: "source"; source: OnboardingSource}
    | {type: "category"; category: GalleryCategory}
    | {type: "focus"; key: string}
    | {type: "template"; template: AgentStarterTemplate}
    | {type: "scratch"}
    | {type: "agent"; patch: Partial<Omit<OnboardingAgent, "apps">>}
    | {type: "app"; key: string; on: boolean}

export const onboardingReducer = (
    draft: OnboardingDraft,
    action: OnboardingAction,
): OnboardingDraft => {
    switch (action.type) {
        case "step":
            return {...draft, step: action.step}
        case "role":
            // The gallery's Recommended slice follows the role, so its focus resets with it.
            return action.role === draft.role
                ? draft
                : {...draft, role: action.role, category: RECOMMENDED, focus: null}
        case "source":
            return {...draft, source: action.source}
        case "category":
            return {...draft, category: action.category, focus: null}
        case "focus":
            return {...draft, focus: action.key}
        case "template":
            return {
                ...draft,
                templateKey: action.template.key,
                agent: agentFromTemplate(action.template),
            }
        case "scratch":
            return {...draft, templateKey: null, agent: BLANK_AGENT}
        case "agent": {
            const agent = {...draft.agent, ...action.patch}
            return {
                ...draft,
                agent: {
                    ...agent,
                    name: agent.name.slice(0, ONBOARDING_NAME_MAX),
                    instructions: agent.instructions.slice(0, ONBOARDING_TEXT_MAX),
                    firstMessage: agent.firstMessage.slice(0, ONBOARDING_TEXT_MAX),
                },
            }
        }
        case "app": {
            const others = draft.agent.apps.filter((key) => key !== action.key)
            return {
                ...draft,
                agent: {...draft.agent, apps: action.on ? [...others, action.key] : others},
            }
        }
    }
}

export const FIRST_AGENT_FALLBACK_NAME = "My first agent"

export interface FirstAgentInput {
    name: string
    instructions: string
    firstMessage: string
}

/** What Create commits; it needs instructions or a first message to have anything to do. */
export const firstAgentInput = ({
    name,
    instructions,
    firstMessage,
}: OnboardingAgent): FirstAgentInput | null => {
    const input = {
        name: name.trim() || FIRST_AGENT_FALLBACK_NAME,
        instructions: instructions.trim(),
        firstMessage: firstMessage.trim(),
    }
    return input.instructions || input.firstMessage ? input : null
}

export const onboardingDraftKey = (projectId: string) => `agenta:onboarding:draft:v2:${projectId}`

const stepIndex = (step: OnboardingStep) => ONBOARDING_STEPS.indexOf(step)

const iconSchema = z.object({icon: z.string().min(1), color: z.string().min(1)})

const draftSchema = z
    .object({
        step: z.enum(ONBOARDING_STEPS),
        role: z.enum(ONBOARDING_ROLES.map((role) => role.label)).nullable(),
        source: z.enum(ONBOARDING_SOURCES.map((source) => source.label)).nullable(),
        category: z.string().min(1),
        focus: z.string().min(1).nullable(),
        templateKey: z.string().min(1).nullable(),
        agent: z.object({
            name: z.string().max(ONBOARDING_NAME_MAX),
            icon: iconSchema,
            instructions: z.string().max(ONBOARDING_TEXT_MAX),
            apps: z.array(z.string().min(1)),
            firstMessage: z.string().max(ONBOARDING_TEXT_MAX),
        }),
    })
    // A draft past a question must carry its answer, or the flow resumes past an empty one.
    .refine(
        (draft) =>
            (draft.role !== null || draft.step === "role") &&
            (draft.source !== null || stepIndex(draft.step) <= stepIndex("referral")),
    )

/** The saved draft, or a fresh one when there is none or it no longer parses. */
export const readOnboardingDraft = (key: string): OnboardingDraft => {
    try {
        const raw = window.sessionStorage.getItem(key)
        if (!raw) return EMPTY_ONBOARDING_DRAFT
        const parsed = draftSchema.safeParse(JSON.parse(raw))
        return parsed.success ? (parsed.data as OnboardingDraft) : EMPTY_ONBOARDING_DRAFT
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
