"use client"

import {
    cloneElement,
    isValidElement,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"
import type {CSSProperties, ReactElement} from "react"

import type {CardComponentProps} from "@agentaai/nextstepjs"
import {ArrowLeft, ArrowRight, DotsSixVertical} from "@phosphor-icons/react"
import {Button, Card, Typography} from "antd"
import {useSetAtom} from "jotai"

import {currentStepStateAtom} from "@/oss/lib/onboarding"
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
 * Users can drag the card if it's blocking content.
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
    const cleanupHandlersRef = useRef<Set<() => void>>(new Set())
    const cardRef = useRef<HTMLDivElement>(null)

    // Drag state
    const [offset, setOffset] = useState({x: 0, y: 0})
    const [isDragging, setIsDragging] = useState(false)
    const dragStartRef = useRef({x: 0, y: 0, offsetX: 0, offsetY: 0})

    // Reset offset when step changes
    useEffect(() => {
        setOffset({x: 0, y: 0})
    }, [currentStep])

    // Drag handlers
    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault()
            setIsDragging(true)
            dragStartRef.current = {
                x: e.clientX,
                y: e.clientY,
                offsetX: offset.x,
                offsetY: offset.y,
            }
        },
        [offset],
    )

    useEffect(() => {
        if (!isDragging) return

        const handleMouseMove = (e: MouseEvent) => {
            const dx = e.clientX - dragStartRef.current.x
            const dy = e.clientY - dragStartRef.current.y

            // Calculate new position
            let newX = dragStartRef.current.offsetX + dx
            let newY = dragStartRef.current.offsetY + dy

            // Viewport boundary check
            if (cardRef.current) {
                const rect = cardRef.current.getBoundingClientRect()
                const viewportWidth = window.innerWidth
                const viewportHeight = window.innerHeight

                // Keep card within viewport with some padding
                const padding = 10
                const cardLeft = rect.left - offset.x + newX
                const cardRight = cardLeft + rect.width
                const cardTop = rect.top - offset.y + newY
                const cardBottom = cardTop + rect.height

                if (cardLeft < padding) newX = newX + (padding - cardLeft)
                if (cardRight > viewportWidth - padding)
                    newX = newX - (cardRight - viewportWidth + padding)
                if (cardTop < padding) newY = newY + (padding - cardTop)
                if (cardBottom > viewportHeight - padding)
                    newY = newY - (cardBottom - viewportHeight + padding)
            }

            setOffset({x: newX, y: newY})
        }

        const handleMouseUp = () => {
            setIsDragging(false)
        }

        document.addEventListener("mousemove", handleMouseMove)
        document.addEventListener("mouseup", handleMouseUp)

        return () => {
            document.removeEventListener("mousemove", handleMouseMove)
            document.removeEventListener("mouseup", handleMouseUp)
        }
    }, [isDragging, offset])

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

        // Store reference to this step's cleanup handler
        const currentCleanup = step.onCleanup

        if (currentCleanup) {
            cleanupHandlersRef.current.add(currentCleanup)
        }

        return () => {
            step.onExit?.()
            // Remove this step's cleanup handler when leaving the step
            // This prevents accumulation of stale handlers
            if (currentCleanup) {
                cleanupHandlersRef.current.delete(currentCleanup)
            }
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
        <section
            ref={cardRef}
            className="w-[340px]"
            style={{
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                transition: isDragging ? "none" : "transform 0.1s ease-out",
            }}
        >
            <Card className="!rounded-xl !p-0 shadow-lg" classNames={{body: "!px-4 !py-[10px]"}}>
                <div className="flex w-full flex-col gap-4">
                    {/* Header with drag handle */}
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                            {/* Drag handle */}
                            <div
                                onMouseDown={handleMouseDown}
                                className="cursor-grab active:cursor-grabbing p-1 -ml-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                                title="Drag to move"
                            >
                                <DotsSixVertical size={16} weight="bold" />
                            </div>
                            <Text className="!mb-0 !text-sm font-medium leading-6 text-colorText flex-1">
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

                {/* Arrow - hide if user has dragged the card */}
                {adjustedArrow && offset.x === 0 && offset.y === 0 && (
                    <div className="mt-2 flex w-full justify-center !bg-white">{adjustedArrow}</div>
                )}
            </Card>
        </section>
    )
}

export default OnboardingCard
