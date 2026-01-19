"use client"

import {useCallback, useEffect, useMemo, useRef} from "react"

import {useNextStep} from "@agentaai/nextstepjs"
import {CaretDown, CaretUp, RocketLaunch, X} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useSession} from "@/oss/hooks/useSession"
import {
    activeTourIdAtom,
    hasSeenCloseTooltipAtom,
    isNewUserAtom,
    onboardingWidgetCompletionAtom,
    onboardingWidgetConfigAtom,
    onboardingWidgetEventsAtom,
    onboardingWidgetExpandedSectionsAtom,
    onboardingWidgetStatusAtom,
    onboardingWidgetUIStateAtom,
    recordWidgetEventAtom,
    setOnboardingWidgetConfigAtom,
    setWidgetSectionExpandedAtom,
    tourRegistry,
    type OnboardingWidgetItem,
} from "@/oss/lib/onboarding"

import {registerWidgetClosedTour} from "../tours/widgetClosedTour"

import {
    trackWidgetClosed,
    trackWidgetOpened,
    trackWidgetTaskClicked,
    trackWidgetTaskCompleted,
    trackWidgetTaskEventRecorded,
} from "./analytics"
import {WidgetSection} from "./components"
import {WIDGET_DEFAULT_CONFIG, WIDGET_HEADER_TITLE} from "./constants"

const {Text} = Typography

