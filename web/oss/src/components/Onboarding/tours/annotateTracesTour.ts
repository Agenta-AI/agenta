import {tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"

/**
 * Annotate Traces Tour
 *
 * Guides users through annotating traces for human evaluation.
 */
export const ANNOTATE_TRACES_TOUR_ID = "annotate-traces"

const annotateTracesTour: OnboardingTour = {
    id: ANNOTATE_TRACES_TOUR_ID,
    steps: [
        {
            icon: "🏷️",
            title: "Annotate Your Traces",
            content:
                "You can add human feedback to traces. This helps you build evaluation datasets and track quality.",
            selector: undefined,
            side: "bottom",
            showControls: true,
            showSkip: true,
        },
        {
            icon: "📍",
            title: "Open a Trace",
            content: "Click on a trace to see its details.",
            selector: '[data-tour="trace-row"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            nextAction: {
                selector: '[data-tour="trace-row"]',
                type: "click",
                waitForSelector: '[data-tour="trace-drawer"]',
                waitForSelectorVisible: true,
                waitTimeoutMs: 6000,
            },
            onNext: async () => {
                await new Promise((resolve) => window.setTimeout(resolve, 400))
            },
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "✏️",
            title: "Click Annotate",
            content: "Click the Annotate button to add your feedback.",
            selector: '[data-tour="annotate-button"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            nextAction: {
                selector: '[data-tour="annotate-button"]',
                type: "click",
                waitForSelector: '[data-tour="annotate-drawer"]',
                waitForSelectorVisible: true,
                waitTimeoutMs: 6000,
            },
            onNext: async () => {
                await new Promise((resolve) => window.setTimeout(resolve, 500))
            },
            prevAction: {
                selector: '[data-tour="trace-drawer-close"]',
                type: "click",
                waitForHiddenSelector: '[data-tour="annotate-button"]',
                waitTimeoutMs: 4000,
            },
            selectorRetryAttempts: 30,
            selectorRetryDelay: 200,
        },
        {
            icon: "👍",
            title: "Select an Evaluator",
            content: "Start by choosing which evaluator you want to annotate. Click Add Evaluator.",
            selector: '[data-tour="annotation-add-evaluator"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            prevAction: {
                selector: '[data-tour="annotate-drawer-close"]',
                type: "click",
                waitForHiddenSelector: '[data-tour="annotate-drawer-close"]',
                waitTimeoutMs: 6000,
            },
            selectorRetryAttempts: 30,
            selectorRetryDelay: 200,
        },
        {
            icon: "✅",
            title: "Submit",
            content: "Click Submit to save your annotation.",
            selector: '[data-tour="annotation-submit"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
    ],
}

/**
 * Register the tour
 *
 * This function should be called once to register the tour.
 * It's safe to call multiple times - duplicate registrations are ignored.
 */
export function registerAnnotateTracesTour(): void {
    tourRegistry.register(annotateTracesTour)
}

/**
 * Unregister the tour (for cleanup/testing)
 */
export function unregisterAnnotateTracesTour(): void {
    tourRegistry.unregister(ANNOTATE_TRACES_TOUR_ID)
}

export default annotateTracesTour
