import type {CSSProperties} from "react"
import {cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef} from "react"

import {ArrowLeft, ArrowRight} from "@phosphor-icons/react"
import {Button, Card, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import type {CardComponentProps} from "nextstepjs"
import {NormalizedStepContent} from "./types"

import {
    currentOnboardingStepAtom,
    isNewUserAtom,
    resolveOnboardingSection,
    updateUserOnboardingStatusAtom,
    triggerOnboardingAtom,
} from "@/oss/state/onboarding"
import type {UserOnboardingStatus} from "@/oss/state/onboarding"
import {urlLocationAtom} from "@/oss/state/url"
import {fullJourneyStateAtom} from "@/oss/state/onboarding/atoms/helperAtom"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

const {Text} = Typography

type StepWithEffects = CardComponentProps["step"] & {
    onEnter?: () => void
    onExit?: () => void
    onCleanup?: () => void
    onboardingSection?: keyof UserOnboardingStatus
}

const normalizeStep = (step: CardComponentProps["step"]): NormalizedStepContent => {
    return {
        icon: step?.icon ?? null,
        title: step?.title,
        content: step?.content,
        showControls: step?.showControls ?? true,
        showSkip: step?.showSkip ?? true,
    }
}

const OnboardingCard = ({
    step,
    currentStep,
    totalSteps,
    prevStep,
    nextStep,
    skipTour,
    arrow,
}: CardComponentProps) => {
    const setCurrentStep = useSetAtom(currentOnboardingStepAtom)
    const updateOnboardingStatus = useSetAtom(updateUserOnboardingStatusAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const userSection = useAtomValue(urlLocationAtom).section
    const fullJourneyState = useAtomValue(fullJourneyStateAtom)
    const setFullJourneyState = useSetAtom(fullJourneyStateAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const posthog = usePostHogAg()

    const cleanupHandlersRef = useRef<Set<() => void>>(new Set())

    const runCleanupHandlers = useCallback(() => {
        if (!cleanupHandlersRef.current.size) return

        cleanupHandlersRef.current.forEach((cleanup) => {
            try {
                cleanup()
            } catch (error) {
                console.error("Failed to run onboarding cleanup handler", error)
            }
        })
        cleanupHandlersRef.current.clear()
    }, [])

    useEffect(() => {
        if (!step) return

        const extendedStep = step as StepWithEffects | undefined
        setCurrentStep({...step, currentStep, totalSteps})
        extendedStep?.onEnter?.()

        if (extendedStep?.onCleanup) {
            cleanupHandlersRef.current.add(extendedStep.onCleanup)
        }

        const resolvedSection =
            extendedStep?.onboardingSection ?? resolveOnboardingSection(userSection)
        posthog?.capture("onboarding_step_viewed", {
            title: step?.title,
            stepIndex: currentStep,
            totalSteps,
            section: resolvedSection,
        })

        return () => {
            extendedStep?.onExit?.()
        }
    }, [step, setCurrentStep, currentStep, totalSteps])

    useEffect(() => {
        return () => {
            setCurrentStep(null)
            runCleanupHandlers()
        }
    }, [setCurrentStep, runCleanupHandlers])

    const captureStepAction = useCallback(
        (action: string) => {
            const extendedStep = step as StepWithEffects | undefined
            const resolvedSection =
                extendedStep?.onboardingSection ?? resolveOnboardingSection(userSection)
            posthog?.capture("onboarding_step_action", {
                action,
                title: step?.title,
                stepIndex: currentStep,
                totalSteps,
                section: resolvedSection,
            })
        },
        [step, posthog, currentStep, totalSteps, userSection],
    )

    const onPrevStep = useCallback(() => {
        captureStepAction("previous")
        prevStep()
    }, [captureStepAction, prevStep])

    const onNextStep = useCallback(() => {
        captureStepAction("next")
        nextStep()
    }, [captureStepAction, nextStep])

    const onSkipStep = useCallback(
        (status: string) => {
            const extendedStep = step as StepWithEffects | undefined
            runCleanupHandlers()
            skipTour?.()
            setTriggerOnboarding(null)
            if (!status) return
            if (!isNewUser) return

            const resolvedSection =
                extendedStep?.onboardingSection ?? resolveOnboardingSection(userSection)
            if (!resolvedSection) return

            captureStepAction(status === "done" ? "finish" : "skip")
            updateOnboardingStatus({section: resolvedSection, status})

            if (fullJourneyState.active) {
                setFullJourneyState({active: false, state: null, journeyId: null})
                updateOnboardingStatus({section: "fullJourney", status: status})
                setTriggerOnboarding(null)
            }
        },
        [
            step,
            skipTour,
            isNewUser,
            userSection,
            updateOnboardingStatus,
            runCleanupHandlers,
            fullJourneyState.active,
            setFullJourneyState,
            setTriggerOnboarding,
            captureStepAction,
        ],
    )

    const normalized = useMemo(() => normalizeStep(step), [step])
    const percent = useMemo(
        () => Math.round(((currentStep + 1) / totalSteps) * 100),
        [currentStep, totalSteps],
    )

    const adjustedArrow = useMemo(() => {
        if (!isValidElement(arrow)) return null
        const baseStyle = arrow.props?.style ?? {}
        const offset = 12
        const nextStyle: CSSProperties = {
            ...baseStyle,
            color: "#ffffff",
            backgroundColor: "white",
        }

        if (typeof baseStyle.top === "string") {
            nextStyle.top = `-${offset}px`
        }
        if (typeof baseStyle.bottom === "string") {
            nextStyle.bottom = `-${offset}px`
        }
        if (typeof baseStyle.left === "string") {
            nextStyle.left = `-${offset}px`
        }
        if (typeof baseStyle.right === "string") {
            nextStyle.right = `-${offset}px`
        }

        return cloneElement(arrow, {
            style: nextStyle,
        })
    }, [arrow])

    const progressWidth = useMemo(() => `${percent}%`, [percent])

    return (
        <section className="w-[360px]">
            <Card className="!rounded-xl !p-0" classNames={{body: "!p-4"}}>
                <div className="flex w-full flex-col gap-5">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-4">
                            <Text className="!mb-0 text-sm font-semibold leading-6 text-colorText">
                                {normalized.title}
                            </Text>

                            <Text className="!mb-0 text-sm font-medium text-colorTextSecondary">
                                {currentStep + 1} / {totalSteps}
                            </Text>
                        </div>

                        <Text className="!mb-0 text-xs leading-5 text-colorTextSecondary">
                            {normalized.content}
                        </Text>
                    </div>

                    <div className="flex flex-col gap-4">
                        <div className="h-1.5 w-full rounded-full bg-gray-200">
                            <div
                                className="h-full rounded-full bg-colorPrimary transition-all duration-300"
                                style={{width: progressWidth}}
                                role="presentation"
                            />
                        </div>

                        {normalized.showControls ? (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <Button
                                    onClick={onPrevStep}
                                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                                    disabled={currentStep === 0}
                                    className="text-xs !h-7 rounded-lg !border-colorBorder hover:!border-colorBorder bg-white text-colorText hover:!text-colorTextSecondary"
                                >
                                    Previous
                                </Button>

                                {currentStep < totalSteps - 1 ? (
                                    <Button
                                        type="primary"
                                        onClick={onNextStep}
                                        icon={<ArrowRight size={14} className="mt-0.5" />}
                                        iconPosition="end"
                                        className="text-xs !h-7 bg-colorPrimary hover:!bg-colorPrimaryHover rounded-lg"
                                    >
                                        Next
                                    </Button>
                                ) : (
                                    <Button
                                        type="primary"
                                        icon={<ArrowRight size={14} className="mt-0.5" />}
                                        iconPosition="end"
                                        onClick={() => onSkipStep("done")}
                                        className="text-xs !h-7 bg-colorPrimary hover:!bg-colorPrimaryHover rounded-lg"
                                    >
                                        Finish
                                    </Button>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>

                {normalized.showSkip && skipTour ? (
                    <Button
                        type="default"
                        className="text-xs !h-7 mt-4 w-full rounded-lg !border-colorBorder hover:!border-colorBorder bg-white text-colorText hover:!text-colorTextSecondary"
                        onClick={() => onSkipStep("skipped")}
                        disabled={currentStep === totalSteps - 1}
                    >
                        Skip Tour
                    </Button>
                ) : null}

                {adjustedArrow ? (
                    <div className="mt-2 flex w-full justify-center !bg-white">{adjustedArrow}</div>
                ) : null}
            </Card>
        </section>
    )
}

export default OnboardingCard
