import {tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"

/**
 * Evaluation Results Page Tour
 *
 * Shows new users how to navigate the evaluation results page,
 * introducing them to the key features.
 */
export const EVALUATION_RESULTS_TOUR_ID = "evaluation-results-intro"

const evaluationResultsTour: OnboardingTour = {
    id: EVALUATION_RESULTS_TOUR_ID,
    steps: [
        {
            icon: "👋",
            title: "Welcome to Evaluation Results",
            content:
                "This page shows the results of your evaluation run. Let's take a quick tour of the key features.",
            selector: "", // Empty selector = centered modal
            side: "bottom",
            showControls: true,
            showSkip: true,
        },
        {
            icon: "📊",
            title: "View Tabs",
            content:
                "Use these tabs to switch between Overview (summary metrics), Scenarios (detailed test cases), and Configuration (evaluation settings).",
            selector: ".ant-tabs-nav", // Target the tabs navigation
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "🎯",
            title: "Explore Test Scenarios",
            content:
                "Click on any row in the Scenarios view to see detailed inputs, outputs, and individual metric scores for that test case.",
            selector: ".ant-tabs-content", // Target the content area
            side: "top",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            controlLabels: {
                finish: "Got it!",
            },
        },
    ],
}

/**
 * Register the tour
 *
 * This function should be called once to register the tour.
 * It's safe to call multiple times - duplicate registrations are ignored.
 */
export function registerEvaluationResultsTour(): void {
    tourRegistry.register(evaluationResultsTour)
}

/**
 * Unregister the tour (for cleanup/testing)
 */
export function unregisterEvaluationResultsTour(): void {
    tourRegistry.unregister(EVALUATION_RESULTS_TOUR_ID)
}

export default evaluationResultsTour
