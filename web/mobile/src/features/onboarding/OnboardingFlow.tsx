import {useEffect, useLayoutEffect, useReducer, useRef, useState} from "react"

import type {useComposerAttachments} from "@agenta/chat/hooks"
import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import type {ConnectedApps} from "./onboardingApps"
import type {OnboardingCatalog} from "./onboardingChoices"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import {OnboardingCreditsStep} from "./OnboardingCreditsStep"
import {
    blankAgentInput,
    onboardingReducer,
    readOnboardingDraft,
    templateAgentInput,
    type FirstAgentInput,
    type OnboardingDraft,
} from "./onboardingDraft"
import {OnboardingGallery} from "./OnboardingGallery"
import {OnboardingHeader} from "./OnboardingHeader"
import {OnboardingProgressDots} from "./OnboardingProgressDots"
import {OnboardingQuestion} from "./OnboardingQuestion"
import {
    onboardingQuestion,
    recommendedCategory,
    type OnboardingQuestionId,
} from "./onboardingQuestions"
import {
    guardOnboardingRoute,
    isFixedStep,
    isStepOpen,
    nextStep,
    onboardingHeadingId,
    onboardingRoutePath,
    stepIndex,
    stepRoute,
    type GalleryFocus,
    type OnboardingRoute,
    type OnboardingStep,
    type OnboardingSteps,
} from "./onboardingRoute"
import {useDraftSave} from "./useDraftSave"
import type {OnboardingModel} from "./useOnboardingModel"
import {useOnboardingNav} from "./useOnboardingNav"

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
    creating: boolean
    error?: string | null
    /** The first message's staged files; the host sends them with the create. */
    attachments: ReturnType<typeof useComposerAttachments>
    onStepCompleted: (step: OnboardingStep, draft: OnboardingDraft) => void
    /** Resolves `false` when no agent was created. */
    onCreate: (input: FirstAgentInput) => Promise<boolean>
}

const QUESTION_WIDTH = "max-w-[680px]"

/** Each fixed step's column width, as the design sets it. */
const WIDTH = {
    credits: "max-w-[880px]",
    templates: "max-w-[1040px] max-md:self-start",
} as const

const TEMPLATES: OnboardingRoute = {step: "templates", focus: null}

/** The first-agent flow; it owns the answers, the URL owns the step. */
export const OnboardingFlow = ({
    onboardingPath,
    draftKey,
    steps,
    catalog,
    model,
    connectedApps,
    creating,
    error,
    attachments,
    onStepCompleted,
    onCreate,
}: OnboardingFlowProps) => {
    const [draft, dispatch] = useReducer(onboardingReducer, draftKey, readOnboardingDraft)
    const flushDraft = useDraftSave(draftKey, draft)
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
    const create: OnboardingCreateState = {
        modelReady: model.ready,
        creating,
        error,
        attachments,
        onChooseModel: () => go({step: "credits"}, {returnTo: routeRef.current}),
        onCreate: async (firstMessage) => {
            const input = blankAgentInput(draftRef.current.agent, firstMessage)
            flushDraft()
            return input ? onCreate(input) : false
        },
        onCreateFromTemplate: (template) => {
            flushDraft()
            return onCreate(templateAgentInput(template, connectedApps))
        },
    }
    const onAgent = (patch: Partial<OnboardingDraft["agent"]>) => dispatch({type: "agent", patch})

    const question = (id: OnboardingQuestionId) => {
        const asked = onboardingQuestion(id)
        if (!asked) return null
        return (
            <OnboardingQuestion
                headingId={onboardingHeadingId(id)}
                title={asked.title}
                subtitle={asked.subtitle}
                choices={asked.choices}
                value={draft.answers[id] ?? null}
                onAnswer={(value) => dispatch({type: "answer", question: id, value})}
                onAdvance={() => advance(id, nextStep(id, steps))}
            />
        )
    }
    const body = {
        credits: () => (
            <OnboardingCreditsStep model={model} onContinue={() => go(nav.returnTo ?? TEMPLATES)} />
        ),
        templates: () => (
            <OnboardingGallery
                catalog={catalog}
                preferred={recommendedCategory(draft.answers)}
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
                onChange={onAgent}
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
                    custom={shown.direction}
                    variants={presets.stepSlide}
                    initial="initial"
                    animate="animate"
                    // `min-w-0`: otherwise the widest row sets the floor and overflows a phone.
                    className={cn(
                        "w-full min-w-0",
                        isFixedStep(step) ? WIDTH[step] : QUESTION_WIDTH,
                    )}
                >
                    {isFixedStep(step) ? body[step]() : question(step)}
                </motion.section>
            </main>
            <OnboardingProgressDots
                steps={steps}
                current={steps.indexOf(step)}
                reached={(target) =>
                    !creating && target !== step && isStepOpen(target, draft, steps)
                }
                onGo={(target) => go(stepRoute(target))}
            />
        </div>
    )
}
