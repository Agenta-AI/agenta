import {getDefaultStore} from "jotai"

import {recordWidgetEventAtom, tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"

/**
 * Create Test Set from Traces Tour
 *
 * Guides users through turning traces into a test set.
 */
export const TESTSET_FROM_TRACES_TOUR_ID = "testset-from-traces"

const testsetFromTracesTour: OnboardingTour = {
    id: TESTSET_FROM_TRACES_TOUR_ID,
    steps: [
        {
            icon: "📦",
            title: "Create a Test Set from Traces",
            content:
                "You can turn real production data into test cases. This helps you evaluate against realistic inputs.",
            selector: undefined,
            side: "bottom",
            showControls: true,
            showSkip: true,
        },
        {
            icon: "☑️",
            title: "Select Traces",
            content: "Check the boxes next to the traces you want to include.",
            selector: '[data-tour="trace-checkbox"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "➕",
            title: "Click Create Test Set",
            content: "Click this button to create a test set from your selection.",
            selector: '[data-tour="create-testset-button"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "📝",
            title: "Name Your Test Set",
            content: "Give your test set a descriptive name.",
            selector: '[data-tour="testset-name-input"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "✅",
            title: "Confirm",
            content: "Click Create to save your test set. You can now use it in evaluations.",
            selector: '[data-tour="testset-confirm"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            onNext: () => {
                const store = getDefaultStore()
                store.set(recordWidgetEventAtom, "testset_created_from_traces")
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
export function registerTestsetFromTracesTour(): void {
    tourRegistry.register(testsetFromTracesTour)
}

/**
 * Unregister the tour (for cleanup/testing)
 */
export function unregisterTestsetFromTracesTour(): void {
    tourRegistry.unregister(TESTSET_FROM_TRACES_TOUR_ID)
}

export default testsetFromTracesTour
