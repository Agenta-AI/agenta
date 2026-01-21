import {getEnv} from "@/oss/lib/helpers/dynamicEnv"
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
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "👍",
            title: "Choose a Rating",
            content: "Select thumbs up or thumbs down. You can also add comments.",
            selector: '[data-tour="annotation-rating"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
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

const isWalkthroughsEnabled = () => getEnv("NEXT_PUBLIC_ENABLE_WALKTHROUGHS") === "true"

/**
 * Register the tour
 *
 * This function should be called once to register the tour.
 * It's safe to call multiple times - duplicate registrations are ignored.
 */
export function registerAnnotateTracesTour(): void {
    tourRegistry.register(annotateTracesTour, {
        condition: isWalkthroughsEnabled,
    })
}

/**
 * Unregister the tour (for cleanup/testing)
 */
export function unregisterAnnotateTracesTour(): void {
    tourRegistry.unregister(ANNOTATE_TRACES_TOUR_ID)
}

export default annotateTracesTour
