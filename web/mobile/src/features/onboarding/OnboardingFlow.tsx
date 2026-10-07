import {useEffect, useReducer, useRef, useState, type ReactNode} from "react"

import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {AnimatePresence, motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {
    ONBOARDING_ROLES,
    ONBOARDING_SOURCES,
    type OnboardingCatalog,
} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {OnboardingCreator} from "./OnboardingCreator"
import {OnboardingCreditsStep} from "./OnboardingCreditsStep"
import {
    firstAgentInput,
    ONBOARDING_STEPS,
    onboardingHeadingId,
    onboardingReducer,
    PREVIOUS,
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
    toolsEnabled: boolean
    creating: boolean
    error?: string | null
    onStepCompleted: (step: OnboardingStep, draft: OnboardingDraft) => void
    onCreate: (input: OnboardingCreateInput) => void
}

const WIDTH: Record<OnboardingStep, string> = {
    role: "max-w-[680px] lg:pt-[10vh]",
    referral: "max-w-[680px] lg:pt-[10vh]",
    credits: "max-w-[640px]",
    gallery: "max-w-[1040px]",
    creator: "max-w-[1040px]",
}

/** The four-step first-agent flow; it owns the answers, the host owns data and side effects. */
export const OnboardingFlow = ({
    draftKey,
    catalog,
    model,
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
    const scrollerRef = useRef<HTMLElement | null>(null)
    const movedRef = useRef(false)
    const {step} = draft
    useEffect(() => {
        if (!movedRef.current) return
        scrollerRef.current
            ?.querySelector<HTMLElement>(`#${onboardingHeadingId(step)}`)
            ?.focus({preventScroll: true})
    }, [step])

    const go = (next: OnboardingStep) => {
        const current = draftRef.current
        const forward = ONBOARDING_STEPS.indexOf(next) > ONBOARDING_STEPS.indexOf(current.step)
        if (forward) onStepCompleted(current.step, current)
        setDirection(forward ? 1 : -1)
        movedRef.current = true
        dispatch({type: "step", step: next})
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    }
    const previous = PREVIOUS[step]

    const template =
        catalog.templates.find((item) => item.key === draft.templateKey) ?? null
    const input = firstAgentInput(draft.agent)
    const onUse = (picked: AgentStarterTemplate) => {
        dispatch({type: "template", template: picked})
        go("creator")
    }

    const body: Record<OnboardingStep, () => ReactNode> = {
        role: () => (
            <OnboardingQuestion
                headingId={onboardingHeadingId("role")}
                title={ONBOARDING_COPY.role.title}
                subtitle={ONBOARDING_COPY.role.subtitle}
                choices={ONBOARDING_ROLES}
                value={draft.role}
                onAnswer={(role) => dispatch({type: "role", role})}
                onAdvance={() => go("referral")}
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
                onAdvance={() => go("credits")}
            />
        ),
        credits: () => <OnboardingCreditsStep model={model} onContinue={() => go("gallery")} />,
        gallery: () => (
            <OnboardingGallery
                catalog={catalog}
                role={draft.role}
                category={draft.category}
                focus={draft.focus}
                onCategory={(category) => dispatch({type: "category", category})}
                onFocus={(key) => dispatch({type: "focus", key})}
                onUse={onUse}
                onScratch={() => {
                    dispatch({type: "scratch"})
                    go("creator")
                }}
            />
        ),
        creator: () => (
            <OnboardingCreator
                agent={draft.agent}
                templateName={template?.name ?? null}
                suggestedApps={template ? templateProviderSlugs(template) : []}
                toolsEnabled={toolsEnabled}
                onChange={(patch) => dispatch({type: "agent", patch})}
                onApp={(key, on) => dispatch({type: "app", key, on})}
                create={{
                    modelReady: model.ready,
                    complete: input !== null,
                    creating,
                    error,
                    onChooseModel: () => go("credits"),
                    onCreate: () => {
                        if (!input) return
                        onCreate({...input, icon: draft.agent.icon, apps: draft.agent.apps})
                    },
                }}
            />
        ),
    }

    return (
        <main
            ref={scrollerRef}
            className="bg-background text-foreground flex h-dvh flex-col overflow-y-auto"
        >
            <OnboardingHeader
                position={PROGRESS[step]}
                onBack={previous && !creating ? () => go(previous) : null}
            />
            <div className="relative flex-1 overflow-x-hidden px-4 lg:px-6">
                <AnimatePresence mode="popLayout" custom={direction} initial={false}>
                    <motion.section
                        key={step}
                        custom={direction}
                        variants={presets.sharedAxisPush}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className={cn("mx-auto w-full pb-16 pt-6 lg:pt-10", WIDTH[step])}
                    >
                        {body[step]()}
                    </motion.section>
                </AnimatePresence>
            </div>
        </main>
    )
}
