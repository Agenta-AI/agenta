import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {CheckCircle, Circle, Question, X} from "@phosphor-icons/react"
import {Button, Modal, Progress, Tooltip} from "antd"
import clsx from "clsx"
import {getDefaultStore, useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {
    isNewUserAtom,
    triggerOnboardingAtom,
    userOnboardingStatusAtom,
} from "@/oss/state/onboarding"
import {userAtom} from "@/oss/state/profile"
import {sessionExistsAtom} from "@/oss/state/session"
import {
    currentRunningWidgetOnboardingAtom,
    onboardingWidgetClosedAtom,
    onboardingWidgetCompletionAtom,
    onboardingWidgetSkippedAtom,
    onboardingWidgetPositionAtom,
    type OnboardingWidgetPosition,
} from "@/oss/state/onboarding/atoms/widgetAtom"
import {
    trackOnboardingAllTasksCompleted,
    trackOnboardingGuideClosed,
    trackOnboardingTaskCompleted,
} from "../../utils/trackOnboarding"
import {BOUNDARY_PADDING} from "./constants"
import {type ChecklistItem} from "./types"
import {buildChecklistSections, clamp} from "./utils"

type ElementSize = {width: number; height: number}

const DEFAULT_WIDGET_SIZE: ElementSize = {width: 280, height: 360}

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
    const [skippedMap, setSkippedMap] = useAtom(onboardingWidgetSkippedAtom)
    const [currentRunningWidgetOnboarding, setCurrentRunningWidgetOnboarding] = useAtom(
        currentRunningWidgetOnboardingAtom,
    )
    const [storedPosition, setStoredPosition] = useAtom(onboardingWidgetPositionAtom)
    const [isClosed, setIsClosed] = useAtom(onboardingWidgetClosedAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const userOnboardingStatus = useAtomValue(userOnboardingStatusAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const sessionExists = useAtomValue(sessionExistsAtom)
    const user = useAtomValue(userAtom)
    const canInitializeVisibility = sessionExists && Boolean(user)

    const widgetRef = useRef<HTMLDivElement | null>(null)
    const dragStateRef = useRef<{
        offsetX: number
        offsetY: number
        width: number
        height: number
    } | null>(null)
    const appliedVisibilityStateRef = useRef<boolean | null>(null)
    const autoOpenedRef = useRef(false)
    const autoClosedRef = useRef(false)
    const [isDragging, setIsDragging] = useState(false)
    const [widgetSize, setWidgetSize] = useState<ElementSize | null>(null)
    const store = useMemo(() => getDefaultStore(), [])

    const shouldRenderWidget = !isClosed

    useEffect(() => {
        if (!canInitializeVisibility) return
        if (appliedVisibilityStateRef.current) return

        if (isNewUser && !isClosed) {
            setIsClosed(false)
            autoOpenedRef.current = true
            autoClosedRef.current = false
        }

        appliedVisibilityStateRef.current = true
    }, [canInitializeVisibility, isClosed, isNewUser, setIsClosed])

    // marking widget onboarding as completed
    useEffect(() => {
        if (!currentRunningWidgetOnboarding) return
        const {section, completionKey, initialStatus} = currentRunningWidgetOnboarding
        const currentStatus = userOnboardingStatus[section]
        if (currentStatus === initialStatus) return
        if (currentStatus === "idle") return
        if (completedMap[completionKey]) return

        setCompletedMap((prev) => {
            const next = {...prev, [completionKey]: true}
            trackOnboardingTaskCompleted({
                ...buildBasePayload(),
                completed_tasks: Object.keys(next).length,
                task_id: completionKey,
            })
            return next
        })

        setCurrentRunningWidgetOnboarding(null)
    }, [currentRunningWidgetOnboarding, userOnboardingStatus, completedMap, skippedMap])

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

    const skippedCount = useMemo(() => {
        return allItems.reduce(
            (count, item) => (skippedMap[getCompletionKey(item)] ? count + 1 : count),
            0,
        )
    }, [allItems, skippedMap, getCompletionKey])

    const buildBasePayload = useCallback(
        () => ({
            total_tasks: totalTasks,
            completed_tasks: completedCount,
            skipped_tasks: skippedCount,
        }),
        [totalTasks, completedCount, skippedCount],
    )
    const progressPercent = totalTasks ? Math.round((completedCount / totalTasks) * 100) : 0
    const totalDone = completedCount + skippedCount

    useEffect(() => {
        if (!canInitializeVisibility) return
        if (!isNewUser) return
        if (!autoOpenedRef.current) return
        if (autoClosedRef.current) return
        if (!totalTasks) return
        if (totalDone < totalTasks) return

        if (!autoClosedRef.current) {
            trackOnboardingAllTasksCompleted(buildBasePayload())
            trackOnboardingGuideClosed({
                ...buildBasePayload(),
                close_reason: "auto_all_done",
            })
        }

        setIsClosed(true)
        autoClosedRef.current = true
    }, [canInitializeVisibility, isNewUser, totalDone, totalTasks])

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
                setCompletedMap((prev) => {
                    const next = {...prev, [completionKey]: true}
                    trackOnboardingTaskCompleted({
                        ...buildBasePayload(),
                        completed_tasks: Object.keys(next).length,
                        task_id: completionKey,
                    })
                    return next
                })
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
            buildBasePayload,
            trackOnboardingTaskCompleted,
        ],
    )

    const onClose = useCallback(() => {
        setIsClosed(true)
        trackOnboardingGuideClosed({
            ...buildBasePayload(),
            close_reason: "manual",
        })
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

    const getWidgetSize = useCallback(() => widgetSize ?? DEFAULT_WIDGET_SIZE, [widgetSize])

    const clampToViewport = useCallback((position: OnboardingWidgetPosition, size: ElementSize) => {
        const maxX = Math.max(BOUNDARY_PADDING, window.innerWidth - size.width - BOUNDARY_PADDING)
        const maxY = Math.max(BOUNDARY_PADDING, window.innerHeight - size.height - BOUNDARY_PADDING)
        return {
            x: clamp(position.x, BOUNDARY_PADDING, maxX),
            y: clamp(position.y, BOUNDARY_PADDING, maxY),
        }
    }, [])

    useEffect(() => {
        if (!widgetRef.current) return
        const element = widgetRef.current
        const updateSize = () => {
            const rect = element.getBoundingClientRect()
            setWidgetSize({width: rect.width, height: rect.height})
        }
        updateSize()
        const observer = new ResizeObserver(updateSize)
        observer.observe(element)
        return () => observer.disconnect()
    }, [shouldRenderWidget])

    useEffect(() => {
        const handleResize = () => {
            setStoredPosition((prev) => {
                if (!prev) return prev
                const clamped = clampToViewport(prev, getWidgetSize())
                return clamped.x === prev.x && clamped.y === prev.y ? prev : clamped
            })
        }

        handleResize()
        window.addEventListener("resize", handleResize)
        return () => window.removeEventListener("resize", handleResize)
    }, [clampToViewport, getWidgetSize, setStoredPosition])

    useEffect(() => {
        if (!isDragging) return

        const handlePointerMove = (event: PointerEvent) => {
            if (!dragStateRef.current) return
            const {offsetX, offsetY, width, height} = dragStateRef.current
            const maxX = Math.max(BOUNDARY_PADDING, window.innerWidth - width - BOUNDARY_PADDING)
            const maxY = Math.max(BOUNDARY_PADDING, window.innerHeight - height - BOUNDARY_PADDING)
            const nextX = clamp(event.clientX - offsetX, BOUNDARY_PADDING, maxX)
            const nextY = clamp(event.clientY - offsetY, BOUNDARY_PADDING, maxY)
            setStoredPosition({x: nextX, y: nextY})
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
    }, [isDragging, stopDragging, setStoredPosition])

    useEffect(() => {
        if (!isDragging) return
        const previousUserSelect = document.body.style.userSelect
        document.body.style.userSelect = "none"
        return () => {
            document.body.style.userSelect = previousUserSelect
        }
    }, [isDragging])

    const containerStyle: React.CSSProperties = {
        position: "fixed",
        zIndex: 900,
        ...(storedPosition
            ? {top: storedPosition.y, left: storedPosition.x}
            : {bottom: BOUNDARY_PADDING, right: BOUNDARY_PADDING}),
    }

    return (
        <>
            {shouldRenderWidget && (
                <div ref={widgetRef} style={containerStyle} className="pointer-events-auto">
                    <section
                        className={clsx(
                            "w-[250px] max-w-[calc(100vw-32px)] rounded-xl border border-solid border-gray-100 bg-white shadow-2xl flex flex-col gap-3",
                            {"select-none": isDragging},
                        )}
                    >
                        <div
                            className="flex flex-col gap-2 border-0 border-b border-solid border-gray-100 px-4 pt-3 pb-1 cursor-move"
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

                            <Progress className="" percent={progressPercent} status="active" />
                        </div>

                        <div className="max-h-[400px] overflow-y-auto px-4 pb-3 flex flex-col gap-2">
                            {sections.map((section) => (
                                <div key={section.id} className="mb-0 last:mb-0 flex flex-col gap-1">
                                    <div className="flex items-center gap-1 font-medium text-colorTextSecondary">
                                        <Question size={14} />
                                        {section.title}
                                    </div>
                                    <div className="flex flex-col gap-1">
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
                                                        "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition hover:shadow",
                                                        {
                                                            "border-colorBorder bg-white hover:border-colorPrimary cursor-pointer":
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
                                                            "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border",
                                                            {
                                                                "border-colorPrimary bg-colorPrimary text-white":
                                                                    isCompleted,
                                                                "border-colorBorder bg-white text-colorTextSecondary":
                                                                    !isCompleted,
                                                            },
                                                        )}
                                                    >
                                                        {isCompleted ? (
                                                            <CheckCircle size={14} weight="fill" />
                                                        ) : (
                                                            <Circle size={14} />
                                                        )}
                                                    </span>

                                                    <span className="text-xs font-medium text-colorText">
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
        </>
    )
}

export default OnboardingWidget
