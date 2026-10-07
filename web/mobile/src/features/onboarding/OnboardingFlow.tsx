import {useEffect, useReducer, useRef, useState, type ReactNode} from "react"

import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import type {ConnectedApps} from "./onboardingApps"
import {ONBOARDING_ROLES, ONBOARDING_SOURCES, type OnboardingCatalog} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import {OnboardingCreator} from "./OnboardingCreator"
import {OnboardingCreditsStep} from "./OnboardingCreditsStep"
import {
    firstAgentInput,
    ONBOARDING_STEPS,
    onboardingHeadingId,
    onboardingReducer,
    PROGRESS,
    readOnboardingDraft,
    saveOnboardingDraft,
    type FirstAgentInput,
    type OnboardingDraft,
    type OnboardingIconPick,
    type OnboardingStep,
} from "./onboardingDraft"
import {OnboardingGallery} from "./OnboardingGallery"
import {OnboardingHeader} from "./OnboardingHeader"
import {OnboardingProgressDots} from "./OnboardingProgressDots"
import {OnboardingQuestion} from "./OnboardingQuestion"
import type {OnboardingModel} from "./useOnboardingModel"

export interface OnboardingCreateInput extends FirstAgentInput {
    icon: OnboardingIconPick
    apps: string[]
}

export interface OnboardingFlowProps {
    /** sessionStorage key; answers survive a reload or an auth redirect. */
    draftKey: string
    catalog: OnboardingCatalog
    model: OnboardingModel
    connectedApps: ConnectedApps
    toolsEnabled: boolean
    creating: boolean
    error?: string | null
    onStepCompleted: (step: OnboardingStep, draft: OnboardingDraft) => void
    onCreate: (input: OnboardingCreateInput) => void
}

/** Each step's column width, as the design sets it. */
const WIDTH: Record<OnboardingStep, string> = {
    role: "max-w-[680px]",
    referral: "max-w-[680px]",
    credits: "max-w-[880px]",
    gallery: "max-w-[1040px] max-md:self-start",
    creator: "max-w-[1040px] max-md:self-start",
}

/** Which progress dots open from here: any answered step, and the gallery from its own creator. */
const reachable = (draft: OnboardingDraft, target: OnboardingStep) => {
    if (PROGRESS[target] === PROGRESS[draft.step]) return draft.step === "creator"
    if (target === "role") return true
    if (target === "referral") return draft.role !== null
    return draft.source !== null
}

