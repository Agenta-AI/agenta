import {getDefaultStore} from "jotai"

import {recordWidgetEventAtom, tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"

import {waitForSelectorVisible} from "./firstEvaluationTour"

/**
 * Deploy Prompt Tour
 *
 * Guides users through deploying a prompt version and accessing the API snippet.
 */
export const DEPLOY_PROMPT_TOUR_ID = "deploy-prompt"

const deployPromptTour: OnboardingTour = {
    id: DEPLOY_PROMPT_TOUR_ID,
    steps: [
        {
            icon: "🚀",
            title: "Deploy Your Prompt",
            content:
                "Once you have a prompt version you like, you can deploy it to an environment. Let me show you how.",
            selector: undefined,
            side: "bottom",
            showControls: true,
            showSkip: true,
        },
        // {
        //     icon: "📋",
        //     title: "Open the Registry",
        //     content:
        //         "The registry shows all your committed prompt versions. Click here to open it.",
        //     selector: '[data-menu-id="rc-menu-uuid-app-variants-link"]',
        //     side: "right",
        //     showControls: true,
        //     showSkip: true,
        //     selectorRetryAttempts: 10,
        //     selectorRetryDelay: 200,
        // },
        {
            icon: "📄",
            title: "Select a Version",
            content: "Click on a version to see its details.",
            selector: '[data-tour="version-row"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            pointerPadding: 10,
            pointerRadius: 8,
            nextAction: {
                selector: '[data-tour="version-row"]',
                type: "click",
                waitForSelector: '[data-tour="variant-drawer"]',
                waitForSelectorVisible: true,
                waitTimeoutMs: 6000,
                advanceOnActionClick: true,
            },
            onNext: async () => {
                await waitForSelectorVisible('[data-tour="deploy-button"]')
                await new Promise((resolve) => window.setTimeout(resolve, 500))
            },
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "🌐",
            title: "Deploy to an Environment",
            content:
                "Click Deploy to make this version available via API. You can deploy to staging or production.",
            selector: '[data-tour="deploy-button"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            pointerPadding: 10,
            pointerRadius: 8,
            nextAction: {
                selector: '[data-tour="deploy-button"]',
                type: "click",
                waitForSelector: '[data-tour="deploy-variant-modal"]',
                waitForSelectorVisible: true,
                waitTimeoutMs: 6000,
                advanceOnActionClick: true,
            },
            onNext: async () => {
                await waitForSelectorVisible('[data-tour="deploy-variant-modal"]')
                await new Promise((resolve) => window.setTimeout(resolve, 500))
            },
            prevAction: {
                selector: '[data-tour="variant-drawer-close-button"]',
                type: "click",
                waitForHiddenSelector: '[data-tour="variant-drawer"]',
                waitTimeoutMs: 4000,
            },
        },
        {
            icon: "🌐",
            title: "Select Environment",
            content:
                "Choose where you want to deploy this version. Staging is for testing, production is for live use.",
            selector: '[data-tour="deploy-variant-modal"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            pointerPadding: 10,
            pointerRadius: 8,
            prevAction: {
                selector: '[data-tour="deploy-variant-modal-cancel-button"]',
                type: "click",
                waitForHiddenSelector: '[data-tour="deploy-variant-modal"]',
                waitTimeoutMs: 4000,
            },
        },
        {
            icon: "✅",
            title: "Deploy",
            content: "Click Deploy to deploy this version to the selected environment.",
            selector: '[data-tour="deploy-variant-modal-deploy-button"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            pointerPadding: 10,
            pointerRadius: 8,
            nextAction: {
                selector: '[data-tour="deploy-variant-modal-deploy-button"]',
                type: "click",
                waitForHiddenSelector: '[data-tour="deploy-variant-modal"]',
                waitTimeoutMs: 6000,
                advanceOnActionClick: true,
            },
            onNext: () => {
                const store = getDefaultStore()
                store.set(recordWidgetEventAtom, "variant_deployed")
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
export function registerDeployPromptTour(): void {
    tourRegistry.register(deployPromptTour, {
        condition: () => true,
    })
}

/**
 * Unregister the tour (for cleanup/testing)
 */
export function unregisterDeployPromptTour(): void {
    tourRegistry.unregister(DEPLOY_PROMPT_TOUR_ID)
}

export default deployPromptTour
