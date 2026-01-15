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
            title: "Aggregated Results",
            content:
                "The Overview tab shows aggregated metrics and summary statistics for your entire evaluation run.",
            selector: ".ant-tabs-nav .ant-tabs-tab:first-child", // Target the Overview tab
            side: "right-end", // Position to the right, aligned to bottom
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "🔍",
            title: "Detailed Results",
            content:
                "The Scenarios tab shows detailed results for each test case. Click on any row to see inputs, outputs, and individual metric scores.",
            selector: ".ant-tabs-nav .ant-tabs-tab:nth-child(2)", // Target the Scenarios tab
            side: "right-end", // Position to the right, aligned to bottom
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            controlLabels: {
                finish: "Got it!",
            },
            // Click the Scenarios tab when this step is shown
            onEnter: () => {
                const scenariosTab = document.querySelector(
                    ".ant-tabs-nav .ant-tabs-tab:nth-child(2)",
                ) as HTMLElement | null
                if (scenariosTab) {
                    scenariosTab.click()
                }
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