const OnboardingWidget = () => {
    const router = useRouter()
    const {doesSessionExist} = useSession()
    const config = useAtomValue(onboardingWidgetConfigAtom)
    const widgetStatus = useAtomValue(onboardingWidgetStatusAtom)
    const setWidgetStatus = useSetAtom(onboardingWidgetStatusAtom)
    const widgetUIState = useAtomValue(onboardingWidgetUIStateAtom)
    const setWidgetConfig = useSetAtom(setOnboardingWidgetConfigAtom)
    const setWidgetUIState = useSetAtom(onboardingWidgetUIStateAtom)
    const expandedSections = useAtomValue(onboardingWidgetExpandedSectionsAtom)
    const setSectionExpanded = useSetAtom(setWidgetSectionExpandedAtom)
    const completionMap = useAtomValue(onboardingWidgetCompletionAtom)
    const widgetEvents = useAtomValue(onboardingWidgetEventsAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const hasSeenCloseTooltip = useAtomValue(hasSeenCloseTooltipAtom)
    const setHasSeenCloseTooltip = useSetAtom(hasSeenCloseTooltipAtom)
    const activeTourId = useAtomValue(activeTourIdAtom)
    const setActiveTourId = useSetAtom(activeTourIdAtom)
    const {startNextStep, isNextStepVisible} = useNextStep()

    const allItems = useMemo(
        () => config.sections.flatMap((section) => section.items),
        [config.sections],
    )

    const totalTasks = allItems.length
    const completedTasks = useMemo(() => {
        return allItems.filter((item) => completionMap[item.id]).length
    }, [allItems, completionMap])

    const completedEventCount = useMemo(() => Object.keys(widgetEvents).length, [widgetEvents])

    // Widget only renders for authenticated new users who haven't dismissed it
    const shouldRender =
        doesSessionExist &&
        isNewUser &&
        widgetStatus !== "dismissed" &&
        widgetUIState.isOpen &&
        totalTasks > 0

    const hasTrackedOpenRef = useRef(false)

    const startTour = useCallback(
        (tourId: string) => {
            if (!tourRegistry.has(tourId)) {
                console.warn(`[Onboarding] Tour "${tourId}" not found in registry`)
                return
            }

            if (isNextStepVisible && activeTourId && activeTourId !== tourId) {
                console.warn(`[Onboarding] Another tour is active, skipping "${tourId}"`)
                return
            }

            setActiveTourId(tourId)
            startNextStep(tourId)
        },
        [activeTourId, isNextStepVisible, setActiveTourId, startNextStep],
    )

    const handleItemClick = useCallback(
        async (item: OnboardingWidgetItem) => {
            if (item.disabled) return

            trackWidgetTaskClicked(item)

            if (item.activationHint) {
                recordWidgetEvent(`activation:${item.activationHint}`)
            }

            if (item.href) {
                try {
                    await router.push(item.href)
                } catch (error) {
                    console.error("Failed to navigate to onboarding target", error)
                    return
                }
            }

            if (item.tourId) {
                startTour(item.tourId)
            }
        },
        [recordWidgetEvent, router, startTour],
    )

    const toggleSection = useCallback(
        (sectionId: string) => {
            // Default to collapsed (false) if not set
            const isExpanded = expandedSections[sectionId] ?? false
            setSectionExpanded({sectionId, expanded: !isExpanded})
        },
        [expandedSections, setSectionExpanded],
    )

    const minimizeWidget = useCallback(() => {
        setWidgetUIState((prev) => ({...prev, isMinimized: true}))
    }, [setWidgetUIState])

    const expandWidget = useCallback(() => {
        setWidgetUIState((prev) => ({...prev, isMinimized: false}))
    }, [setWidgetUIState])

    const closeWidget = useCallback(() => {
        // Close immediately
        setWidgetStatus("dismissed")
        setWidgetUIState({isOpen: false, isMinimized: false})
        trackWidgetClosed({totalTasks, completedTasks})

        // If user hasn't seen the close tooltip, start the sidebar tour
        if (!hasSeenCloseTooltip) {
            setHasSeenCloseTooltip(true)
            // Small delay to let the widget close first
            setTimeout(() => {
                startNextStep("onboarding-widget-closed-tour")
            }, 300)
        }
    }, [
        hasSeenCloseTooltip,
        setHasSeenCloseTooltip,
        setWidgetStatus,
        setWidgetUIState,
        totalTasks,
        completedTasks,
        startNextStep,
    ])

    // Register the widget closed tour
    useEffect(() => {
        registerWidgetClosedTour()
    }, [])

    useEffect(() => {
        if (!config.sections.length) {
            setWidgetConfig(WIDGET_DEFAULT_CONFIG)
        }
    }, [config.sections.length, setWidgetConfig])

    useEffect(() => {
        if (!isNewUser || !doesSessionExist) return
        setWidgetUIState((prev) => {
            if (prev.isOpen) return prev
            return {...prev, isOpen: true}
        })
    }, [isNewUser, doesSessionExist, setWidgetUIState])

    useEffect(() => {
        if (!shouldRender || hasTrackedOpenRef.current) return
        hasTrackedOpenRef.current = true
        trackWidgetOpened({totalTasks, completedTasks})
    }, [shouldRender, totalTasks, completedTasks])

    useEffect(() => {
        if (!completedEventCount) return
        trackWidgetTaskEventRecorded(String(completedEventCount))
    }, [completedEventCount])

    useEffect(() => {
        const shouldComplete = totalTasks > 0 && completedTasks >= totalTasks
        if (!shouldComplete) return
        setWidgetStatus("completed")
        trackWidgetTaskCompleted({totalTasks, completedTasks})
    }, [totalTasks, completedTasks, setWidgetStatus])

    if (!shouldRender) {
        return null
    }

    const isMinimized = widgetUIState.isMinimized

    return (
        <section
            className={clsx(
                "fixed bottom-6 right-6 z-[900] w-[340px] max-w-[calc(100vw-32px)]",
                "overflow-hidden rounded-2xl bg-white",
                "shadow-[0px_6px_16px_0px_rgba(0,0,0,0.08),0px_3px_6px_-4px_rgba(0,0,0,0.12),0px_9px_28px_8px_rgba(0,0,0,0.05)]",
                "flex flex-col",
            )}
        >
            {/* Header */}
            <div className="flex items-center gap-2.5 py-4 pl-6 pr-4">
                <div className="flex min-w-0 flex-1 items-center gap-1">
                    <RocketLaunch size={20} weight="regular" className="shrink-0 text-colorText" />
                    <Text className="text-base font-semibold text-colorText">
                        {WIDGET_HEADER_TITLE}
                    </Text>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                    <Button
                        type="text"
                        size="small"
                        className="flex h-6 w-6 items-center justify-center !p-1 !rounded-md"
                        icon={
                            isMinimized ? (
                                <CaretUp size={14} className="text-colorText" />
                            ) : (
                                <CaretDown size={14} className="text-colorText" />
                            )
                        }
                        onClick={isMinimized ? expandWidget : minimizeWidget}
                    />
                    <Button
                        type="text"
                        size="small"
                        className="flex h-6 w-6 items-center justify-center !p-1 !rounded-md"
                        icon={<X size={14} className="text-colorText" />}
                        onClick={closeWidget}
                    />
                </div>
            </div>

            {/* Content - hidden when minimized */}
            {!isMinimized && (
                <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-4 pb-4">
                    {config.sections.map((section) => (
                        <WidgetSection
                            key={section.id}
                            section={section}
                            completionMap={completionMap}
                            isExpanded={expandedSections[section.id] ?? false}
                            onToggle={toggleSection}
                            onItemClick={handleItemClick}
                        />
                    ))}
                </div>
            )}
        </section>
    )
}

export default OnboardingWidget
