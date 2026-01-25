import {getDefaultStore} from "jotai"

import {newEvaluationActivePanelAtom} from "@/oss/components/pages/evaluations/NewEvaluation/state/panel"
import {recordWidgetEventAtom, tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"

/**
 * Run First Evaluation Tour
 *
 * Guides users through running their first evaluation from the Playground.
 */
export const FIRST_EVALUATION_TOUR_ID = "first-evaluation"

const waitForSelectorVisible = (
    selector: string,
    timeoutMs = 2000,
    pollInterval = 100,
): Promise<boolean> => {
    const start = Date.now()

    return new Promise((resolve) => {
        const check = () => {
            const element = document.querySelector(selector)
            if (element && element.getClientRects().length > 0) {
                resolve(true)
                return
            }
            if (Date.now() - start >= timeoutMs) {
                resolve(false)
                return
            }
            window.setTimeout(check, pollInterval)
        }
        check()
    })
}

const firstEvaluationTour: OnboardingTour = {
    id: FIRST_EVALUATION_TOUR_ID,
    steps: [
        {
            icon: "🎯",
            title: "Run Your First Evaluation",
            content:
                "Evaluations help you measure how well your prompts perform. Let's run one together.",
            selector: undefined,
            side: "bottom",
            showControls: true,
            showSkip: true,
        },
        {
            icon: "▶️",
            title: "Open the Evaluation Modal",
            content:
                'Click "Run Evaluation" to start. If you do not have a prompt yet, create one first.',
            selector: '[data-tour="run-evaluation-button"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            nextAction: {
                selector: '[data-tour="run-evaluation-button"]',
                type: "click",
                waitForSelector: '[data-tour="testset-select"]',
                waitTimeoutMs: 3000,
            },
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "📂",
            title: "Select a Test Set",
            content: "Choose a test set. We have created one for you to get started.",
            selector: '[data-tour="testset-select"]',
            side: "right",
            showControls: true,
            showSkip: true,
            panelKey: "testsetPanel",
            prevAction: {
                selector: '[data-tour="new-eval-modal-close"]',
                type: "click",
                waitForHiddenSelector: '[data-tour="testset-select"]',
                waitTimeoutMs: 2000,
            },
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "✏️",
            title: "Choose an Evaluator",
            content:
                'Select "Exact Match" to compare outputs against expected answers. You can create custom evaluators later.',
            selector: '[data-tour="evaluator-select"]',
            side: "right",
            showControls: true,
            showSkip: true,
            panelKey: "evaluatorPanel",
            onPrev: async () => {
                const store = getDefaultStore()
                store.set(newEvaluationActivePanelAtom, "testsetPanel")
                await waitForSelectorVisible('[data-tour="testset-select"]')
            },
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "🚀",
            title: "Run the Evaluation",
            content: "Click Run to start the evaluation.",
            selector: '[data-tour="run-eval-confirm"]',
            side: "top",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "📊",
            title: "View Your Results",
            content:
                "Here are your results. You can see how each test case performed and the overall score.",
            selector: '[data-tour="eval-results"]',
            side: "top",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            onNext: () => {
                const store = getDefaultStore()
                store.set(recordWidgetEventAtom, "evaluation_ran")
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
export function registerFirstEvaluationTour(): void {
    tourRegistry.register(firstEvaluationTour)
}

/**
 * Unregister the tour (for cleanup/testing)
 */
export function unregisterFirstEvaluationTour(): void {
    tourRegistry.unregister(FIRST_EVALUATION_TOUR_ID)
}

export default firstEvaluationTour
