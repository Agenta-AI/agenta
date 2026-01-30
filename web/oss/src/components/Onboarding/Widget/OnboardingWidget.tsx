"use client"

import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {useNextStep} from "@agentaai/nextstepjs"
import {CaretDown, CaretUp, RocketLaunch, X} from "@phosphor-icons/react"
import {Button, Typography, message} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {openDeploymentsDrawerAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentDrawerStore"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
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
    setOnboardingWidgetActivationAtom,
    setOnboardingWidgetConfigAtom,
    setWidgetSectionExpandedAtom,
    tourRegistry,
    type OnboardingWidgetItem,
} from "@/oss/lib/onboarding"
import {traceCountAtom, tracesQueryAtom} from "@/oss/state/newObservability/atoms/queries"

import {ANNOTATE_TRACES_TOUR_ID, registerAnnotateTracesTour} from "../tours/annotateTracesTour"
import {DEPLOY_PROMPT_TOUR_ID, registerDeployPromptTour} from "../tours/deployPromptTour"
import {
    registerTestsetFromTracesTour,
    TESTSET_FROM_TRACES_TOUR_ID,
} from "../tours/testsetFromTracesTour"
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
    const {appURL, recentlyVisitedAppURL, baseAppURL, projectURL} = useURL()
    const config = useAtomValue(onboardingWidgetConfigAtom)
    const widgetStatus = useAtomValue(onboardingWidgetStatusAtom)
    const setWidgetStatus = useSetAtom(onboardingWidgetStatusAtom)
    const widgetUIState = useAtomValue(onboardingWidgetUIStateAtom)
    const setWidgetConfig = useSetAtom(setOnboardingWidgetConfigAtom)
    const setWidgetUIState = useSetAtom(onboardingWidgetUIStateAtom)
    const setWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)
    const expandedSections = useAtomValue(onboardingWidgetExpandedSectionsAtom)
    const setSectionExpanded = useSetAtom(setWidgetSectionExpandedAtom)
    const completionMap = useAtomValue(onboardingWidgetCompletionAtom)
    const widgetEvents = useAtomValue(onboardingWidgetEventsAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const openDeploymentsDrawer = useSetAtom(openDeploymentsDrawerAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const hasSeenCloseTooltip = useAtomValue(hasSeenCloseTooltipAtom)
    const setHasSeenCloseTooltip = useSetAtom(hasSeenCloseTooltipAtom)
    const activeTourId = useAtomValue(activeTourIdAtom)
    const setActiveTourId = useSetAtom(activeTourIdAtom)
    const {startNextStep, isNextStepVisible} = useNextStep()
    const {goToPlayground} = usePlaygroundNavigation()
    const traceCount = useAtomValue(traceCountAtom)
    const tracesQuery = useAtomValue(tracesQueryAtom)
    const [pendingTraceTourId, setPendingTraceTourId] = useState<string | null>(null)

    const registryUrl = useMemo(() => {
        const base = appURL || recentlyVisitedAppURL
        if (!base) return null
        return `${base}/variants`
    }, [appURL, recentlyVisitedAppURL])

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
    // and only on app pages (not on auth/onboarding routes)
    const isOnboardingRoute =
        router.pathname.includes("/auth") ||
        router.pathname.includes("/post-signup") ||
        router.pathname.includes("/get-started") ||
        router.pathname.includes("/workspaces")

    const shouldRender =
        doesSessionExist &&
        !isOnboardingRoute &&
        widgetStatus !== "dismissed" &&
        widgetUIState.isOpen &&
        totalTasks > 0
    const hasTrackedOpenRef = useRef(false)

    const startTour = useCallback(
        (tourId: string) => {
            if (!tourRegistry.get(tourId)) {
                console.warn(`[Onboarding] Tour "${tourId}" not found or disabled`)
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

    useEffect(() => {
        if (!pendingTraceTourId || !router.isReady) return
        if (tracesQuery.isPending || tracesQuery.isLoading || tracesQuery.isFetching) return

        if (traceCount > 0) {
            startTour(pendingTraceTourId)
            setPendingTraceTourId(null)
            return
        }

        message.info(
            "No traces yet. Set up tracing first, then return here to start the walkthrough.",
        )
        setPendingTraceTourId(null)
    }, [
        pendingTraceTourId,
        router.isReady,
        startTour,
        traceCount,
        tracesQuery.isFetching,
        tracesQuery.isPending,
        tracesQuery.isLoading,
    ])

    const handleItemClick = useCallback(
        async (item: OnboardingWidgetItem) => {
            if (item.disabled) return

            trackWidgetTaskClicked(item)

            if (item.activationHint) {
                recordWidgetEvent(`activation:${item.activationHint}`)
                setWidgetActivation(item.activationHint)
            }

            if (item.activationHint === "open-create-prompt" && baseAppURL) {
                try {
                    await router.push(baseAppURL)
                } catch (error) {
                    console.error("Failed to navigate to onboarding target", error)
                    return
                }
            } else if (item.activationHint === "open-registry") {
                if (!registryUrl) {
                    message.info("Create or open an app to view the registry.")
                    return
                }
                try {
                    await router.push(registryUrl)
                    recordWidgetEvent("registry_page_viewed")
                } catch (error) {
                    console.error("Failed to navigate to onboarding target", error)
                    return
                }
            } else if (item.activationHint === "integration-snippet") {
                if (!registryUrl) {
                    message.info("Create or open an app to view the integration snippet.")
                    return
                }
                try {
                    await router.push(registryUrl)
                    openDeploymentsDrawer({initialWidth: 1200, mode: "variant"})
                    recordWidgetEvent("integration_snippet_viewed")
                } catch (error) {
                    console.error("Failed to open integration snippet", error)
                    return
                }
            } else if (item.activationHint === "deploy-variant") {
                if (!registryUrl) {
                    message.info("Create or open an app to deploy a variant.")
                    return
                }
                try {
                    await router.push(registryUrl)
                } catch (error) {
                    console.error("Failed to navigate to registry", error)
                    return
                }
                startTour(item.tourId || DEPLOY_PROMPT_TOUR_ID)
                return
            } else if (item.activationHint === "sdk-docs") {
                if (!projectURL) {
                    message.info("Create or open a project to run SDK evaluations.")
                    return
                }
                try {
                    await router.push(`${projectURL}/evaluations?kind=custom`)
                } catch (error) {
                    console.error("Failed to navigate to SDK evaluations", error)
                    return
                }
                return
            } else if (item.activationHint === "tracing-snippet") {
                if (!projectURL) {
                    message.info("Create or open a project to configure tracing.")
                    return
                }
                try {
                    await router.push(`${projectURL}/observability`)
                } catch (error) {
                    console.error("Failed to navigate to tracing setup", error)
                    return
                }
                return
            } else if (item.activationHint === "trace-annotations") {
                if (!projectURL) {
                    message.info("Create or open a project to view observability.")
                    return
                }
                try {
                    await router.push(`${projectURL}/observability`)
                    setPendingTraceTourId(item.tourId || ANNOTATE_TRACES_TOUR_ID)
                    return
                } catch (error) {
                    console.error("Failed to navigate to observability", error)
                    return
                }
            } else if (item.activationHint === "trace-to-testset") {
                if (!projectURL) {
                    message.info("Create or open a project to view observability.")
                    return
                }
                try {
                    await router.push(`${projectURL}/observability`)
                    setPendingTraceTourId(item.tourId || TESTSET_FROM_TRACES_TOUR_ID)
                    return
                } catch (error) {
                    console.error("Failed to navigate to observability", error)
                    return
                }
            } else if (item.activationHint === "create-testset" && projectURL) {
                try {
                    await router.push(`${projectURL}/testsets`)
                } catch (error) {
                    console.error("Failed to navigate to testsets", error)
                }
                return
            } else if (item.activationHint === "create-evaluator" && projectURL) {
                try {
                    await router.push(`${projectURL}/evaluators`)
                } catch (error) {
                    console.error("Failed to navigate to evaluators", error)
                }
                return
            } else if (item.activationHint === "run-first-evaluation") {
                goToPlayground()
            } else if (item.href) {
                try {
                    await router.push(item.href)
                } catch (error) {
                    console.error("Failed to navigate to onboarding target", error)
                    return
                }
            } else if (item.activationHint === "playground-walkthrough") {
                goToPlayground()
            }

            if (item.tourId) {
                startTour(item.tourId)
            }
        },
        [
            recordWidgetEvent,
            baseAppURL,
            projectURL,
            registryUrl,
            router,
            startTour,
            openDeploymentsDrawer,
            setWidgetActivation,
            goToPlayground,
            setPendingTraceTourId,
        ],
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
        registerDeployPromptTour()
        registerAnnotateTracesTour()
        registerTestsetFromTracesTour()
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
        if (!shouldComplete || widgetStatus === "completed") return
        setWidgetStatus("completed")
        trackWidgetTaskCompleted({totalTasks, completedTasks})
    }, [totalTasks, completedTasks, widgetStatus, setWidgetStatus])

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
