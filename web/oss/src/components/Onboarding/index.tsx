import type {CSSProperties} from "react"
import {cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef} from "react"

import {ArrowLeft, ArrowRight} from "@phosphor-icons/react"
import {Button, Card, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import type {CardComponentProps} from "nextstepjs"
import {NormalizedStepContent} from "./types"

import type {OnboardingControlLabels, UserOnboardingStatus} from "@/oss/state/onboarding"
import {
    currentOnboardingStepAtom,
    isNewUserAtom,
    triggerOnboardingAtom,
    updateUserOnboardingStatusAtom,
} from "@/oss/state/onboarding"
import {urlLocationAtom} from "@/oss/state/url"

const {Text} = Typography

type StepWithEffects = CardComponentProps["step"] & {
    onEnter?: () => void
    onExit?: () => void
    onCleanup?: () => void
    onNext?: () => void | Promise<void>
    onboardingSection?: keyof UserOnboardingStatus
    controlLabels?: OnboardingControlLabels
}

const normalizeStep = (step: CardComponentProps["step"]): NormalizedStepContent => {
    const extendedStep = step as StepWithEffects | undefined
    return {
        icon: step?.icon ?? null,
        title: step?.title,
        content: step?.content,
        showControls: step?.showControls ?? true,
        showSkip: step?.showSkip ?? true,
        controlLabels: extendedStep?.controlLabels,
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
    const userOnboardingSection = useAtomValue(urlLocationAtom).resolvedSection
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)

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
        if (!step?.selector && currentStep == null) {
            skipTour?.()
        }
    }, [step, skipTour, currentStep])

    useEffect(() => {
        if (!step) return

        const extendedStep = step as StepWithEffects | undefined
        setCurrentStep({...step, currentStep, totalSteps})
        extendedStep?.onEnter?.()

        if (extendedStep?.onCleanup) {
            cleanupHandlersRef.current.add(extendedStep.onCleanup)
        }

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

    const onSkipStep = useCallback(
        (status: string) => {
            const extendedStep = step as StepWithEffects | undefined
            runCleanupHandlers()
            skipTour?.()
            setTriggerOnboarding(null)
            if (!status) return

            const resolvedSection =
                extendedStep?.onboardingSection ?? userOnboardingSection
            if (!resolvedSection) return

            updateOnboardingStatus({section: resolvedSection, status})
        },
        [
            step,
            skipTour,
            isNewUser,
            userOnboardingSection,
            updateOnboardingStatus,
            runCleanupHandlers,
            setTriggerOnboarding,
        ],
    )

    const handleAdvance = useCallback(
        async (isFinalStep?: boolean) => {
            const extendedStep = step as StepWithEffects | undefined
            try {
                if (extendedStep?.onNext) {
                    await extendedStep.onNext()
                }
            } catch (error) {
                console.error("Failed to run onboarding advance handler", error)
            }
            if (isFinalStep) {
                onSkipStep("done")
                return
            }
            nextStep()
        },
        [step, nextStep, onSkipStep],
    )

    const onPrevStep = useCallback(() => {
        prevStep()
    }, [prevStep])

    const onNextStep = useCallback(() => {
        handleAdvance()
    }, [handleAdvance])

    const normalized = useMemo(() => normalizeStep(step), [step])
    const percent = useMemo(
        () => Math.round(((currentStep + 1) / totalSteps) * 100),
        [currentStep, totalSteps],
    )
    const controlLabels = normalized.controlLabels ?? ({} as OnboardingControlLabels)
    const previousLabel = controlLabels.previous ?? "Previous"
    const nextLabel = controlLabels.next ?? "Next"
    const finishLabel = controlLabels.finish ?? "Finish"

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
        <section className="w-[340px]">
            <Card className="!rounded-xl !p-0" classNames={{body: "!px-4 !py-[10px]"}}>
                <div className="flex w-full flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-4">
                            <Text className="!mb-0 !text-sm font-medium leading-6 text-colorText">
                                {normalized.title}
                            </Text>

                            <Text className="!mb-0 !text-xs font-medium text-colorTextSecondary">
                                {currentStep + 1} / {totalSteps}
                            </Text>
                        </div>

                        <Text className="!mb-0 !text-xs leading-5 text-colorTextSecondary">
                            {normalized.content}
                        </Text>
                    </div>
                    {normalized.showControls ? (
                        <div className="flex flex-col gap-4">
                            <div className="h-1.5 w-full rounded-full bg-gray-200">
                                <div
                                    className="h-full rounded-full bg-colorPrimary transition-all duration-300"
                                    style={{width: progressWidth}}
                                    role="presentation"
                                />
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Button
                                    onClick={onPrevStep}
                                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                                    disabled={currentStep === 0}
                                    className="!text-xs !h-[26px] rounded-lg !border-colorBorder hover:!border-colorBorder bg-white text-colorText hover:!text-colorTextSecondary"
                                    size="small"
                                >
                                    {previousLabel}
                                </Button>

                                {currentStep < totalSteps - 1 ? (
                                    <Button
                                        type="primary"
                                        onClick={onNextStep}
                                        icon={<ArrowRight size={14} className="mt-0.5" />}
                                        iconPosition="end"
                                        className="!text-xs !h-[26px] bg-colorPrimary hover:!bg-colorPrimaryHover rounded-lg"
                                        size="small"
                                    >
                                        {nextLabel}
                                    </Button>
                                ) : (
                                    <Button
                                        type="primary"
                                        icon={<ArrowRight size={14} className="mt-0.5" />}
                                        iconPosition="end"
                                        onClick={() => handleAdvance(true)}
                                        className="!text-xs !h-[26px] bg-colorPrimary hover:!bg-colorPrimaryHover rounded-lg"
                                        size="small"
                                    >
                                        {finishLabel}
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>

                {normalized.showSkip && skipTour ? (
                    <Button
                        type="default"
                        className="!text-xs mt-2 w-full rounded-lg !border-colorBorder hover:!border-colorBorder bg-white text-colorText hover:!text-colorTextSecondary"
                        onClick={() => onSkipStep("skipped")}
                        disabled={currentStep === totalSteps - 1}
                        size="small"
                    >
                        Skip
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
