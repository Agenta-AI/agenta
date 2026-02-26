"use client"

import type {CSSProperties, ReactElement} from "react"
import {
    cloneElement,
    isValidElement,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import type {CardComponentProps} from "@agentaai/nextstepjs"
import {ArrowLeft, ArrowRight, DotsSixVertical} from "@phosphor-icons/react"
import {Button, Card, Typography} from "antd"
import {useSetAtom} from "jotai"

import type {OnboardingStep} from "@/oss/lib/onboarding"
import {currentStepStateAtom} from "@/oss/lib/onboarding"

const {Text} = Typography

// We omit specific props to override them with our stricter types
interface Props extends Omit<CardComponentProps, "step" | "arrow"> {
    step: OnboardingStep
    currentStep: number
    totalSteps: number
    prevStep: () => void
    nextStep: () => void
    skipTour?: () => void
    arrow?: ReactElement
}

/**
 * OnboardingCard - The tooltip/card UI for onboarding steps
 *
 * Refactored to separate concerns:
 * - Drag logic is self-contained
 * - Effect hook handles cleanup and state updates
 * - Render logic is cleaner
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
    const hasValidStep = Boolean(step && totalSteps > 0)
    const setCurrentStepState = useSetAtom(currentStepStateAtom)
    const cardRef = useRef<HTMLDivElement>(null)

    // Simplified Drag State
    const [userOffset, setUserOffset] = useState({x: 0, y: 0})
    const [autoOffset, setAutoOffset] = useState({x: 0, y: 0})
    const isDraggingRef = useRef(false)
    const dragStartRef = useRef({x: 0, y: 0, offsetX: 0, offsetY: 0})
    const clampRafRef = useRef<number | null>(null)
    const clampTimeoutsRef = useRef<number[]>([])
    const autoScrollRef = useRef(false)
    const autoScrollTimeoutRef = useRef<number | null>(null)
    const autoAdvanceTriggeredRef = useRef(false)
    const viewPadding = 12

    // Drag Handler: Mouse Down
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        isDraggingRef.current = true
        dragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            offsetX: 0, // Will be updated relative to current offset state
            offsetY: 0,
        }

        // Update drag start based on current React state
        setUserOffset((prev) => {
            dragStartRef.current.offsetX = prev.x
            dragStartRef.current.offsetY = prev.y
            return prev
        })
    }, [])

    // Drag Logic: Global Listeners
    const getTargetElement = useCallback(() => {
        const selector = step?.selector
        if (!selector) return null

        try {
            return document.querySelector(selector)
        } catch (error) {
            console.warn("[Onboarding] Invalid step selector:", selector, error)
            return null
        }
    }, [step?.selector])

    const isTargetInViewport = useCallback(
        (rect: DOMRect) => {
            const maxX = window.innerWidth - viewPadding
            const maxY = window.innerHeight - viewPadding
            return (
                rect.right > viewPadding &&
                rect.left < maxX &&
                rect.bottom > viewPadding &&
                rect.top < maxY
            )
        },
        [viewPadding],
    )

    const ensureTargetInView = useCallback(() => {
        if (typeof window === "undefined") return false
        const target = getTargetElement()
        if (!target || !(target instanceof HTMLElement)) return false

        const rect = target.getBoundingClientRect()
        if (isTargetInViewport(rect)) return false
        if (autoScrollRef.current) return true

        autoScrollRef.current = true
        target.scrollIntoView({block: "center", inline: "center", behavior: "smooth"})
        if (autoScrollTimeoutRef.current) {
            window.clearTimeout(autoScrollTimeoutRef.current)
        }

        const startedAt = window.performance.now()
        const releaseAutoScroll = () => {
            autoScrollRef.current = false
            autoScrollTimeoutRef.current = null
        }
        const settleAutoScroll = () => {
            if (!autoScrollRef.current) return
            const latestTarget = getTargetElement()
            if (!latestTarget || !(latestTarget instanceof HTMLElement)) {
                releaseAutoScroll()
                return
            }
            if (isTargetInViewport(latestTarget.getBoundingClientRect())) {
                releaseAutoScroll()
                return
            }
            if (window.performance.now() - startedAt > 1600) {
                releaseAutoScroll()
                return
            }
            autoScrollTimeoutRef.current = window.setTimeout(settleAutoScroll, 60)
        }
        autoScrollTimeoutRef.current = window.setTimeout(settleAutoScroll, 60)
        return true
    }, [getTargetElement, isTargetInViewport])

    const adjustIntoView = useCallback(() => {
        if (isDraggingRef.current) return
        if (!cardRef.current || typeof window === "undefined") return
        ensureTargetInView()

        const rect = cardRef.current.getBoundingClientRect()
        const maxX = window.innerWidth - viewPadding
        const maxY = window.innerHeight - viewPadding
        let dx = 0
        let dy = 0

        if (rect.left < viewPadding) {
            dx = viewPadding - rect.left
        } else if (rect.right > maxX) {
            dx = maxX - rect.right
        }

        if (rect.top < viewPadding) {
            dy = viewPadding - rect.top
        } else if (rect.bottom > maxY) {
            dy = maxY - rect.bottom
        }

        if (dx === 0 && dy === 0) return

        setAutoOffset((prev) => ({x: prev.x + dx, y: prev.y + dy}))
    }, [ensureTargetInView, viewPadding])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingRef.current) return

            const dx = e.clientX - dragStartRef.current.x
            const dy = e.clientY - dragStartRef.current.y

            setUserOffset({
                x: dragStartRef.current.offsetX + dx,
                y: dragStartRef.current.offsetY + dy,
            })
        }

        const handleMouseUp = () => {
            if (!isDraggingRef.current) return
            isDraggingRef.current = false
            requestAnimationFrame(adjustIntoView)
        }

        window.addEventListener("mousemove", handleMouseMove)
        window.addEventListener("mouseup", handleMouseUp)

        return () => {
            window.removeEventListener("mousemove", handleMouseMove)
            window.removeEventListener("mouseup", handleMouseUp)
        }
    }, [adjustIntoView])

    // Reset offset on step change
    useEffect(() => {
        setUserOffset({x: 0, y: 0})
        setAutoOffset({x: 0, y: 0})
        autoScrollRef.current = false
        if (autoScrollTimeoutRef.current) {
            window.clearTimeout(autoScrollTimeoutRef.current)
            autoScrollTimeoutRef.current = null
        }
    }, [currentStep])

    const startClampPasses = useCallback(() => {
        if (clampRafRef.current) {
            cancelAnimationFrame(clampRafRef.current)
            clampRafRef.current = null
        }
        clampTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
        clampTimeoutsRef.current = []

        clampRafRef.current = requestAnimationFrame(adjustIntoView)
        clampTimeoutsRef.current.push(
            window.setTimeout(() => requestAnimationFrame(adjustIntoView), 160),
        )
        clampTimeoutsRef.current.push(
            window.setTimeout(() => requestAnimationFrame(adjustIntoView), 360),
        )
    }, [adjustIntoView])

    useLayoutEffect(() => {
        startClampPasses()
        return () => {
            if (clampRafRef.current) {
                cancelAnimationFrame(clampRafRef.current)
                clampRafRef.current = null
            }
            clampTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
            clampTimeoutsRef.current = []
            if (autoScrollTimeoutRef.current) {
                window.clearTimeout(autoScrollTimeoutRef.current)
                autoScrollTimeoutRef.current = null
            }
        }
    }, [currentStep, step, startClampPasses])

    useEffect(() => {
        const handleResize = () => {
            requestAnimationFrame(adjustIntoView)
        }

        window.addEventListener("resize", handleResize)
        window.addEventListener("scroll", adjustIntoView, true)
        requestAnimationFrame(adjustIntoView)

        return () => {
            window.removeEventListener("resize", handleResize)
            window.removeEventListener("scroll", adjustIntoView, true)
        }
    }, [adjustIntoView])

    // Step Lifecycle & Cleanup Management
    useEffect(() => {
        if (!step) return

        const getScrollParents = (element: Element) => {
            const parents: Element[] = []
            let current: Element | null = element

            while (current && current !== document.body && current !== document.documentElement) {
                const style = window.getComputedStyle(current)
                const overflowY = style.overflowY
                const overflowX = style.overflowX
                if (
                    overflowY === "auto" ||
                    overflowY === "scroll" ||
                    overflowX === "auto" ||
                    overflowX === "scroll"
                ) {
                    parents.push(current)
                }
                current = current.parentElement
            }

            const rootScroller = document.scrollingElement || document.documentElement
            if (rootScroller) {
                parents.push(rootScroller)
            }

            return parents
        }

        const target = getTargetElement()
        const scrollParents = target ? getScrollParents(target) : []
        const scrollPositions = new Map<Element, {top: number; left: number}>()
        scrollParents.forEach((parent) => {
            const el = parent as HTMLElement
            scrollPositions.set(parent, {top: el.scrollTop, left: el.scrollLeft})
        })

        const preventScroll = (event: Event) => {
            event.preventDefault()
        }

        const isTextInputTarget = (element: Element | null) => {
            if (!element) return false
            if (element instanceof HTMLTextAreaElement) return true
            if (element instanceof HTMLInputElement) {
                const nonTextTypes = new Set([
                    "button",
                    "checkbox",
                    "color",
                    "file",
                    "image",
                    "radio",
                    "range",
                    "reset",
                    "submit",
                ])
                return !nonTextTypes.has(element.type)
            }
            const htmlElement = element as HTMLElement
            if (htmlElement.isContentEditable) return true
            return Boolean(element.closest("input, textarea, [contenteditable='true']"))
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (isTextInputTarget(event.target as Element | null)) return
            const blockedKeys = [
                "ArrowUp",
                "ArrowDown",
                "PageUp",
                "PageDown",
                "Home",
                "End",
                " ",
                "Spacebar",
            ]
            if (blockedKeys.includes(event.key)) {
                event.preventDefault()
            }
        }

        const handleScroll = (event: Event) => {
            const targetEl = event.target as Element | null
            if (!targetEl) return
            const saved = scrollPositions.get(targetEl)
            if (!saved) return
            const el = targetEl as HTMLElement

            // Allow onboarding-driven scrollIntoView and update the lock baseline.
            if (autoScrollRef.current) {
                scrollPositions.set(targetEl, {top: el.scrollTop, left: el.scrollLeft})
                return
            }

            if (el.scrollTop !== saved.top) {
                el.scrollTop = saved.top
            }
            if (el.scrollLeft !== saved.left) {
                el.scrollLeft = saved.left
            }
        }

        window.addEventListener("wheel", preventScroll, {passive: false})
        window.addEventListener("touchmove", preventScroll, {passive: false})
        window.addEventListener("keydown", handleKeyDown)
        scrollParents.forEach((parent) =>
            parent.addEventListener("scroll", handleScroll, {passive: false}),
        )

        setCurrentStepState({step, currentStep, totalSteps})
        step.onEnter?.()
        autoAdvanceTriggeredRef.current = false

        return () => {
            step.onExit?.()
            step.onCleanup?.()
            window.removeEventListener("wheel", preventScroll)
            window.removeEventListener("touchmove", preventScroll)
            window.removeEventListener("keydown", handleKeyDown)
            scrollParents.forEach((parent) => parent.removeEventListener("scroll", handleScroll))
        }
    }, [getTargetElement, step, currentStep, totalSteps, setCurrentStepState])

    useEffect(() => {
        if (!hasValidStep) {
            skipTour?.()
        }
    }, [hasValidStep, skipTour])

    // Handle skip/complete
    const handleSkip = useCallback(() => {
        step.onCleanup?.()
        skipTour?.()
    }, [skipTour, step])

    const isElementVisible = (element: Element | null) => {
        if (!element || !(element instanceof HTMLElement)) return false
        const style = window.getComputedStyle(element)
        if (style.display === "none" || style.visibility === "hidden") return false
        return element.getClientRects().length > 0
    }

    const waitForSelectorReady = async (
        selector: string,
        requireVisible: boolean,
        timeoutMs = 2000,
        pollInterval = 100,
    ): Promise<boolean> => {
        const start = Date.now()

        return new Promise((resolve) => {
            const check = () => {
                try {
                    const element = document.querySelector(selector)
                    const isReady = requireVisible ? isElementVisible(element) : Boolean(element)
                    if (isReady) {
                        resolve(true)
                        return
                    }
                } catch (error) {
                    console.warn("[Onboarding] Invalid waitForSelector:", selector, error)
                    resolve(false)
                    return
                }

                if (Date.now() - start >= timeoutMs) {
                    resolve(false)
                    return
                }

                window.setTimeout(check, pollInterval)
            }

            check()
        })
    }

    const waitForSelectorHidden = async (
        selector: string,
        timeoutMs = 2000,
        pollInterval = 100,
    ): Promise<boolean> => {
        const start = Date.now()

        return new Promise((resolve) => {
            const check = () => {
                try {
                    const element = document.querySelector(selector)
                    if (!isElementVisible(element)) {
                        resolve(true)
                        return
                    }
                } catch (error) {
                    console.warn("[Onboarding] Invalid waitForHiddenSelector:", selector, error)
                    resolve(false)
                    return
                }

                if (Date.now() - start >= timeoutMs) {
                    resolve(false)
                    return
                }

                window.setTimeout(check, pollInterval)
            }

            check()
        })
    }

    const performStepAction = useCallback(
        async (
            action:
                | {
                      selector: string
                      type?: "click"
                      waitForSelector?: string
                      waitForSelectorVisible?: boolean
                      waitForHiddenSelector?: string
                      waitTimeoutMs?: number
                      waitPollInterval?: number
                      advanceOnActionClick?: boolean
                  }
                | undefined,
        ) => {
            if (!action) return true

            const {
                selector,
                type = "click",
                waitForSelector,
                waitForSelectorVisible = true,
                waitForHiddenSelector,
                waitTimeoutMs,
                waitPollInterval,
            } = action

            let target: HTMLElement | null = null
            try {
                target = document.querySelector(selector) as HTMLElement | null
            } catch (error) {
                console.warn("[Onboarding] Invalid step action selector:", selector, error)
                return false
            }

            if (!target) {
                console.warn("[Onboarding] Step action target not found:", selector)
                return false
            }

            if (target instanceof HTMLButtonElement && target.disabled) {
                console.warn("[Onboarding] Step action target is disabled:", selector)
                return false
            }

            if (type === "click") {
                target.click()
            }

            if (waitForSelector) {
                return waitForSelectorReady(
                    waitForSelector,
                    waitForSelectorVisible,
                    waitTimeoutMs ?? 2000,
                    waitPollInterval ?? 100,
                )
            }

            if (waitForHiddenSelector) {
                return waitForSelectorHidden(
                    waitForHiddenSelector,
                    waitTimeoutMs ?? 2000,
                    waitPollInterval ?? 100,
                )
            }

            return true
        },
        [],
    )

    const advanceStep = useCallback(async () => {
        if (!hasValidStep) {
            skipTour?.()
            return
        }
        try {
            await step?.onNext?.()
        } catch (error) {
            console.error("[Onboarding] onNext handler error:", error)
        }

        if (currentStep >= totalSteps - 1) {
            step?.onCleanup?.()
            skipTour?.()
        } else {
            nextStep()
        }
    }, [currentStep, hasValidStep, nextStep, skipTour, step, totalSteps])

    const handlePrev = useCallback(async () => {
        if (!hasValidStep) return
        try {
            await step?.onPrev?.()
        } catch (error) {
            console.error("[Onboarding] onPrev handler error:", error)
            return
        }
        const actionReady = await performStepAction(step?.prevAction)
        if (!actionReady) {
            return
        }
        prevStep()
    }, [hasValidStep, performStepAction, prevStep, step])

    // Handle next step
    const handleNext = useCallback(async () => {
        if (!hasValidStep) {
            skipTour?.()
            return
        }
        const actionReady = await performStepAction(step?.nextAction)
        if (!actionReady) {
            return
        }
        await advanceStep()
    }, [advanceStep, hasValidStep, performStepAction, skipTour, step?.nextAction])

    useEffect(() => {
        if (!step?.nextAction?.advanceOnActionClick) return

        let target: HTMLElement | null = null
        try {
            target = document.querySelector(step.nextAction.selector) as HTMLElement | null
        } catch (error) {
            console.warn(
                "[Onboarding] Invalid step action selector:",
                step.nextAction.selector,
                error,
            )
            return
        }

        if (!target) return

        const handleActionClick = async (event: Event) => {
            if (!(event instanceof MouseEvent) || !event.isTrusted) return
            if (autoAdvanceTriggeredRef.current) return
            autoAdvanceTriggeredRef.current = true

            const {
                waitForSelector,
                waitForSelectorVisible,
                waitForHiddenSelector,
                waitTimeoutMs,
                waitPollInterval,
            } = step.nextAction ?? {}

            if (waitForSelector) {
                const ready = await waitForSelectorReady(
                    waitForSelector,
                    waitForSelectorVisible ?? true,
                    waitTimeoutMs ?? 2000,
                    waitPollInterval ?? 100,
                )
                if (!ready) return
            }

            if (waitForHiddenSelector) {
                const ready = await waitForSelectorHidden(
                    waitForHiddenSelector,
                    waitTimeoutMs ?? 2000,
                    waitPollInterval ?? 100,
                )
                if (!ready) return
            }

            await advanceStep()
        }

        target.addEventListener("click", handleActionClick)

        return () => {
            target?.removeEventListener("click", handleActionClick)
        }
    }, [advanceStep, step, waitForSelectorReady, waitForSelectorHidden])

    // UI Helpers
    const labels = step?.controlLabels ?? {}
    const progressPercent = hasValidStep ? Math.round(((currentStep + 1) / totalSteps) * 100) : 0

    // Arrow Styling
    // We clone the arrow element to apply custom styles (white color)
    // ensuring it matches the card theme
    const adjustedArrow = useMemo(() => {
        if (!isValidElement(arrow)) return null

        // Safe prop access with type assertion
        const element = arrow as ReactElement<{style?: CSSProperties}>
        const baseStyle = element.props?.style || {}

        return cloneElement(element, {
            style: {
                ...baseStyle,
                color: "#ffffff",
                backgroundColor: "white",
            },
        })
    }, [arrow])

    const showControls = step?.showControls ?? true
    const showSkip = step?.showSkip ?? true
    const totalOffset = useMemo(
        () => ({x: userOffset.x + autoOffset.x, y: userOffset.y + autoOffset.y}),
        [autoOffset.x, autoOffset.y, userOffset.x, userOffset.y],
    )

    if (!hasValidStep) {
        return null
    }

    return (
        <section
            ref={cardRef}
            className="w-[340px] max-w-[calc(100vw-24px)]"
            style={{
                transform: `translate(${totalOffset.x}px, ${totalOffset.y}px)`,
                // Add explicit 'will-change' for performance hint
                willChange: "transform",
                // Only animate when NOT dragging to avoid lag
                transition: isDraggingRef.current ? "none" : "transform 0.1s ease-out",
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
                            <div className="h-1.5 w-full rounded-full bg-gray-200">
                                <div
                                    className="h-full rounded-full bg-colorPrimary transition-all duration-300"
                                    style={{width: `${progressPercent}%`}}
                                />
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Button
                                    onClick={handlePrev}
                                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                                    disabled={currentStep === 0}
                                    className="!text-xs !h-[26px] rounded-lg !border-colorBorder hover:!border-colorBorder bg-white text-colorText hover:!text-colorTextSecondary"
                                    size="small"
                                >
                                    {labels.previous ?? "Previous"}
                                </Button>

                                <Button
                                    type="primary"
                                    onClick={handleNext}
                                    icon={<ArrowRight size={14} className="mt-0.5" />}
                                    iconPosition="end"
                                    className="!text-xs !h-[26px] bg-colorPrimary hover:!bg-colorPrimaryHover rounded-lg"
                                    size="small"
                                >
                                    {currentStep < totalSteps - 1
                                        ? (labels.next ?? "Next")
                                        : (labels.finish ?? "Got it")}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

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

                {/* Arrow - hide if user has moved the card */}
                {adjustedArrow && userOffset.x === 0 && userOffset.y === 0 && (
                    <div className="mt-2 flex w-full justify-center !bg-white">{adjustedArrow}</div>
                )}
            </Card>
        </section>
    )
}

export default OnboardingCard
