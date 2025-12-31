import {useCallback, useEffect, useRef} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import {useNextStep} from "@agentaai/nextstepjs"

import {
    tourRegistry,
    isNewUserAtom,
    seenToursAtom,
    activeTourIdAtom,
    markTourSeenAtom,
} from "@/oss/lib/onboarding"
import type {TriggerTourOptions} from "@/oss/lib/onboarding"

interface UseOnboardingTourOptions {
    /** Tour ID to use */
    tourId: string
    /**
     * Auto-start the tour when conditions are met
     * (isNewUser && !seenBefore && tour is registered)
     */
    autoStart?: boolean
    /**
     * Additional condition for auto-start
     * Useful for page-specific logic
     */
    autoStartCondition?: boolean
}

interface UseOnboardingTourReturn {
    /** Start the tour manually */
    startTour: (options?: TriggerTourOptions) => void
    /** Whether the tour is currently active */
    isActive: boolean
    /** Whether the tour has been seen before */
    hasBeenSeen: boolean
    /** Whether the tour can be auto-started */
    canAutoStart: boolean
}

/**
 * Hook to trigger and manage onboarding tours
 *
 * @example
 * ```tsx
 * // Basic usage - manual trigger
 * const {startTour} = useOnboardingTour({tourId: "my-tour"})
 *
 * // Auto-start for new users
 * useOnboardingTour({
 *   tourId: "page-intro",
 *   autoStart: true,
 * })
 *
 * // Auto-start with additional condition
 * useOnboardingTour({
 *   tourId: "feature-tour",
 *   autoStart: true,
 *   autoStartCondition: hasFeatureData,
 * })
 * ```
 */
export function useOnboardingTour({
    tourId,
    autoStart = false,
    autoStartCondition = true,
}: UseOnboardingTourOptions): UseOnboardingTourReturn {
    const {startNextStep, isNextStepVisible} = useNextStep()

    const isNewUser = useAtomValue(isNewUserAtom)
    const seenTours = useAtomValue(seenToursAtom)
    const activeTourId = useAtomValue(activeTourIdAtom)
    const setActiveTourId = useSetAtom(activeTourIdAtom)
    const markTourSeen = useSetAtom(markTourSeenAtom)

    const hasBeenSeen = Boolean(seenTours[tourId])
    const isActive = activeTourId === tourId && isNextStepVisible
    const canAutoStart = isNewUser && !hasBeenSeen && autoStartCondition && tourRegistry.has(tourId)

    // Track if we've auto-started to prevent multiple triggers
    const hasAutoStartedRef = useRef(false)

    const startTour = useCallback(
        (options?: TriggerTourOptions) => {
            const {force = false} = options ?? {}

            // Check if tour exists
            if (!tourRegistry.has(tourId)) {
                console.warn(`[Onboarding] Tour "${tourId}" not found in registry`)
                return
            }

            // Check if already seen (unless forced)
            if (!force && hasBeenSeen) {
                return
            }

            // Check if another tour is active
            if (isNextStepVisible && activeTourId !== tourId) {
                console.warn(`[Onboarding] Another tour is active, skipping "${tourId}"`)
                return
            }

            setActiveTourId(tourId)
            startNextStep(tourId)
        },
        [tourId, hasBeenSeen, isNextStepVisible, activeTourId, setActiveTourId, startNextStep],
    )

    // Auto-start effect
    useEffect(() => {
        if (!autoStart) return
        if (hasAutoStartedRef.current) return
        if (!canAutoStart) return

        // Small delay to ensure page is rendered
        const timer = setTimeout(() => {
            if (!hasAutoStartedRef.current && canAutoStart) {
                hasAutoStartedRef.current = true
                startTour()
            }
        }, 500)

        return () => clearTimeout(timer)
    }, [autoStart, canAutoStart, startTour])

    // Reset auto-start ref when tour changes
    useEffect(() => {
        hasAutoStartedRef.current = false
    }, [tourId])

    return {
        startTour,
        isActive,
        hasBeenSeen,
        canAutoStart,
    }
}

export default useOnboardingTour
