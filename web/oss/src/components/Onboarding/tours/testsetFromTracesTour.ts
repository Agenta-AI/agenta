import {getDefaultStore} from "jotai"

import {cascaderValueAtom} from "@/oss/components/SharedDrawers/AddToTestsetDrawer/atoms/cascaderState"
import {onTestsetSelectAtom} from "@/oss/components/SharedDrawers/AddToTestsetDrawer/atoms/drawerState"
import {recordWidgetEventAtom, tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"
import {selectedRowKeysAtom} from "@/oss/state/newObservability/atoms/controls"
import {tracesAtom} from "@/oss/state/newObservability/atoms/queries"
import {selectTestsetAtom} from "@/oss/state/testsetSelection"

import {waitForSelectorVisible} from "./firstEvaluationTour"

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
            onNext: async () => {
                const store = getDefaultStore()
                const traces = store.get(tracesAtom)
                const firstSpanId = traces[0]?.span_id
                if (!firstSpanId) return

                const selectedKeys = store.get(selectedRowKeysAtom).map(String)
                if (selectedKeys.includes(String(firstSpanId))) {
                    return
                }

                const root = document.querySelector(
                    '[data-tour="trace-checkbox"]',
                ) as HTMLElement | null
                if (!root) return

                root.click()
                await new Promise((resolve) => window.setTimeout(resolve, 200))
            },
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
            nextAction: {
                selector: '[data-tour="create-testset-button"]',
                type: "click",
                waitForSelector: '[data-tour="add-to-testset-drawer"]',
                waitForSelectorVisible: true,
                waitTimeoutMs: 6000,
                advanceOnActionClick: true,
            },
            onNext: async () => {
                const store = getDefaultStore()
                await store.set(selectTestsetAtom, {
                    testsetId: "create",
                    testsetName: "Create New",
                    autoSelectLatest: false,
                })
                // Also update cascader value to show "Create New" in the UI
                await store.set(cascaderValueAtom, ["create"])
                // Trigger auto-mapping to enable the create button
                await store.set(onTestsetSelectAtom)
                await waitForSelectorVisible('[data-tour="testset-name-input"]')
                await new Promise((resolve) => window.setTimeout(resolve, 500))
            },
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
            prevAction: {
                selector: '[data-tour="add-to-testset-close"]',
                type: "click",
                waitForHiddenSelector: '[data-tour="add-to-testset-drawer"]',
                waitTimeoutMs: 6000,
            },
            selectorRetryAttempts: 10,
            selectorRetryDelay: 200,
        },
        {
            icon: "✅",
            title: "Confirm",
            content: "Click Create to save your test set. You can now use it in evaluations.",
            selector: '[data-tour="testset-confirm"]',
            side: "top",
            showControls: true,
            showSkip: true,
            nextAction: {
                selector: '[data-tour="testset-confirm"]',
                type: "click",
                waitForHiddenSelector: '[data-tour="add-to-testset-drawer"]',
                waitTimeoutMs: 10000,
                advanceOnActionClick: true,
            },
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
