"use client"

import {useCallback, useEffect, useState} from "react"

import {NextStep, NextStepProvider} from "@agentaai/nextstepjs"
import {useSetAtom} from "jotai"

import {ANNOTATE_TRACES_TOUR_ID} from "@/oss/components/Onboarding/tours/annotateTracesTour"
import {DEPLOY_PROMPT_TOUR_ID} from "@/oss/components/Onboarding/tours/deployPromptTour"
import {EXPLORE_PLAYGROUND_TOUR_ID} from "@/oss/components/Onboarding/tours/explorePlaygroundTour"
import {FIRST_EVALUATION_TOUR_ID} from "@/oss/components/Onboarding/tours/firstEvaluationTour"
import {TESTSET_FROM_TRACES_TOUR_ID} from "@/oss/components/Onboarding/tours/testsetFromTracesTour"
import {
    tourRegistry,
    activeTourIdAtom,
    markTourSeenAtom,
    recordWidgetEventAtom,
} from "@/oss/lib/onboarding"
import type {InternalTour} from "@/oss/lib/onboarding/types"

import OnboardingCard from "./OnboardingCard"

/**
 * Inner provider that wraps content with NextStep
 */
const OnboardingInner = ({children}: {children: React.ReactNode}) => {
    // Use simple useState instead of useSyncExternalStore to avoid hydration issues
    const [tours, setTours] = useState<InternalTour[]>([])

    // Subscribe to registry changes after mount (client-side only)
    useEffect(() => {
        // Initial load
        setTours(tourRegistry.toNextStepFormat())

        // Subscribe to changes
        const unsubscribe = tourRegistry.subscribe(() => {
            setTours(tourRegistry.toNextStepFormat())
        })

        return unsubscribe
    }, [])

    const markTourSeen = useSetAtom(markTourSeenAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const setActiveTourId = useSetAtom(activeTourIdAtom)

    const handleComplete = useCallback(
        (tourName: string | null) => {
            if (tourName) {
                markTourSeen(tourName)
                if (tourName === EXPLORE_PLAYGROUND_TOUR_ID) {
                    recordWidgetEvent("playground_explored")
                }
                if (tourName === DEPLOY_PROMPT_TOUR_ID) {
                    recordWidgetEvent("variant_deployed")
                }
                if (tourName === ANNOTATE_TRACES_TOUR_ID) {
                    recordWidgetEvent("trace_annotated")
                }
                if (tourName === TESTSET_FROM_TRACES_TOUR_ID) {
                    recordWidgetEvent("testset_created_from_traces")
                }
                if (tourName === FIRST_EVALUATION_TOUR_ID) {
                    recordWidgetEvent("evaluation_ran")
                }
            }
            setActiveTourId(null)
        },
        [markTourSeen, recordWidgetEvent, setActiveTourId],
    )

    const handleSkip = useCallback(
        (_step: number, tourName: string | null) => {
            if (tourName) {
                markTourSeen(tourName)
                if (tourName === EXPLORE_PLAYGROUND_TOUR_ID) {
                    recordWidgetEvent("playground_explored")
                }
                if (tourName === DEPLOY_PROMPT_TOUR_ID) {
                    recordWidgetEvent("variant_deployed")
                }
                if (tourName === ANNOTATE_TRACES_TOUR_ID) {
                    recordWidgetEvent("trace_annotated")
                }
                if (tourName === TESTSET_FROM_TRACES_TOUR_ID) {
                    recordWidgetEvent("testset_created_from_traces")
                }
                if (tourName === FIRST_EVALUATION_TOUR_ID) {
                    recordWidgetEvent("evaluation_ran")
                }
            }
            setActiveTourId(null)
        },
        [markTourSeen, recordWidgetEvent, setActiveTourId],
    )

    return (
        <NextStep
            steps={tours}
            cardComponent={OnboardingCard}
            onComplete={handleComplete}
            onSkip={handleSkip}
            cardTransition={{duration: 0.2}}
            noInViewScroll
        >
            {children}
        </NextStep>
    )
}

/**
 * OnboardingProvider - Wraps the app with onboarding functionality
 *
 * Place this high in your component tree (e.g., in _app.tsx).
 *
 * @example
 * ```tsx
 * <OnboardingProvider>
 *   <App />
 * </OnboardingProvider>
 * ```
 */
export const OnboardingProvider = ({children}: {children: React.ReactNode}) => {
    return (
        <NextStepProvider>
            <OnboardingInner>{children}</OnboardingInner>
        </NextStepProvider>
    )
}

export default OnboardingProvider
