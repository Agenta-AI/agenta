import type {AgentStarterTemplate} from "@agenta/entities/workflow"
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

/** The four progress dots: each is the step it jumps back to, and the gallery covers the creator. */
export const PROGRESS_STEPS = ["role", "referral", "credits", "gallery"] as const
export const PROGRESS: Record<OnboardingStep, number> = {
    role: 0,
    referral: 1,
    credits: 2,
    gallery: 3,
    creator: 3,
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

/** The gallery's right panel: a blank start, one template, or (`null`) the first template listed. */
export type GalleryFocus = {kind: "scratch"} | {kind: "template"; key: string} | null

export interface OnboardingDraft {
    step: OnboardingStep
    role: OnboardingRole | null
    source: OnboardingSource | null
    category: GalleryCategory
    focus: GalleryFocus
    /** The template the creator was filled from; `null` while the blank start is edited. */
    templateKey: string | null
    agent: OnboardingAgent
    /** Where credits' Continue leads after a detour from a later step; `null` is the gallery. */
    returnTo: OnboardingStep | null
    /** Steps already reported as completed, so each is reported once. */
    completed: OnboardingStep[]
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
    returnTo: null,
    completed: [],
}

/** A template's agent: its name and instructions come from the template and are not edited. */
export const agentFromTemplate = (
    template: AgentStarterTemplate,
    apps: readonly string[],
): OnboardingAgent => ({
    name: template.name,
    icon: {icon: templateGlyph(template), color: template.color},
    instructions: "",
    apps: [...apps],
    firstMessage: "",
})

export type OnboardingAction =
    | {type: "step"; step: OnboardingStep}
    | {type: "role"; role: OnboardingRole}
    | {type: "source"; source: OnboardingSource}
    | {type: "category"; category: GalleryCategory}
    | {type: "focus"; focus: GalleryFocus}
    /** `apps`: the template's apps that are already connected. */
    | {type: "template"; template: AgentStarterTemplate; apps: readonly string[]}
    | {type: "agent"; patch: Partial<Omit<OnboardingAgent, "apps">>}
    | {type: "app"; key: string; on: boolean}
    | {type: "returnTo"; step: OnboardingStep | null}
    | {type: "completed"; step: OnboardingStep}

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
            // The blank start edits the same agent a template filled, so it starts it over.
            return action.focus?.kind === "scratch" && draft.templateKey !== null
                ? {...draft, focus: action.focus, templateKey: null, agent: BLANK_AGENT}
                : {...draft, focus: action.focus}
        case "template":
            // Coming back to the same template keeps what the user already changed.
            return action.template.key === draft.templateKey
                ? draft
                : {
                      ...draft,
                      templateKey: action.template.key,
                      agent: agentFromTemplate(action.template, action.apps),
                  }
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
        case "returnTo":
            return {...draft, returnTo: action.step}
        case "completed":
            return draft.completed.includes(action.step)
                ? draft
                : {...draft, completed: [...draft.completed, action.step]}
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
    /** The template whose package Create loads; `null` for a blank start. */
    templateKey: string | null
}

/**
 * What Create commits. A template creates from its own package, so it needs only to have loaded;
 * a blank start needs instructions or a first message to have anything to do.
 */
export const firstAgentInput = (
    {templateKey, agent}: Pick<OnboardingDraft, "templateKey" | "agent">,
    template: AgentStarterTemplate | null,
): FirstAgentInput | null => {
    const firstMessage = agent.firstMessage.trim()
    if (templateKey) {
        return template?.key === templateKey
            ? {name: template.name, instructions: "", firstMessage, templateKey}
            : null
    }
    const input = {
        name: agent.name.trim() || FIRST_AGENT_FALLBACK_NAME,
        instructions: agent.instructions.trim(),
        firstMessage,
        templateKey: null,
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
        focus: z
            .union([
                z.object({kind: z.literal("scratch")}),
                z.object({kind: z.literal("template"), key: z.string().min(1)}),
            ])
            .nullable(),
        templateKey: z.string().min(1).nullable(),
        agent: z.object({
            name: z.string().max(ONBOARDING_NAME_MAX),
            icon: iconSchema,
            instructions: z.string().max(ONBOARDING_TEXT_MAX),
            apps: z.array(z.string().min(1)),
            firstMessage: z.string().max(ONBOARDING_TEXT_MAX),
        }),
        returnTo: z.enum(ONBOARDING_STEPS).nullable(),
        completed: z.array(z.enum(ONBOARDING_STEPS)),
    })
    // A draft past a question must carry its answer, or the flow resumes past an empty one.
    .refine(
        (draft) =>
            (draft.role !== null || draft.step === "role") &&
            (draft.source !== null || stepIndex(draft.step) <= stepIndex("referral")) &&
            // The creator page is only for a template; a blank start is edited in the gallery.
            (draft.step !== "creator" || draft.templateKey !== null),
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
