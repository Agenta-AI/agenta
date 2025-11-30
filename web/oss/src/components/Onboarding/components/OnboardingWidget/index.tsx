import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {CheckCircle, Circle, Minus, Question, X} from "@phosphor-icons/react"
import {Button, Modal, Progress, Tooltip} from "antd"
import clsx from "clsx"
import {getDefaultStore, useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {
    currentOnboardingStepWithLocationAtom,
    isNewUserAtom,
    triggerOnboardingAtom,
    UserOnboardingStatus,
    userOnboardingStatusAtom,
} from "@/oss/state/onboarding"
import {userAtom} from "@/oss/state/profile"
import {sessionExistsAtom} from "@/oss/state/session"
import {
    currentRunningWidgetOnboardingAtom,
    onboardingWidgetClosedAtom,
    onboardingWidgetCompletionAtom,
    onboardingWidgetMinimizedAtom,
    onboardingWidgetMinimizeHintAtom,
    onboardingWidgetPositionAtom,
    onboardingWidgetTogglePositionAtom,
    type OnboardingWidgetPosition,
} from "@/oss/state/onboarding/atoms/widgetAtom"
import {BOUNDARY_PADDING, CLOSING_ANIMATION_MS, TOGGLE_DRAG_THRESHOLD} from "./constants"
import {type ChecklistItem} from "./types"
import {buildChecklistSections, clamp} from "./utils"

const normalizeRoutePath = (value: string) => {
    if (!value) return ""
    const withoutOrigin = value.replace(/^https?:\/\/[^/]+/i, "")
    const [pathWithQuery] = withoutOrigin.split("#")
    const [path, query] = pathWithQuery.split("?")
    if (!path || path === "/") {
        return query ? `/?${query}` : "/"
    }
    const normalizedPath = path.replace(/\/+$/, "")
    return query ? `${normalizedPath}?${query}` : normalizedPath
}

export const setCompleteWidgetTaskMap = (key: string) => {
    const store = getDefaultStore()
    store.set(onboardingWidgetCompletionAtom, (prev) => ({
        ...prev,
        [key]: true,
    }))
}

const OnboardingWidget = () => {
    const router = useRouter()
    const {projectURL, appURL, recentlyVisitedAppURL} = useURL()
    const [completedMap, setCompletedMap] = useAtom(onboardingWidgetCompletionAtom)
    const [isMinimized, setIsMinimized] = useAtom(onboardingWidgetMinimizedAtom)
    const [currentRunningWidgetOnboarding, setCurrentRunningWidgetOnboarding] = useAtom(
        currentRunningWidgetOnboardingAtom,
    )
    const [hasSeenMinimizeHint, setHasSeenMinimizeHint] = useAtom(onboardingWidgetMinimizeHintAtom)
    const [storedPosition, setStoredPosition] = useAtom(onboardingWidgetPositionAtom)
    const [toggleStoredPosition, setToggleStoredPosition] = useAtom(
        onboardingWidgetTogglePositionAtom,
    )
    const [isClosed, setIsClosed] = useAtom(onboardingWidgetClosedAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const userOnboardingStatus = useAtomValue(userOnboardingStatusAtom)
    const currentTourStep = useAtomValue(currentOnboardingStepWithLocationAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const sessionExists = useAtomValue(sessionExistsAtom)
    const user = useAtomValue(userAtom)
    const canInitializeVisibility = sessionExists && Boolean(user)

    const widgetRef = useRef<HTMLDivElement | null>(null)
    const toggleRef = useRef<HTMLDivElement | null>(null)
    const dragStateRef = useRef<{
        offsetX: number
        offsetY: number
        width: number
        height: number
    } | null>(null)
    const toggleDragStateRef = useRef<{
        offsetX: number
        offsetY: number
        width: number
        height: number
        startX: number
        startY: number
    } | null>(null)
    const toggleMovedRef = useRef(false)
    const toggleIgnoreClickRef = useRef(false)
    const wasMinimizedBeforeTourRef = useRef<boolean | null>(null)
    const appliedVisibilityStateRef = useRef<boolean | null>(null)
    const autoOpenedRef = useRef(false)
    const autoClosedRef = useRef(false)
    const [isDragging, setIsDragging] = useState(false)
    const [isDraggingToggle, setIsDraggingToggle] = useState(false)
    const [isClosing, setIsClosing] = useState(false)

    useEffect(() => {
        if (!isClosing) return
        const timeout = window.setTimeout(() => {
            setIsClosing(false)
        }, CLOSING_ANIMATION_MS)
        return () => window.clearTimeout(timeout)
    }, [isClosing])

    useEffect(() => {
        if (!canInitializeVisibility) return
        if (appliedVisibilityStateRef.current === isNewUser) return

        if (isNewUser) {
            setIsClosed(false)
            setIsMinimized(false)
            autoOpenedRef.current = true
            autoClosedRef.current = false
        } else {
            setIsClosed(true)
            setIsMinimized(true)
            autoOpenedRef.current = false
            autoClosedRef.current = false
        }

        appliedVisibilityStateRef.current = isNewUser
    }, [canInitializeVisibility, isNewUser, setIsClosed, setIsMinimized])

    useEffect(() => {
        // Minimize the widget while a tour is actively showing a step,
        // and restore it to its previous state once the tour finishes or is skipped.
        if (currentTourStep?.selector) {
            if (wasMinimizedBeforeTourRef.current === null) {
                wasMinimizedBeforeTourRef.current = isMinimized
            }

            if (!isMinimized) {
                onMinimize()
            }

            return
        }

        if (!currentTourStep?.selector && wasMinimizedBeforeTourRef.current !== null) {
            const wasMinimizedBeforeTour = wasMinimizedBeforeTourRef.current
            wasMinimizedBeforeTourRef.current = null

            if (!wasMinimizedBeforeTour) {
                onRestore()
            }
        }
    }, [currentTourStep, isMinimized])

    // // marking widget onboarding as completed
    useEffect(() => {
        if (!currentRunningWidgetOnboarding) return
        const {section, completionKey, initialStatus} = currentRunningWidgetOnboarding
        const currentStatus = userOnboardingStatus[section]
        if (currentStatus === initialStatus) return
        if (currentStatus === "idle") return
        if (completedMap[completionKey]) return

        setCompletedMap((prev) => ({
            ...prev,
            [completionKey]: true,
        }))
        setCurrentRunningWidgetOnboarding(null)
    }, [currentRunningWidgetOnboarding, userOnboardingStatus, completedMap, setCompletedMap])

    const sections = useMemo(
        () =>
            buildChecklistSections({
                projectURL,
                appURL,
                recentlyVisitedAppURL,
            }),
        [projectURL, appURL, recentlyVisitedAppURL],
    )

    const getCompletionKey = useCallback(
        (item: ChecklistItem) => item.tour?.tourId ?? item.tour?.section ?? item.id,
        [],
    )

    const allItems = useMemo(
        () => sections.reduce<ChecklistItem[]>((acc, section) => acc.concat(section.items), []),
        [sections],
    )
    const totalTasks = allItems.length
    const completedCount = useMemo(() => {
        return allItems.reduce(
            (count, item) => (completedMap[getCompletionKey(item)] ? count + 1 : count),
            0,
        )
    }, [allItems, completedMap, getCompletionKey])
    const progressPercent = totalTasks ? Math.round((completedCount / totalTasks) * 100) : 0

    useEffect(() => {
        if (!canInitializeVisibility) return
        if (!isNewUser) return
        if (!autoOpenedRef.current) return
        if (autoClosedRef.current) return
        if (!totalTasks) return
        if (completedCount < totalTasks) return

        setIsClosed(true)
        setIsMinimized(true)
        autoClosedRef.current = true
    }, [
        canInitializeVisibility,
        isNewUser,
        completedCount,
        totalTasks,
        setIsClosed,
        setIsMinimized,
    ])

    const onClickGuideItem = useCallback(
        async (item: ChecklistItem) => {
            if (item.disabled) return

            const navigateIfNeeded = async () => {
                if (!item.href) return true
                const currentPath = normalizeRoutePath(router.asPath)
                const targetPath = normalizeRoutePath(item.href)
                if (currentPath === targetPath) {
                    return true
                }
                try {
                    await router.push(item.href)
                    return true
                } catch (error) {
                    console.error("Failed to navigate to onboarding target", error)
                    return false
                }
            }

            const navigationCompleted = await navigateIfNeeded()
            if (!navigationCompleted) return

            const completionKey = getCompletionKey(item)
            if (!item.tour) {
                setCompletedMap((prev) => ({...prev, [completionKey]: true}))
                return
            }

            setTriggerOnboarding({state: item.tour.section, tourId: item.tour?.tourId})
            setCurrentRunningWidgetOnboarding({
                section: item.tour.section,
                completionKey,
                initialStatus: userOnboardingStatus[item.tour.section],
            })
        },
        [
            router,
            setCompletedMap,
            setTriggerOnboarding,
            setCurrentRunningWidgetOnboarding,
            getCompletionKey,
            userOnboardingStatus,
        ],
    )

    const onMinimize = useCallback(() => {
        if (isClosing) return

        setIsMinimized(true)

        if (!hasSeenMinimizeHint) {
            setHasSeenMinimizeHint(true)
        }
    }, [hasSeenMinimizeHint, isClosing, setHasSeenMinimizeHint, setIsMinimized])

    const onRestore = useCallback(() => {
        setIsMinimized(false)
    }, [setIsMinimized])

    const onClose = useCallback(() => {
        setIsClosed(true)
        Modal.info({
            title: "Onboarding guide hidden",
            content: (
                <p className="mb-0">
                    You can reopen the Onboarding Guide anytime from the sidebar under{" "}
                    <strong>Help &amp; Docs → Onboarding Guide</strong>.
                </p>
            ),
            okText: "Got it",
        })
    }, [setIsClosed])

    const startDragging = useCallback((event: React.PointerEvent) => {
        if (event.button !== 0) return
        if (!widgetRef.current) return
        event.preventDefault()
        event.stopPropagation()
        const rect = widgetRef.current.getBoundingClientRect()
        dragStateRef.current = {
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width,
            height: rect.height,
        }
        setIsDragging(true)
    }, [])

    const stopDragging = useCallback(() => {
        if (!isDragging) return
        setIsDragging(false)
        dragStateRef.current = null
    }, [isDragging, setStoredPosition])

    useEffect(() => {
        if (!isDragging) return

        const handlePointerMove = (event: PointerEvent) => {
            if (!dragStateRef.current) return
            const {offsetX, offsetY, width, height} = dragStateRef.current
            const maxX = Math.max(BOUNDARY_PADDING, window.innerWidth - width - BOUNDARY_PADDING)
            const maxY = Math.max(BOUNDARY_PADDING, window.innerHeight - height - BOUNDARY_PADDING)
            const nextX = clamp(event.clientX - offsetX, BOUNDARY_PADDING, maxX)
            const nextY = clamp(event.clientY - offsetY, BOUNDARY_PADDING, maxY)
            const nextPosition: OnboardingWidgetPosition = {x: nextX, y: nextY}
            setStoredPosition(nextPosition)
        }

        const handlePointerUp = () => {
            stopDragging()
        }

        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", handlePointerUp)

        return () => {
            window.removeEventListener("pointermove", handlePointerMove)
            window.removeEventListener("pointerup", handlePointerUp)
        }
    }, [isDragging, stopDragging])

    const startToggleDragging = useCallback(
        (event: React.PointerEvent) => {
            if (event.button !== 0) return
            if (!toggleRef.current) return
            const rect = toggleRef.current.getBoundingClientRect()
            toggleDragStateRef.current = {
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
                width: rect.width,
                height: rect.height,
                startX: event.clientX,
                startY: event.clientY,
            }
            toggleMovedRef.current = false
            setIsDraggingToggle(true)
        },
        [setIsDraggingToggle],
    )

    const stopToggleDragging = useCallback(() => {
        if (!isDraggingToggle) return
        setIsDraggingToggle(false)
        toggleIgnoreClickRef.current = toggleMovedRef.current
        toggleDragStateRef.current = null
        window.setTimeout(() => {
            toggleIgnoreClickRef.current = false
            toggleMovedRef.current = false
        }, 0)
    }, [isDraggingToggle, setToggleStoredPosition])

    useEffect(() => {
        if (!isDraggingToggle) return

        const handlePointerMove = (event: PointerEvent) => {
            if (!toggleDragStateRef.current) return
            const {offsetX, offsetY, width, height, startX, startY} = toggleDragStateRef.current
            if (!toggleMovedRef.current) {
                const dx = event.clientX - startX
                const dy = event.clientY - startY
                if (Math.abs(dx) + Math.abs(dy) > TOGGLE_DRAG_THRESHOLD) {
                    toggleMovedRef.current = true
                }
            }
            const maxX = Math.max(BOUNDARY_PADDING, window.innerWidth - width - BOUNDARY_PADDING)
            const maxY = Math.max(BOUNDARY_PADDING, window.innerHeight - height - BOUNDARY_PADDING)
            const nextX = clamp(event.clientX - offsetX, BOUNDARY_PADDING, maxX)
            const nextY = clamp(event.clientY - offsetY, BOUNDARY_PADDING, maxY)
            const nextPosition: OnboardingWidgetPosition = {x: nextX, y: nextY}
            setToggleStoredPosition(nextPosition)
        }

        const handlePointerUp = () => {
            stopToggleDragging()
        }

        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", handlePointerUp)

        return () => {
            window.removeEventListener("pointermove", handlePointerMove)
            window.removeEventListener("pointerup", handlePointerUp)
        }
    }, [isDraggingToggle, stopToggleDragging])

    useEffect(() => {
        if (!isDragging && !isDraggingToggle) return
        const previousUserSelect = document.body.style.userSelect
        document.body.style.userSelect = "none"
        return () => {
            document.body.style.userSelect = previousUserSelect
        }
    }, [isDragging, isDraggingToggle])

    const containerStyle: React.CSSProperties = {
        position: "fixed",
        zIndex: 900,
        ...(storedPosition
            ? {top: storedPosition.y, left: storedPosition.x}
            : {bottom: BOUNDARY_PADDING, right: BOUNDARY_PADDING}),
    }

    const togglePositionStyle: React.CSSProperties = {
        position: "fixed",
        zIndex: 900,
        ...(toggleStoredPosition
            ? {top: toggleStoredPosition.y, left: toggleStoredPosition.x}
            : {bottom: BOUNDARY_PADDING, right: BOUNDARY_PADDING}),
    }

    const shouldRenderWidget = !isClosed && (!isMinimized || isClosing)
    const showToggleButton = !isClosed && isMinimized && !isClosing

    return (
        <>
            {shouldRenderWidget && (
                <div ref={widgetRef} style={containerStyle} className="pointer-events-auto">
                    <section
                        className={clsx(
                            "w-[280px] max-w-[calc(100vw-32px)] rounded-2xl border border-colorBorder bg-white shadow-2xl transition-all duration-300 ease-in-out",
                            {
                                "select-none": isDragging,
                                "pointer-events-none translate-y-3 scale-95 opacity-0": isClosing,
                                "translate-y-3 scale-95 opacity-0": isMinimized,
                            },
                        )}
                    >
                        <div
                            className="flex flex-col gap-2 border-b border-colorBorder px-4 pt-3 pb-1 cursor-move"
                            onPointerDown={startDragging}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex flex-col">
                                    <span className="text-sm font-semibold text-colorText">
                                        Onboarding Guide
                                    </span>
                                    <span className="text-xs text-colorTextSecondary">
                                        {completedCount} of {totalTasks} tasks completed
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Tooltip title="Hide guide">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Minus size={16} />}
                                            aria-label="Minimize onboarding guide"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                onMinimize()
                                            }}
                                            className="!text-colorTextSecondary hover:!text-colorText"
                                        />
                                    </Tooltip>
                                    <Tooltip title="Close guide">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<X size={16} />}
                                            aria-label="Close onboarding guide"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                onClose()
                                            }}
                                            className="!text-colorTextSecondary hover:!text-colorText"
                                        />
                                    </Tooltip>
                                </div>
                            </div>
                            <div className="">
                                <Progress className="" percent={progressPercent} status="active" />
                            </div>
                        </div>

                        <div className="max-h-[400px] overflow-y-auto px-4 pb-3 flex flex-col gap-2">
                            {sections.map((section) => (
                                <div key={section.id} className="mb-4 last:mb-0">
                                    <div className="flex items-center gap-1 font-medium text-colorTextSecondary">
                                        <Question size={14} />
                                        {section.title}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {section.items.map((item) => {
                                            const isCompleted = Boolean(
                                                completedMap[getCompletionKey(item)],
                                            )
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    disabled={item.disabled}
                                                    onClick={() => onClickGuideItem(item)}
                                                    className={clsx(
                                                        "flex w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-left transition hover:shadow",
                                                        {
                                                            "border-colorBorder bg-white hover:border-colorPrimary":
                                                                !isCompleted && !item.disabled,
                                                            "border-colorPrimary bg-[#f5f7fa]":
                                                                isCompleted,
                                                            "cursor-not-allowed opacity-60":
                                                                item.disabled,
                                                        },
                                                    )}
                                                >
                                                    <span
                                                        className={clsx(
                                                            "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border",
                                                            {
                                                                "border-colorPrimary bg-colorPrimary text-white":
                                                                    isCompleted,
                                                                "border-colorBorder bg-white text-colorTextSecondary":
                                                                    !isCompleted,
                                                            },
                                                        )}
                                                    >
                                                        {isCompleted ? (
                                                            <CheckCircle size={16} weight="fill" />
                                                        ) : (
                                                            <Circle size={16} />
                                                        )}
                                                    </span>

                                                    <span className="text-sm font-medium text-colorText">
                                                        {item.title}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            )}

            {showToggleButton && (
                <div ref={toggleRef} style={togglePositionStyle} className="pointer-events-auto">
                    <Button
                        type="primary"
                        icon={<Question size={20} />}
                        className={clsx(
                            "flex items-center gap-2 rounded-full duration-200 !w-[30px] h-[30px]",
                            {"cursor-grabbing": isDraggingToggle, "cursor-grab": !isDraggingToggle},
                        )}
                        onPointerDown={startToggleDragging}
                        onClick={(event) => {
                            if (toggleIgnoreClickRef.current) {
                                event.preventDefault()
                                return
                            }
                            onRestore()
                        }}
                    />
                </div>
            )}
        </>
    )
}

export default OnboardingWidget
