import {useEffect, useMemo, useReducer, useRef, useState, type ReactNode} from "react"

import {Button, LoadingButton} from "@agenta/ui/ui"
import {ArrowLeft, ArrowRight} from "@phosphor-icons/react"
import {AnimatePresence, motion} from "motion/react"

import {AgentaLogo} from "@/components/AgentaLogo"
import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {OnboardingChoiceGrid} from "./OnboardingChoiceGrid"
import {
    firstAgentInput,
    ONBOARDING_ROLES,
    ONBOARDING_SOURCES,
    suggestionsForRole,
    type FirstAgentInput,
    type OnboardingCatalog,
    type OnboardingVariant,
} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {
    canLeaveStep,
    DEFAULT_IDENTITY,
    ONBOARDING_STEPS,
    onboardingHeadingId,
    onboardingReducer,
    readOnboardingDraft,
    saveOnboardingDraft,
    stepAfter,
    stepBefore,
    type OnboardingDraft,
    type OnboardingIconPick,
    type OnboardingStep,
} from "./onboardingDraft"
import {OnboardingNameFirst} from "./OnboardingNameFirst"
import {OnboardingTaskFirst} from "./OnboardingTaskFirst"

export interface OnboardingCreateInput extends FirstAgentInput {
    icon: OnboardingIconPick | null
}

export interface OnboardingFlowProps {
    variant: OnboardingVariant
    /** sessionStorage key; answers survive a reload or an auth redirect. */
    draftKey: string
    steps: readonly OnboardingStep[]
    catalog: OnboardingCatalog
    tools: ReactNode
    model: ReactNode
    modelReady: boolean
    modelNextLabel: string
    creating: boolean
    error?: string | null
    onStepCompleted: (step: OnboardingStep, draft: OnboardingDraft) => void
    onCreate: (input: OnboardingCreateInput) => void
}

const WIDTH: Record<OnboardingStep, string> = {
    role: "max-w-[700px]",
    tools: "max-w-[700px]",
    model: "max-w-[600px]",
    referral: "max-w-[700px]",
    agent: "max-w-[1080px]",
}

/** A restored draft can sit on a step this deployment skips; resume on the next one it has. */
const resumeOn = (draft: OnboardingDraft, steps: readonly OnboardingStep[]): OnboardingDraft => {
    if (steps.includes(draft.step)) return draft
    const from = ONBOARDING_STEPS.indexOf(draft.step)
    return {...draft, step: steps.find((step) => ONBOARDING_STEPS.indexOf(step) > from) ?? steps[0]}
}

