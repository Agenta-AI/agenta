import {tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"

/**
 * Widget Closed Tour
 *
 * Shows users how to reopen the onboarding widget from the sidebar
 * after they close it for the first time.
 */
export const WIDGET_CLOSED_TOUR_ID = "onboarding-widget-closed-tour"

const widgetClosedTour: OnboardingTour = {
    id: WIDGET_CLOSED_TOUR_ID,
    steps: [
        {
            icon: "🚀",
            title: "Need help getting started?",
            content: "You can always reopen the onboarding guide by clicking here in the sidebar.",
            selector: "[data-menu-id='get-started-guide-link']",
            side: "right",
            showControls: true,
            showSkip: false,
            selectorRetryAttempts: 15,
            selectorRetryDelay: 100,
            pointerPadding: 4,
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
export function registerWidgetClosedTour(): void {
    tourRegistry.register(widgetClosedTour)
}

/**
 * Unregister the tour (for cleanup/testing)
 */
export function unregisterWidgetClosedTour(): void {
    tourRegistry.unregister(WIDGET_CLOSED_TOUR_ID)
}

export default widgetClosedTour
