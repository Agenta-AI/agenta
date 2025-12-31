"use client"

import {cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef} from "react"
import type {CSSProperties, ReactElement} from "react"

import {ArrowLeft, ArrowRight} from "@phosphor-icons/react"
import {Button, Card, Typography} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import type {CardComponentProps} from "@agentaai/nextstepjs"

import {currentStepStateAtom, markTourSeenAtom} from "@/oss/lib/onboarding"
import type {OnboardingStep} from "@/oss/lib/onboarding"

const {Text} = Typography

interface Props extends CardComponentProps {
    step: OnboardingStep
}

/**
 * OnboardingCard - The tooltip/card UI for onboarding steps
 *
 * This component is passed to NextStep as the cardComponent prop.
 * It renders the step content with navigation controls.
 */
const OnboardingCard = ({
    step,
    currentStep,
    totalSteps,
    prevStep,
    nextStep,
    skipTour,
    arrow,
}: Props) => {
    const setCurrentStepState = useSetAtom(currentStepStateAtom)
    const markTourSeen = useSetAtom(markTourSeenAtom)
    const cleanupHandlersRef = useRef<Set<() => void>>(new Set())

    // Run cleanup handlers
    const runCleanupHandlers = useCallback(() => {
        cleanupHandlersRef.current.forEach((cleanup) => {
            try {
                cleanup()
            } catch (error) {
                console.error("[Onboarding] Cleanup handler error:", error)
            }
        })
        cleanupHandlersRef.current.clear()
    }, [])

    // Update current step state and run lifecycle hooks
    useEffect(() => {
        if (!step) return

        setCurrentStepState({step, currentStep, totalSteps})
        step.onEnter?.()

        if (step.onCleanup) {
            cleanupHandlersRef.current.add(step.onCleanup)
        }

        return () => {
            step.onExit?.()
        }
    }, [step, currentStep, totalSteps, setCurrentStepState])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            setCurrentStepState({step: null, currentStep: 0, totalSteps: 0})
            runCleanupHandlers()
        }
    }, [setCurrentStepState, runCleanupHandlers])

    // Handle skip/complete
    const handleSkip = useCallback(() => {
        runCleanupHandlers()
        skipTour?.()
    }, [skipTour, runCleanupHandlers])

    // Handle next step
    const handleNext = useCallback(async () => {
        try {
            await step?.onNext?.()
        } catch (error) {
            console.error("[Onboarding] onNext handler error:", error)
        }

        if (currentStep >= totalSteps - 1) {
            // Last step - complete the tour
            runCleanupHandlers()
            skipTour?.()
        } else {
            nextStep()
        }
    }, [step, currentStep, totalSteps, nextStep, skipTour, runCleanupHandlers])

    // Handle previous step
    const handlePrev = useCallback(() => {
        prevStep()
    }, [prevStep])

    // Get control labels
    const labels = step?.controlLabels ?? {}
    const prevLabel = labels.previous ?? "Previous"
    const nextLabel = labels.next ?? "Next"
    const finishLabel = labels.finish ?? "Got it"

    // Calculate progress
    const progressPercent = Math.round(((currentStep + 1) / totalSteps) * 100)

    // Adjust arrow styling
    const adjustedArrow = useMemo(() => {
        if (!isValidElement(arrow)) return null

        const baseStyle = (arrow as ReactElement<{style?: CSSProperties}>).props?.style ?? {}
        const offset = 12
        const nextStyle: CSSProperties = {
            ...baseStyle,
            color: "#ffffff",
            backgroundColor: "white",
        }

        if (typeof baseStyle.top === "string") nextStyle.top = `-${offset}px`
        if (typeof baseStyle.bottom === "string") nextStyle.bottom = `-${offset}px`
        if (typeof baseStyle.left === "string") nextStyle.left = `-${offset}px`
        if (typeof baseStyle.right === "string") nextStyle.right = `-${offset}px`

        return cloneElement(arrow as ReactElement<{style?: CSSProperties}>, {style: nextStyle})
    }, [arrow])

    const showControls = step?.showControls ?? true
    const showSkip = step?.showSkip ?? true

    return (
        <section className="w-[340px]">
            <Card className="!rounded-xl !p-0" classNames={{body: "!px-4 !py-[10px]"}}>
                <div className="flex w-full flex-col gap-4">
                    {/* Header */}
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-4">
                            <Text className="!mb-0 !text-sm font-medium leading-6 text-colorText">
                                {step?.title}
                            </Text>
                            <Text className="!mb-0 !text-xs font-medium text-colorTextSecondary">
                                {currentStep + 1} / {totalSteps}
                            </Text>
                        </div>
                        <Text className="!mb-0 !text-xs leading-5 text-colorTextSecondary">
                            {step?.content}
                        </Text>
                    </div>

                    {/* Controls */}
                    {showControls && (
                        <div className="flex flex-col gap-4">
                            {/* Progress bar */}
                            <div className="h-1.5 w-full rounded-full bg-gray-200">
                                <div
                                    className="h-full rounded-full bg-colorPrimary transition-all duration-300"
                                    style={{width: `${progressPercent}%`}}
                                />
                            </div>

                            {/* Navigation buttons */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Button
                                    onClick={handlePrev}
                                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                                    disabled={currentStep === 0}
                                    className="!text-xs !h-[26px] rounded-lg !border-colorBorder hover:!border-colorBorder bg-white text-colorText hover:!text-colorTextSecondary"
                                    size="small"
                                >
                                    {prevLabel}
                                </Button>

                                <Button
                                    type="primary"
                                    onClick={handleNext}
                                    icon={<ArrowRight size={14} className="mt-0.5" />}
                                    iconPosition="end"
                                    className="!text-xs !h-[26px] bg-colorPrimary hover:!bg-colorPrimaryHover rounded-lg"
                                    size="small"
                                >
                                    {currentStep < totalSteps - 1 ? nextLabel : finishLabel}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Skip button */}
                {showSkip && skipTour && currentStep < totalSteps - 1 && (
                    <Button
                        type="default"
                        className="!text-xs mt-2 w-full rounded-lg !border-colorBorder hover:!border-colorBorder bg-white text-colorText hover:!text-colorTextSecondary"
                        onClick={handleSkip}
                        size="small"
                    >
                        Skip
                    </Button>
                )}

                {/* Arrow */}
                {adjustedArrow && (
                    <div className="mt-2 flex w-full justify-center !bg-white">{adjustedArrow}</div>
                )}
            </Card>
        </section>
    )
}

export default OnboardingCard
