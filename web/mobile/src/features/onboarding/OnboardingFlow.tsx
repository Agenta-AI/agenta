import {useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode} from "react"

import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {motion} from "motion/react"

import type {ConnectedApps} from "./onboardingApps"
import {ONBOARDING_ROLES, ONBOARDING_SOURCES, type OnboardingCatalog} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import {OnboardingCreator} from "./OnboardingCreator"
import {OnboardingCreditsStep} from "./OnboardingCreditsStep"
import {
    firstAgentInput,
    onboardingReducer,
    readOnboardingDraft,
    saveOnboardingDraft,
    type FirstAgentInput,
    type OnboardingDraft,
    type OnboardingIconPick,
} from "./onboardingDraft"
import {OnboardingGallery} from "./OnboardingGallery"
import {OnboardingHeader} from "./OnboardingHeader"
import {OnboardingProgressDots} from "./OnboardingProgressDots"
import {OnboardingQuestion} from "./OnboardingQuestion"
import {
    guardOnboardingRoute,
    isStepOpen,
    nextStep,
    onboardingHeadingId,
    onboardingRoutePath,
    progressIndex,
    progressSteps,
    stepIndex,
    stepRoute,
    type GalleryFocus,
    type OnboardingRoute,
    type OnboardingStep,
    type OnboardingSteps,
} from "./onboardingRoute"
import type {OnboardingModel} from "./useOnboardingModel"
import {useOnboardingNav} from "./useOnboardingNav"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

export interface OnboardingCreateInput extends FirstAgentInput {
    icon: OnboardingIconPick
    apps: string[]
}

export interface OnboardingFlowProps {
    /** The page's own path, `/w/<workspace>/p/<project>/onboarding`; steps hang off it. */
    onboardingPath: string
    /** sessionStorage key; answers survive a reload or an auth redirect. */
    draftKey: string
    /** The steps to show, in order. */
    steps: OnboardingSteps
    catalog: OnboardingCatalog
    model: OnboardingModel
    connectedApps: ConnectedApps
    toolsEnabled: boolean
    creating: boolean
    error?: string | null
    onStepCompleted: (step: OnboardingStep, draft: OnboardingDraft) => void
    onCreate: (input: OnboardingCreateInput) => void
    onSkip: (step: OnboardingStep) => void
}

/** Each step's column width, as the design sets it. */
const WIDTH: Record<OnboardingStep, string> = {
    role: "max-w-[680px]",
    source: "max-w-[680px]",
    credits: "max-w-[880px]",
    templates: "max-w-[1040px] max-md:self-start",
    review: "max-w-[1040px] max-md:self-start",
}

/** Which progress dots open from here: any answered step, and the templates from review. */
const reachable = (
    draft: OnboardingDraft,
    steps: OnboardingSteps,
    current: OnboardingStep,
    target: OnboardingStep,
) =>
    progressIndex(target, steps) === progressIndex(current, steps)
        ? current === "review"
        : isStepOpen(target, draft, steps)

const TEMPLATES: OnboardingRoute = {step: "templates", focus: null}

