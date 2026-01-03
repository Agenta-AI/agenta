"use client"

import {useCallback, useEffect, useState} from "react"

import {NextStep, NextStepProvider} from "@agentaai/nextstepjs"
import {useSetAtom} from "jotai"

import {tourRegistry, activeTourIdAtom, markTourSeenAtom} from "@/oss/lib/onboarding"
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
    const setActiveTourId = useSetAtom(activeTourIdAtom)

    const handleComplete = useCallback(
        (tourName: string | null) => {
            if (tourName) {
                markTourSeen(tourName)
            }
            setActiveTourId(null)
        },
        [markTourSeen, setActiveTourId],
    )

    const handleSkip = useCallback(
        (_step: number, tourName: string | null) => {
            if (tourName) {
                markTourSeen(tourName)
            }
            setActiveTourId(null)
        },
        [markTourSeen, setActiveTourId],
    )

    return (
        <NextStep
            steps={tours}
            cardComponent={OnboardingCard}
            onComplete={handleComplete}
            onSkip={handleSkip}
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
