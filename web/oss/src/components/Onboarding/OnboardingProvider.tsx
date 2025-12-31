"use client"

import {useSyncExternalStore} from "react"

import {useSetAtom} from "jotai"
import {NextStep, NextStepProvider} from "@agentaai/nextstepjs"

import {tourRegistry, activeTourIdAtom, markTourSeenAtom} from "@/oss/lib/onboarding"

import OnboardingCard from "./OnboardingCard"

/**
 * Inner provider that wraps content with NextStep
 */
const OnboardingInner = ({children}: {children: React.ReactNode}) => {
    // Subscribe to registry changes
    const tours = useSyncExternalStore(
        (callback) => tourRegistry.subscribe(callback),
        () => tourRegistry.toNextStepFormat(),
        () => [] // SSR fallback
    )

    const markTourSeen = useSetAtom(markTourSeenAtom)
    const setActiveTourId = useSetAtom(activeTourIdAtom)

    const handleComplete = (tourName: string | null) => {
        if (tourName) {
            markTourSeen(tourName)
        }
        setActiveTourId(null)
    }

    const handleSkip = (step: number, tourName: string | null) => {
        // Optionally mark as seen on skip too
        if (tourName) {
            markTourSeen(tourName)
        }
        setActiveTourId(null)
    }

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
