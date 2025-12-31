import {setCompleteWidgetTaskMap} from "@/oss/components/Onboarding/components/OnboardingWidget"

import {clearOnboardingState, redirectToAppsPage} from "../assets/utils"

import {resolveGeneralTours} from "./generalSteps"
import {OnboardingStepsContext, TourDefinition} from "./types"

const APP_CREATION_STEPS = [
    {
        tour: "create-first-app",
        steps: [
            {
                icon: "🚀",
                title: "Create a new prompt",
                content: (
                    <span>Click here to create new application using predefined templates</span>
                ),
                selector: "#tour-create-new-prompt",
                side: "left",
                showControls: false,
                showSkip: false,
                pointerPadding: 12,
                pointerRadius: 12,
                advanceOnClick: true,
                onNext: () => {
                    setCompleteWidgetTaskMap("create-first-app")
                    clearOnboardingState()
                },
            },
        ],
    },
]

// integration
const SETUP_TRACING_TOUR: TourDefinition = [
    {
        tour: "trace-setup",
        steps: [
            {
                icon: "🛰️",
                title: "Set up tracing",
                content: (
                    <span>
                        Open tracing setup to instrument your app and start capturing traces for
                        observability.
                    </span>
                ),
                selector: "#tour-setup-tracing-card",
                side: "top",
                showControls: false,
                showSkip: false,
                pointerPadding: 12,
                pointerRadius: 12,
                advanceOnClick: true,
                onNext: () => {
                    setCompleteWidgetTaskMap("trace-setup")
                    clearOnboardingState()
                    void redirectToAppsPage()
                },
            },
        ],
    },
]

export const resolveTours = (ctx: OnboardingStepsContext): TourDefinition => {
    const tourId = ctx.tourId
    if (tourId === "trace-setup") {
        return SETUP_TRACING_TOUR
    }
    if (tourId === "create-first-app") {
        return APP_CREATION_STEPS
    }

    if (tourId === "reopen-onboarding-guide") {
        const generalTours = resolveGeneralTours(ctx)
        if (generalTours.length) return generalTours
    }
    return []
}

const APP_MANAGEMENT_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: (ctx) => resolveTours(ctx),
    "ML/AI Engineer or Data scientist": (ctx) => resolveTours(ctx),
    "Frontend / Backend Developer": (ctx) => resolveTours(ctx),
}

export const APP_MANAGEMENT_TOURS = new Proxy(APP_MANAGEMENT_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof APP_MANAGEMENT_TOUR_MAP
