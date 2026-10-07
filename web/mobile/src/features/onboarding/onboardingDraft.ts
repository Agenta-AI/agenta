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
import {ONBOARDING_STEPS, type OnboardingStep} from "./onboardingRoute"

/** A glyph name from the agent-icon catalog and a colour. */
export interface OnboardingIconPick {
    icon: string
    color: string
}

/** The agent the creator edits and Create commits. */
export interface OnboardingAgent {
    name: string
    icon: OnboardingIconPick
    /** Tool integration keys the user chose; only connected ones join the agent. */
    apps: string[]
    firstMessage: string
}

/** What the user chose and typed; where they are lives in the URL. */
export interface OnboardingDraft {
    role: OnboardingRole | null
    source: OnboardingSource | null
    category: GalleryCategory
    /** The template the review step was filled from; `null` while the blank start is edited. */
    templateKey: string | null
    agent: OnboardingAgent
    /** Steps already reported as completed, so each is reported once. */
    completed: OnboardingStep[]
}

export const ONBOARDING_NAME_MAX = 100
export const ONBOARDING_TEXT_MAX = 10000

export const BLANK_AGENT: OnboardingAgent = {
    name: "",
    icon: {icon: DEFAULT_AGENT_ICON.icon, color: DEFAULT_AGENT_ICON.color},
    apps: [],
    firstMessage: "",
}

export const EMPTY_ONBOARDING_DRAFT: OnboardingDraft = {
    role: null,
    source: null,
    category: RECOMMENDED,
    templateKey: null,
    agent: BLANK_AGENT,
    completed: [],
}

/** A template's agent: its name and instructions come from the template and are not edited. */
export const agentFromTemplate = (
    template: AgentStarterTemplate,
    apps: readonly string[],
): OnboardingAgent => ({
    name: template.name,
    icon: {icon: templateGlyph(template), color: template.color},
    apps: [...apps],
    firstMessage: "",
})

export type OnboardingAction =
    | {type: "role"; role: OnboardingRole}
    | {type: "source"; source: OnboardingSource}
    | {type: "category"; category: GalleryCategory}
    /** The blank start was opened; it edits the agent a template may have filled. */
    | {type: "scratch"}
    /** `apps`: the template's apps that are already connected. */
    | {type: "template"; template: AgentStarterTemplate; apps: readonly string[]}
    | {type: "agent"; patch: Partial<Omit<OnboardingAgent, "apps">>}
    | {type: "app"; key: string; on: boolean}
    | {type: "completed"; step: OnboardingStep}

export const onboardingReducer = (
    draft: OnboardingDraft,
    action: OnboardingAction,
): OnboardingDraft => {
    switch (action.type) {
        case "role":
            // The gallery's Recommended slice follows the role.
            return action.role === draft.role
                ? draft
                : {...draft, role: action.role, category: RECOMMENDED}
        case "source":
            return {...draft, source: action.source}
        case "category":
            return {...draft, category: action.category}
        case "scratch":
            return draft.templateKey === null
                ? draft
                : {...draft, templateKey: null, agent: BLANK_AGENT}
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
                    firstMessage: agent.firstMessage.slice(0, ONBOARDING_TEXT_MAX),
                },
            }
        }
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
    firstMessage: string
    /** The template whose package Create loads; `null` for a blank start. */
    templateKey: string | null
}

/** What Create commits: a loaded template, or a blank start with a first message. */
export const firstAgentInput = (
    {templateKey, agent}: Pick<OnboardingDraft, "templateKey" | "agent">,
    template: AgentStarterTemplate | null,
): FirstAgentInput | null => {
    const firstMessage = agent.firstMessage.trim()
    if (templateKey) {
        return template?.key === templateKey
            ? {name: template.name, firstMessage, templateKey}
            : null
    }
    if (!firstMessage) return null
    return {name: agent.name.trim() || FIRST_AGENT_FALLBACK_NAME, firstMessage, templateKey: null}
}

/** Per user: a preview on any project resumes the same answers. */
export const onboardingDraftKey = (userId: string) => `agenta:onboarding:draft:v3:${userId}`

const iconSchema = z.object({icon: z.string().min(1), color: z.string().min(1)})

const draftSchema = z.object({
    role: z.enum(ONBOARDING_ROLES.map((role) => role.label)).nullable(),
    source: z.enum(ONBOARDING_SOURCES.map((source) => source.label)).nullable(),
    category: z.string().min(1),
    templateKey: z.string().min(1).nullable(),
    agent: z.object({
        name: z.string().max(ONBOARDING_NAME_MAX),
        icon: iconSchema,
        apps: z.array(z.string().min(1)),
        firstMessage: z.string().max(ONBOARDING_TEXT_MAX),
    }),
    completed: z.array(z.enum(ONBOARDING_STEPS)),
})

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
