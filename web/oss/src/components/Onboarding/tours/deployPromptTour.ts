import {getDefaultStore} from "jotai"

import {openDeploymentsDrawerAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentDrawerStore"
import {recordWidgetEventAtom, tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"
import {variantTableSelectionAtomFamily} from "@/oss/state/variant/atoms/selection"

/**
 * Deploy Prompt Tour
 *
 * Guides users through deploying a prompt version and accessing the API snippet.
 */
export const DEPLOY_PROMPT_TOUR_ID = "deploy-prompt"

const SELECTION_SCOPE = "variants/dashboard"

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
        {
            icon: "📋",
            title: "Open the Registry",
            content:
                "The registry shows all your committed prompt versions. Click here to open it.",
            selector: '[data-tour="registry-nav"]',
            side: "right",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "📄",
            title: "Select a Version",
            content: "Click on a version to see its details.",
            selector: '[data-tour="version-row"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
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
        },
        {
            icon: "🔗",
            title: "View the API Code",
            content:
                "Click here to see the code snippet for calling your deployed prompt. Copy this into your application.",
            selector: '[data-tour="api-code-button"]',
            side: "bottom",
            showControls: true,
            showSkip: true,
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
            onEnter: () => {
                if (typeof window === "undefined") return
                const store = getDefaultStore()
                const selected = store.get(variantTableSelectionAtomFamily(SELECTION_SCOPE)) || []
                const revisionId = selected[0] ? String(selected[0]) : undefined
                store.set(openDeploymentsDrawerAtom, {
                    initialWidth: 1200,
                    revisionId,
                    mode: "variant",
                })
                store.set(recordWidgetEventAtom, "integration_snippet_viewed")
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
