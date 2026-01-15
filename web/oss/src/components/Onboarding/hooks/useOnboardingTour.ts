import {useCallback, useEffect} from "react"

import {useNextStep} from "@agentaai/nextstepjs"
import {useAtomValue, useSetAtom} from "jotai"

import type {TriggerTourOptions} from "@/oss/lib/onboarding"
import {activeTourIdAtom, isNewUserAtom, seenToursAtom, tourRegistry} from "@/oss/lib/onboarding"

import {useTourReducer} from "./useTourReducer"

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
    /** Whether the tour can be auto-startd */
    canAutoStart: boolean
}

/**
 * Hook to trigger and manage onboarding tours
 * Refactored to use reducer pattern for better state management
 */
export function useOnboardingTour({
    tourId,
    autoStart = false,
    autoStartCondition = true,
}: UseOnboardingTourOptions): UseOnboardingTourReturn {
    const {startNextStep, isNextStepVisible} = useNextStep()
    const [state, dispatch] = useTourReducer()

    const isNewUser = useAtomValue(isNewUserAtom)
    const seenTours = useAtomValue(seenToursAtom)
    const activeTourId = useAtomValue(activeTourIdAtom)
    const setActiveTourId = useSetAtom(activeTourIdAtom)

    const hasBeenSeen = Boolean(seenTours[tourId])
    const isActive = activeTourId === tourId && isNextStepVisible
    const canAutoStart = isNewUser && !hasBeenSeen && autoStartCondition && tourRegistry.has(tourId)

    // Manual start function
    const startTour = useCallback(
        (options?: TriggerTourOptions) => {
            const {force = false} = options ?? {}

            if (!tourRegistry.has(tourId)) {
                console.warn(`[Onboarding] Tour "${tourId}" not found in registry`)
                dispatch({type: "CHECK_FAILURE", error: "Tour not found"})
                return
            }

            if (!force && hasBeenSeen) {
                dispatch({type: "CHECK_FAILURE", error: "Tour already seen"})
                return
            }

            if (isNextStepVisible && activeTourId !== tourId) {
                console.warn(`[Onboarding] Another tour is active, skipping "${tourId}"`)
                dispatch({type: "CHECK_FAILURE", error: "Another tour active"})
                return
            }

            // Signal readiness to start
            dispatch({type: "CHECK_SUCCESS"})
        },
        [tourId, hasBeenSeen, isNextStepVisible, activeTourId, dispatch],
    )

    // Effect: Handle Auto Start logic
    useEffect(() => {
        if (autoStart && canAutoStart && state.status === "idle") {
            dispatch({type: "START_CHECK"})
        }
    }, [autoStart, canAutoStart, state.status, dispatch])

    // Effect: Perform connection check (simulating "wait for element" or "ready")
    // In a real scenario, this could check for document.querySelector(selector)
    // This separation allows us to replace the arbitrary 500ms timeout with
    // a proper check for DOM readiness in the future.
    useEffect(() => {
        if (state.status === "checking") {
            // We can replace the arbitrary timeout with a check logic here if needed
            // For now, checks are immediate as we rely on 'canAutoStart' condition which encompasses logic
            if (canAutoStart) {
                dispatch({type: "CHECK_SUCCESS"})
            } else {
                dispatch({type: "CHECK_FAILURE", error: "Conditions not met"})
            }
        }
    }, [state.status, canAutoStart, dispatch])

    // Effect: Start the tour when state becomes ready
    useEffect(() => {
        if (state.status === "ready") {
            setActiveTourId(tourId)
            startNextStep(tourId)
            dispatch({type: "START_TOUR"})
        }
    }, [state.status, tourId, setActiveTourId, startNextStep, dispatch])

    // Effect: Monitor visibility to complete tour state
    useEffect(() => {
        if (state.status === "active" && !isNextStepVisible) {
            dispatch({type: "COMPLETE_TOUR"})
        }
    }, [isNextStepVisible, state.status, dispatch])

    return {
        startTour,
        isActive,
        hasBeenSeen,
        canAutoStart,
    }
}

export default useOnboardingTour