/** The four-step first-agent flow; it owns the answers, the host owns data and side effects. */
export const OnboardingFlow = ({
    draftKey,
    catalog,
    model,
    connectedApps,
    toolsEnabled,
    creating,
    error,
    onStepCompleted,
    onCreate,
}: OnboardingFlowProps) => {
    const [draft, dispatch] = useReducer(onboardingReducer, draftKey, readOnboardingDraft)
    useEffect(() => saveOnboardingDraft(draftKey, draft), [draftKey, draft])
    // A question advances on a timer armed before its answer re-rendered; read the latest.
    const draftRef = useRef(draft)
    draftRef.current = draft

    const presets = useMotionPresets()
    const [direction, setDirection] = useState(1)
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    const movedRef = useRef(false)
    const {step} = draft
    useEffect(() => {
        if (!movedRef.current) return
        scrollerRef.current
            ?.querySelector<HTMLElement>(`#${onboardingHeadingId(step)}`)
            ?.focus({preventScroll: true})
    }, [step])

    // Mirrors `draft.completed` synchronously, so a double click reports a step once.
    const completedRef = useRef(new Set(draft.completed))
    const go = (next: OnboardingStep) => {
        const current = draftRef.current
        if (next === current.step) return
        const forward = ONBOARDING_STEPS.indexOf(next) > ONBOARDING_STEPS.indexOf(current.step)
        if (forward && !completedRef.current.has(current.step)) {
            completedRef.current.add(current.step)
            dispatch({type: "completed", step: current.step})
            onStepCompleted(current.step, current)
        }
        setDirection(forward ? 1 : -1)
        movedRef.current = true
        dispatch({type: "step", step: next})
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    }
    /** A question's timer or key moves the flow only while its own step is current. */
    const advance = (from: OnboardingStep, to: OnboardingStep) => {
        if (draftRef.current.step === from) go(to)
    }

    const template = catalog.templates.find((item) => item.key === draft.templateKey) ?? null
    const input = firstAgentInput(draft, template)
    const onUse = (picked: AgentStarterTemplate) => {
        const apps = templateProviderSlugs(picked).filter((key) => connectedApps.has(key))
        dispatch({type: "template", template: picked, apps})
        go("creator")
    }
    const create: OnboardingCreateState = {
        modelReady: model.ready,
        complete: input !== null,
        creating,
        error,
        onChooseModel: () => {
            dispatch({type: "returnTo", step: draftRef.current.step})
            go("credits")
        },
        onCreate: () => {
            if (!input) return
            onCreate({...input, icon: draft.agent.icon, apps: draft.agent.apps})
        },
    }
    const onAgent = (patch: Partial<Omit<OnboardingDraft["agent"], "apps">>) =>
        dispatch({type: "agent", patch})

    const body: Record<OnboardingStep, () => ReactNode> = {
        role: () => (
            <OnboardingQuestion
                headingId={onboardingHeadingId("role")}
                title={ONBOARDING_COPY.role.title}
                subtitle={ONBOARDING_COPY.role.subtitle}
                choices={ONBOARDING_ROLES}
                value={draft.role}
                onAnswer={(role) => dispatch({type: "role", role})}
                onAdvance={() => advance("role", "referral")}
            />
        ),
        referral: () => (
            <OnboardingQuestion
                headingId={onboardingHeadingId("referral")}
                title={ONBOARDING_COPY.referral.title}
                subtitle={ONBOARDING_COPY.referral.subtitle}
                choices={ONBOARDING_SOURCES}
                value={draft.source}
                onAnswer={(source) => dispatch({type: "source", source})}
                onAdvance={() => advance("referral", "credits")}
            />
        ),
        credits: () => (
            <OnboardingCreditsStep
                model={model}
                onContinue={() => {
                    const next = draftRef.current.returnTo ?? "gallery"
                    dispatch({type: "returnTo", step: null})
                    go(next)
                }}
            />
        ),
        gallery: () => (
            <OnboardingGallery
                catalog={catalog}
                role={draft.role}
                category={draft.category}
                focus={draft.focus}
                agent={draft.agent}
                create={create}
                onCategory={(category) => dispatch({type: "category", category})}
                onFocus={(focus) => dispatch({type: "focus", focus})}
                onUse={onUse}
                onChange={onAgent}
            />
        ),
        creator: () => (
            <OnboardingCreator
                agent={draft.agent}
                template={template}
                suggestedApps={template ? templateProviderSlugs(template) : []}
                connectedApps={connectedApps}
                toolsEnabled={toolsEnabled}
                onChange={onAgent}
                onApp={(key, on) => dispatch({type: "app", key, on})}
                create={create}
            />
        ),
    }

    return (
        <div
            ref={scrollerRef}
            data-onboarding-scroller
            className="bg-background text-foreground flex h-dvh flex-col overflow-y-auto overflow-x-hidden"
        >
            <OnboardingHeader />
            <main className="box-border flex min-w-0 flex-1 items-center justify-center px-4 pb-6 pt-6 sm:px-6 md:pb-24">
                <motion.section
                    key={step}
                    custom={direction}
                    variants={presets.stepSlide}
                    initial="initial"
                    animate="animate"
                    // `min-w-0`: a flex item's floor is otherwise its widest row, which pushed the
                    // gallery's scrolling icon row past a phone's edge.
                    className={cn("w-full min-w-0", WIDTH[step])}
                >
                    {body[step]()}
                </motion.section>
            </main>
            <OnboardingProgressDots
                current={PROGRESS[step]}
                reached={(target) => !creating && reachable(draft, target)}
                onGo={go}
            />
        </div>
    )
}
