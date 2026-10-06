import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {AGENT_ICON_COLORS, DEFAULT_AGENT_ICON} from "@agenta/ui/agent-icon"
import {z} from "zod"

import {
    ONBOARDING_ROLES,
    ONBOARDING_SOURCES,
    type OnboardingRole,
    type OnboardingSource,
    type OnboardingVariant,
} from "./onboardingChoices"

/** Canonical order; analytics numbers steps by it even when one is skipped. */
export const ONBOARDING_STEPS = ["role", "tools", "model", "referral", "agent"] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/** Each step's heading id: focus lands on it, and its choices are labelled by it. */
export const onboardingHeadingId = (step: OnboardingStep) => `onboarding-heading-${step}`

export const onboardingStepNumber = (step: OnboardingStep) => ONBOARDING_STEPS.indexOf(step) + 1

/** The tools step needs the tool gateway; without it there is nothing to connect. */
export const activeOnboardingSteps = (toolsEnabled: boolean): readonly OnboardingStep[] =>
    toolsEnabled ? ONBOARDING_STEPS : ONBOARDING_STEPS.filter((step) => step !== "tools")

export type TemplatePick = {kind: "template"; key: string} | {kind: "custom"} | null

/** A glyph name from the agent-icon catalog and a palette colour. */
export interface OnboardingIconPick {
    icon: string
    color: string
}

export interface OnboardingDraft {
    step: OnboardingStep
    role: OnboardingRole | null
    source: OnboardingSource | null
    name: string
    task: string
    pick: TemplatePick
    icon: OnboardingIconPick | null
}

export const EMPTY_ONBOARDING_DRAFT: OnboardingDraft = {
    step: "role",
    role: null,
    source: null,
    name: "",
    task: "",
    pick: null,
    icon: null,
}

export const ONBOARDING_NAME_MAX = 100
export const ONBOARDING_TASK_MAX = 10000

/** What name-first shows before a pick, and saves when nothing else was chosen. */
export const DEFAULT_IDENTITY: OnboardingIconPick = {
    icon: DEFAULT_AGENT_ICON.icon,
    color: DEFAULT_AGENT_ICON.color,
}

/** One glyph per suggestion slot, so each picked template brings its own identity. */
const TEMPLATE_GLYPHS = [
    "git-pull-request",
    "bug",
    "lightning",
    "chat-circle-dots",
    "chart-line-up",
]

export const templateIcon = (index: number): OnboardingIconPick => ({
    icon: TEMPLATE_GLYPHS[index % TEMPLATE_GLYPHS.length],
    color: AGENT_ICON_COLORS[(index + 1) % AGENT_ICON_COLORS.length][0],
})

export type OnboardingAction =
    | {type: "step"; step: OnboardingStep}
    | {type: "role"; role: OnboardingRole}
    | {type: "source"; source: OnboardingSource}
    | {type: "name"; name: string}
    | {type: "task"; task: string}
    | {
          type: "template"
          template: AgentStarterTemplate
          index: number
          variant: OnboardingVariant
      }
    | {type: "custom"}
    | {type: "icon"; icon: OnboardingIconPick}

export const onboardingReducer = (
    draft: OnboardingDraft,
    action: OnboardingAction,
): OnboardingDraft => {
    switch (action.type) {
        case "step":
            return {...draft, step: action.step}
        case "role":
            if (action.role === draft.role) return draft
            // Suggestions follow the role, so a new role drops the pick made from the old list.
            return {...draft, role: action.role, pick: null, task: "", name: "", icon: null}
        case "source":
            return {...draft, source: action.source}
        case "name":
            return {...draft, name: action.name.slice(0, ONBOARDING_NAME_MAX)}
        case "task":
            return {...draft, task: action.task.slice(0, ONBOARDING_TASK_MAX)}
        case "template":
            return {
                ...draft,
                pick: {kind: "template", key: action.template.key},
                task: "",
                name: action.variant === "control" ? action.template.name : draft.name,
                icon: templateIcon(action.index),
            }
        case "custom":
            return {...draft, pick: {kind: "custom"}, task: ""}
        case "icon":
            return {...draft, icon: action.icon}
    }
}

const STEP_COMPLETE: Record<
    OnboardingStep,
    (draft: OnboardingDraft, context: {modelReady: boolean}) => boolean
> = {
    role: (draft) => draft.role !== null,
    tools: () => true,
    model: (_, {modelReady}) => modelReady,
    referral: (draft) => draft.source !== null,
    agent: () => false,
}

export const canLeaveStep = (draft: OnboardingDraft, context: {modelReady: boolean}) =>
    STEP_COMPLETE[draft.step](draft, context)

export const stepAfter = (steps: readonly OnboardingStep[], step: OnboardingStep) =>
    steps[steps.indexOf(step) + 1] ?? null

export const stepBefore = (steps: readonly OnboardingStep[], step: OnboardingStep) =>
    steps[steps.indexOf(step) - 1] ?? null

export const onboardingDraftKey = (projectId: string) => `agenta:onboarding:draft:v1:${projectId}`

const stepIndex = (step: OnboardingStep) => ONBOARDING_STEPS.indexOf(step)

const draftSchema = z
    .object({
        step: z.enum(ONBOARDING_STEPS),
        role: z.enum(ONBOARDING_ROLES.map((role) => role.label)).nullable(),
        source: z.enum(ONBOARDING_SOURCES.map((source) => source.label)).nullable(),
        name: z.string().max(ONBOARDING_NAME_MAX),
        task: z.string().max(ONBOARDING_TASK_MAX),
        pick: z.union([
            z.object({kind: z.literal("template"), key: z.string().min(1)}),
            z.object({kind: z.literal("custom")}),
            z.null(),
        ]),
        icon: z.object({icon: z.string().min(1), color: z.string().min(1)}).nullable(),
    })
    // A draft past a question must carry its answer, or the flow resumes on a dead Next.
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