/** The four-step first-agent flow; it owns the answers, the URL owns the step. */
export const OnboardingFlow = ({
    onboardingPath,
    draftKey,
    steps,
    catalog,
    model,
    connectedApps,
    toolsEnabled,
    creating,
    error,
    onStepCompleted,
    onCreate,
    onSkip,
}: OnboardingFlowProps) => {
    const [draft, dispatch] = useReducer(onboardingReducer, draftKey, readOnboardingDraft)
    useEffect(() => saveOnboardingDraft(draftKey, draft), [draftKey, draft])
    // A question advances on a timer armed before its answer re-rendered; read the latest.
    const draftRef = useRef(draft)
    draftRef.current = draft

    const nav = useOnboardingNav(onboardingPath)
    const {navigate} = nav
    const route = guardOnboardingRoute(nav.requested, draft, steps)
    const routeRef = useRef(route)
    routeRef.current = route
    const {step} = route
    const focus: GalleryFocus = route.step === "templates" ? route.focus : null

    // A link to a step the answers do not open yet lands on the furthest one they do.
    const canonical = onboardingRoutePath(route)
    const redirect =
        nav.ready && (!nav.requested || onboardingRoutePath(nav.requested) !== canonical)
    useEffect(() => {
        if (redirect) navigate(routeRef.current, {replace: true})
    }, [redirect, canonical, navigate])

    // The blank start edits the agent a template filled, so opening it starts that agent over.
    const scratchOverTemplate = focus?.kind === "scratch" && draft.templateKey !== null
    useLayoutEffect(() => {
        if (scratchOverTemplate) dispatch({type: "scratch"})
    }, [scratchOverTemplate])

    const presets = useMotionPresets()
    const [shown, setShown] = useState({step, direction: 1, moved: false})
    if (shown.step !== step) {
        setShown({step, direction: stepIndex(step) > stepIndex(shown.step) ? 1 : -1, moved: true})
    }
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    useLayoutEffect(() => {
        if (!shown.moved) return
        const scroller = scrollerRef.current
        if (!scroller) return
        scroller.scrollTop = 0
        scroller
            .querySelector<HTMLElement>(`#${onboardingHeadingId(shown.step)}`)
            ?.focus({preventScroll: true})
    }, [shown])

    // Mirrors `draft.completed` synchronously, so a double click reports a step once.
    const completedRef = useRef(new Set(draft.completed))
    const go = (
        next: OnboardingRoute,
        options?: {replace?: boolean; returnTo?: OnboardingRoute},
    ) => {
        const current = routeRef.current.step
        if (stepIndex(next.step) > stepIndex(current) && !completedRef.current.has(current)) {
            completedRef.current.add(current)
            dispatch({type: "completed", step: current})
            onStepCompleted(current, draftRef.current)
        }
        navigate(next, options)
    }
    /** A question's timer or key moves the flow only while its own step is current. */
    const advance = (from: OnboardingStep, to: OnboardingStep) => {
        if (routeRef.current.step === from) go(stepRoute(to))
    }

    // Set when a phone opens a panel over the list, so its Back control pops that entry.
    const detailPushedRef = useRef(false)
    const template = catalog.templates.find((item) => item.key === draft.templateKey) ?? null
    const input = firstAgentInput(draft, template)
    const onUse = (picked: AgentStarterTemplate) => {
        const apps = templateProviderSlugs(picked).filter((key) => connectedApps.has(key))
        dispatch({type: "template", template: picked, apps})
        go({step: "review"})
    }
    const create: OnboardingCreateState = {
        modelReady: model.ready,
        complete: input !== null,
        creating,
        error,
        onChooseModel: () => go({step: "credits"}, {returnTo: routeRef.current}),
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
                onAdvance={() => advance("role", nextStep("role", steps))}
            />
        ),
        source: () => (
            <OnboardingQuestion
                headingId={onboardingHeadingId("source")}
                title={ONBOARDING_COPY.source.title}
                subtitle={ONBOARDING_COPY.source.subtitle}
                choices={ONBOARDING_SOURCES}
                value={draft.source}
                onAnswer={(source) => dispatch({type: "source", source})}
                onAdvance={() => advance("source", nextStep("source", steps))}
            />
        ),
        credits: () => (
            <OnboardingCreditsStep model={model} onContinue={() => go(nav.returnTo ?? TEMPLATES)} />
        ),
        templates: () => (
            <OnboardingGallery
                catalog={catalog}
                role={draft.role}
                category={draft.category}
                focus={focus}
                agent={draft.agent}
                create={create}
                onCategory={(category) => {
                    dispatch({type: "category", category})
                    if (focus) go(TEMPLATES, {replace: true})
                }}
                onFocus={(next, open) => {
                    if (open) detailPushedRef.current = true
                    go({step: "templates", focus: next}, {replace: !open})
                }}
                onCloseDetail={() => {
                    if (detailPushedRef.current) {
                        detailPushedRef.current = false
                        nav.back()
                    } else {
                        go(TEMPLATES, {replace: true})
                    }
                }}
                onUse={onUse}
                onChange={onAgent}
            />
        ),
        review: () => (
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
            <OnboardingHeader onSkip={creating ? undefined : () => onSkip(step)} />
            <main className="box-border flex min-w-0 flex-1 items-center justify-center px-4 pb-6 pt-6 sm:px-6 md:pb-24">
                <motion.section
                    key={step}
                    custom={shown.direction}
                    variants={presets.stepSlide}
                    initial="initial"
                    animate="animate"
                    // `min-w-0`: otherwise the widest row sets the floor and overflows a phone.
                    className={cn("w-full min-w-0", WIDTH[step])}
                >
                    {body[step]()}
                </motion.section>
            </main>
            <OnboardingProgressDots
                steps={progressSteps(steps)}
                current={progressIndex(step, steps)}
                reached={(target) => !creating && reachable(draft, steps, step, target)}
                onGo={(target) => go(stepRoute(target))}
            />
        </div>
    )
}