/** The five-step first-agent flow; it owns the answers, the host owns data and side effects. */
export const OnboardingFlow = ({
    variant,
    draftKey,
    steps,
    catalog,
    tools,
    model,
    modelReady,
    modelNextLabel,
    creating,
    error,
    onStepCompleted,
    onCreate,
}: OnboardingFlowProps) => {
    const [draft, dispatch] = useReducer(onboardingReducer, draftKey, (key) =>
        resumeOn(readOnboardingDraft(key), steps),
    )
    useEffect(() => saveOnboardingDraft(draftKey, draft), [draftKey, draft])

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
    const previous = stepBefore(steps, step)
    const following = stepAfter(steps, step)
    const go = (next: OnboardingStep | null) => {
        if (!next) return
        const forward = steps.indexOf(next) > steps.indexOf(step)
        if (forward) onStepCompleted(step, draft)
        setDirection(forward ? 1 : -1)
        movedRef.current = true
        dispatch({type: "step", step: next})
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    }

    const suggestions = useMemo(
        () => suggestionsForRole(catalog.templates, draft.role),
        [catalog.templates, draft.role],
    )
    const pick = draft.pick
    const selected =
        pick?.kind === "template" ? suggestions.find((item) => item.key === pick.key) : undefined
    // A pick creates only from its own template; a catalog that loaded without it drops it.
    const pickPending = pick?.kind === "template" && !selected && catalog.status !== "success"
    const input = pickPending ? null : firstAgentInput(variant, draft, selected)

    const create = (
        <LoadingButton
            size="lg"
            loading={creating}
            disabled={!input || !modelReady}
            onClick={() => {
                if (!input) return
                const icon = draft.icon ?? (variant === "control" ? DEFAULT_IDENTITY : null)
                onCreate({...input, icon})
            }}
        >
            {ONBOARDING_COPY.agent.create(variant)}
        </LoadingButton>
    )
    const onPick = (template: (typeof suggestions)[number], index: number) =>
        dispatch({type: "template", template, index, variant})

    const heading =
        step === "role" || step === "tools" || step === "referral"
            ? ONBOARDING_COPY.headings[step]
            : null
    const body: Record<OnboardingStep, () => ReactNode> = {
        role: () => (
            <OnboardingChoiceGrid
                tall
                labelledBy={onboardingHeadingId("role")}
                choices={ONBOARDING_ROLES}
                value={draft.role}
                onPick={(role) => dispatch({type: "role", role})}
            />
        ),
        tools: () => tools,
        model: () => model,
        referral: () => (
            <OnboardingChoiceGrid
                labelledBy={onboardingHeadingId("referral")}
                choices={ONBOARDING_SOURCES}
                value={draft.source}
                onPick={(source) => dispatch({type: "source", source})}
            />
        ),
        agent: () =>
            variant === "control" ? (
                <OnboardingNameFirst
                    role={draft.role ?? ""}
                    name={draft.name}
                    icon={draft.icon}
                    pickedKey={selected?.key ?? null}
                    suggestions={suggestions}
                    catalog={catalog}
                    onName={(name) => dispatch({type: "name", name})}
                    onIcon={(icon) => dispatch({type: "icon", icon})}
                    onPick={onPick}
                    create={create}
                />
            ) : (
                <OnboardingTaskFirst
                    pick={pick}
                    task={draft.task}
                    selected={selected}
                    suggestions={suggestions}
                    catalog={catalog}
                    onPick={onPick}
                    onCustom={() => dispatch({type: "custom"})}
                    onTask={(task) => dispatch({type: "task", task})}
                    create={create}
                />
            ),
    }
    const position = steps.indexOf(step) + 1

    return (
        <main
            ref={scrollerRef}
            className="bg-background text-foreground flex h-dvh flex-col overflow-y-auto"
        >
            <header className="mx-auto w-full max-w-[1200px] px-4 pt-6 lg:px-8 lg:pt-8">
                <div className="flex items-center justify-between">
                    <AgentaLogo className="h-6 w-auto" />
                    <span className="text-muted-foreground text-sm">
                        {ONBOARDING_COPY.stepCounter(position, steps.length)}
                    </span>
                </div>
                <div
                    className="mt-5 flex gap-2"
                    role="progressbar"
                    aria-valuemin={1}
                    aria-valuemax={steps.length}
                    aria-valuenow={position}
                    aria-label={ONBOARDING_COPY.stepCounter(position, steps.length)}
                >
                    {steps.map((item, index) => (
                        <div
                            key={item}
                            className={cn(
                                "h-[3px] flex-1 rounded-full transition-colors",
                                index < position ? "bg-foreground" : "bg-border",
                            )}
                        />
                    ))}
                </div>
            </header>
            <div className="relative flex-1 overflow-x-hidden px-4 lg:px-8">
                <AnimatePresence mode="popLayout" custom={direction} initial={false}>
                    <motion.section
                        key={step}
                        custom={direction}
                        variants={presets.sharedAxisPush}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className={cn("mx-auto w-full pb-10 pt-10 lg:pt-16", WIDTH[step])}
                    >
                        {heading ? (
                            <>
                                <h1
                                    id={onboardingHeadingId(step)}
                                    tabIndex={-1}
                                    className={cn(
                                        ONBOARDING_COPY.headingClass,
                                        "text-center lg:text-[30px]",
                                    )}
                                >
                                    {heading.title}
                                </h1>
                                <p className="text-muted-foreground mb-8 mt-2 text-center text-[15px]">
                                    {heading.subtitle}
                                </p>
                            </>
                        ) : null}
                        {body[step]()}
                        {step === "agent" && !modelReady ? (
                            <p className="text-muted-foreground m-0 mt-4 text-center text-sm">
                                {ONBOARDING_COPY.agent.modelMissing}{" "}
                                <button
                                    type="button"
                                    onClick={() => go("model")}
                                    className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-sm underline"
                                >
                                    {ONBOARDING_COPY.agent.modelMissingAction}
                                </button>
                            </p>
                        ) : null}
                        {step === "agent" && error ? (
                            <p
                                role="alert"
                                className="text-destructive m-0 mt-4 text-center text-sm"
                            >
                                {error}
                            </p>
                        ) : null}
                    </motion.section>
                </AnimatePresence>
            </div>
            <footer className="bg-background border-border sticky bottom-0 border-0 border-t border-solid px-4 py-3 lg:border-t-0 lg:px-8 lg:py-8">
                <div
                    className={cn(
                        "mx-auto flex w-full items-center gap-4",
                        following
                            ? "max-w-[700px] justify-between"
                            : "max-w-[1080px] justify-center",
                    )}
                >
                    <Button
                        variant="ghost"
                        onClick={() => go(previous)}
                        disabled={!previous || creating}
                    >
                        <ArrowLeft data-icon="inline-start" /> {ONBOARDING_COPY.back}
                    </Button>
                    {following ? (
                        <Button
                            size="lg"
                            disabled={!canLeaveStep(draft, {modelReady})}
                            onClick={() => go(following)}
                        >
                            {step === "model" ? modelNextLabel : ONBOARDING_COPY.next}
                            <ArrowRight data-icon="inline-end" />
                        </Button>
                    ) : null}
                </div>
            </footer>
        </main>
    )
}
