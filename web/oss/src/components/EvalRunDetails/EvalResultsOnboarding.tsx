"use client"

import {useEffect} from "react"

import {useOnboardingTour} from "@/oss/components/Onboarding"
import {
    registerEvaluationResultsTour,
    EVALUATION_RESULTS_TOUR_ID,
} from "@/oss/components/Onboarding/tours/evaluationResultsTour"

// Register tour on module load
registerEvaluationResultsTour()

interface EvalResultsOnboardingProps {
    /** Whether the page data has loaded (tour waits for this) */
    isReady?: boolean
}

/**
 * Evaluation Results Onboarding
 *
 * Renders nothing visible - just handles tour registration and auto-start.
 * Include this component in the evaluation results page to enable onboarding.
 */
export function EvalResultsOnboarding({isReady = true}: EvalResultsOnboardingProps) {
    // Auto-start tour for new users when page is ready
    useOnboardingTour({
        tourId: EVALUATION_RESULTS_TOUR_ID,
        autoStart: true,
        autoStartCondition: isReady,
    })

    return null
}

export default EvalResultsOnboarding
