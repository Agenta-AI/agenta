import {tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"

/**
 * Playground Exploration Tour
 *
 * Guides users through core Playground actions.
 */
export const EXPLORE_PLAYGROUND_TOUR_ID = "explore-playground"

const explorePlaygroundTour: OnboardingTour = {
    id: EXPLORE_PLAYGROUND_TOUR_ID,
    steps: [
        {
            icon: "👋",
            title: "Welcome to the Playground",
            content: "This is where you iterate on your prompts. Let me show you the key features.",
            selector: undefined,
            side: "bottom",
            showControls: true,
            showSkip: true,
        },
        {
            icon: "▶️",
            title: "Run Your Prompt",
            content: "Click Run to test your prompt with the current inputs. Try it now.",
            selector: '[data-tour="run-button"]',
            side: "left",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            pointerPadding: 10,
            pointerRadius: 8,
        },
        {
            icon: "🗂️",
            title: "Load a Test Set",
            content:
                "You can load a test set to run your prompt against multiple inputs at once. Click here to load one.",
            selector: '[data-tour="load-testset"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            pointerPadding: 10,
            pointerRadius: 8,
        },
        {
            icon: "💾",
            title: "Commit Your Changes",
            content:
                "When you are happy with a version, commit it. This saves it to the registry so you can deploy or compare later.",
            selector: '[data-tour="commit-button"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            pointerPadding: 10,
            pointerRadius: 8,
        },
        {
            icon: "⚖️",
            title: "Compare Versions",
            content:
                "Enable compare mode to test two prompt versions side by side. This helps you see which one performs better.",
            selector: '[data-tour="compare-toggle"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            pointerPadding: 10,
            pointerRadius: 8,
        },
    ],
}

/**
 * Register the tour
 *
 * This function should be called once to register the tour.
 * It's safe to call multiple times - duplicate registrations are ignored.
 */
export function registerExplorePlaygroundTour(): void {
    tourRegistry.register(explorePlaygroundTour, {
        condition: () => true,
    })
}

/**
 * Unregister the tour (for cleanup/testing)
 */
export function unregisterExplorePlaygroundTour(): void {
    tourRegistry.unregister(EXPLORE_PLAYGROUND_TOUR_ID)
}

export default explorePlaygroundTour
